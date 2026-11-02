import { Controller, Get, Param } from '@nestjs/common';
import { idSchema, type RequestScope } from '@platform/kernel';
import { CurrentScope, RequirePermission, zodPipe } from '@platform/server';
import {
  CompanyProfileService,
  type CompanyProfile,
} from '../application/company-profile.service.js';

/**
 * Company Profile — Company Details & Brands. A product sends its JWT and the
 * Company ID from GET /product-session/me. Any signed-in user may ask
 * (ORGANISATION_PROFILE READ is held by every role); the Brands returned
 * narrow to the user's own access.
 */
@Controller('companies')
export class CompanyProfileController {
  constructor(private readonly profiles: CompanyProfileService) {}

  @Get(':companyId')
  @RequirePermission('ORGANISATION_PROFILE', 'READ', { brandFrom: 'none' })
  get(
    @CurrentScope() scope: RequestScope,
    @Param('companyId', zodPipe(idSchema)) companyId: string,
  ): Promise<CompanyProfile> {
    return this.profiles.get(scope, companyId);
  }
}
