import { describe, expect, it } from 'vitest';
import { formatDateForDisplay } from './date-display.js';

describe('formatDateForDisplay', () => {
  it('formats a Date instance', () => {
    expect(formatDateForDisplay(new Date('2026-08-14T00:00:00Z'))).toBe('Aug 14, 2026');
  });

  it('formats an ISO string the same way, without a caller needing to wrap it', () => {
    expect(formatDateForDisplay('2026-01-01T00:00:00Z')).toBe('Jan 1, 2026');
  });
});
