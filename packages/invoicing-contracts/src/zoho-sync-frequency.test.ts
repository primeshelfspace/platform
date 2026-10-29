/**
 * Sync Frequency (FR-ZHO-030): the choices the Integrations tab offers, and
 * nothing else.
 */
import { describe, expect, it } from 'vitest';
import { zohoSyncSettingsSchema } from './schemas.js';

describe('Sync Frequency', () => {
  it('accepts Real-time, 15 and 30 minutes, hourly, daily and monthly', () => {
    for (const minutes of [0, 15, 30, 60, 1440, 43200]) {
      expect(zohoSyncSettingsSchema.safeParse({ pullFrequencyMinutes: minutes }).success).toBe(
        true,
      );
    }
  });

  it('refuses any other interval, including the old every-minute pull', () => {
    for (const minutes of [1, 5, 45, 120, -15, 15.5]) {
      expect(zohoSyncSettingsSchema.safeParse({ pullFrequencyMinutes: minutes }).success).toBe(
        false,
      );
    }
  });
});
