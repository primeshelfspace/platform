import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../database/client.js';
import {
  type CheckReviewStatus,
  type CheckSubmissionListQuery,
  type ReviewCheckSubmissionInput,
} from '@platform/invoicing-contracts';
import {
  formatMinor,
  isPublicScope,
  STORAGE_PORT,
  toCurrencyCode,
  type Scope,
  type StoragePort,
} from '@platform/kernel';
import { InvoicingPrismaService } from '../../database/invoicing-prisma.service.js';
import { ENV, decryptFile, encryptFile, isEncryptedFile, type Env } from '@platform/server';
import { CHECK_IMAGE_PURPOSE, checkImageType } from '../../../common/check-upload.js';
import { InvoicesService } from '../../invoices/application/invoices.service.js';

type CheckSubmissionRow = Prisma.CheckSubmissionGetPayload<{
  include: {
    invoice: {
      select: { number: true; currency: true; customer: { select: { displayName: true } } };
    };
  };
}>;

/** A listing row — enough for the Check Verifications table to render one
 * line without a second round trip per row, same shape as PaymentListRow. */
export interface CheckSubmissionListRow {
  readonly id: string;
  readonly checkNumber: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: CheckReviewStatus;
  readonly customerName: string;
  readonly invoiceNumber: string;
  readonly createdAt: Date;
}

export interface CheckSubmissionListResult {
  readonly data: CheckSubmissionListRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface CheckSubmissionDetail extends CheckSubmissionListRow {
  readonly invoiceId: string;
  readonly customerNote: string | null;
  readonly reviewNote: string | null;
  readonly reviewedAt: Date | null;
  /** Where the photos are read: GET /brands/:brandId/checks/:id/images/front
   * (and /back), signed-in staff only. There is no storage link any more. */
  readonly frontImageUrl: string;
  readonly backImageUrl: string;
}

export interface CheckImage {
  readonly body: Buffer;
  readonly contentType: string;
}

/**
 * Payments > Check Verifications (FR-PAY's "Upload Check" method — Brand
 * Settings' checkEnabled toggle is the customer-facing half; this is the
 * staff-facing review half). A SUBMITTED/UNDER_REVIEW row is reviewed exactly
 * once: approve records a real settled payment against the linked invoice
 * (reusing InvoicesService.recordManualPayment rather than re-deriving the
 * balance/status transition), reject just closes the row out with a reason.
 */
@Injectable()
export class ChecksService {
  constructor(
    private readonly prisma: InvoicingPrismaService,
    private readonly invoices: InvoicesService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(
    scope: Scope,
    brandId: string,
    query: CheckSubmissionListQuery,
  ): Promise<CheckSubmissionListResult> {
    return this.prisma.withScope(scope, async (tx) => {
      const where: Prisma.CheckSubmissionWhereInput = { brandId };
      if (query.status === 'PENDING') {
        where.status = { in: ['SUBMITTED', 'UNDER_REVIEW'] };
      } else if (query.status) {
        where.status = query.status;
      }
      if (query.search) {
        const search = query.search;
        where.OR = [
          { checkNumber: { contains: search, mode: 'insensitive' } },
          { invoice: { number: { contains: search, mode: 'insensitive' } } },
          { invoice: { customer: { displayName: { contains: search, mode: 'insensitive' } } } },
        ];
      }

      const [rows, total] = await Promise.all([
        tx.checkSubmission.findMany({
          where,
          include: {
            invoice: {
              select: { number: true, currency: true, customer: { select: { displayName: true } } },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.checkSubmission.count({ where }),
      ]);
      return {
        data: rows.map((row) => this.toListRow(row)),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  async getDetail(scope: Scope, brandId: string, id: string): Promise<CheckSubmissionDetail> {
    const row = await this.findOrThrow(scope, brandId, id);
    // The photos are encrypted, so there is no storage link to hand out: they
    // are read through image() below, which checks who is asking.
    const frontImageUrl = `/brands/${brandId}/checks/${id}/images/front`;
    const backImageUrl = `/brands/${brandId}/checks/${id}/images/back`;
    return {
      ...this.toListRow(row),
      invoiceId: row.invoiceId,
      customerNote: row.customerNote,
      reviewNote: row.reviewNote,
      reviewedAt: row.reviewedAt,
      frontImageUrl,
      backImageUrl,
    };
  }

  /**
   * One photo of a check, decrypted, for staff who can see this brand's
   * payments (the route's permission, and findOrThrow's brand scope). A photo
   * stored before encryption existed is encrypted in place the first time it
   * is opened, so none stays readable in storage once looked at.
   */
  async image(
    scope: Scope,
    brandId: string,
    id: string,
    side: 'front' | 'back',
  ): Promise<CheckImage> {
    const row = await this.findOrThrow(scope, brandId, id);
    const key = side === 'front' ? row.frontImageKey : row.backImageKey;
    const stored = await this.storage.get(key);
    const secret = this.env.CREDENTIAL_ENCRYPTION_KEY;

    let body: Buffer;
    if (isEncryptedFile(stored)) {
      body = decryptFile(stored, secret, CHECK_IMAGE_PURPOSE);
    } else {
      body = stored;
      await this.storage.put({
        key,
        body: encryptFile(stored, secret, CHECK_IMAGE_PURPOSE),
        contentType: 'application/octet-stream',
        metadata: { 'sugrpay-encrypted': 'aes-256-gcm' },
        encrypt: true,
      });
    }
    const contentType = checkImageType(body);
    if (!contentType) throw new NotFoundException('check photo is not a readable image');
    return { body, contentType };
  }

  /** Records a SETTLED CHECK payment for the submission's claimed amount
   * (invoice balance/status follow from that the same way a manually
   * recorded payment's would), then closes the submission out. Not wrapped in
   * one transaction with recordManualPayment — see reviewedBy guard below for
   * why a races-with-itself double approval still can't double the money. */
  async approve(
    scope: Scope,
    brandId: string,
    id: string,
    input: ReviewCheckSubmissionInput,
  ): Promise<void> {
    const submission = await this.requirePending(scope, brandId, id);
    await this.invoices.recordManualPayment(scope, brandId, submission.invoiceId, {
      // The reviewer's reading of the check wins: a $50 check must not clear
      // a $5,000 balance just because that is what the customer claimed.
      amount:
        input.amount ??
        formatMinor(Number(submission.amountMinor), toCurrencyCode(submission.invoice.currency)),
      method: 'CHECK',
      paidAt: new Date(),
      reference: submission.checkNumber,
    });
    // If this loses a race with a concurrent review, the payment above still
    // landed — an accepted tradeoff for a low-volume, staff-only action, same
    // as recordManualPayment itself has no cross-request lock on "has someone
    // else already recorded a payment for this invoice right now".
    await this.finishReview(scope, brandId, id, 'APPROVED', input.note ?? null);
  }

  async reject(
    scope: Scope,
    brandId: string,
    id: string,
    input: ReviewCheckSubmissionInput,
  ): Promise<void> {
    if (!input.note) {
      throw new ConflictException('a reason is required to reject a check');
    }
    await this.requirePending(scope, brandId, id);
    await this.finishReview(scope, brandId, id, 'REJECTED', input.note);
  }

  private async findOrThrow(
    scope: Scope,
    brandId: string,
    id: string,
  ): Promise<CheckSubmissionRow> {
    const row = await this.prisma.withScope(scope, (tx) =>
      tx.checkSubmission.findFirst({
        where: { id, brandId },
        include: {
          invoice: {
            select: { number: true, currency: true, customer: { select: { displayName: true } } },
          },
        },
      }),
    );
    if (!row) throw new NotFoundException('check submission not found');
    return row;
  }

  private async requirePending(
    scope: Scope,
    brandId: string,
    id: string,
  ): Promise<CheckSubmissionRow> {
    const row = await this.findOrThrow(scope, brandId, id);
    if (row.status !== 'SUBMITTED' && row.status !== 'UNDER_REVIEW') {
      throw new ConflictException('this check has already been reviewed');
    }
    return row;
  }

  private async finishReview(
    scope: Scope,
    brandId: string,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    note: string | null,
  ): Promise<void> {
    if (isPublicScope(scope)) {
      // Unreachable in practice: CHECK_APPROVAL is never granted to the
      // public payment scope, so the guard refuses this before the service
      // is ever called. Narrows the type for reviewedBy below.
      throw new ConflictException('check review requires an authenticated session');
    }
    const reviewerId = scope.userId;
    await this.prisma.withScope(scope, async (tx) => {
      const { count } = await tx.checkSubmission.updateMany({
        where: { id, brandId, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
        data: { status, reviewedBy: reviewerId, reviewNote: note, reviewedAt: new Date() },
      });
      if (count === 0) {
        throw new ConflictException('this check changed while saving — reload and try again');
      }
    });
  }

  private toListRow(row: CheckSubmissionRow): CheckSubmissionListRow {
    return {
      id: row.id,
      checkNumber: row.checkNumber,
      amountMinor: row.amountMinor,
      currency: row.invoice.currency,
      status:
        row.status === 'APPROVED' ? 'APPROVED' : row.status === 'REJECTED' ? 'REJECTED' : 'PENDING',
      customerName: row.invoice.customer.displayName,
      invoiceNumber: row.invoice.number,
      createdAt: row.createdAt,
    };
  }
}
