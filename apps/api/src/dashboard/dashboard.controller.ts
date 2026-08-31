import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { dashboardQuerySchema, idSchema, type DashboardQuery, type Scope } from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission } from '../tenancy/authorisation.js';
import {
  DashboardService,
  type BrandRollup,
  type CrossBrandCustomersResult,
  type DashboardStatusBucket,
  type DashboardSummary,
  type DashboardTrendPoint,
  type NeedsAttentionResult,
  type RecentActivityItem,
  type TopOverdueCustomer,
} from './dashboard.service.js';

/**
 * Not nested under /brands/:brandId like every other feature controller —
 * `brandId` is an optional query param here (dashboardQuerySchema), and
 * omitting it is the "All Brands" request: RequirePermission's `brandFrom:
 * 'query'` only enforces brand-assignment when a brandId is actually
 * present (see checkAccess, packages/shared/src/domain/roles.ts), so the
 * omitted case falls through to row-level security scoping the result to
 * every brand the caller can read, same as BrandsController.list.
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermission('REPORTS', 'READ', { brandFrom: 'query' })
  summary(
    @CurrentScope() scope: Scope,
    @Query(zodPipe(dashboardQuerySchema)) query: DashboardQuery,
  ): Promise<DashboardSummary> {
    return this.dashboard.getSummary(scope, query.brandId ?? null);
  }

  @Get('trend')
  @RequirePermission('REPORTS', 'READ', { brandFrom: 'query' })
  trend(
    @CurrentScope() scope: Scope,
    @Query(zodPipe(dashboardQuerySchema)) query: DashboardQuery,
  ): Promise<DashboardTrendPoint[]> {
    return this.dashboard.getTrend(scope, query.brandId ?? null);
  }

  @Get('status-breakdown')
  @RequirePermission('REPORTS', 'READ', { brandFrom: 'query' })
  statusBreakdown(
    @CurrentScope() scope: Scope,
    @Query(zodPipe(dashboardQuerySchema)) query: DashboardQuery,
  ): Promise<DashboardStatusBucket[]> {
    return this.dashboard.getStatusBreakdown(scope, query.brandId ?? null);
  }

  @Get('top-overdue-customers')
  @RequirePermission('REPORTS', 'READ', { brandFrom: 'query' })
  topOverdueCustomers(
    @CurrentScope() scope: Scope,
    @Query(zodPipe(dashboardQuerySchema)) query: DashboardQuery,
  ): Promise<TopOverdueCustomer[]> {
    return this.dashboard.getTopOverdueCustomers(scope, query.brandId ?? null);
  }

  @Get('needs-attention')
  @RequirePermission('REPORTS', 'READ', { brandFrom: 'query' })
  needsAttention(
    @CurrentScope() scope: Scope,
    @Query(zodPipe(dashboardQuerySchema)) query: DashboardQuery,
  ): Promise<NeedsAttentionResult> {
    return this.dashboard.getNeedsAttention(scope, query.brandId ?? null);
  }

  @Get('recent-activity')
  @RequirePermission('REPORTS', 'READ', { brandFrom: 'query' })
  recentActivity(
    @CurrentScope() scope: Scope,
    @Query(zodPipe(dashboardQuerySchema)) query: DashboardQuery,
  ): Promise<RecentActivityItem[]> {
    return this.dashboard.getRecentActivity(scope, query.brandId ?? null);
  }

  /** Meaningless for one brand — always "every brand I can read". */
  @Get('by-brand')
  @RequirePermission('REPORTS', 'READ', { brandFrom: 'none' })
  byBrand(@CurrentScope() scope: Scope): Promise<BrandRollup[]> {
    return this.dashboard.getByBrand(scope);
  }

  @Get('cross-brand-customers')
  @RequirePermission('REPORTS', 'READ', { brandFrom: 'none' })
  crossBrandCustomers(@CurrentScope() scope: Scope): Promise<CrossBrandCustomersResult> {
    return this.dashboard.getCrossBrandCustomers(scope);
  }

  /** brandFrom: 'none' — the job's own brandId (read after lookup, inside
   * the service) is what row-level security actually gates on; the guard
   * only checks the resource/action matrix here, same shape as
   * BrandsController.list. */
  @Post('sync-jobs/:jobId/retry')
  @RequirePermission('INTEGRATIONS', 'WRITE', { brandFrom: 'none' })
  retrySyncJob(
    @CurrentScope() scope: Scope,
    @Param('jobId', zodPipe(idSchema)) jobId: string,
  ): Promise<{ queued: true }> {
    return this.dashboard.retrySyncJob(scope, jobId);
  }
}
