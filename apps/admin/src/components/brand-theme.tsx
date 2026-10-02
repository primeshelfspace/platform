import type { ReactNode } from 'react';
import { brandThemeVariables } from '@sugrpay/shared/tokens';

/**
 * Applies a brand's colours to everything inside it.
 *
 * The foreground is computed from the brand colour rather than assumed, so a
 * merchant who picks a pale yellow gets readable text instead of an invisible
 * button (NFR-USE-004, NFR-001 §11.1).
 */
export function BrandTheme({
  brandColour,
  children,
}: {
  brandColour: string;
  children: ReactNode;
}) {
  const variables = brandThemeVariables(brandColour);
  return (
    <div style={variables as React.CSSProperties} className="contents">
      {children}
    </div>
  );
}
