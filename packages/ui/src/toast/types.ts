export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  /** Supporting text under the title. */
  description?: string;
  /** Auto-dismiss delay in ms. 0 keeps the toast until dismissed. */
  duration?: number;
}

export interface ToastRecord {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  duration: number;
}
