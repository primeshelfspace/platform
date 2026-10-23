import { Global, Module } from '@nestjs/common';
import { ENV, getEnv } from './env.js';

/**
 * Global so that no module has to import it, and validated eagerly so that a
 * bad configuration fails at boot rather than on first use.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: getEnv }],
  exports: [ENV],
})
export class ConfigModule {}
