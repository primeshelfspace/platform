import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { RegisterInput, RequestScope, Role } from '@fenwick/shared';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { hashPassword, verifyPassword } from './password.js';
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

/** FR-AUTH-002: 5 consecutive failures within 15 minutes locks for 30. */
const FAILURE_WINDOW_MINUTES = 15;
const MAX_FAILURES_IN_WINDOW = 5;
const LOCKOUT_MINUTES = 30;

/** The audit `action` for a sign-in attempt, successful or not. */
export const AUDIT_LOGIN = 'AUTH_LOGIN';
export const AUDIT_LOGOUT = 'AUTH_LOGOUT';
export const AUDIT_PASSWORD_SET = 'AUTH_PASSWORD_SET';
export const AUDIT_REGISTER = 'AUTH_REGISTER';

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
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly passwordResets: PasswordResetService,
    private readonly mail: AuthMailService,
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
   * FR-ONB: self-serve signup. Creates the tenant and its first owner, then
   * emails a set-password link.
   *
   * No session is issued here and no password is chosen yet: proving control
   * of the address is what the emailed link is for. Until it is followed the
   * account exists but is unreachable — its password hash is random and nobody
   * holds the input to it.
   *
   * Unscoped for the same reason login is: there is no tenant yet to scope to
   * — this call is what creates one.
   */
  async register(input: RegisterInput, context: AttemptContext): Promise<void> {
    const passwordHash = await hashPassword(randomBytes(32).toString('hex'));

    const created = await this.prisma.withoutScope(
      'creating a merchant and its first owner during signup (no tenant exists yet)',
      async (client) => {
        // Signup refuses an address already in use anywhere. The schema allows
        // the same address under two merchants — the same person may hold
        // accounts at two client organisations — but that is for an
        // administrator inviting them, not for self-serve, where it would
        // silently create a second tenant the user cannot tell apart from the
        // first at the sign-in prompt.
        const existing = await client.user.findFirst({
          where: { email: input.email },
          select: { id: true },
        });
        if (existing) return null;

        return client.user.create({
          data: {
            email: input.email,
            name: input.fullName,
            passwordHash,
            role: 'MERCHANT_OWNER',
            status: 'INVITED',
            merchant: {
              create: {
                // A placeholder until the company-details step collects the
                // real legal name; Merchant.name is NOT NULL and something has
                // to identify the tenant in the interim.
                name: input.fullName,
                contactEmail: input.email,
              },
            },
          },
        });
      },
    );

    if (!created) {
      throw new ConflictException('an account with this email address already exists');
    }

    const { token } = await this.passwordResets.issue(created.id);
    // Awaited, not queued: this message is the flow. See AuthMailService.
    await this.mail.sendSetPasswordLink({
      to: created.email,
      name: created.name,
      token,
      isNewAccount: true,
    });

    await this.record(created.merchantId, created.id, 'SUCCESS', null, context, AUDIT_REGISTER);
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
      (client) =>
        client.user.update({
          where: { id: claim.userId },
          data: { passwordHash, status: 'ACTIVE', failedLogins: 0, lockedUntil: null },
        }),
    );

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
   * voluntary change later (already ACTIVE, and stays that way). Does not
   * ask for the current password: the caller already holds a live session,
   * which is its own proof of who they are for this one action.
   */
  async setPassword(scope: RequestScope, newPassword: string): Promise<void> {
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.withScope(scope, (tx) =>
      tx.user.update({
        where: { id: scope.userId },
        data: { passwordHash, status: 'ACTIVE' },
      }),
    );
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
   * FR-AUTH-002. The 15-minute window is counted from the audit trail rather
   * than from a column on `user`, because FR-AUTH-004 already requires every
   * attempt to be written there — a `failed_logins` integer alone cannot say
   * *when* those failures happened, and adding a timestamp column would be a
   * second, redundant record of the same events.
   */
  private async registerFailure(
    merchantId: string,
    userId: string,
    context: AttemptContext,
  ): Promise<void> {
    await this.record(merchantId, userId, 'FAILURE', 'BAD_PASSWORD', context);

    const windowStart = new Date(Date.now() - FAILURE_WINDOW_MINUTES * 60_000);

    await this.prisma.withoutScope('counting recent sign-in failures for lockout', async (c) => {
      // "Consecutive" is the whole of FR-AUTH-002, so the count has to start
      // after the last successful sign-in, not merely at the window edge. A
      // successful login already clears the failedLogins column, but that
      // column is not what this decision reads — without this the audit trail
      // still holds the earlier failures, and a user who mistyped four times,
      // signed in fine, then fumbled once would be locked out on that single
      // failure.
      const lastSuccess = await c.auditLog.findFirst({
        where: {
          merchantId,
          actorId: userId,
          action: AUDIT_LOGIN,
          outcome: 'SUCCESS',
          occurredAt: { gte: windowStart },
        },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      });
      const countFrom =
        lastSuccess && lastSuccess.occurredAt > windowStart ? lastSuccess.occurredAt : windowStart;

      const failures = await c.auditLog.count({
        where: {
          merchantId,
          actorId: userId,
          action: AUDIT_LOGIN,
          outcome: 'FAILURE',
          occurredAt: { gt: countFrom },
        },
      });

      await c.user.update({
        where: { id: userId },
        data: {
          failedLogins: failures,
          ...(failures >= MAX_FAILURES_IN_WINDOW
            ? { lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) }
            : {}),
        },
      });

      if (failures >= MAX_FAILURES_IN_WINDOW) {
        this.logger.warn(
          `locked user ${userId} for ${LOCKOUT_MINUTES}m after ${failures} failures`,
        );
      }
    });
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
