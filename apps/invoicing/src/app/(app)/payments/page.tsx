import {
  ApiError,
  listBrands,
  listCheckSubmissions,
  listPaymentTransactions,
  type Brand,
  type CheckReviewStatus,
  type CheckSubmissionListResponse,
  type PaymentTransaction,
  type PaymentTransactionListResponse,
} from '@/lib/api';
import { BrandTheme } from '@/components/brand-theme';
import { PageContainer } from '@/components/page-container';
import { parsePageParams } from '@/lib/pagination';
import { PaymentsPageClient } from './payments-page-client';

export const dynamic = 'force-dynamic';

const FALLBACK_THEME_COLOUR = '#16261F';
const TX_DAY_MS = 24 * 60 * 60 * 1000;

/** Same convention as Brand Settings' own Transaction Log date-range filter
 * (brand-settings/page.tsx's txRangeCutoffIso) — kept as its own copy since
 * that one is private to a file this page does not otherwise depend on. */
function txRangeCutoffIso(range: string): string | undefined {
  if (range === 'all') return undefined;
  const days = Number(range);
  if (!Number.isFinite(days)) return undefined;
  return new Date(Date.now() - days * TX_DAY_MS).toISOString();
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    brandId?: string;
    tab?: string;
    txRange?: string;
    txStatus?: string;
    txMethod?: string;
    txPage?: string;
    txPageSize?: string;
    checkStatus?: string;
    checkSearch?: string;
    checkPage?: string;
    checkPageSize?: string;
  }>;
}) {
  const params = await searchParams;
  const tab = params.tab === 'checks' ? 'checks' : 'transactions';

  let brands: Brand[] = [];
  let brandsError: string | null = null;
  try {
    brands = await listBrands();
  } catch (cause) {
    brandsError = cause instanceof ApiError ? cause.message : String(cause);
  }

  const activeBrand = brands.find((b) => b.id === params.brandId) ?? brands[0] ?? null;

  let transactions: PaymentTransactionListResponse | null = null;
  let checkSubmissions: CheckSubmissionListResponse | null = null;
  let dataError: string | null = null;

  if (activeBrand && tab === 'transactions') {
    try {
      const { page: txPage, pageSize: txPageSize } = parsePageParams({
        page: params.txPage,
        pageSize: params.txPageSize,
      });
      transactions = await listPaymentTransactions(activeBrand.id, {
        page: txPage,
        pageSize: txPageSize,
        status: params.txStatus ? [params.txStatus as PaymentTransaction['status']] : undefined,
        method: params.txMethod ? [params.txMethod as PaymentTransaction['method']] : undefined,
        dateRange: { from: txRangeCutoffIso(params.txRange ?? '30') },
      });
    } catch (cause) {
      dataError = cause instanceof ApiError ? cause.message : String(cause);
    }
  } else if (activeBrand && tab === 'checks') {
    try {
      const { page: checkPage, pageSize: checkPageSize } = parsePageParams({
        page: params.checkPage,
        pageSize: params.checkPageSize,
      });
      checkSubmissions = await listCheckSubmissions(activeBrand.id, {
        page: checkPage,
        pageSize: checkPageSize,
        status: (params.checkStatus as CheckReviewStatus | undefined) ?? 'PENDING',
        search: params.checkSearch || undefined,
      });
    } catch (cause) {
      dataError = cause instanceof ApiError ? cause.message : String(cause);
    }
  }

  return (
    <BrandTheme brandColour={activeBrand?.themeColor ?? FALLBACK_THEME_COLOUR}>
      <PageContainer compact>
        <PaymentsPageClient
          brand={activeBrand}
          brandsError={brandsError}
          hasBrands={brands.length > 0}
          tab={tab}
          transactions={transactions}
          checkSubmissions={checkSubmissions}
          checkStatus={(params.checkStatus as CheckReviewStatus | undefined) ?? 'PENDING'}
          checkSearch={params.checkSearch ?? ''}
          dataError={dataError}
        />
      </PageContainer>
    </BrandTheme>
  );
}
