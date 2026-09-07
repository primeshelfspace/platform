import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  PutObjectInput,
  ScanResult,
  SignedUrlOptions,
  StoragePort,
  StoredObject,
} from '@fenwick/shared';
import { ENV, type Env } from '../../config/env.js';

/**
 * LocalDiskAdapter — StoragePort backed by the filesystem, for local
 * development without MinIO.
 *
 * Signed URLs are real HMAC-signed, expiring URLs pointing at the API's own
 * local-object route, so the calling code exercises the same expiry and
 * verification path it will use against S3.
 */
@Injectable()
export class LocalDiskAdapter implements StoragePort {
  readonly providerName = 'local-disk';

  private readonly logger = new Logger(LocalDiskAdapter.name);
  private readonly root: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.root = path.resolve(process.cwd(), env.STORAGE_LOCAL_PATH);
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const target = this.resolve(input.key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, input.body);
    await fs.writeFile(
      `${target}.meta.json`,
      JSON.stringify({ contentType: input.contentType, metadata: input.metadata ?? {} }),
      'utf8',
    );

    return {
      key: input.key,
      size: input.body.byteLength,
      contentType: input.contentType,
      checksum: createHash('sha256').update(input.body).digest('hex'),
      storedAt: new Date(),
    };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async head(key: string): Promise<StoredObject | null> {
    const target = this.resolve(key);
    try {
      const stat = await fs.stat(target);
      const meta = await fs
        .readFile(`${target}.meta.json`, 'utf8')
        .then((raw) => JSON.parse(raw) as { contentType?: string })
        .catch(() => ({}) as { contentType?: string });
      return {
        key,
        size: stat.size,
        contentType: meta.contentType ?? 'application/octet-stream',
        checksum: createHash('sha256')
          .update(await fs.readFile(target))
          .digest('hex'),
        storedAt: stat.mtime,
      };
    } catch (error) {
      // A missing file is a legitimate "no" for callers checking existence.
      // Anything else — permission denied, a full disk, the root itself
      // missing — must not look identical to "not found" (see S3Adapter.head
      // for why that distinction matters to the health check).
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + options.expiresInSeconds;
    const signature = this.sign(key, expiresAt);
    const url = new URL('/storage/local', this.env.API_PUBLIC_URL);
    url.searchParams.set('key', key);
    url.searchParams.set('expires', String(expiresAt));
    url.searchParams.set('signature', signature);
    if (options.downloadFilename) url.searchParams.set('filename', options.downloadFilename);
    return url.toString();
  }

  async delete(key: string): Promise<void> {
    const target = this.resolve(key);
    await fs.rm(target, { force: true });
    await fs.rm(`${target}.meta.json`, { force: true });
  }

  async scan(_key: string): Promise<ScanResult> {
    // No scanner locally. Deployed environments bind the S3 adapter, which
    // delegates to the real scanning pipeline.
    return { clean: true, signature: null, scannedAt: new Date() };
  }

  // --- Signature helpers, used by the local object route -------------------

  sign(key: string, expiresAtSeconds: number): string {
    return createHmac('sha256', this.env.SESSION_SECRET)
      .update(`${key}:${expiresAtSeconds}`)
      .digest('hex');
  }

  verify(key: string, expiresAtSeconds: number, signature: string): boolean {
    if (Number.isNaN(expiresAtSeconds) || expiresAtSeconds < Math.floor(Date.now() / 1000)) {
      return false;
    }
    const expected = Buffer.from(this.sign(key, expiresAtSeconds));
    const provided = Buffer.from(signature);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }

  /**
   * Resolves a storage key to a path inside the storage root, refusing any key
   * that would escape it. Keys reach this method from customer-influenced
   * values such as attachment filenames.
   */
  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (target !== this.root && !target.startsWith(rootWithSep)) {
      throw new Error(`storage key "${key}" resolves outside the storage root`);
    }
    return target;
  }
}
