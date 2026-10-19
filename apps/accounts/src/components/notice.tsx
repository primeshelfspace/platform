/** The result of the last form post, carried back in the URL (?saved / ?error). */
export function Notice({ saved, error }: { saved?: string; error?: string }) {
  if (error) {
    return (
      <p
        role="alert"
        className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {error}
      </p>
    );
  }
  if (saved) {
    return (
      <p
        role="status"
        className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
      >
        {saved}
      </p>
    );
  }
  return null;
}

export function roleLabel(role: string): string {
  return role
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
