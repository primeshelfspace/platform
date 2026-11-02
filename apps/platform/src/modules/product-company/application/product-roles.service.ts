import { Injectable } from '@nestjs/common';
import { PRODUCT_ROLE_NAMES, assignableProductRoles, type RequestScope } from '@platform/kernel';
import { askingProduct } from '../../auth/application/product-access.js';
import { requireCompanyAdmin } from '../../companies/application/merchant.service.js';

export interface ProductRole {
  /** What User Management takes as `role`. */
  readonly id: string;
  readonly name: string;
}

/**
 * Role Management — Role List (docs/product/stories/product-company-apis.md):
 * the asking product's fixed roles, the same for every Company, without the
 * Company Admin. Company Admin only; read-only.
 */
@Injectable()
export class ProductRolesService {
  list(scope: RequestScope): ProductRole[] {
    const product = askingProduct(scope);
    requireCompanyAdmin(scope);
    return assignableProductRoles(product).map((id) => ({
      id,
      name: PRODUCT_ROLE_NAMES[product][id] ?? id,
    }));
  }
}
