/**
 * The two outcomes of a token lookup that are not an invoice.
 *
 * Shared by the payment page and the invoice document route so a dead link
 * looks identical whichever of the two a customer happened to open — a
 * difference between them would itself be a signal about which invoices
 * exist.
 */

/**
 * One terminal page for every "this link does not resolve" case. It names no
 * brand and no invoice, so it cannot be used to confirm that either exists.
 */
export function Terminal() {
  return (
    <Shell>
      <h1 className="text-lg font-medium text-ink-strong">This payment link is no longer valid</h1>
      <p className="mt-2 text-sm text-ink-muted">
        The link may have expired, or the invoice may already have been paid or cancelled. If you
        think this is a mistake, reply to the email the invoice came from.
      </p>
    </Shell>
  );
}

/** The API is reachable in principle but did not answer. Says so plainly:
 * a customer whose link is fine must not be told it is dead. */
export function Unavailable({ detail }: { detail: string }) {
  return (
    <Shell>
      <h1 className="text-lg font-medium text-ink-strong">We can&rsquo;t load this invoice</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Something on our side is not responding. Your link is still valid — please try again in a
        few minutes.
      </p>
      <p className="mt-4 font-mono text-xs text-ink-subtle">{detail}</p>
    </Shell>
  );
}

/** Unbranded fallback for the two states above, where no brand is known yet
 * (or ever will be) — the branded chrome needs a real invoice to lay out. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16">
      <div className="rounded-lg border border-border bg-surface p-8 shadow-sm">{children}</div>
    </main>
  );
}
