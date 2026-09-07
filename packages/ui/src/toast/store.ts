import type { ToastOptions, ToastRecord, ToastVariant } from './types.js';

/**
 * Module-level store, not React state: `toast.success(...)` has to work from
 * anywhere a notification originates — a fetch `.catch`, a Stripe callback, an
 * event handler several components away from wherever `<Toaster>` is mounted —
 * without every caller threading a hook down to that point. `<Toaster>`
 * subscribes to this with `useSyncExternalStore`; nothing else needs to.
 */

const DEFAULT_DURATION = 5000;
const EMPTY: ToastRecord[] = [];

let toasts: ToastRecord[] = EMPTY;
let nextId = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ToastRecord[] {
  return toasts;
}

function getServerSnapshot(): ToastRecord[] {
  return EMPTY;
}

function dismiss(id: string): void {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function dismissAll(): void {
  toasts = EMPTY;
  emit();
}

function push(variant: ToastVariant, title: string, options: ToastOptions = {}): string {
  const id = `toast-${++nextId}`;
  const duration = options.duration ?? DEFAULT_DURATION;
  toasts = [...toasts, { id, variant, title, description: options.description, duration }];
  emit();
  if (duration > 0) setTimeout(() => dismiss(id), duration);
  return id;
}

export const toastStore = { subscribe, getSnapshot, getServerSnapshot };

/** The public, DRY notification API — this is what call sites use. */
export const toast = {
  success: (title: string, options?: ToastOptions) => push('success', title, options),
  error: (title: string, options?: ToastOptions) => push('error', title, options),
  warning: (title: string, options?: ToastOptions) => push('warning', title, options),
  info: (title: string, options?: ToastOptions) => push('info', title, options),
  dismiss,
  dismissAll,
};
