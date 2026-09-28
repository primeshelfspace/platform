/** Mirrors Prisma's PaymentStatus enum (apps/api/prisma/schema.prisma) — kept
 * here, not imported from @prisma/client, so this package stays framework
 * and database free (see packages/shared/src/index.ts's own doc comment).
 * Used by the Transaction Log's status filter (FR-PAY). */
export const PAYMENT_STATUSES = [
  'INITIATED',
  'PROCESSING',
  'SETTLED',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'CANCELLED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
