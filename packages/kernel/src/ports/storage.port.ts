/**
 * StoragePort (TDD-001 §10.2).
 *
 * S3 in deployed environments, MinIO or local disk locally — the same adapter
 * contract either way, so nothing above this line knows which is in use.
 *
 * Binary content is never stored in the database; tables hold storage keys
 * (TDD-001 §5.2, check_submission).
 */

export interface PutObjectInput {
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string;
  readonly cacheControl?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  /** Server-side encryption is mandatory in deployed environments. */
  readonly encrypt?: boolean;
}

export interface StoredObject {
  readonly key: string;
  readonly size: number;
  readonly contentType: string;
  readonly checksum: string;
  readonly storedAt: Date;
}

export interface SignedUrlOptions {
  readonly expiresInSeconds: number;
  /** Forces a download with this filename rather than inline rendering. */
  readonly downloadFilename?: string;
}

export interface ScanResult {
  readonly clean: boolean;
  readonly signature?: string | null;
  readonly scannedAt: Date;
}

export interface StoragePort {
  readonly providerName: string;

  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  head(key: string): Promise<StoredObject | null>;
  /** Time-limited URL. PDFs are never served through the application tier. */
  getSignedUrl(key: string, options: SignedUrlOptions): Promise<string>;
  delete(key: string): Promise<void>;
  /** Malware scan for customer-supplied uploads (check images, attachments). */
  scan(key: string): Promise<ScanResult>;
}

export const STORAGE_PORT = Symbol('StoragePort');

/** Key layout, centralised so every producer and consumer agrees. */
export const storageKeys = {
  invoicePdf: (brandId: string, invoiceId: string, contentVersion: string): string =>
    `brands/${brandId}/invoices/${invoiceId}/invoice-${contentVersion}.pdf`,
  receiptPdf: (brandId: string, paymentId: string): string =>
    `brands/${brandId}/receipts/${paymentId}.pdf`,
  brandLogo: (brandId: string, filename: string): string => `brands/${brandId}/logo/${filename}`,
  /** Staged on Merchant during onboarding, before any Brand exists to own a
   * logo of its own — copied into the first Brand's logoKey on SINGLE
   * brand-structure, same as the rest of the staged company details. */
  merchantLogo: (merchantId: string, filename: string): string =>
    `merchants/${merchantId}/logo/${filename}`,
  checkImage: (brandId: string, submissionId: string, side: 'front' | 'back'): string =>
    `brands/${brandId}/checks/${submissionId}-${side}`,
  invoiceAttachment: (brandId: string, invoiceId: string, filename: string): string =>
    `brands/${brandId}/invoices/${invoiceId}/attachments/${filename}`,
} as const;
