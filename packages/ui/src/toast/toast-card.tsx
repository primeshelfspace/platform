'use client';

import { AlertTriangleIcon, CheckCircleIcon, CloseIcon, InfoIcon, XCircleIcon } from './icons.js';
import type { ToastRecord, ToastVariant } from './types.js';

const VARIANT: Record<
  ToastVariant,
  { Icon: typeof CheckCircleIcon; iconColor: string; iconBg: string; role: 'alert' | 'status' }
> = {
  success: { Icon: CheckCircleIcon, iconColor: 'text-success', iconBg: 'bg-success-surface', role: 'status' },
  error: { Icon: XCircleIcon, iconColor: 'text-danger', iconBg: 'bg-danger-surface', role: 'alert' },
  warning: { Icon: AlertTriangleIcon, iconColor: 'text-warning', iconBg: 'bg-warning-surface', role: 'status' },
  info: { Icon: InfoIcon, iconColor: 'text-info', iconBg: 'bg-info-surface', role: 'status' },
};

export function ToastCard({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  const { Icon, iconColor, iconBg, role } = VARIANT[toast.variant];

  return (
    <div
      role={role}
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      className="fenwick-toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl
                 border border-border bg-surface p-4 shadow-lg"
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconBg}`}>
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-semibold text-ink">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-sm text-ink-muted">{toast.description}</p>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 rounded-md p-1 text-ink-subtle hover:bg-surface-muted hover:text-ink
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
