import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import type { RequestScope } from '@platform/kernel';
import { hexColourSchema, idSchema } from '@platform/kernel';
import { InternalOnly, zodPipe } from '@platform/server';
import { z } from 'zod';
import { AuditLogService, type AuditEntry } from '../audit/application/audit-log.service.js';
import { SessionService } from '../auth/application/session.service.js';
import { BrandsService } from '../brands/application/brands.service.js';
import { StripeAccountService } from '../integrations/application/stripe-account.service.js';

/** The caller's scope, exactly as /internal/sessions/resolve returned it. */
const scopeSchema = z.object({
  merchantId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.string().min(1),
  assignedBrandIds: z.array(z.string().uuid()),
  sessionId: z.string().uuid(),
  sourceIp: z.string().nullable(),
  products: z.array(z.string()).optional(),
  productRoles: z.record(z.string()).optional(),
  assignedLocationIds: z.array(z.string().uuid()).optional(),
  product: z.string().optional(),
});
const resolveSessionSchema = z.object({
  token: z.string().min(1).max(200),
  sourceIp: z.string().max(100).nullable(),
});

const themeColorSchema = z.object({ scope: scopeSchema, themeColor: hexColourSchema });

const auditSchema = z.object({
  scope: scopeSchema,
  entry: z.object({
    brandId: z.string().uuid().nullable(),
    action: z.string().min(1).max(100),
    objectType: z.string().min(1).max(100),
    objectId: z.string().max(100).nullable(),
    outcome: z.enum(['SUCCESS', 'FAILURE']),
    metadata: z.record(z.unknown()).optional(),
  }),
});

/**
 * What product APIs (Sugrpay, later HQ) ask the platform for. Never reachable
 * from the internet: nginx refuses /internal/, and every route needs the
 * shared INTERNAL_API_KEY. A product sends the caller's scope it received
 * from /internal/sessions/resolve; the platform still applies its own rules
 * (row-level security, the brand's own checks) inside that scope.
 */
@Controller('internal')
export class InternalController {
  constructor(
    private readonly sessions: SessionService,
    private readonly stripeAccounts: StripeAccountService,
    private readonly brands: BrandsService,
    private readonly audit: AuditLogService,
  ) {}

  /** Who a session token belongs to — what a product's request guard needs. */
  @Post('sessions/resolve')
  @InternalOnly()
  @HttpCode(200)
  async resolveSession(
    @Body(zodPipe(resolveSessionSchema)) body: z.infer<typeof resolveSessionSchema>,
  ): Promise<{ scope: RequestScope | null }> {
    return { scope: await this.sessions.resolve(body.token, body.sourceIp) };
  }

  /** The brand's connected Stripe account, for taking a card payment. */
  @Get('brands/:brandId/stripe-account')
  @InternalOnly()
  async stripeAccount(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
  ): Promise<{ accountId: string | null }> {
    return { accountId: await this.stripeAccounts.getAccountIdForBrand(brandId) };
  }

  /** Which brand a Stripe webhook's connected account belongs to. */
  @Get('stripe-accounts/:accountId/brand')
  @InternalOnly()
  async brandForStripeAccount(
    @Param('accountId', zodPipe(z.string().regex(/^acct_[A-Za-z0-9]+$/))) accountId: string,
  ): Promise<{ brandId: string | null }> {
    return { brandId: await this.stripeAccounts.findBrandIdByAccountId(accountId) };
  }

  /** Brand Settings' colour: the brand belongs to the platform. */
  @Post('brands/:brandId/theme-color')
  @InternalOnly()
  @HttpCode(200)
  async setThemeColor(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(themeColorSchema)) body: z.infer<typeof themeColorSchema>,
  ): Promise<{ ok: true }> {
    const brand = await this.brands.setThemeColor(
      body.scope as unknown as RequestScope,
      brandId,
      body.themeColor,
    );
    if (!brand) throw new NotFoundException('brand not found');
    return { ok: true };
  }

  /** The platform's append-only audit log, shared by every product. */
  @Post('audit')
  @InternalOnly()
  @HttpCode(204)
  async recordAudit(@Body(zodPipe(auditSchema)) body: z.infer<typeof auditSchema>): Promise<void> {
    await this.audit.record(body.scope as unknown as RequestScope, body.entry as AuditEntry);
  }
}
