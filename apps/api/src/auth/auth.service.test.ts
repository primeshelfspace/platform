/**
 * AuthService against in-memory stubs.
 *
 * No database: what is worth pinning down here is the decision logic — which
 * failures are indistinguishable, what order the checks run in, and when the
 * lockout counter trips — none of which needs Postgres to be true. The scoped
 * paths it does not exercise (RLS on `user`) are covered by rls.test.ts.
 */
import { UnauthorizedException } from '@nestjs/common';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RequestScope } from '@fenwick/shared';
import type { PrismaService } from '../infra/prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import type { AuthMailService } from './auth-mail.service.js';
import type { PasswordResetService } from './password-reset.service.js';
import { hashPassword, verifyPassword } from './password.js';
import type { SessionService } from './session.service.js';

const PASSWORD = 'correct-horse-battery-staple';
const OTHER_PASSWORD = 'a-different-password-entirely';

interface UserRow {
  id: string;
  merchantId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  passwordHash: string;
  failedLogins: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

interface AuditRow {
  merchantId: string;
  actorId: string | null;
  action: string;
  outcome: string;
  sourceIp: string | null;
  occurredAt: Date;
  metadata: unknown;
}

/** Just enough of PrismaService for the unscoped paths login actually touches. */
function fakePrisma(users: UserRow[], audit: AuditRow[]) {
  /** Mirrors the subset of Prisma's filter semantics these queries rely on —
   * notably that occurredAt may be bounded by gte (inclusive) or gt
   * (exclusive), which is what distinguishes "within the window" from
   * "since the last success". */
  const matching = (where: Record<string, unknown>) => {
    const occurredAt = where['occurredAt'] as { gte?: Date; gt?: Date } | undefined;
    return audit.filter(
      (row) =>
        row.merchantId === where['merchantId'] &&
        row.actorId === where['actorId'] &&
        row.action === where['action'] &&
        row.outcome === where['outcome'] &&
        (!occurredAt?.gte || row.occurredAt >= occurredAt.gte) &&
        (!occurredAt?.gt || row.occurredAt > occurredAt.gt),
    );
  };

  const client = {
    user: {
      findMany: async ({ where }: { where: { email: string } }) =>
        users.filter((u) => u.email === where.email).sort((a, b) => +a.createdAt - +b.createdAt),
      update: async ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
        const row = users.find((u) => u.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Omit<AuditRow, 'occurredAt'> }) => {
        const row = { ...data, occurredAt: new Date() };
        audit.push(row);
        return row;
      },
      count: async ({ where }: { where: Record<string, unknown> }) => matching(where).length,
      // Used to find the last successful sign-in, so the lockout counts only
      // failures since then (FR-AUTH-002 is about *consecutive* failures).
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const rows = matching(where).sort((a, b) => +b.occurredAt - +a.occurredAt);
        return rows[0] ?? null;
      },
    },
  };

  return {
    withoutScope: async <T>(_reason: string, work: (c: unknown) => Promise<T>) => work(client),
    withScope: async <T>(_scope: unknown, work: (c: unknown) => Promise<T>) => work(client),
  } as unknown as PrismaService;
}

function fakeSessions(issued: string[]) {
  return {
    issue: async (userId: string) => {
      issued.push(userId);
      return { token: `token-for-${userId}`, expiresAt: new Date(Date.now() + 3_600_000) };
    },
    revoke: async () => undefined,
  } as unknown as SessionService;
}

/** login never touches either of these — they exist so the constructor is
 * satisfied, and a call would be a bug this stub makes loud. */
function fakeResets() {
  return {
    issue: () => {
      throw new Error('login must not issue a set-password token');
    },
    consume: () => {
      throw new Error('login must not consume a set-password token');
    },
  } as unknown as PasswordResetService;
}

function fakeMail() {
  return {
    sendSetPasswordLink: () => {
      throw new Error('login must not send mail');
    },
  } as unknown as AuthMailService;
}

function makeUser(overrides: Partial<UserRow> & { passwordHash: string }): UserRow {
  return {
    id: 'user-1',
    merchantId: 'merchant-1',
    email: 'dana@fenwick.test',
    name: 'Dana Fenwick',
    role: 'MERCHANT_OWNER',
    status: 'ACTIVE',
    failedLogins: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('AuthService.login', () => {
  let hash = '';
  let otherHash = '';
  let users: UserRow[];
  let audit: AuditRow[];
  let issued: string[];
  let auth: AuthService;

  const attempt = {
    email: 'dana@fenwick.test',
    password: PASSWORD,
    sourceIp: '198.51.100.7',
    userAgent: 'vitest',
  };

  beforeAll(async () => {
    [hash, otherHash] = await Promise.all([hashPassword(PASSWORD), hashPassword(OTHER_PASSWORD)]);
  });

  beforeEach(() => {
    users = [makeUser({ passwordHash: hash })];
    audit = [];
    issued = [];
    auth = new AuthService(
      fakePrisma(users, audit),
      fakeSessions(issued),
      fakeResets(),
      fakeMail(),
    );
  });

  it('issues a session and clears the failure counter on a correct password', async () => {
    users[0]!.failedLogins = 3;

    const result = await auth.login(attempt);

    expect(result.token).toBe('token-for-user-1');
    expect(result.user.email).toBe('dana@fenwick.test');
    expect(users[0]!.failedLogins).toBe(0);
    expect(users[0]!.lockedUntil).toBeNull();
    expect(users[0]!.lastLoginAt).toBeInstanceOf(Date);
    expect(audit.at(-1)).toMatchObject({ action: 'AUTH_LOGIN', outcome: 'SUCCESS' });
  });

  // FR-AUTH-003: an attacker must not be able to tell these four apart.
  it('gives the same message for an unknown address and a wrong password', async () => {
    const unknown = await auth
      .login({ ...attempt, email: 'nobody@fenwick.test' })
      .catch((e: Error) => e);
    const wrong = await auth.login({ ...attempt, password: 'wrong' }).catch((e: Error) => e);

    expect(unknown).toBeInstanceOf(UnauthorizedException);
    expect(wrong).toBeInstanceOf(UnauthorizedException);
    expect((unknown as Error).message).toBe((wrong as Error).message);
  });

  it('does not record an audit row for an address that matches no user', async () => {
    // audit_log.merchant_id is NOT NULL and there is no merchant to attribute
    // it to; the attempt goes to the application log instead.
    await expect(auth.login({ ...attempt, email: 'nobody@fenwick.test' })).rejects.toThrow();
    expect(audit).toHaveLength(0);
  });

  it('records a failed attempt with its source IP and user agent (FR-AUTH-004)', async () => {
    await expect(auth.login({ ...attempt, password: 'wrong' })).rejects.toThrow();

    expect(audit[0]).toMatchObject({
      action: 'AUTH_LOGIN',
      outcome: 'FAILURE',
      sourceIp: '198.51.100.7',
      metadata: { reason: 'BAD_PASSWORD', userAgent: 'vitest' },
    });
  });

  it('never writes the password into the audit payload', async () => {
    await expect(auth.login({ ...attempt, password: 'hunter2' })).rejects.toThrow();
    expect(JSON.stringify(audit)).not.toContain('hunter2');
  });

  // FR-AUTH-002.
  it('locks the account for 30 minutes on the fifth failure in 15 minutes', async () => {
    for (let i = 0; i < 4; i += 1) {
      await expect(auth.login({ ...attempt, password: 'wrong' })).rejects.toThrow();
    }
    expect(users[0]!.failedLogins).toBe(4);
    expect(users[0]!.lockedUntil).toBeNull();

    await expect(auth.login({ ...attempt, password: 'wrong' })).rejects.toThrow();

    expect(users[0]!.failedLogins).toBe(5);
    const lockedFor = users[0]!.lockedUntil!.getTime() - Date.now();
    expect(lockedFor).toBeGreaterThan(29 * 60_000);
    expect(lockedFor).toBeLessThanOrEqual(30 * 60_000);
  });

  // FR-AUTH-002 says *consecutive*. A successful sign-in ends any run of
  // failures, so the four below must not be counted toward the fifth.
  // Regression: the count was taken from the audit trail over the whole
  // window with no regard for the success in the middle, so this sequence
  // locked the account on a single mistyped password.
  it('does not count failures from before a successful sign-in', async () => {
    for (let i = 0; i < 4; i += 1) {
      await expect(auth.login({ ...attempt, password: 'wrong' })).rejects.toThrow();
    }
    expect(users[0]!.failedLogins).toBe(4);

    await expect(auth.login(attempt)).resolves.toBeDefined();
    expect(users[0]!.failedLogins).toBe(0);
    expect(users[0]!.lockedUntil).toBeNull();

    await expect(auth.login({ ...attempt, password: 'wrong' })).rejects.toThrow();

    expect(users[0]!.failedLogins).toBe(1);
    expect(users[0]!.lockedUntil).toBeNull();
    // And the account is still usable, which is the property that actually matters.
    await expect(auth.login(attempt)).resolves.toBeDefined();
  });

  it('ignores failures that fall outside the 15-minute window', async () => {
    audit.push(
      ...Array.from({ length: 4 }, () => ({
        merchantId: 'merchant-1',
        actorId: 'user-1',
        action: 'AUTH_LOGIN',
        outcome: 'FAILURE',
        sourceIp: null,
        occurredAt: new Date(Date.now() - 20 * 60_000),
        metadata: null,
      })),
    );

    await expect(auth.login({ ...attempt, password: 'wrong' })).rejects.toThrow();

    // Only the one just made counts; the stale four do not.
    expect(users[0]!.failedLogins).toBe(1);
    expect(users[0]!.lockedUntil).toBeNull();
  });

  it('rejects a locked account even when the password is right, and issues no session', async () => {
    users[0]!.lockedUntil = new Date(Date.now() + 10 * 60_000);

    await expect(auth.login(attempt)).rejects.toThrow(UnauthorizedException);

    expect(issued).toEqual([]);
    expect(audit.at(-1)).toMatchObject({ outcome: 'FAILURE', metadata: { reason: 'LOCKED' } });
  });

  it('lets a user back in once the lock has expired', async () => {
    users[0]!.lockedUntil = new Date(Date.now() - 1_000);

    await expect(auth.login(attempt)).resolves.toMatchObject({ token: 'token-for-user-1' });
  });

  it('refuses a SUSPENDED user holding the right password', async () => {
    users[0]!.status = 'SUSPENDED';

    await expect(auth.login(attempt)).rejects.toThrow(UnauthorizedException);

    expect(issued).toEqual([]);
    expect(audit.at(-1)).toMatchObject({ metadata: { reason: 'STATUS_SUSPENDED' } });
  });

  // FR-AUTH-007/021: an INVITED user signs in on the temporary password like
  // anyone else — mustResetPassword is what routes them onward, not a rejection.
  it('signs an INVITED user in and flags mustResetPassword', async () => {
    users[0]!.status = 'INVITED';

    const result = await auth.login(attempt);

    expect(result.token).toBe('token-for-user-1');
    expect(result.user.mustResetPassword).toBe(true);
    expect(issued).toEqual(['user-1']);
    expect(audit.at(-1)).toMatchObject({ action: 'AUTH_LOGIN', outcome: 'SUCCESS' });
  });

  it('does not flag mustResetPassword for an ACTIVE user', async () => {
    const result = await auth.login(attempt);

    expect(result.user.mustResetPassword).toBe(false);
  });

  // Email is unique per merchant, not globally (schema.prisma) — the password
  // is the only thing that can say which of two accounts is being signed into.
  it('signs into the account whose password matches when two merchants share an address', async () => {
    users.push(
      makeUser({
        id: 'user-2',
        merchantId: 'merchant-2',
        passwordHash: otherHash,
        createdAt: new Date('2026-02-01'),
      }),
    );

    const result = await auth.login({ ...attempt, password: OTHER_PASSWORD });

    expect(result.user.id).toBe('user-2');
    expect(result.user.merchantId).toBe('merchant-2');
  });
});

describe('AuthService.logout', () => {
  it('revokes the session server-side and records it (FR-AUTH-010)', async () => {
    const audit: AuditRow[] = [];
    const revoked: string[] = [];
    const sessions = {
      issue: async () => ({ token: '', expiresAt: new Date() }),
      revoke: async (sessionId: string) => {
        revoked.push(sessionId);
      },
    } as unknown as SessionService;

    const auth = new AuthService(fakePrisma([], audit), sessions, fakeResets(), fakeMail());
    const scope: RequestScope = {
      merchantId: 'merchant-1',
      userId: 'user-1',
      role: 'MERCHANT_OWNER',
      assignedBrandIds: [],
      sessionId: 'session-1',
      sourceIp: '198.51.100.7',
    };

    await auth.logout(scope);

    expect(revoked).toEqual(['session-1']);
    expect(audit.at(-1)).toMatchObject({ action: 'AUTH_LOGOUT', outcome: 'SUCCESS' });
  });
});

describe('AuthService.setPassword', () => {
  const scope: RequestScope = {
    merchantId: 'merchant-1',
    userId: 'user-1',
    role: 'MERCHANT_OWNER',
    assignedBrandIds: [],
    sessionId: 'session-1',
    sourceIp: '198.51.100.7',
  };

  it('hashes the new password, flips status to ACTIVE, and records an audit row', async () => {
    const users = [makeUser({ passwordHash: await hashPassword(PASSWORD), status: 'INVITED' })];
    const audit: AuditRow[] = [];
    const auth = new AuthService(
      fakePrisma(users, audit),
      fakeSessions([]),
      fakeResets(),
      fakeMail(),
    );

    await auth.setPassword(scope, 'a-brand-new-password');

    expect(users[0]!.status).toBe('ACTIVE');
    expect(users[0]!.passwordHash).not.toBe(PASSWORD);
    await expect(verifyPassword('a-brand-new-password', users[0]!.passwordHash)).resolves.toBe(
      true,
    );
    expect(audit.at(-1)).toMatchObject({ action: 'AUTH_PASSWORD_SET', outcome: 'SUCCESS' });
  });

  it('leaves an already-ACTIVE user ACTIVE', async () => {
    const users = [makeUser({ passwordHash: await hashPassword(PASSWORD), status: 'ACTIVE' })];
    const auth = new AuthService(fakePrisma(users, []), fakeSessions([]), fakeResets(), fakeMail());

    await auth.setPassword(scope, 'a-brand-new-password');

    expect(users[0]!.status).toBe('ACTIVE');
  });
});
