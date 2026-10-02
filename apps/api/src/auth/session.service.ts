import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { RequestScope, Role } from '@sugrpay/shared';
import { PrismaService } from '../infra/prisma/prisma.service.js';

/**
 * Session issue and resolution (TDD-001 §7.1).
 *
 * The raw token is returned to the caller once and never stored: the database
 * holds only its SHA-256 digest, so a database disclosure does not yield usable
 * sessions.
 *
 * The `session` table is deliberately outside row-level security — the scope is
 * derived FROM it, so it cannot itself be scoped. Resolution goes through the
 * `app_resolve_session` definer function, which returns exactly what the guard
 * needs and nothing else, keeping the `user` table protected by RLS as normal.
 */
export const SESSION_COOKIE = 'sugrpay_session';
const SESSION_TTL_HOURS = 12;

interface ResolvedSessionRow {
  session_id: string;
  user_id: string;
  merchant_id: string;
  role: Role;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  expires_at: Date;
  revoked_at: Date | null;
  brand_ids: string[];
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(
    userId: string,
    context: { sourceIp?: string | null; userAgent?: string | null } = {},
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);

    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: SessionService.hash(token),
        expiresAt,
        sourceIp: context.sourceIp ?? null,
        userAgent: context.userAgent ?? null,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Resolves a raw session token into the immutable request scope. Returns null
   * for anything unknown, expired, revoked, or belonging to a non-active user —
   * the caller turns all of those into the same 401 without distinguishing them.
   */
  async resolve(token: string, sourceIp: string | null): Promise<RequestScope | null> {
    const rows = await this.prisma.$queryRaw<ResolvedSessionRow[]>`
      SELECT * FROM app_resolve_session(${SessionService.hash(token)})
    `;

    const row = rows[0];
    if (!row) return null;
    if (row.revoked_at) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    // SUSPENDED may not hold a session at all. INVITED is allowed through: it
    // is how a session issued to a first-login, mustResetPassword user is able
    // to reach /auth/set-password in the first place — see AuthService.login.
    if (row.status === 'SUSPENDED') return null;

    return {
      merchantId: row.merchant_id,
      userId: row.user_id,
      role: row.role,
      assignedBrandIds: row.brand_ids ?? [],
      sessionId: row.session_id,
      sourceIp,
    };
  }

  async touch(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { lastSeenAt: new Date() },
    });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /** Housekeeping for the scheduled queue. */
  async purgeExpired(): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
