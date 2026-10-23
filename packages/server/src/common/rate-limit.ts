import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RedisService } from '../redis/redis.service.js';

export const RATE_LIMIT_KEY = 'platform:rate-limit';

export interface RateLimitRule {
  /** Names the bucket, e.g. 'login'. */
  readonly name: string;
  /** Requests allowed per window from one client address. Leave it out on
   * routes only the web app's server calls: there every user shares the
   * server's address, and a per-address count would be a global one. */
  readonly limit?: number;
  readonly windowSeconds: number;
  /** Also count per :token path parameter (public invoice routes), so one
   * invoice link cannot be hammered from many addresses either. */
  readonly perTokenLimit?: number;
  /** Also count per body.email (sign-in, sign-up, password reset). These
   * calls come through the web app's server, so the address alone would put
   * every user in one bucket — the per-address limit there is a loose brake,
   * and this is the one that bites. */
  readonly perEmailLimit?: number;
  /** Also count per signed-in company — a quota on what one tenant may do,
   * e.g. how many emails it may send a day. */
  readonly perCompanyLimit?: number;
}

/**
 * Caps how often one client may call a route. For the unauthenticated routes
 * that are worth abusing: sign-in (password guessing), sign-up and password
 * reset (mail flooding), and the public invoice routes (card testing, PDF
 * rendering, check uploads). A fixed window in Redis, shared by every API
 * process.
 */
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_KEY, rule);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.get<RateLimitRule | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!rule) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const keys: Array<[string, number]> = [];
    if (rule.limit) {
      keys.push([`ratelimit:http:${rule.name}:ip:${request.ip ?? 'unknown'}`, rule.limit]);
    }
    const token = (request.params as Record<string, string | undefined>)['token'];
    if (rule.perTokenLimit && token) {
      keys.push([`ratelimit:http:${rule.name}:token:${token}`, rule.perTokenLimit]);
    }
    const merchantId = (request as Request & { scope?: { merchantId?: string } }).scope?.merchantId;
    if (rule.perCompanyLimit && merchantId) {
      keys.push([`ratelimit:http:${rule.name}:company:${merchantId}`, rule.perCompanyLimit]);
    }
    const email = (request.body as Record<string, unknown> | undefined)?.['email'];
    if (rule.perEmailLimit && typeof email === 'string' && email.length > 0) {
      keys.push([
        `ratelimit:http:${rule.name}:email:${email.trim().toLowerCase()}`,
        rule.perEmailLimit,
      ]);
    }

    try {
      for (const [key, limit] of keys) {
        if (!(await this.redis.acquireGenericRateToken(key, limit, rule.windowSeconds))) {
          throw new HttpException(
            'Too many requests. Please wait a moment and try again.',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Redis being down must not take sign-in down with it.
      this.logger.warn(`rate limit unavailable, allowing request: ${String(error)}`);
    }
    return true;
  }
}
