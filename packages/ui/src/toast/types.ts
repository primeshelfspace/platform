import type { ReactNode } from 'react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  /** Supporting text under the title. A plain string in most cases; a node
   * lets a call site color-code parts of it (e.g. "N sent" / "M failed"
   * each in their own status color) without the toast system needing to
   * know about that case specifically. */
  description?: ReactNode;
  /** Auto-dismiss delay in ms. 0 keeps the toast until dismissed. */
  duration?: number;
}

export interface ToastRecord {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: ReactNode;
  duration: number;
}
