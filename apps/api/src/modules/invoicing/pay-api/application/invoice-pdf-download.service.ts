import { Injectable } from '@nestjs/common';
import {
  formatDateForDisplay,
  formatMinorForDisplay,
  renderInvoicePdfHtml,
  toCurrencyCode,
} from '@platform/shared';
import { InvoicePdfService } from '../infrastructure/invoice-pdf.service.js';
import { PublicInvoicesService } from './public-invoices.service.js';

export interface InvoicePdfDownload {
  readonly number: string;
  readonly pdf: Buffer;
}

/**
 * The invoice as a real downloadable PDF (FR-PAY "Download PDF"), for a
 * public payment token: the same token-only access and the same view the
 * payment page renders, laid out with the brand's Invoice PDF settings and
 * printed by headless Chromium. Null for any token that does not resolve, so
 * the caller can collapse every failure to one 404.
 */
@Injectable()
export class InvoicePdfDownloadService {
  constructor(
    private readonly publicInvoices: PublicInvoicesService,
    private readonly invoicePdf: InvoicePdfService,
  ) {}

  async forToken(token: string): Promise<InvoicePdfDownload | null> {
    const scope = await this.publicInvoices.resolveScope(token);
    if (!scope) return null;

    const view = await this.publicInvoices.view(scope);
    if (!view) return null;

    const currency = toCurrencyCode(view.currency);
    const html = renderInvoicePdfHtml({
      number: view.number,
      invoiceDate: formatDateForDisplay(view.invoiceDate),
      dueDate: formatDateForDisplay(view.dueDate),
      brand: view.brand,
      customerName: view.customerName,
      customerAddress: view.customerAddress,
      settings: view.invoicePdf,
      lines: view.lines.map((line) => ({
        itemName: line.itemName,
        quantityLabel: line.quantity,
        rateLabel: formatMinorForDisplay(line.unitPriceMinor, currency),
        amountLabel: formatMinorForDisplay(line.lineTotalMinor, currency),
      })),
      subtotalLabel: formatMinorForDisplay(view.subtotalMinor, currency),
      totalLabel: formatMinorForDisplay(view.totalMinor, currency),
      balanceDueLabel: formatMinorForDisplay(view.balanceMinor, currency),
    });

    return { number: view.number, pdf: await this.invoicePdf.render(html) };
  }
}
