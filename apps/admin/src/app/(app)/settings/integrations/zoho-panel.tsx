'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Loader2, RefreshCw, Unlink } from 'lucide-react';
import type { ZohoActivityEntry, ZohoConnectionStatus, ZohoSyncSettingsPatch } from '@/lib/api';
import { Toggle } from '@/components/ui/toggle';
import { disconnectZohoAction, updateZohoSyncSettingsAction } from './actions';

const POLL_INTERVAL_MS = 4000;

const FREQUENCY_OPTIONS: { readonly value: 1 | 15 | 60 | 1440; readonly label: string }[] = [
  { value: 1, label: 'Realtime' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 60, label: 'Hourly' },
  { value: 1440, label: 'Daily' },
];

function statusDotClass(status: string): string {
  if (status === 'SUCCEEDED') return 'bg-success';
  if (status === 'FAILED' || status === 'DEAD_LETTERED') return 'bg-danger';
  return 'bg-ink-subtle';
}

function statusTextClass(status: string): string {
  if (status === 'SUCCEEDED') return 'text-success';
  if (status === 'FAILED' || status === 'DEAD_LETTERED') return 'text-danger';
  return 'text-ink-muted';
}

function statusLabel(status: string): string {
  if (status === 'SUCCEEDED') return 'Success';
  if (status === 'FAILED' || status === 'DEAD_LETTERED') return 'Failed';
  if (status === 'RUNNING') return 'Running';
  return 'Queued';
}

/** Neither a fabricated batch count nor invented create/update/delete
 * semantics — SyncJob records one row per object, not a batch, and tracks
 * push/pull direction, not a CRUD verb. This shows what's actually true for
 * each row: which direction it moved, and the record it moved. */
function eventLabel(entry: ZohoActivityEntry): string {
  const object = entry.objectType.charAt(0) + entry.objectType.slice(1).toLowerCase();
  return `${object} Sync`;
}
function actionLabel(entry: ZohoActivityEntry): string {
  return entry.direction === 'PUSH' ? 'Pushed' : 'Pulled';
}

function useDismissablePanel<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);
  return ref;
}

export function ZohoPanel({
  brandId,
  brandDisplayName,
  connectHref,
  initialStatus,
  initialActivity,
}: {
  brandId: string;
  brandDisplayName: string;
  connectHref: string;
  initialStatus: ZohoConnectionStatus;
  initialActivity: ZohoActivityEntry[];
}) {
  const [status, setStatus] = useState(initialStatus);
  const [entries, setEntries] = useState(initialActivity);
  const [savingField, setSavingField] = useState<
    'pullFrequencyMinutes' | 'customerSyncEnabled' | 'invoiceSyncEnabled' | null
  >(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [resyncMessage, setResyncMessage] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const dialogRef = useDismissablePanel<HTMLDivElement>(confirmingDisconnect, () =>
    setConfirmingDisconnect(false),
  );

  const refreshActivity = useCallback(async () => {
    try {
      const response = await fetch(`/settings/zoho/activity?brandId=${brandId}`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      setEntries((await response.json()) as ZohoActivityEntry[]);
    } catch {
      // A missed poll just tries again on the next tick.
    }
  }, [brandId]);

  useEffect(() => {
    if (!status.connected) return;
    const timer = setInterval(refreshActivity, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [status.connected, refreshActivity]);

  async function saveSetting(
    field: 'pullFrequencyMinutes' | 'customerSyncEnabled' | 'invoiceSyncEnabled',
    patch: ZohoSyncSettingsPatch,
    optimistic: Partial<ZohoConnectionStatus>,
  ) {
    const previous = status;
    setStatus((s) => ({ ...s, ...optimistic }));
    setSavingField(field);
    setSettingsError(null);

    const result = await updateZohoSyncSettingsAction(brandId, patch);
    setSavingField(null);
    if (result.ok) {
      setStatus(result.data);
    } else {
      setStatus(previous); // roll back the optimistic update
      setSettingsError(result.error);
    }
  }

  async function runManualResync() {
    setResyncing(true);
    setResyncMessage(null);
    try {
      const response = await fetch(`/settings/zoho/pull?brandId=${brandId}`, { method: 'POST' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setResyncMessage(body?.message ?? 'Could not queue a resync.');
      } else {
        setResyncMessage('Resync queued — watch the log below.');
        void refreshActivity();
      }
    } catch (error) {
      setResyncMessage(error instanceof Error ? error.message : 'Could not reach the server.');
    } finally {
      setResyncing(false);
    }
  }

  async function confirmDisconnect() {
    setDisconnecting(true);
    setDisconnectError(null);
    const result = await disconnectZohoAction(brandId);
    setDisconnecting(false);
    if (result.ok) {
      setConfirmingDisconnect(false);
      setStatus({
        connected: false,
        organizationName: null,
        lastSyncAt: null,
        lastPulledAt: null,
        health: null,
        pullFrequencyMinutes: 15,
        customerSyncEnabled: true,
        invoiceSyncEnabled: true,
      });
    } else {
      setDisconnectError(result.error);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#2952CC] text-lg font-bold text-white"
              aria-hidden
            >
              Z
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-ink-strong">Zoho Books</h2>
                {status.connected && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success-surface px-2.5 py-0.5 text-xs font-medium text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                    Connected
                  </span>
                )}
              </div>
              <p className="mt-1 text-[15px] text-ink-muted">
                {status.connected
                  ? `${brandDisplayName} • Last synced ${
                      status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : 'never yet'
                    }`
                  : `Sync customers and invoices between ${brandDisplayName} and Zoho Books.`}
              </p>
            </div>
          </div>

          {status.connected ? (
            <button
              type="button"
              onClick={() => setConfirmingDisconnect(true)}
              className="inline-flex shrink-0 items-center gap-2 rounded-[10px] border border-ink-strong bg-surface px-4 py-2.5 text-sm font-bold text-ink-strong hover:bg-surface-muted"
            >
              <Unlink className="h-4 w-4" aria-hidden />
              Disconnect
            </button>
          ) : (
            <a
              href={connectHref}
              className="inline-flex shrink-0 items-center gap-2 rounded-[10px] bg-ink-strong px-4 py-2.5 text-sm font-bold text-white hover:bg-black"
            >
              <Link2 className="h-4 w-4" aria-hidden />
              Connect
            </a>
          )}
        </div>
      </div>

      {status.connected && (
        <>
          {settingsError && (
            <div className="rounded-md bg-danger-surface p-3 text-sm text-danger">
              {settingsError}
            </div>
          )}

          <div className="grid gap-6 sm:grid-cols-2">
            <section className="rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6">
              <h3 className="text-base font-bold text-ink-strong">Sync Frequency</h3>
              <p className="mt-1 text-sm text-ink-muted">
                How often this brand pulls data and pushes invoices/payments to Zoho Books.
              </p>
              <div className="relative mt-4">
                <select
                  aria-label="Sync frequency"
                  value={status.pullFrequencyMinutes}
                  disabled={savingField === 'pullFrequencyMinutes'}
                  onChange={(event) => {
                    const value = Number(event.target.value) as 1 | 15 | 60 | 1440;
                    void saveSetting(
                      'pullFrequencyMinutes',
                      { pullFrequencyMinutes: value },
                      { pullFrequencyMinutes: value },
                    );
                  }}
                  className="w-full appearance-none rounded-[10px] border border-border bg-white px-4 py-3 text-base text-ink-strong disabled:opacity-60"
                >
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {savingField === 'pullFrequencyMinutes' && (
                  <Loader2
                    className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-muted"
                    aria-hidden
                  />
                )}
              </div>
              <p className="mt-2 text-xs text-ink-subtle">
                &ldquo;Realtime&rdquo; checks every minute — Zoho pull is polling, not a push
                notification, so this is the shortest interval actually available.
              </p>
            </section>

            <section className="rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6">
              <h3 className="text-base font-bold text-ink-strong">Data Synchronization</h3>
              <p className="mt-1 text-sm text-ink-muted">
                Choose which records to keep in sync with Zoho Books.
              </p>
              <div className="mt-4">
                <Toggle
                  layout="row"
                  label="Customer Synchronization"
                  hint={`Sync customer records between ${brandDisplayName} and Zoho Books.`}
                  checked={status.customerSyncEnabled}
                  disabled={savingField === 'customerSyncEnabled'}
                  onChange={(checked) =>
                    void saveSetting(
                      'customerSyncEnabled',
                      { customerSyncEnabled: checked },
                      { customerSyncEnabled: checked },
                    )
                  }
                />
                <Toggle
                  layout="row"
                  label="Invoice Synchronization"
                  hint={`Sync invoice status and amounts from Zoho Books into ${brandDisplayName}.`}
                  checked={status.invoiceSyncEnabled}
                  disabled={savingField === 'invoiceSyncEnabled'}
                  onChange={(checked) =>
                    void saveSetting(
                      'invoiceSyncEnabled',
                      { invoiceSyncEnabled: checked },
                      { invoiceSyncEnabled: checked },
                    )
                  }
                />
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-border bg-surface shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
              <div>
                <h3 className="text-base font-bold text-ink-strong">Connection Log</h3>
                <p className="mt-1 text-sm text-ink-muted">
                  Recent sync activity between {brandDisplayName} and Zoho Books.
                </p>
              </div>
              <button
                type="button"
                onClick={runManualResync}
                disabled={resyncing}
                className="inline-flex shrink-0 items-center gap-2 rounded-[10px] border border-border bg-surface px-4 py-2 text-sm font-bold text-ink-strong hover:bg-surface-muted disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${resyncing ? 'animate-spin' : ''}`} aria-hidden />
                {resyncing ? 'Queuing…' : 'Manual Resync'}
              </button>
            </div>

            {resyncMessage && (
              <p className="border-b border-border px-5 py-2 text-sm text-ink-muted sm:px-6">
                {resyncMessage}
              </p>
            )}

            {entries.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-muted sm:px-6">
                No activity yet — Manual Resync or the next scheduled sync will populate this log.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Recent Zoho Books sync activity</caption>
                  <thead>
                    <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-ink-subtle">
                      <th scope="col" className="px-5 py-3 sm:px-6">
                        Date &amp; Time
                      </th>
                      <th scope="col" className="px-5 py-3">
                        Event
                      </th>
                      <th scope="col" className="px-5 py-3">
                        Action
                      </th>
                      <th scope="col" className="px-5 py-3">
                        Record
                      </th>
                      <th scope="col" className="px-5 py-3 sm:pr-6">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {entries.map((entry, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-ink-muted sm:px-6">
                          {new Date(entry.updatedAt).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-ink-strong">{eventLabel(entry)}</td>
                        <td className="px-5 py-3 text-ink-muted">{actionLabel(entry)}</td>
                        <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-ink-muted">
                          {entry.objectId ? entry.objectId.slice(0, 8) : '—'}
                        </td>
                        <td
                          className="whitespace-nowrap px-5 py-3 sm:pr-6"
                          title={entry.lastError ?? undefined}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={`h-2 w-2 rounded-full ${statusDotClass(entry.status)}`}
                              aria-hidden
                            />
                            <span className={`font-medium ${statusTextClass(entry.status)}`}>
                              {statusLabel(entry.status)}
                            </span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {confirmingDisconnect && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="disconnect-zoho-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div ref={dialogRef} className="w-full max-w-sm rounded-xl bg-surface p-6 shadow-lg">
            <h2 id="disconnect-zoho-title" className="text-base font-bold text-ink-strong">
              Disconnect Zoho Books?
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              {brandDisplayName} will stop pushing and pulling records with Zoho Books immediately.
              You can reconnect at any time.
            </p>
            {disconnectError && (
              <div className="mt-3 rounded-md bg-danger-surface p-3 text-sm text-danger">
                {disconnectError}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmingDisconnect(false)}
                disabled={disconnecting}
                className="rounded-[10px] border border-border bg-surface px-4 py-2 text-sm font-bold text-ink-strong hover:bg-surface-muted disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDisconnect}
                disabled={disconnecting}
                className="rounded-[10px] bg-danger px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
