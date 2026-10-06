import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  checkSubmissionListQuerySchema,
  idSchema,
  reviewCheckSubmissionSchema,
  type CheckSubmissionListQuery,
  type ReviewCheckSubmissionInput,
  type Scope,
} from '@sugrpay/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission } from '../tenancy/authorisation.js';
import {
  ChecksService,
  type CheckSubmissionDetail,
  type CheckSubmissionListResult,
} from './checks.service.js';

/** Payments > Check Verifications. Read is PAYMENTS READ — same resource the
 * Transactions tab's list endpoint uses, since both back one Payments page.
 * Approve/reject are CHECK_APPROVAL APPROVE — the only action letter that
 * resource grants (roles.ts), deliberately distinct from PAYMENTS so a role
 * can see pending checks without being trusted to clear them. */
@Controller('brands/:brandId/checks')
export class ChecksController {
  constructor(private readonly checks: ChecksService) {}

  @Get()
  @RequirePermission('PAYMENTS', 'READ')
  list(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Query(zodPipe(checkSubmissionListQuerySchema)) query: CheckSubmissionListQuery,
  ): Promise<CheckSubmissionListResult> {
    return this.checks.list(scope, brandId, query);
  }

  @Get(':id')
  @RequirePermission('PAYMENTS', 'READ')
  findOne(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
  ): Promise<CheckSubmissionDetail> {
    return this.checks.getDetail(scope, brandId, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('CHECK_APPROVAL', 'APPROVE')
  async approve(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(reviewCheckSubmissionSchema)) body: ReviewCheckSubmissionInput,
  ): Promise<{ ok: true }> {
    await this.checks.approve(scope, brandId, id, body);
    return { ok: true };
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('CHECK_APPROVAL', 'APPROVE')
  async reject(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(reviewCheckSubmissionSchema)) body: ReviewCheckSubmissionInput,
  ): Promise<{ ok: true }> {
    await this.checks.reject(scope, brandId, id, body);
    return { ok: true };
  }
}
