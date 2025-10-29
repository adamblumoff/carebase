import { describe, expect, it } from 'vitest';
import type * as Notifications from 'expo-notifications';
import { parseMedicationNotificationPayload } from '../payload';

const buildNotificationData = (
  overrides: Record<string, unknown> = {}
): Notifications.Notification['request']['content']['data'] =>
  ({
    type: 'medication-reminder',
    medicationId: 42,
    ...overrides
  }) as Notifications.Notification['request']['content']['data'];

describe('parseMedicationNotificationPayload', () => {
  it('parses medication reminder payloads with numeric identifiers', () => {
    const payload = parseMedicationNotificationPayload(buildNotificationData());
    expect(payload).toEqual({
      type: 'medication-reminder',
      medicationId: 42,
      intakeId: null,
      medicationName: null
    });
  });

  it('accepts string identifiers and normalizes type casing', () => {
    const payload = parseMedicationNotificationPayload(
      buildNotificationData({
        type: 'Medication-Missed',
        medicationId: '105',
        intake_id: '9',
        medication_name: 'Lipitor 10 mg'
      })
    );

    expect(payload).toEqual({
      type: 'medication-missed',
      medicationId: 105,
      intakeId: 9,
      medicationName: 'Lipitor 10 mg'
    });
  });

  it('returns null when medication identifier is missing', () => {
    const payload = parseMedicationNotificationPayload(
      buildNotificationData({
        medicationId: undefined,
        medication_id: undefined
      })
    );
    expect(payload).toBeNull();
  });
});
