import { Injectable } from '@nestjs/common';
import type { Pagination, Scope } from '@platform/kernel';
import { InvoicingPrismaService } from '../../database/invoicing-prisma.service.js';

export interface ZohoActivityEntry {
  readonly direction: 'PUSH' | 'PULL';
  readonly objectType: string;
  readonly objectId: string | null;
  /** What the row is about, in words: "78 contacts in 1 call, 78 saved" for a
   * list scan, the customer's name or the invoice number for one record.
   * Null on rows written before this existed. */
  readonly summary: string | null;
  readonly status: string;
  readonly errorClass: string | null;
  readonly lastError: string | null;
  readonly updatedAt: Date;
}

/** Same envelope as the platform's other paginated lists. */
export interface ZohoActivityPage {
  readonly data: ZohoActivityEntry[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/**
 * FR-ZHO-020/021, and the direct answer to "is this actually doing anything
 * real": every push and pull attempt records a SyncJob row with the
 * provider's own verbatim error, not a paraphrase. This surfaces the last N of
 * them so that is visible on the page itself, not just in a database query
 * someone has to ask for.
 *
 * Lives in invoicing because sync jobs do: the platform owns the connection,
 * invoicing owns what it syncs over it.
 */
@Injectable()
export class ZohoActivityService {
  constructor(private readonly prisma: InvoicingPrismaService) {}

  async getRecentActivity(
    scope: Scope,
    brandId: string,
    { page, pageSize }: Pagination,
  ): Promise<ZohoActivityPage> {
    const where = { brandId, provider: 'ZOHO_BOOKS' as const };
    const [rows, total] = await this.prisma.withScope(scope, (tx) =>
      Promise.all([
        tx.syncJob.findMany({
          where,
          // id as a tiebreaker: a list scan and its per-record jobs often
          // share an updatedAt, and without a total order the same row can
          // appear on two pages (or neither) as the log is paged through.
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.syncJob.count({ where }),
      ]),
    );
    return {
      data: rows.map((row) => ({
        direction: row.direction,
        objectType: row.objectType,
        objectId: row.objectId,
        summary: row.summary,
        status: row.status,
        errorClass: row.errorClass,
        lastError: row.lastError,
        updatedAt: row.updatedAt,
      })),
      page,
      pageSize,
      total,
    };
  }
}
