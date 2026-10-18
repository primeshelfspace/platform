import { Injectable } from '@nestjs/common';
import { isPublicScope, type Scope } from '@platform/shared';
import type { Prisma } from '../../database/client.js';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';

export interface AuditEntry {
  readonly brandId: string | null;
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string | null;
  readonly outcome: 'SUCCESS' | 'FAILURE';
  readonly metadata?: Record<string, unknown>;
}

/**
 * The platform's append-only audit log, open to every product. audit_log has
 * no UPDATE or DELETE grant (see the rls_and_grants migration), which is what
 * makes it evidence.
 *
 * A product records its entry right after its own change commits — the
 * change lives in the product's database and the log in the platform's, so
 * they cannot share a transaction. The actor is taken from the scope; a
 * public (token-scoped) caller is recorded as a system actor.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PlatformPrismaService) {}

  async record(scope: Scope, entry: AuditEntry): Promise<void> {
    await this.prisma.withScope(scope, (tx) =>
      tx.auditLog.create({
        data: {
          merchantId: scope.merchantId,
          brandId: entry.brandId,
          actorType: isPublicScope(scope) ? 'SYSTEM' : 'USER',
          actorId: isPublicScope(scope) ? null : scope.userId,
          action: entry.action,
          objectType: entry.objectType,
          objectId: entry.objectId,
          sourceIp: scope.sourceIp,
          outcome: entry.outcome,
          metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      }),
    );
  }
}
