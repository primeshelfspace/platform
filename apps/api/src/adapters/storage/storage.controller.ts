import { Controller, Get, Inject, NotFoundException, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ENV, type Env } from '../../config/env.js';
import { Public } from '../../platform/public-api.js';
import { LocalDiskAdapter } from './local-disk.adapter.js';

/**
 * Serves objects for the local disk driver only.
 *
 * In deployed environments STORAGE_DRIVER is s3, signed URLs point at S3, and
 * this route refuses everything — documents are never served through the
 * application tier (TDD-001 §13).
 *
 * @Public() is deliberate, not an oversight: a signed URL exists precisely so
 * a plain `<img src>` or a redirect can fetch it with no Authorization header
 * to attach. The HMAC signature + expiry (verified below) is the access
 * control here, the same way a public invoice token is elsewhere — requiring
 * a session on top would defeat the point of handing out a signed URL at all.
 */
@Controller('storage')
export class StorageController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly local: LocalDiskAdapter,
  ) {}

  @Get('local')
  @Public()
  async serve(
    @Query('key') key: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Query('filename') filename: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (this.env.STORAGE_DRIVER !== 'local') throw new NotFoundException();
    if (!key || !expires || !signature) throw new NotFoundException();
    if (!this.local.verify(key, Number(expires), signature)) throw new NotFoundException();

    const meta = await this.local.head(key);
    if (!meta) throw new NotFoundException();

    const body = await this.local.get(key);
    response.setHeader('content-type', meta.contentType);
    response.setHeader('cache-control', 'private, no-store');
    if (filename) {
      response.setHeader(
        'content-disposition',
        `attachment; filename="${filename.replace(/"/g, '')}"`,
      );
    }
    response.send(body);
  }
}
