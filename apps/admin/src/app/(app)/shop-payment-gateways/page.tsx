import { PageContainer } from '@/components/page-container';
import { GatewayMarketplace } from './gateway-marketplace';

/** Sidebar's "Shop Payment Gateways" destination — a static browse-and-compare
 * catalog, so there's no server data to fetch here (see gateways-data.ts). */
export default function ShopPaymentGatewaysPage() {
  return (
    <PageContainer>
      <GatewayMarketplace />
    </PageContainer>
  );
}
