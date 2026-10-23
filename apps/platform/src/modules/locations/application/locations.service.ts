import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type RequestScope } from '@platform/kernel';
import type { CreateLocationInput, UpdateLocationInput } from '@platform/platform-contracts';
import { Prisma, type Location } from '../../database/client.js';
import {
  PlatformPrismaService,
  type ScopedClient,
} from '../../database/platform-prisma.service.js';
import { PlatformOutbox } from '../../events/platform-outbox.js';

export type { Location };

/**
 * Stores and warehouses (architecture plan, phase 2). A location belongs to
 * the company and may serve one brand.
 *
 * Visibility is the `location_scope` RLS policy: all-brand roles see every
 * location; anyone else sees the locations assigned to them plus those of the
 * brands they can reach. So list() filters nothing itself. Writes are
 * Owner/Merchant Admin only (LOCATIONS in the matrix). Nothing is
 * hard-deleted: a closed location is ARCHIVED.
 *
 * Every write records a platform.location.* event in the same transaction, so
 * a product keeping its own copy (HQ, later) stays current.
 */
@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly outbox: PlatformOutbox,
  ) {}

  list(scope: RequestScope): Promise<Location[]> {
    return this.prisma.withScope(scope, (tx) =>
      tx.location.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] }),
    );
  }

  findOne(scope: RequestScope, id: string): Promise<Location> {
    return this.prisma.withScope(scope, (tx) => this.require(tx, id));
  }

  async create(scope: RequestScope, input: CreateLocationInput): Promise<Location> {
    const created = await this.prisma.withScope(scope, async (tx) => {
      await this.assertBrand(tx, input.brandId);
      const location = await tx.location.create({
        data: {
          merchantId: scope.merchantId,
          name: input.name,
          kind: input.kind,
          brandId: input.brandId,
          address: toJson(input.address),
        },
      });
      await this.outbox.recordLocation(tx, 'created', location);
      return location;
    });
    await this.outbox.flush();
    return created;
  }

  async update(scope: RequestScope, id: string, input: UpdateLocationInput): Promise<Location> {
    const updated = await this.prisma.withScope(scope, async (tx) => {
      await this.require(tx, id);
      if (input.brandId !== undefined) await this.assertBrand(tx, input.brandId);
      const location = await tx.location.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
          ...(input.address !== undefined ? { address: toJson(input.address) } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      await this.outbox.recordLocation(tx, 'updated', location);
      return location;
    });
    await this.outbox.flush();
    return updated;
  }

  private async require(tx: ScopedClient, id: string): Promise<Location> {
    const location = await tx.location.findUnique({ where: { id } });
    if (!location) throw new NotFoundException('location not found');
    return location;
  }

  /** The brand must exist in this company (and be visible to the caller). */
  private async assertBrand(tx: ScopedClient, brandId: string | null): Promise<void> {
    if (brandId === null) return;
    const brand = await tx.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (!brand) throw new BadRequestException('brand not found');
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}
