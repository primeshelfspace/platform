import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PaymentMethodSettingsInput, PaymentPageDisplayInput, Scope } from '@fenwick/shared';
import { PrismaService } from '../infra/prisma/prisma.service.js';

export interface PaymentMethodSettings {
  readonly cardEnabled: boolean;
  readonly applePayEnabled: boolean;
  readonly googlePayEnabled: boolean;
  readonly achEnabled: boolean;
  readonly checkEnabled: boolean;
}

export interface PaymentPageDisplaySettings {
  readonly accentColor: string;
  readonly paymentPageLayout: 'BANNER' | 'CENTERED' | 'SPLIT';
}

/**
 * FR-PAY-005. Deliberately separate from the (currently unused) general
 * BrandSettings CRUD — this is the one slice of it with a real consumer:
 * the public payment page and PaymentsService.createIntent both read this
 * to decide what a brand actually offers.
 */
@Injectable()
export class BrandSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPaymentMethods(scope: Scope, brandId: string): Promise<PaymentMethodSettings> {
    const settings = await this.prisma.withScope(scope, (tx) =>
      tx.brandSettings.findUnique({ where: { brandId } }),
    );
    if (!settings) throw new NotFoundException('brand settings not found');
    return {
      cardEnabled: settings.cardEnabled,
      applePayEnabled: settings.applePayEnabled,
      googlePayEnabled: settings.googlePayEnabled,
      achEnabled: settings.achEnabled,
      checkEnabled: settings.checkEnabled,
    };
  }

  async updatePaymentMethods(
    scope: Scope,
    brandId: string,
    input: PaymentMethodSettingsInput,
  ): Promise<PaymentMethodSettings> {
    return this.prisma.withScope(scope, async (tx) => {
      const existing = await tx.brandSettings.findUnique({ where: { brandId } });
      if (!existing) throw new NotFoundException('brand settings not found');

      // Disabling every method leaves every invoice unpayable with no
      // indication why — refused here rather than discovered by a confused
      // customer on the payment page.
      const anyEnabled =
        input.cardEnabled ||
        input.applePayEnabled ||
        input.googlePayEnabled ||
        input.achEnabled ||
        input.checkEnabled;
      if (!anyEnabled) {
        throw new ConflictException('at least one payment method must stay enabled');
      }

      const updated = await tx.brandSettings.update({ where: { brandId }, data: input });
      return {
        cardEnabled: updated.cardEnabled,
        applePayEnabled: updated.applePayEnabled,
        googlePayEnabled: updated.googlePayEnabled,
        achEnabled: updated.achEnabled,
        checkEnabled: updated.checkEnabled,
      };
    });
  }

  async getPaymentPageDisplay(scope: Scope, brandId: string): Promise<PaymentPageDisplaySettings> {
    const settings = await this.prisma.withScope(scope, (tx) =>
      tx.brandSettings.findUnique({ where: { brandId } }),
    );
    if (!settings) throw new NotFoundException('brand settings not found');
    return { accentColor: settings.accentColor, paymentPageLayout: settings.paymentPageLayout };
  }

  async updatePaymentPageDisplay(
    scope: Scope,
    brandId: string,
    input: PaymentPageDisplayInput,
  ): Promise<PaymentPageDisplaySettings> {
    return this.prisma.withScope(scope, async (tx) => {
      const existing = await tx.brandSettings.findUnique({ where: { brandId } });
      if (!existing) throw new NotFoundException('brand settings not found');

      const updated = await tx.brandSettings.update({ where: { brandId }, data: input });
      return { accentColor: updated.accentColor, paymentPageLayout: updated.paymentPageLayout };
    });
  }
}
