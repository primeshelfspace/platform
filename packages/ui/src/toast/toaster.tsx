'use client';

import { useSyncExternalStore } from 'react';
import { toast, toastStore } from './store.js';
import { ToastCard } from './toast-card.js';

/**
 * Entering/exiting animation and reduced-motion handling for `.fenwick-toast`.
 * Shipped as an injected `<style>` tag rather than requiring each app to add
 * it to its own globals.css — the whole point of centralizing this here is
 * that mounting `<Toaster>` is the only integration step an app needs.
 */
const TOAST_STYLES = `
@keyframes fenwick-toast-in {
  from { opacity: 0; transform: translateY(-8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.fenwick-toast { animation: fenwick-toast-in 180ms ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .fenwick-toast { animation: none; }
}
`;

/**
 * Mount once per app (in the root layout). Everything else — every save
 * handler, every error `.catch`, anywhere in the tree — reaches this through
 * the imperative `toast` API instead of prop-drilling or a context hook.
 */
export function Toaster() {
  const toasts = useSyncExternalStore(
    toastStore.subscribe,
    toastStore.getSnapshot,
    toastStore.getServerSnapshot,
  );

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 p-4
                 sm:inset-x-auto sm:right-0 sm:items-end"
      role="region"
      aria-label="Notifications"
    >
      <style>{TOAST_STYLES}</style>
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => toast.dismiss(t.id)} />
      ))}
    </div>
  );
}
