'use client';

import { useActionState, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Customer } from '@/lib/api';
import { createInvoiceAction, type CreateInvoiceState } from './actions';

const initialState: CreateInvoiceState = {};

interface Row {
  itemName: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxExempt: boolean;
}

const emptyRow: Row = {
  itemName: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  taxExempt: false,
};

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink-strong';
const labelClass = 'mb-1 block text-xs font-medium text-ink-muted';

export function InvoiceForm({
  brandId,
  currency,
  customers,
}: {
  brandId: string;
  /** The brand's own currency — the invoice is denominated in it. */
  currency: string;
  customers: Customer[];
}) {
  const [state, formAction, pending] = useActionState(createInvoiceAction, initialState);
  const [rows, setRows] = useState<Row[]>([{ ...emptyRow }]);

  const today = new Date().toISOString().slice(0, 10);
  const in30Days = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="lineCount" value={rows.length} />

      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <label className="block">
          <span className={labelClass}>Customer</span>
          <select name="customerId" required className={inputClass} defaultValue="">
            <option value="" disabled>
              Choose a customer…
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelClass}>Invoice date</span>
            <input
              type="date"
              name="invoiceDate"
              defaultValue={today}
              required
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Due date</span>
            <input
              type="date"
              name="dueDate"
              defaultValue={in30Days}
              required
              className={inputClass}
            />
          </label>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelClass}>Tax rate (%)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              name="taxRatePercent"
              defaultValue="6"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Card fee (%) — applies to card payments only</span>
            <input
              type="number"
              step="0.01"
              min="0"
              name="cardFeeRatePercent"
              defaultValue="2.9"
              className={inputClass}
            />
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-ink-strong">Line items</span>
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, { ...emptyRow }])}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add line
          </button>
        </div>

        <div className="space-y-4">
          {rows.map((row, i) => (
            <div key={i} className="rounded-md border border-border p-3">
              <div className="mb-2 grid grid-cols-2 gap-2">
                <input
                  name={`lines.${i}.itemName`}
                  placeholder="Item name"
                  required
                  value={row.itemName}
                  onChange={(e) => updateRow(i, { itemName: e.target.value })}
                  className={inputClass}
                />
                <input
                  name={`lines.${i}.description`}
                  placeholder="Description (optional)"
                  value={row.description}
                  onChange={(e) => updateRow(i, { description: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="flex items-end gap-2">
                <label className="block flex-1">
                  <span className={labelClass}>Quantity</span>
                  <input
                    name={`lines.${i}.quantity`}
                    placeholder="1"
                    required
                    value={row.quantity}
                    onChange={(e) => updateRow(i, { quantity: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="block flex-1">
                  <span className={labelClass}>Unit price</span>
                  <input
                    name={`lines.${i}.unitPrice`}
                    placeholder="0.00"
                    required
                    value={row.unitPrice}
                    onChange={(e) => updateRow(i, { unitPrice: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="flex items-center gap-1.5 pb-2 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    name={`lines.${i}.taxExempt`}
                    checked={row.taxExempt}
                    onChange={(e) => updateRow(i, { taxExempt: e.target.checked })}
                  />
                  Tax exempt
                </label>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                    className="mb-2 text-danger"
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <label className="block">
        <span className={labelClass}>Notes (optional, shown to the customer)</span>
        <textarea name="notes" rows={2} className={inputClass} />
      </label>

      {state.error && (
        <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">{state.error}</div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create & issue'}
        </button>
        <a href={`/invoices?brandId=${brandId}`} className="text-sm text-ink-muted">
          Cancel
        </a>
      </div>
    </form>
  );
}
