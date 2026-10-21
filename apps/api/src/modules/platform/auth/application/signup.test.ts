/**
 * Self-serve signup (FR-ONB) against the real platform database, with a mail
 * port that can be made to fail.
 *
 * The flow: register creates the company, its INVITED owner, the Sugrpay
 * subscription and product role, then emails a set-password link. The email is
 * part of the outcome — these tests pin what happens when it cannot be sent,
 * and when someone signs up again before ever setting a password.
 */
import { randomUUID } from 'node:crypto';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SendMailInput } from '@platform/kernel';
import { createFakeMailPort } from '../../../../shared/adapters/mail/fake-mail.port.js';
import { loadEnv } from '../../../../shared/config/load-env.js';
import { getEnv } from '../../../../shared/config/env.js';
import type { RedisService } from '../../../../shared/infra/redis/redis.service.js';
import { PrismaClient } from '../../database/client.js';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';
import { AuthMailService } from './auth-mail.service.js';
import { AuthService, MAIL_UNAVAILABLE_MESSAGE } from './auth.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { SessionService } from './session.service.js';

loadEnv();
const hasDb = Boolean(process.env['PLATFORM_DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

describeWithDb('signup', () => {
  const prisma = new PlatformPrismaService(env!);
  const fake = createFakeMailPort();
  let mailFails = false;
  const mail = {
    ...fake,
    send: async (input: SendMailInput) => {
      if (mailFails) throw new Error('SMTP send failed');
      return fake.send(input);
    },
  };
  // Signup does not rate-limit; forgot-password does, and always allows here.
  const redis = { acquireGenericRateToken: async () => true } as unknown as RedisService;
  const auth = new AuthService(
    prisma,
    new SessionService(prisma),
    new PasswordResetService(prisma),
    new AuthMailService(mail, env!),
    redis,
  );
  const owner = new PrismaClient({
    datasources: { db: { url: env!.PLATFORM_DIRECT_DATABASE_URL ?? env!.PLATFORM_DATABASE_URL } },
  });
  const context = { sourceIp: '127.0.0.1', userAgent: 'vitest' };
  const used: string[] = [];
  const newEmail = () => {
    const email = `signup-${randomUUID().slice(0, 8)}@signup-test.test`;
    used.push(email);
    return email;
  };
  const accounts = (email: string) =>
    owner.user.findMany({
      where: { email },
      include: { merchant: { include: { subscriptions: true } }, productRoles: true },
    });

  beforeEach(() => {
    mailFails = false;
    fake.outbox.length = 0;
  });

  afterAll(async () => {
    const users = await owner.user.findMany({ where: { email: { in: used } } });
    await owner.merchant.deleteMany({ where: { id: { in: users.map((u) => u.merchantId) } } });
    await owner.$disconnect();
    await prisma.$disconnect();
  });

  it('creates the company, an invited owner, the Sugrpay subscription and role, and emails a link', async () => {
    const email = newEmail();
    await auth.register({ fullName: 'Sign Up', email }, context);

    const [user] = await accounts(email);
    expect(user).toMatchObject({ status: 'INVITED', role: 'MERCHANT_OWNER', name: 'Sign Up' });
    expect(user!.merchant.subscriptions.map((s) => s.product)).toEqual(['INVOICING']);
    expect(user!.productRoles.map((r) => [r.product, r.role])).toEqual([
      ['INVOICING', 'MERCHANT_OWNER'],
    ]);
    expect(fake.outbox).toHaveLength(1);
    expect(fake.outbox[0]!.to).toEqual([email]);
    expect(fake.outbox[0]!.text).toContain('/set-password?token=');
  });

  it('undoes the signup and answers 503 when the email cannot be sent', async () => {
    const email = newEmail();
    mailFails = true;

    const attempt = auth.register({ fullName: 'No Mail', email }, context);
    await expect(attempt).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(attempt).rejects.toThrow(MAIL_UNAVAILABLE_MESSAGE);

    expect(await accounts(email)).toHaveLength(0);
    expect(await owner.merchant.count({ where: { contactEmail: email } })).toBe(0);
  });

  it('lets the same person try again after a failed email, without "already exists"', async () => {
    const email = newEmail();
    mailFails = true;
    await expect(auth.register({ fullName: 'Retry', email }, context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    mailFails = false;
    await auth.register({ fullName: 'Retry', email }, context);
    expect(await accounts(email)).toHaveLength(1);
    expect(fake.outbox).toHaveLength(1);
  });

  it('re-sends the link, without a second company, when the account is still waiting for a password', async () => {
    const email = newEmail();
    await auth.register({ fullName: 'Twice', email }, context);
    await auth.register({ fullName: 'Twice', email }, context);

    const users = await accounts(email);
    expect(users).toHaveLength(1);
    expect(fake.outbox).toHaveLength(2);
    expect(fake.outbox[1]!.to).toEqual([email]);
    // Two different, live links: the second is a fresh token.
    expect(fake.outbox[0]!.text).not.toEqual(fake.outbox[1]!.text);
    expect(await owner.passwordResetToken.count({ where: { userId: users[0]!.id } })).toBe(2);
  });

  it('answers 503 and keeps the waiting account when a re-send cannot be sent', async () => {
    const email = newEmail();
    await auth.register({ fullName: 'Keep', email }, context);
    mailFails = true;

    await expect(auth.register({ fullName: 'Keep', email }, context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(await accounts(email)).toHaveLength(1);
  });

  it('refuses an address that has finished signing up (409)', async () => {
    const email = newEmail();
    await auth.register({ fullName: 'Done', email }, context);
    await owner.user.updateMany({ where: { email }, data: { status: 'ACTIVE' } });

    await expect(auth.register({ fullName: 'Done', email }, context)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await accounts(email)).toHaveLength(1);
  });

  it('forgot-password answers the same way when the email cannot be sent', async () => {
    const email = newEmail();
    await auth.register({ fullName: 'Forgot', email }, context);
    mailFails = true;

    await expect(auth.requestPasswordReset(email, context)).resolves.toBeUndefined();
    await expect(
      auth.requestPasswordReset(`nobody-${randomUUID().slice(0, 6)}@signup-test.test`, context),
    ).resolves.toBeUndefined();
  });
});
