import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RequestScope } from '@platform/kernel';
import type { RegisterInput, Role } from '@platform/platform-contracts';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';
import { RedisService } from '@platform/server';
import { hashPassword, verifyPassword } from '../infrastructure/password.js';
import { SessionService } from './session.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { AuthMailService } from './auth-mail.service.js';

/**
 * Sign-in (FR-AUTH-001..004, FR-AUTH-010).
 *
 * Every read here runs through `withoutScope`, and that is not an oversight:
 * the request scope is *derived from* a successful credential check, so the
 * check itself cannot be scoped by it. This is the same reasoning that put
 * session resolution behind the `app_resolve_session` definer function — see
 * the note in migrations/20260727180200_rls_and_grants. The blast radius is
 * kept small by doing all of it in one place, on one narrow lookup keyed by
 * email, returning nothing to the caller that a generic failure would not.
 */

/** Sign In: 5 failed attempts in a row lock the account for 2 hours. */
export const MAX_CONSECUTIVE_FAILURES = 5;
export const LOCKOUT_HOURS = 2;

/** FR-AUTH-005: at most 3 forgot-password requests per address per hour. Keyed
 * by address rather than source IP — see requestPasswordReset. */
/** Shown when the set-password email cannot be sent, so the person knows to
 * retry rather than seeing a bare server error. */
export const MAIL_UNAVAILABLE_MESSAGE =
  'We could not send the email to set your password. Please try again in a few minutes.';

const FORGOT_PASSWORD_LIMIT = 3;
const FORGOT_PASSWORD_WINDOW_SECONDS = 3600;

/** The audit `action` for a sign-in attempt, successful or not. */
export const AUDIT_LOGIN = 'AUTH_LOGIN';
export const AUDIT_LOGOUT = 'AUTH_LOGOUT';
export const AUDIT_PASSWORD_SET = 'AUTH_PASSWORD_SET';
export const AUDIT_REGISTER = 'AUTH_REGISTER';
export const AUDIT_PASSWORD_RESET_REQUEST = 'AUTH_PASSWORD_RESET_REQUEST';

export interface LoginAttempt {
  readonly email: string;
  readonly password: string;
  readonly sourceIp: string | null;
  readonly userAgent: string | null;
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly merchantId: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  /** True for a user who has never signed in with a password of their own
   * choosing — an INVITED account signing in for the first time with the
   * temporary password whoever created it set. The client's only obligation
   * on seeing this is to send them to set a real one before anything else. */
  readonly mustResetPassword: boolean;
}

export interface LoginResult {
  readonly token: string;
  readonly expiresAt: Date;
  readonly user: AuthenticatedUser;
}

/**
 * FR-AUTH-003: one message for every failure — bad password, unknown address,
 * suspended account, locked account. Anything that distinguishes them tells an
 * attacker which addresses are worth attacking.
 */
const GENERIC_FAILURE = 'invalid email or password';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * A throwaway hash, derived once, verified against when no user matches. Without
   * it "unknown address" returns in microseconds while "wrong password" pays for a
   * scrypt derivation, and that timing difference re-opens the enumeration hole
   * FR-AUTH-003 closes in the response body.
   */
  private decoyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly sessions: SessionService,
    private readonly passwordResets: PasswordResetService,
    private readonly mail: AuthMailService,
    private readonly redis: RedisService,
  ) {}

  async login(attempt: LoginAttempt): Promise<LoginResult> {
    const user = await this.prisma.withoutScope(
      'resolving credentials for a sign-in attempt (no scope exists until it succeeds)',
      async (client) => {
        // Email is unique per merchant, not globally (schema.prisma: the same
        // person may hold accounts at two client organisations), so this is a
        // findMany. In practice it returns one row; when it returns more, the
        // password decides which — that is the only signal we have, and trying
        // each is what keeps a shared address from locking a user out of an
        // account they can actually prove they own.
        const candidates = await client.user.findMany({
          where: { email: attempt.email },
          orderBy: { createdAt: 'asc' },
        });

        if (candidates.length === 0) {
          await verifyPassword(attempt.password, await this.decoy());
          return null;
        }

        for (const candidate of candidates) {
          if (await verifyPassword(attempt.password, candidate.passwordHash)) {
            return { row: candidate, passwordMatched: true as const };
          }
        }
        // Attribute the failure to the first candidate so the lockout counter
        // and the audit trail have somewhere to land.
        return { row: candidates[0]!, passwordMatched: false as const };
      },
    );

    if (!user) {
      // No merchant to attribute an audit row to, and audit_log.merchant_id is
      // NOT NULL. The application log is the only place this can be recorded.
      this.logger.warn(`sign-in attempt for an unknown address from ${attempt.sourceIp ?? '?'}`);
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    const { row, passwordMatched } = user;

    const context = { sourceIp: attempt.sourceIp, userAgent: attempt.userAgent };

    // Order matters: the lock is checked before the password result is acted on,
    // so a locked account cannot be probed for a correct password.
    if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
      await this.record(row.merchantId, row.id, 'FAILURE', 'LOCKED', context);
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    if (!passwordMatched) {
      await this.registerFailure(row.merchantId, row.id, context);
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    // SUSPENDED has been switched off and may not hold a session, and is not
    // told that is why (FR-AUTH-003). INVITED is different on purpose: the
    // temporary password an owner/admin set *is* this account's password
    // until setPassword replaces it, so it signs in like any other — the
    // mustResetPassword flag below is what stops it going anywhere else
    // first, not a rejection here.
    if (row.status === 'SUSPENDED') {
      await this.record(row.merchantId, row.id, 'FAILURE', `STATUS_${row.status}`, context);
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    const { token, expiresAt } = await this.sessions.issue(row.id, {
      sourceIp: attempt.sourceIp,
      userAgent: attempt.userAgent,
    });

    await this.prisma.withoutScope('clearing the lockout counter after a successful sign-in', (c) =>
      c.user.update({
        where: { id: row.id },
        data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
      }),
    );
    await this.record(row.merchantId, row.id, 'SUCCESS', null, context);

    return {
      token,
      expiresAt,
      user: {
        id: row.id,
        merchantId: row.merchantId,
        email: row.email,
        name: row.name,
        role: row.role,
        mustResetPassword: row.status === 'INVITED',
      },
    };
  }

  /**
   * Sign Up: a company email and a password. Creates the company and its
   * first user, the Company Admin (MERCHANT_OWNER), active with that password,
   * and signs them in. No product is enabled yet; that is Select Your Products.
   * The company is registered next (Register Your Company).
   *
   * One account per email across every company: an address with any account,
   * in any company and any status, is refused (409), so a person cannot end up
   * with two companies behind one sign-in. Checked under a transaction-scoped
   * advisory lock on the address, so two sign-ups with the same email at the
   * same moment cannot both pass the check.
   *
   * Unscoped for the same reason login is: there is no tenant yet to scope to
   * — this call is what creates one.
   */
  async register(input: RegisterInput, context: AttemptContext): Promise<LoginResult> {
    const passwordHash = await hashPassword(input.password);
    // Not asked on Sign Up; the part before the @ until the person sets a name.
    const name = input.email.split('@')[0] ?? input.email;

    const created = await this.prisma.withoutScope(
      'creating a company and its Company Admin during sign-up (no tenant exists yet)',
      (client) =>
        client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'signup:' + input.email}))`;
          const taken = await tx.user.findFirst({
            where: { email: { equals: input.email, mode: 'insensitive' } },
            select: { id: true },
          });
          if (taken) return null;
          return tx.user.create({
            data: {
              email: input.email,
              name,
              passwordHash,
              role: 'MERCHANT_OWNER',
              status: 'ACTIVE',
              merchant: {
                create: {
                  // Until Register Your Company names it.
                  name: input.email.split('@')[1] ?? input.email,
                  contactEmail: input.email,
                  companyEmail: input.email,
                },
              },
            },
          });
        }),
    );

    if (!created) {
      throw new ConflictException({
        message: 'an account with this email address already exists',
        code: 'EMAIL_TAKEN',
        issues: [
          { path: 'email', message: 'an account with this email already exists', code: 'taken' },
        ],
      });
    }

    await this.record(created.merchantId, created.id, 'SUCCESS', null, context, AUDIT_REGISTER);

    const { token, expiresAt } = await this.sessions.issue(created.id, {
      sourceIp: context.sourceIp,
      userAgent: context.userAgent,
    });
    await this.prisma.withoutScope('recording the first sign-in after sign-up', (c) =>
      c.user.update({ where: { id: created.id }, data: { lastLoginAt: new Date() } }),
    );

    return {
      token,
      expiresAt,
      user: {
        id: created.id,
        merchantId: created.merchantId,
        email: created.email,
        name: created.name,
        role: created.role,
        mustResetPassword: false,
      },
    };
  }

  /**
   * FR-AUTH-005: "I forgot my password." Always acknowledges the same way
   * regardless of whether the address matches anything — same reasoning as
   * GENERIC_FAILURE in login, and for the same reason: "no such account" is a
   * free email-enumeration oracle, and so, just as much, is "you've already
   * asked too many times" — so a caller over the limit gets this exact same
   * silent return rather than a distinct error.
   *
   * Throttled per address rather than per source IP: a spray from many IPs
   * must not be able to flood one inbox, and one office's shared IP must not
   * lock everyone behind it out of resetting their own password.
   *
   * Email is unique per merchant, not globally (schema.prisma) — the same
   * person may hold accounts at two client organisations — so every matching,
   * non-suspended account gets its own link. SUSPENDED is excluded on
   * purpose: the link's follow-through, setPasswordWithToken, flips status to
   * ACTIVE by design (FR-AUTH-006), and this path must not become a back door
   * out of a suspension.
   */
  async requestPasswordReset(email: string, context: AttemptContext): Promise<void> {
    const allowed = await this.redis.acquireGenericRateToken(
      `ratelimit:forgot-password:${email}`,
      FORGOT_PASSWORD_LIMIT,
      FORGOT_PASSWORD_WINDOW_SECONDS,
    );
    if (!allowed) return;

    const candidates = await this.prisma.withoutScope(
      'looking up an address for a forgot-password request (no scope exists until one is chosen)',
      (client) =>
        client.user.findMany({
          where: { email, status: { not: 'SUSPENDED' } },
          orderBy: { createdAt: 'asc' },
        }),
    );

    for (const candidate of candidates) {
      const { token } = await this.passwordResets.issue(candidate.id);
      try {
        await this.mail.sendSetPasswordLink({
          to: candidate.email,
          name: candidate.name,
          token,
          isNewAccount: false,
        });
      } catch (error) {
        // Same silent answer as every other outcome: an error only when the
        // address has an account would tell anyone which addresses do.
        this.logger.error(
          `forgot-password: could not send the reset link to ${candidate.email}`,
          error,
        );
        continue;
      }
      await this.record(
        candidate.merchantId,
        candidate.id,
        'SUCCESS',
        null,
        context,
        AUDIT_PASSWORD_RESET_REQUEST,
      );
    }
  }

  /**
   * FR-AUTH-006: setting a password from an emailed link, with no session.
   *
   * The token is the credential and is spent atomically before anything else
   * happens, so a link cannot be replayed. Clearing INVITED here is what makes
   * the account reachable at all — and a session is issued so the new owner
   * continues straight into onboarding rather than being asked to sign in with
   * the password they typed ten seconds ago.
   *
   * Every other session for the user is revoked: whoever followed this link is
   * now the only holder of the password, and anything already signed in
   * predates that proof.
   */
  async setPasswordWithToken(
    token: string,
    newPassword: string,
    context: AttemptContext,
  ): Promise<LoginResult> {
    const claim = await this.passwordResets.consume(token);
    if (!claim) {
      throw new UnauthorizedException('this link is no longer valid');
    }

    const passwordHash = await hashPassword(newPassword);
    const user = await this.prisma.withoutScope(
      'setting a password from an emailed token (no session exists until it succeeds)',
      async (client) => {
        // A suspended account stays suspended: an invite or reset link sent
        // before the suspension must not be a way back in.
        const updated = await client.user.updateMany({
          where: { id: claim.userId, status: { not: 'SUSPENDED' } },
          data: { passwordHash, status: 'ACTIVE', failedLogins: 0, lockedUntil: null },
        });
        if (updated.count === 0) return null;
        return client.user.findUniqueOrThrow({ where: { id: claim.userId } });
      },
    );
    if (!user) {
      throw new UnauthorizedException('this link is no longer valid');
    }

    await this.sessions.revokeAllForUser(user.id);
    const { token: sessionToken, expiresAt } = await this.sessions.issue(user.id, context);
    await this.record(user.merchantId, user.id, 'SUCCESS', null, context, AUDIT_PASSWORD_SET);

    return {
      token: sessionToken,
      expiresAt,
      user: {
        id: user.id,
        merchantId: user.merchantId,
        email: user.email,
        name: user.name,
        role: user.role,
        mustResetPassword: false,
      },
    };
  }

  /**
   * The signed-in user's own identity. Runs scoped rather than unscoped: the
   * `user_scope` RLS policy is `merchant_id = app_merchant_id()`, so a session
   * can always reach its own row and never anyone else's.
   */
  async profile(scope: RequestScope): Promise<AuthenticatedUser | null> {
    const row = await this.prisma.withScope(scope, (tx) =>
      tx.user.findUnique({
        where: { id: scope.userId },
        select: { id: true, merchantId: true, email: true, name: true, role: true, status: true },
      }),
    );
    if (!row) return null;
    return {
      id: row.id,
      merchantId: row.merchantId,
      email: row.email,
      name: row.name,
      role: row.role,
      mustResetPassword: row.status === 'INVITED',
    };
  }

  /**
   * FR-AUTH-007/021: the one path that ever changes passwordHash, whether
   * this is a first-login forced reset off a temporary one (row.status is
   * still INVITED, and this is what clears it — see login above) or a
   * voluntary change later (already ACTIVE, and stays that way), which must
   * also prove the current password.
   */
  async setPassword(
    scope: RequestScope,
    newPassword: string,
    currentPassword?: string,
  ): Promise<void> {
    const current = await this.prisma.withScope(scope, (tx) =>
      tx.user.findUniqueOrThrow({
        where: { id: scope.userId },
        select: { status: true, passwordHash: true },
      }),
    );
    // A voluntary change needs the current password: a session token alone
    // (stolen, or a browser left signed in) must not be enough to lock the
    // owner out. The forced first-login reset (INVITED) has no password the
    // user knows, so it is exempt.
    if (current.status !== 'INVITED') {
      if (!currentPassword || !(await verifyPassword(currentPassword, current.passwordHash))) {
        throw new UnauthorizedException('your current password is not correct');
      }
    }

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.withScope(scope, (tx) =>
      tx.user.update({
        where: { id: scope.userId },
        data: { passwordHash, status: 'ACTIVE' },
      }),
    );
    // Every other session predates the new password; only this one stays.
    await this.sessions.revokeAllForUser(scope.userId, scope.sessionId);
    await this.record(
      scope.merchantId,
      scope.userId,
      'SUCCESS',
      null,
      {
        sourceIp: scope.sourceIp,
        userAgent: null,
      },
      AUDIT_PASSWORD_SET,
    );
  }

  /** FR-AUTH-010: sign-out terminates the session server-side, not just in the browser. */
  async logout(scope: RequestScope): Promise<void> {
    await this.sessions.revoke(scope.sessionId);
    await this.record(
      scope.merchantId,
      scope.userId,
      'SUCCESS',
      null,
      { sourceIp: scope.sourceIp, userAgent: null },
      AUDIT_LOGOUT,
    );
  }

  /**
   * Sign In lockout: 5 failed attempts in a row lock the account for 2 hours.
   * "In a row" is user.failed_logins: a successful sign-in sets it back to 0,
   * and so does the end of a lock, so the first failure after a lock counts as
   * the first again. While locked this is never reached: login refuses before
   * checking the password, so a locked account cannot be probed and the lock
   * is not extended.
   *
   * One statement, under a row lock, so two wrong passwords at the same
   * moment both count.
   */
  private async registerFailure(
    merchantId: string,
    userId: string,
    context: AttemptContext,
  ): Promise<void> {
    await this.record(merchantId, userId, 'FAILURE', 'BAD_PASSWORD', context);

    const [counted] = await this.prisma.withoutScope(
      'counting consecutive sign-in failures for lockout',
      (c) => c.$queryRaw<Array<{ failed_logins: number; locked: boolean }>>`
        UPDATE "user" AS u
        SET failed_logins = n.count,
            locked_until = CASE
              WHEN n.count >= ${MAX_CONSECUTIVE_FAILURES}::int
                THEN timezone('UTC', now()) + make_interval(hours => ${LOCKOUT_HOURS}::int)
              ELSE NULL
            END
        FROM (
          SELECT id,
                 CASE WHEN locked_until IS NOT NULL AND locked_until <= timezone('UTC', now())
                      THEN 1 ELSE failed_logins + 1 END AS count
          FROM "user" WHERE id = ${userId}::uuid FOR UPDATE
        ) AS n
        WHERE u.id = n.id
        RETURNING u.failed_logins, u.locked_until IS NOT NULL AS locked`,
    );

    if (counted?.locked) {
      this.logger.warn(
        `locked user ${userId} for ${LOCKOUT_HOURS}h after ${counted.failed_logins} failures in a row`,
      );
    }
  }

  /**
   * FR-AUTH-004: every attempt, successful or not, with timestamp, source IP and
   * user agent. NFR-SEC: the password never reaches this function's payload.
   */
  private async record(
    merchantId: string,
    userId: string,
    outcome: 'SUCCESS' | 'FAILURE',
    reason: string | null,
    context: AttemptContext,
    action: string = AUDIT_LOGIN,
  ): Promise<void> {
    await this.prisma.withoutScope('writing an authentication audit entry', (c) =>
      c.auditLog.create({
        data: {
          merchantId,
          actorType: 'USER',
          actorId: userId,
          action,
          objectType: 'USER',
          objectId: userId,
          sourceIp: context.sourceIp,
          outcome,
          metadata: { reason, userAgent: context.userAgent },
        },
      }),
    );
  }

  private decoy(): Promise<string> {
    this.decoyHash ??= hashPassword(randomBytes(32).toString('hex'));
    return this.decoyHash;
  }
}

/** What an audit row records about where an attempt came from. Never the password. */
interface AttemptContext {
  readonly sourceIp: string | null;
  readonly userAgent: string | null;
}
