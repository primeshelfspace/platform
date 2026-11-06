import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  checkSubmissionListQuerySchema,
  reviewCheckSubmissionSchema,
  type CheckSubmissionListQuery,
  type ReviewCheckSubmissionInput,
} from '@platform/invoicing-contracts';
import { idSchema, type Scope } from '@platform/kernel';
import { zodPipe } from '@platform/server';
import { CurrentScope, RequirePermission, ProductScope } from '@platform/server';
import {
  ChecksService,
  type CheckSubmissionDetail,
  type CheckSubmissionListResult,
} from '../application/checks.service.js';

/** Payments > Check Verifications. Read is PAYMENTS READ — same resource the
 * Transactions tab's list endpoint uses, since both back one Payments page.
 * Approve/reject are CHECK_APPROVAL APPROVE — the only action letter that
 * resource grants (roles.ts), deliberately distinct from PAYMENTS so a role
 * can see pending checks without being trusted to clear them. */
@ProductScope('INVOICING')
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

  /** One photo of the check (front or back), decrypted. The photos are stored
   * encrypted; this is the only way to see them, signed in, never cached. */
  @Get(':id/images/:side')
  @RequirePermission('PAYMENTS', 'READ')
  async image(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
    @Param('side', zodPipe(z.enum(['front', 'back']))) side: 'front' | 'back',
    @Res() response: Response,
  ): Promise<void> {
    const image = await this.checks.image(scope, brandId, id, side);
    response.setHeader('content-type', image.contentType);
    response.setHeader('content-disposition', 'inline');
    response.setHeader('cache-control', 'no-store, private');
    response.setHeader('x-content-type-options', 'nosniff');
    response.send(image.body);
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
