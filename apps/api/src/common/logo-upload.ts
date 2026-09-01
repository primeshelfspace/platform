import { BadRequestException } from '@nestjs/common';
import type { MailAttachment, StoragePort } from '@fenwick/shared';

/**
 * The one definition of what a logo may be, and the one path that stores it.
 *
 * BrandsService and MerchantService each held their own copy of the size
 * limit, the accepted MIME map and the signed-URL TTL, plus a near-identical
 * validate → put → sign sequence. Unlike the pure helpers elsewhere, that
 * duplication was behavioural: raising the limit in one place left the other
 * still rejecting at the old one, and the two would have disagreed about what
 * a valid logo is while both claiming to enforce "the" rule.
 */
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

const LOGO_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
};

export const LOGO_URL_TTL_SECONDS = 3600;

export interface LogoUpload {
  readonly buffer: Buffer;
  readonly mimetype: string;
  readonly size: number;
}

/** Validates the upload and returns the file extension its MIME type implies.
 * Throws the same 400s both callers used to raise separately. */
export function logoExtensionFor(file: LogoUpload): string {
  const extension = LOGO_EXTENSION_BY_MIME[file.mimetype];
  if (!extension) {
    throw new BadRequestException('logo must be a JPG, PNG, or SVG image');
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new BadRequestException('logo must be 5MB or smaller');
  }
  return extension;
}

/**
 * Stores the logo and returns a signed URL for it.
 *
 * Deliberately takes a fully-formed key rather than building one: the two
 * callers namespace differently (`storageKeys.brandLogo` vs
 * `storageKeys.merchantLogo`), and that difference is real rather than
 * incidental. Runs outside any database transaction — `put` is a network call,
 * and withScope holds a real transaction open for the whole of its callback.
 */
/** The Content-ID an email's HTML uses to reference the inline logo part. */
export const LOGO_CID = 'brand-logo';

const LOGO_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
};

/**
 * Reads a brand's logo back out of storage as an inline mail attachment.
 *
 * Emails embed the bytes rather than link to them: a signed URL expires (an
 * hour here, seven days at the outside on S3), and an invoice email is read
 * whenever the recipient gets to it. Returns null when the brand has no logo
 * or the object cannot be read — a missing logo falls back to the brand's
 * initial in the template, which is never worth failing a send over.
 */
export async function brandLogoAttachment(
  storage: StoragePort,
  logoKey: string | null,
): Promise<MailAttachment | null> {
  if (!logoKey) return null;

  const extension = logoKey.split('.').pop()?.toLowerCase() ?? '';
  const contentType = LOGO_MIME_BY_EXTENSION[extension];
  if (!contentType) return null;

  try {
    const content = await storage.get(logoKey);
    return { filename: `logo.${extension}`, contentType, content, cid: LOGO_CID };
  } catch {
    return null;
  }
}

export async function storeLogo(
  storage: StoragePort,
  key: string,
  file: LogoUpload,
): Promise<string> {
  await storage.put({ key, body: file.buffer, contentType: file.mimetype, encrypt: true });
  return storage.getSignedUrl(key, { expiresInSeconds: LOGO_URL_TTL_SECONDS });
}
