import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/authorisation.js';
import { ENV, type Env } from '../config/env.js';

/** The header one API sends another to prove it is one of ours. */
export const INTERNAL_KEY_HEADER = 'x-internal-key';

/**
 * For routes only the other APIs may call (`/internal/...`): no user session,
 * but the shared INTERNAL_API_KEY. nginx also refuses `/internal/` from the
 * internet, so this key is the second lock, not the only one.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.env.INTERNAL_API_KEY;
    if (!expected) throw new ServiceUnavailableException('internal API is not configured');
    const sent = context.switchToHttp().getRequest<Request>().headers[INTERNAL_KEY_HEADER];
    if (typeof sent !== 'string' || !sameSecret(sent, expected)) {
      throw new UnauthorizedException('internal route');
    }
    return true;
  }
}

/** Marks a route as API-to-API only: skips the user guard, requires the key. */
export const InternalOnly = () => applyDecorators(Public(), UseGuards(InternalKeyGuard));

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Thrown when another API cannot be reached or answers with an error. */
export class InternalCallError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/**
 * Calls another API's internal routes. Short timeout: these calls sit on the
 * path of a user's request, and a hung platform API must fail fast rather
 * than hold every Sugrpay request open.
 */
export class InternalClient {
  private readonly logger = new Logger(InternalClient.name);

  constructor(
    private readonly baseUrl: string,
    private readonly key: string,
    private readonly timeoutMs = 5000,
  ) {}

  async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          [INTERNAL_KEY_HEADER]: this.key,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      this.logger.error(`internal ${method} ${path} unreachable: ${String(error)}`);
      throw new InternalCallError(`internal API unreachable: ${path}`, null);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new InternalCallError(
        `internal ${method} ${path} answered ${response.status}`,
        response.status,
      );
    }
    return (text ? JSON.parse(text) : null) as T;
  }
}
