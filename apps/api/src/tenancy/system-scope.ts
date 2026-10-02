import { Injectable } from '@nestjs/common';
import type { RequestScope } from '@sugrpay/shared';
import { PrismaService } from '../infra/prisma/prisma.service.js';

/**
 * A scope for work with no human session behind it: worker jobs, webhook
 * callbacks, scheduled tasks. All-brand role because these actors are
 * scoped to exactly the one brand they were told to act on (the caller
 * already knows which brand — that is the actual authorisation boundary
 * here, not the role), and RLS still enforces the merchant boundary
 * regardless of the all-brand flag.
 */
@Injectable()
export class SystemScopeResolver {
  constructor(private readonly prisma: PrismaService) {}

  async forBrand(brandId: string, actor: string): Promise<RequestScope | null> {
    const brand = await this.prisma.withoutScope(
      `resolving merchant for system-actor scope (${actor})`,
      (client) => client.brand.findUnique({ where: { id: brandId }, select: { merchantId: true } }),
    );
    if (!brand) return null;

    return {
      merchantId: brand.merchantId,
      userId: `system:${actor}`,
      role: 'MERCHANT_OWNER',
      assignedBrandIds: [],
      sessionId: `system:${actor}`,
      sourceIp: null,
    };
  }
}
