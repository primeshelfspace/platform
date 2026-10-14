import { BadRequestException } from '@nestjs/common';

/**
 * What a check image may be — the one place that decides, same shape as
 * logo-upload.ts's MAX_LOGO_BYTES/logoExtensionFor. Phone photos of a check
 * run larger than a logo, hence the higher ceiling.
 */
export const MAX_CHECK_IMAGE_BYTES = 10 * 1024 * 1024;

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
}
