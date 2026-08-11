-- Brand Settings > Branding > Payment Page: brand-level display of the
-- hosted payment page. accentColor has no other home; themeColor on brand
-- already covers the primary brand colour used elsewhere.
CREATE TYPE "PaymentPageLayout" AS ENUM ('BANNER', 'CENTERED', 'SPLIT');

ALTER TABLE "brand_settings" ADD COLUMN "accent_color" TEXT NOT NULL DEFAULT '#171717';
ALTER TABLE "brand_settings" ADD COLUMN "payment_page_layout" "PaymentPageLayout" NOT NULL DEFAULT 'BANNER';
