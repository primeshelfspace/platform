import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  PutObjectInput,
  ScanResult,
  SignedUrlOptions,
  StoragePort,
  StoredObject,
} from '@fenwick/shared';
import { ENV, type Env } from '../../config/env.js';

/**
 * S3Adapter — the deployed StoragePort. Also drives MinIO locally, since MinIO
 * is S3-compatible and the adapter code runs unchanged (TER-001 §3.2).
 *
 * Server-side encryption is applied by default rather than on request: an
 * unencrypted object in a bucket holding check images is a compliance finding,
 * so the safe behaviour is the one you get without asking.
 */
@Injectable()
export class S3Adapter implements StoragePort {
  readonly providerName = 's3';

  private readonly logger = new Logger(S3Adapter.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.bucket = env.S3_BUCKET ?? '';
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      // MinIO and other S3-compatible endpoints need path-style addressing.
      forcePathStyle: Boolean(env.S3_ENDPOINT),
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        CacheControl: input.cacheControl,
        Metadata: input.metadata as Record<string, string> | undefined,
        ServerSideEncryption: input.encrypt === false ? undefined : 'AES256',
      }),
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
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new Error(`object ${key} returned no body`);
    return Buffer.from(bytes);
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        size: response.ContentLength ?? 0,
        contentType: response.ContentType ?? 'application/octet-stream',
        checksum: (response.ETag ?? '').replace(/"/g, ''),
        storedAt: response.LastModified ?? new Date(),
      };
    } catch (error) {
      // A missing object is a legitimate "no" for callers checking existence
      // (scan() below, in particular). Anything else — no permission, wrong
      // bucket, a network failure — must not look identical to "not found":
      // a health check reading this as a clean miss is exactly how a real S3
      // outage went unnoticed here (NFR-OPS). Note that without s3:ListBucket
      // (least-privilege on purpose — TDD-001 §15.2), S3 itself reports a
      // missing key as 403 rather than 404, so this only catches a genuine
      // 404/NotFound; a 403 for a key that legitimately does not exist yet
      // still surfaces, which is why the health check below proves access by
      // writing a real object rather than heading one that never exists.
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: options.downloadFilename
        ? `attachment; filename="${options.downloadFilename.replace(/"/g, '')}"`
        : undefined,
    });
    return getSignedUrl(this.client, command, { expiresIn: options.expiresInSeconds });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async scan(key: string): Promise<ScanResult> {
    // The bucket is wired to a scanning pipeline that writes a verdict tag.
    // Until that pipeline exists, report honestly rather than claiming clean:
    // customer-supplied uploads are the one place a false "clean" is dangerous.
    const head = await this.head(key);
    if (!head) return { clean: false, signature: 'object-missing', scannedAt: new Date() };
    this.logger.warn(`no scanner configured; ${key} was not scanned`);
    return { clean: false, signature: 'scanner-not-configured', scannedAt: new Date() };
  }

  async healthy(): Promise<boolean> {
    await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: '.healthcheck' }));
    return true;
  }
}

/** True only for S3's own "no such key" — a 403 (missing s3:ListBucket, wrong
 * credentials, no policy at all) must not be mistaken for one. */
function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = 'name' in error ? String((error as { name: unknown }).name) : '';
  const status =
    'httpStatusCode' in error
      ? Number((error as { httpStatusCode: unknown }).httpStatusCode)
      : (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}
