import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { RequestScope } from '@platform/kernel';
import {
  refreshProductSessionSchema,
  type RefreshProductSessionInput,
} from '@platform/platform-contracts';
import { CurrentScope, Public, RateLimit, RequirePermission, zodPipe } from '@platform/server';
import {
  ProductSessionService,
  type ProductUserDetails,
} from '../application/product-session.service.js';
import type { ProductTokens } from '../application/session.service.js';

/**
 * Product Session — User Details & Tokens. A product (HQ or Sugrpay) sends the
 * JWT it was given on Continue; `me` needs only that, no user or Company id.
 * Any signed-in user may ask (ORGANISATION_PROFILE READ is held by every
 * role; see AuthController). Refresh is public: the refresh token is the
 * credential.
 */
@Controller('product-session')
export class ProductSessionController {
  constructor(private readonly productSessions: ProductSessionService) {}

  @Get('me')
  @RequirePermission('ORGANISATION_PROFILE', 'READ', { brandFrom: 'none' })
  me(@CurrentScope() scope: RequestScope): Promise<ProductUserDetails> {
    return this.productSessions.details(scope);
  }

  @Post('refresh')
  @Public()
  @RateLimit({ name: 'product-refresh', limit: 600, windowSeconds: 300 })
  @HttpCode(200)
  refresh(
    @Body(zodPipe(refreshProductSessionSchema)) body: RefreshProductSessionInput,
  ): Promise<ProductTokens> {
    return this.productSessions.refresh(body.refreshToken);
  }
}
