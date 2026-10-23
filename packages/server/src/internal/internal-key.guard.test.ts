/**
 * The lock on the APIs' /internal routes: only a caller holding the shared
 * INTERNAL_API_KEY gets through (nginx also refuses /internal/ publicly).
 */
import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env.js';
import { INTERNAL_KEY_HEADER, InternalKeyGuard } from './internal-key.guard.js';

const KEY = 'k'.repeat(48);

function context(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('InternalKeyGuard', () => {
  const guard = new InternalKeyGuard({ INTERNAL_API_KEY: KEY } as Env);

  it('lets the right key through', () => {
    expect(guard.canActivate(context({ [INTERNAL_KEY_HEADER]: KEY }))).toBe(true);
  });

  it('refuses no key, a wrong key, and a key of a different length', () => {
    for (const headers of [
      {},
      { [INTERNAL_KEY_HEADER]: 'x'.repeat(48) },
      { [INTERNAL_KEY_HEADER]: KEY.slice(0, 20) },
      { [INTERNAL_KEY_HEADER]: `${KEY}extra` },
    ]) {
      expect(() => guard.canActivate(context(headers))).toThrow(UnauthorizedException);
    }
  });

  it('refuses everything when no key is configured', () => {
    const unconfigured = new InternalKeyGuard({} as Env);
    expect(() => unconfigured.canActivate(context({ [INTERNAL_KEY_HEADER]: '' }))).toThrow(
      ServiceUnavailableException,
    );
  });
});
