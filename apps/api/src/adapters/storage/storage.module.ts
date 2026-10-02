import { Module } from '@nestjs/common';
import { STORAGE_PORT } from '@sugrpay/shared';
import { ENV, type Env } from '../../config/env.js';
import { LocalDiskAdapter } from './local-disk.adapter.js';
import { S3Adapter } from './s3.adapter.js';
import { StorageController } from './storage.controller.js';

@Module({
  controllers: [StorageController],
  providers: [
    LocalDiskAdapter,
    S3Adapter,
    {
      provide: STORAGE_PORT,
      inject: [ENV, LocalDiskAdapter, S3Adapter],
      useFactory: (env: Env, local: LocalDiskAdapter, s3: S3Adapter) =>
        env.STORAGE_DRIVER === 's3' ? s3 : local,
    },
  ],
  exports: [STORAGE_PORT, LocalDiskAdapter, S3Adapter],
})
export class StorageModule {}
