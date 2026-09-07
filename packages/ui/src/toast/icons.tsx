/**
 * Small inline icon set for the toast variants. Kept self-contained (no
 * lucide-react) so this package has zero runtime dependencies beyond React —
 * the payment app treats every added dependency as a PCI-scope question.
 */

type IconProps = { className?: string };

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="currentColor" opacity="0.15" />
      <path
        d="M6.5 10.5l2.2 2.2 4.8-5.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function XCircleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="currentColor" opacity="0.15" />
      <path
        d="M7.3 7.3l5.4 5.4M12.7 7.3l-5.4 5.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AlertTriangleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 2.5l8 14.2a1 1 0 01-.87 1.5H2.87a1 1 0 01-.87-1.5l8-14.2a1 1 0 011.74 0z"
        fill="currentColor"
        opacity="0.15"
      />
      <path d="M10 7.8v3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="14.2" r="0.95" fill="currentColor" />
    </svg>
  );
}

export function InfoIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="currentColor" opacity="0.15" />
      <path d="M10 9.2v4.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="6.6" r="0.95" fill="currentColor" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M5 5l10 10M15 5L5 15"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
