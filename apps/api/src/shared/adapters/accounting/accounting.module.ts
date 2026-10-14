import { Module } from '@nestjs/common';
import { ACCOUNTING_PORT } from '@sugrpay/shared';
import { ENV, type Env } from '../../config/env.js';
import { FakeAccountingAdapter } from './fake-accounting.adapter.js';
import { ZohoBooksAdapter } from './zoho-books.adapter.js';

@Module({
  providers: [
    FakeAccountingAdapter,
    ZohoBooksAdapter,
    {
      provide: ACCOUNTING_PORT,
      inject: [ENV, FakeAccountingAdapter, ZohoBooksAdapter],
      useFactory: (env: Env, fake: FakeAccountingAdapter, zoho: ZohoBooksAdapter) =>
        env.ACCOUNTING_DRIVER === 'zoho' ? zoho : fake,
    },
  ],
  exports: [ACCOUNTING_PORT, FakeAccountingAdapter, ZohoBooksAdapter],
})
export class AccountingModule {}
