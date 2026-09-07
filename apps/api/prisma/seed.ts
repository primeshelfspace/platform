/**
 * Seed dataset (TER-001 §3.3).
 *
 * Specified rather than left to whoever writes it first: this data exists to
 * exercise the isolation and calculation logic, not to populate screens. Two
 * merchants prove cross-merchant isolation. Partial brand assignments give the
 * authorisation tests something to fail against. The TDD-001 §9.3 worked
 * example is present verbatim as a fixture.
 *
 * Runs as the schema OWNER (DIRECT_DATABASE_URL). Seeding creates rows across
 * merchants, which is precisely what row-level security forbids the runtime
 * role from doing.
 */
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import {
  calculate,
  parseMinor,
  quantityFrom,
  type CalculationResult,
  type InvoiceStatus,
  type PaymentMethod,
  type Role,
} from '@fenwick/shared';
import { hashPassword } from '../src/auth/password.js';

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env['DIRECT_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '' },
  },
});

const DEV_PASSWORD = 'fenwick-dev-password';
/** Fixed so a developer's saved requests keep working across re-seeds. */
const DEV_SESSION_TOKEN = 'dev0000000000000000000000000000000000000000000000000000000000dev';

async function main(): Promise<void> {
  if (process.env['APP_ENV'] === 'production') {
    throw new Error('refusing to seed a production database');
  }

  console.log('clearing existing data');
  await reset();

  const passwordHash = await hashPassword(DEV_PASSWORD);

  // -------------------------------------------------------------------------
  // Merchant one — three brands, in three time zones, three theme colours.
  // -------------------------------------------------------------------------
  const fenwick = await prisma.merchant.create({
    data: {
      name: 'Fenwick Holdings Inc.',
      contactEmail: 'ops@fenwickholdings.test',
      address: address('1 Harbour Street', 'Boston', 'MA', '02110'),
      plan: 'standard',
    },
  });

  const solstice = await createBrand(fenwick.id, {
    legalName: 'Solstice Kitchenware LLC',
    displayName: 'Solstice Kitchenware',
    themeColor: '#2D6A6A',
    timezone: 'America/New_York',
    prefix: 'SOL',
    cardFeeRateBp: 290,
    defaultTaxRateBp: 600,
  });

  const meridian = await createBrand(fenwick.id, {
    legalName: 'Meridian Outfitters Inc.',
    displayName: 'Meridian Outfitters',
    themeColor: '#C97A2B',
    timezone: 'America/Denver',
    prefix: 'MER',
    cardFeeRateBp: 250,
    defaultTaxRateBp: 875,
  });

  const cobalt = await createBrand(fenwick.id, {
    legalName: 'Cobalt Studio Supply Co.',
    displayName: 'Cobalt Studio Supply',
    themeColor: '#3A6FA8',
    timezone: 'Pacific/Honolulu',
    prefix: 'COB',
    cardFeeRateBp: 300,
    defaultTaxRateBp: 0,
  });

  // One user per role. Brand assignments are deliberately partial: the brand
  // admin cannot reach Cobalt, and the sales user can reach only Solstice.
  const owner = await createUser(
    fenwick.id,
    'MERCHANT_OWNER',
    'owner@fenwickholdings.test',
    'Dana Fenwick',
    passwordHash,
    [],
  );
  await createUser(
    fenwick.id,
    'MERCHANT_ADMIN',
    'admin@fenwickholdings.test',
    'Roman Ilves',
    passwordHash,
    [],
  );
  await createUser(
    fenwick.id,
    'BRAND_ADMIN',
    'brand.admin@fenwickholdings.test',
    'Priya Raghunathan',
    passwordHash,
    [solstice.id, meridian.id],
  );
  await createUser(
    fenwick.id,
    'FINANCE_USER',
    'finance@fenwickholdings.test',
    'Marta Oyelaran',
    passwordHash,
    [solstice.id, meridian.id, cobalt.id],
  );
  await createUser(
    fenwick.id,
    'SALES_USER',
    'sales@fenwickholdings.test',
    'Tobias Vance',
    passwordHash,
    [solstice.id],
  );
  await createUser(
    fenwick.id,
    'READ_ONLY',
    'readonly@fenwickholdings.test',
    'Junia Sørensen',
    passwordHash,
    [solstice.id, cobalt.id],
  );

  // -------------------------------------------------------------------------
  // Merchant two — exists solely so isolation has something to isolate from.
  // Any query that returns one of these rows to a Fenwick user is a defect.
  // -------------------------------------------------------------------------
  const northgate = await prisma.merchant.create({
    data: {
      name: 'Northgate Provisioning Ltd.',
      contactEmail: 'accounts@northgate.test',
      address: address('88 Kingsway', 'Vancouver', 'BC', 'V5T 3J7'),
    },
  });
  const northgateBrand = await createBrand(northgate.id, {
    legalName: 'Northgate Provisioning Ltd.',
    displayName: 'Northgate',
    themeColor: '#8B4A9C',
    timezone: 'America/Vancouver',
    prefix: 'NGP',
    cardFeeRateBp: 275,
    defaultTaxRateBp: 500,
  });
  await createUser(
    northgate.id,
    'MERCHANT_OWNER',
    'owner@northgate.test',
    'Wren Alcott',
    passwordHash,
    [],
  );
  const northgateCustomer = await createCustomer(northgateBrand.id, {
    displayName: 'Harbourfront Cafés',
    companyName: 'Harbourfront Cafés Ltd.',
    email: 'ap@harbourfront.test',
  });
  await createInvoice({
    brand: northgateBrand,
    customerId: northgateCustomer.id,
    status: 'SENT',
    lines: [{ itemName: 'Bulk coffee', quantity: '40', unitPrice: '18.50' }],
    taxRateBp: 500,
    cardFeeRateBp: 275,
    method: 'CARD',
  });

  // -------------------------------------------------------------------------
  // Customers — with and without outstanding balances, and one non-Latin name
  // to exercise NFR-LOC-008.
  // -------------------------------------------------------------------------
  const brightHouse = await createCustomer(solstice.id, {
    displayName: 'Bright House Hospitality',
    companyName: 'Bright House Hospitality Group',
    email: 'payables@brighthouse.test',
    phone: '+1 617 555 0148',
  });
  const kaneko = await createCustomer(solstice.id, {
    displayName: '金子製作所',
    companyName: '株式会社金子製作所',
    email: 'keiri@kaneko.test',
    phone: '+81 3 5555 0117',
  });
  const alderQuay = await createCustomer(meridian.id, {
    displayName: 'Alder Quay Retail',
    companyName: 'Alder Quay Retail LLC',
    email: 'ap@alderquay.test',
  });
  const individual = await createCustomer(cobalt.id, {
    type: 'INDIVIDUAL',
    displayName: 'Elowen Ferris',
    firstName: 'Elowen',
    lastName: 'Ferris',
    email: 'elowen.ferris@example.test',
  });
  // No invoices: proves the "customers without outstanding balance" filter.
  await createCustomer(cobalt.id, {
    displayName: 'Quiet Harbour Ceramics',
    companyName: 'Quiet Harbour Ceramics',
    email: 'hello@quietharbour.test',
  });

  // -------------------------------------------------------------------------
  // The TDD-001 §9.3 worked example, verbatim.
  //
  // Two line items, 6% tax, 2.9% card fee → 3,392.48 on card, 3,296.87 on ACH.
  // The document writes line 2 as "6 × 118.375"; a unit price with three
  // decimals is not representable in integer minor units, so the fraction sits
  // on the quantity side, which is the field specified as four-decimal fixed
  // point. Same arithmetic, same result. See calculation.test.ts.
  // -------------------------------------------------------------------------
  const workedExampleLines = [
    { itemName: 'Copper saucepan, 24cm', quantity: '12', unitPrice: '200.00' },
    {
      itemName: 'Ceramic serving bowl',
      description: '118.375 units at 6.00',
      quantity: '118.375',
      unitPrice: '6.00',
    },
  ];

  await createInvoice({
    brand: solstice,
    customerId: brightHouse.id,
    status: 'SENT',
    lines: workedExampleLines,
    taxRateBp: 600,
    cardFeeRateBp: 290,
    method: 'CARD',
    notes: 'TDD-001 §9.3 worked example — card. Total must read 3,392.48.',
  });

  await createInvoice({
    brand: solstice,
    customerId: brightHouse.id,
    status: 'PAID',
    lines: workedExampleLines,
    taxRateBp: 600,
    cardFeeRateBp: 290,
    method: 'ACH',
    notes: 'TDD-001 §9.3 worked example — ACH, no card fee. Total must read 3,296.87.',
  });

  // -------------------------------------------------------------------------
  // One invoice in every status, plus fractional quantity and mixed tax-exempt.
  // -------------------------------------------------------------------------
  await createInvoice({
    brand: solstice,
    customerId: kaneko.id,
    status: 'DRAFT',
    lines: [{ itemName: 'Prototype tooling', quantity: '1', unitPrice: '4200.00' }],
    taxRateBp: 600,
    cardFeeRateBp: 290,
    method: 'CARD',
  });

  await createInvoice({
    brand: solstice,
    customerId: kaneko.id,
    status: 'VIEWED',
    lines: [
      {
        itemName: 'Consulting hours',
        description: 'Fractional quantity',
        quantity: '17.2500',
        unitPrice: '185.00',
      },
      {
        itemName: 'Freight',
        description: 'Tax exempt line',
        quantity: '1',
        unitPrice: '240.00',
        taxExempt: true,
      },
    ],
    taxRateBp: 600,
    cardFeeRateBp: 290,
    method: 'CARD',
  });

  await createInvoice({
    brand: meridian,
    customerId: alderQuay.id,
    status: 'PENDING_PAYMENT',
    lines: [{ itemName: 'Trail jacket, wholesale', quantity: '60', unitPrice: '74.25' }],
    taxRateBp: 875,
    cardFeeRateBp: 250,
    method: 'CARD',
  });

  await createInvoice({
    brand: meridian,
    customerId: alderQuay.id,
    status: 'PARTIALLY_PAID',
    settledFraction: 0.4,
    lines: [{ itemName: 'Base layer, wholesale', quantity: '120', unitPrice: '31.00' }],
    taxRateBp: 875,
    cardFeeRateBp: 250,
    method: 'CARD',
  });

  // Overdue is an overlay flag, not a status (TDD-001 §8.1).
  await createInvoice({
    brand: meridian,
    customerId: alderQuay.id,
    status: 'SENT',
    overdue: true,
    dueDaysFromNow: -21,
    lines: [{ itemName: 'Season sample set', quantity: '1', unitPrice: '1875.00' }],
    taxRateBp: 875,
    cardFeeRateBp: 250,
    method: 'CARD',
  });

  await createInvoice({
    brand: cobalt,
    customerId: individual.id,
    status: 'CANCELLED',
    lines: [{ itemName: 'Studio easel', quantity: '2', unitPrice: '349.00' }],
    taxRateBp: 0,
    cardFeeRateBp: 300,
    method: 'CARD',
  });

  // Cobalt's card-fee invoice, so every brand carries at least one.
  await createInvoice({
    brand: cobalt,
    customerId: individual.id,
    status: 'PAID',
    lines: [{ itemName: 'Pigment set, professional', quantity: '4', unitPrice: '128.50' }],
    taxRateBp: 0,
    cardFeeRateBp: 300,
    method: 'CARD',
  });

  // -------------------------------------------------------------------------
  // Integration connections and one sync job per error classification.
  // -------------------------------------------------------------------------
  await prisma.integrationConnection.createMany({
    data: [
      {
        brandId: solstice.id,
        provider: 'ZOHO_BOOKS',
        status: 'CONNECTED',
        health: 'healthy',
        lastSyncAt: new Date(),
        config: { organizationId: 'fake-org-solstice' },
      },
      {
        brandId: meridian.id,
        provider: 'ZOHO_BOOKS',
        status: 'UNHEALTHY',
        health: 'token expired',
        config: { organizationId: 'fake-org-meridian' },
      },
      { brandId: cobalt.id, provider: 'ZOHO_BOOKS', status: 'DISCONNECTED' },
    ],
  });

  const errorClasses = [
    {
      errorClass: 'TRANSIENT' as const,
      lastError: 'Zoho Books: POST /books/v3/invoices failed with 429',
      status: 'QUEUED' as const,
    },
    {
      errorClass: 'AUTHENTICATION' as const,
      lastError: 'Zoho Books: token refresh failed with 401 (invalid_grant)',
      status: 'FAILED' as const,
    },
    {
      errorClass: 'VALIDATION' as const,
      lastError: 'Zoho Books: 422 — tax_id is invalid for this organisation',
      status: 'FAILED' as const,
    },
    {
      errorClass: 'CONFLICT' as const,
      lastError: 'Record has been modified by another user',
      status: 'FAILED' as const,
    },
    {
      errorClass: 'PERMANENT' as const,
      lastError: 'Zoho Books: GET /books/v3/contacts/1234 failed with 404',
      status: 'DEAD_LETTERED' as const,
    },
  ];
  await prisma.syncJob.createMany({
    data: errorClasses.map((entry, index) => ({
      brandId: solstice.id,
      provider: 'ZOHO_BOOKS' as const,
      direction: 'PUSH' as const,
      objectType: index % 2 === 0 ? 'INVOICE' : 'CUSTOMER',
      status: entry.status,
      attemptCount: entry.errorClass === 'TRANSIENT' ? 2 : 1,
      errorClass: entry.errorClass,
      lastError: entry.lastError,
      nextAttemptAt: entry.errorClass === 'TRANSIENT' ? new Date(Date.now() + 5 * 60_000) : null,
    })),
  });

  // -------------------------------------------------------------------------
  // A developer session, so the API is callable immediately after seeding.
  // -------------------------------------------------------------------------
  await prisma.session.create({
    data: {
      userId: owner.id,
      tokenHash: createHash('sha256').update(DEV_SESSION_TOKEN).digest('hex'),
      expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      userAgent: 'seed',
    },
  });

  await summarise();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function reset(): Promise<void> {
  // Order matters: children before parents. Merchant cascades cover most of it,
  // but being explicit keeps a partial failure from leaving orphans.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_log, sync_job, integration_connection, check_submission,
      invoice_event, payment, line_item, invoice, customer, tax_rate,
      brand_settings, user_brand_assignment, session, "user", brand, merchant
    RESTART IDENTITY CASCADE
  `);
}

function address(
  line1: string,
  city: string,
  region: string,
  postalCode: string,
): Prisma.InputJsonValue {
  return { line1, line2: null, city, region, postalCode, country: 'US' };
}

async function createBrand(
  merchantId: string,
  input: {
    legalName: string;
    displayName: string;
    themeColor: string;
    timezone: string;
    prefix: string;
    cardFeeRateBp: number;
    defaultTaxRateBp: number;
  },
) {
  const brand = await prisma.brand.create({
    data: {
      merchantId,
      legalName: input.legalName,
      displayName: input.displayName,
      salesPerson: 'Alex Marchetti',
      phone: '+1 617 555 0100',
      email: `billing@${input.prefix.toLowerCase()}.test`,
      mailingAddress: address('1 Harbour Street', 'Boston', 'MA', '02110'),
      billingAddress: address('1 Harbour Street', 'Boston', 'MA', '02110'),
      taxId: `US-${input.prefix}-0001`,
      currency: 'USD',
      timezone: input.timezone,
      themeColor: input.themeColor,
      settings: {
        create: {
          invoicePrefix: input.prefix,
          nextSequence: 1,
          paymentTermsDays: 30,
          cardFeeRateBp: input.cardFeeRateBp,
          partialPaymentEnabled: true,
          reminderSchedule: [-7, -1, 3, 14],
        },
      },
      taxRates: {
        create: [
          { label: 'No tax', rateBp: 0, active: true },
          {
            label: `Sales tax ${(input.defaultTaxRateBp / 100).toFixed(2)}%`,
            rateBp: input.defaultTaxRateBp,
            active: true,
          },
        ],
      },
    },
  });
  return brand;
}

async function createUser(
  merchantId: string,
  role: Role,
  email: string,
  name: string,
  passwordHash: string,
  brandIds: string[],
) {
  return prisma.user.create({
    data: {
      merchantId,
      email,
      name,
      role,
      passwordHash,
      status: 'ACTIVE',
      assignments: { create: brandIds.map((brandId) => ({ brandId })) },
    },
  });
}

async function createCustomer(
  brandId: string,
  input: {
    displayName: string;
    companyName?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    type?: 'BUSINESS' | 'INDIVIDUAL';
  },
) {
  return prisma.customer.create({
    data: {
      brandId,
      type: input.type ?? 'BUSINESS',
      displayName: input.displayName,
      companyName: input.companyName ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      billingAddress: address('400 Commonwealth Avenue', 'Boston', 'MA', '02215'),
      shippingAddress: address('400 Commonwealth Avenue', 'Boston', 'MA', '02215'),
    },
  });
}

interface SeedLine {
  itemName: string;
  description?: string;
  quantity: string;
  unitPrice: string;
  taxExempt?: boolean;
}

async function createInvoice(input: {
  brand: { id: string };
  customerId: string;
  status: InvoiceStatus;
  lines: SeedLine[];
  taxRateBp: number;
  cardFeeRateBp: number;
  method: PaymentMethod;
  notes?: string;
  overdue?: boolean;
  dueDaysFromNow?: number;
  settledFraction?: number;
}) {
  const settings = await prisma.brandSettings.findUniqueOrThrow({
    where: { brandId: input.brand.id },
  });

  const calculation: CalculationResult = calculate({
    lines: input.lines.map((line) => ({
      quantity: quantityFrom(line.quantity),
      unitPriceMinor: parseMinor(line.unitPrice),
      taxExempt: line.taxExempt ?? false,
    })),
    taxRateBp: input.taxRateBp,
    cardFeeRateBp: input.cardFeeRateBp,
    paymentMethod: input.method,
  });

  const settledMinor =
    input.status === 'PAID'
      ? calculation.totalMinor
      : input.status === 'PARTIALLY_PAID'
        ? Math.round(calculation.totalMinor * (input.settledFraction ?? 0.5))
        : 0;

  const invoiceDate = new Date();
  const dueDate = new Date(
    invoiceDate.getTime() + (input.dueDaysFromNow ?? settings.paymentTermsDays) * 24 * 3600 * 1000,
  );

  const invoice = await prisma.invoice.create({
    data: {
      brandId: input.brand.id,
      customerId: input.customerId,
      number: `${settings.invoicePrefix}-${String(settings.nextSequence).padStart(5, '0')}`,
      status: input.status,
      invoiceDate,
      dueDate,
      currency: 'USD',
      subtotalMinor: BigInt(calculation.subtotalMinor),
      taxRateBpApplied: input.status === 'DRAFT' ? 0 : calculation.taxRateBpApplied,
      taxMinor: BigInt(calculation.taxMinor),
      cardFeeRateBpApplied: input.status === 'DRAFT' ? 0 : calculation.cardFeeRateBpApplied,
      cardFeeMinor: BigInt(calculation.cardFeeMinor),
      totalMinor: BigInt(calculation.totalMinor),
      balanceMinor: BigInt(calculation.totalMinor - settledMinor),
      publicToken: randomBytes(16).toString('hex'),
      publicTokenActive: input.status !== 'CANCELLED',
      notes: input.notes ?? null,
      overdue: input.overdue ?? false,
      issuedAt: input.status === 'DRAFT' ? null : invoiceDate,
      paidAt: input.status === 'PAID' ? new Date() : null,
      cancelledAt: input.status === 'CANCELLED' ? new Date() : null,
      firstViewedAt: ['VIEWED', 'PENDING_PAYMENT', 'PARTIALLY_PAID', 'PAID'].includes(input.status)
        ? new Date()
        : null,
      previousStatus: input.status === 'PENDING_PAYMENT' ? 'VIEWED' : null,
      lineItems: {
        create: input.lines.map((line, index) => ({
          position: index + 1,
          itemName: line.itemName,
          description: line.description ?? null,
          quantity: quantityFrom(line.quantity),
          unitPriceMinor: BigInt(parseMinor(line.unitPrice)),
          lineTotalMinor: BigInt(calculation.lines[index]!.lineTotalMinor),
          taxExempt: line.taxExempt ?? false,
        })),
      },
      events: {
        create: [
          { eventType: 'CREATED', toStatus: 'DRAFT', actor: 'seed' },
          ...(input.status === 'DRAFT'
            ? []
            : [
                {
                  eventType: 'ISSUED',
                  fromStatus: 'DRAFT' as const,
                  toStatus: 'SENT' as const,
                  actor: 'seed',
                },
              ]),
        ],
      },
    },
  });

  await prisma.brandSettings.update({
    where: { brandId: input.brand.id },
    data: { nextSequence: { increment: 1 } },
  });

  if (settledMinor > 0) {
    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        brandId: input.brand.id,
        method: input.method,
        amountMinor: BigInt(settledMinor),
        status: 'SETTLED',
        gatewayReference: `fake_pi_seed_${invoice.id.slice(0, 12)}`,
        idempotencyKey: createHash('sha256')
          .update(`${invoice.id}:${settledMinor}:seed`)
          .digest('hex'),
        settledAt: new Date(),
        lastEventAt: new Date(),
      },
    });
  }

  return invoice;
}

async function summarise(): Promise<void> {
  const [merchants, brands, users, customers, invoices, payments, syncJobs] = await Promise.all([
    prisma.merchant.count(),
    prisma.brand.count(),
    prisma.user.count(),
    prisma.customer.count(),
    prisma.invoice.count(),
    prisma.payment.count(),
    prisma.syncJob.count(),
  ]);

  console.log('');
  console.log(`  merchants   ${merchants}`);
  console.log(`  brands      ${brands}`);
  console.log(`  users       ${users}`);
  console.log(`  customers   ${customers}`);
  console.log(`  invoices    ${invoices}`);
  console.log(`  payments    ${payments}`);
  console.log(`  sync jobs   ${syncJobs}`);
  console.log('');
  console.log(`  sign in with any seeded email and password: ${DEV_PASSWORD}`);
  console.log(`  or call the API directly:`);
  console.log(
    `    curl -H "Authorization: Bearer ${DEV_SESSION_TOKEN}" http://localhost:4000/health`,
  );
  console.log('');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
