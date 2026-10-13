/**
 * "Just now" / "N mins ago" / "Nh ago" / "Yesterday" / "N days ago" — the
 * shared relative-time phrasing for dashboard timestamps that need
 * minute-level precision (e.g. a sync that runs every 1-2 minutes, where
 * hour-granularity would read "Just now" for anything under an hour old).
 */
export function formatRelativeTime(input: string | Date): string {
  const then = typeof input === 'string' ? new Date(input).getTime() : input.getTime();
  const minutes = Math.floor((Date.now() - then) / (60 * 1000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}
