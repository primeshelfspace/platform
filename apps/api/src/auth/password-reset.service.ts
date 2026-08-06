import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service.js';

/**
 * Set-password / reset links (FR-AUTH-005/006, FR-ONB).
 *
 * The raw token is returned once, goes into an email, and is never stored —
 * only its SHA-256 digest is, exactly as SessionService treats session tokens.
 * A database disclosure therefore yields no usable links.
 *
 * Every read and write here is unscoped, and for the same reason login is: the
 * token is what establishes who the caller is, so the lookup cannot itself be
 * scoped by that answer. The table is outside RLS for the same reason.
 */
const TOKEN_TTL_HOURS = 24;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(private readonly prisma: PrismaService) {}

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Mints a link for this user and invalidates any earlier unused one — asking
   * again must not leave two live credentials for the same account in two
   * different inboxes.
   */
  async issue(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 3600 * 1000);

    await this.prisma.withoutScope(
      'issuing a set-password token (the recipient holds no session yet)',
      async (client) => {
        await client.passwordResetToken.updateMany({
          where: { userId, usedAt: null },
          data: { usedAt: new Date() },
        });
        await client.passwordResetToken.create({
          data: { userId, tokenHash: PasswordResetService.hash(token), expiresAt },
        });
      },
    );

    return { token, expiresAt };
  }

  /**
   * Spends a token, returning the user it belongs to. Null for anything
   * unknown, expired or already used — the caller turns all three into the
   * same message, since distinguishing them tells a holder of a bad token
   * which kind of bad it is.
   *
   * The consuming UPDATE is conditional on `used_at IS NULL` and single-use is
   * enforced by how many rows it touches, not by a read-then-write: two
   * requests arriving together would both pass a prior SELECT, and only one
   * can win this.
   */
  async consume(token: string): Promise<{ userId: string } | null> {
    const tokenHash = PasswordResetService.hash(token);

    return this.prisma.withoutScope(
      'consuming a set-password token (this is what establishes who the caller is)',
      async (client) => {
        const claimed = await client.passwordResetToken.updateMany({
          where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (claimed.count === 0) {
          this.logger.warn('set-password token rejected: unknown, expired, or already used');
          return null;
        }

        const row = await client.passwordResetToken.findUnique({
          where: { tokenHash },
          select: { userId: true },
        });
        return row ? { userId: row.userId } : null;
      },
    );
  }

  /** Housekeeping for the scheduled queue, once it has a handler. */
  async purgeExpired(): Promise<number> {
    const result = await this.prisma.withoutScope('purging expired set-password tokens', (client) =>
      client.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    );
    return result.count;
  }
}
