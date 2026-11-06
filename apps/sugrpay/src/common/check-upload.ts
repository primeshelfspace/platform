import { BadRequestException } from '@nestjs/common';
import { contentMatchesType } from '@platform/server';

/**
 * What a check image may be — the one place that decides, same shape as
 * logo-upload.ts's MAX_LOGO_BYTES/logoExtensionFor. Phone photos of a check
 * run larger than a logo, hence the higher ceiling.
 */
export const MAX_CHECK_IMAGE_BYTES = 10 * 1024 * 1024;

/** The purpose check photos are encrypted under (encryptFile/decryptFile). */
export const CHECK_IMAGE_PURPOSE = 'check-image';

/** The image type of decrypted check photo bytes, from their first bytes. */
export function checkImageType(buffer: Buffer): string | null {
  for (const type of CHECK_IMAGE_MIME_TYPES) {
    if (contentMatchesType(buffer, type)) return type;
  }
  return null;
}

const CHECK_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface CheckImageUpload {
  readonly buffer: Buffer;
  readonly mimetype: string;
  readonly size: number;
}

/** Throws the same 400 both the front and back slots need — asserts rather
 * than returning a boolean so the caller's file is narrowed to defined. */
export function assertCheckImage(
  file: CheckImageUpload | undefined,
  side: 'front' | 'back',
): asserts file is CheckImageUpload {
  if (!file) throw new BadRequestException(`a photo of the check's ${side} is required`);
  if (!CHECK_IMAGE_MIME_TYPES.has(file.mimetype)) {
    throw new BadRequestException(`the ${side} photo must be a JPG, PNG, or WEBP image`);
  }
  if (file.size > MAX_CHECK_IMAGE_BYTES) {
    throw new BadRequestException(`the ${side} photo must be 10MB or smaller`);
  }
  if (!contentMatchesType(file.buffer, file.mimetype)) {
    throw new BadRequestException(`the ${side} photo is not a valid JPG, PNG, or WEBP image`);
  }
}
