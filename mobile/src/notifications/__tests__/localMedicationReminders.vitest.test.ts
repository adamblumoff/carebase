import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { MedicationWithDetails } from '@carebase/shared';
import * as Notifications from 'expo-notifications';
import { syncLocalMedicationReminders } from '../localMedicationReminders';

const notifications = vi.mocked(Notifications);

function buildMedication(overrides: Partial<MedicationWithDetails> = {}): MedicationWithDetails {
  const now = new Date();
  return {
    id: 1,
    recipientId: 10,
    ownerId: 5,
    name: 'Lipitor',
    strengthValue: null,
    strengthUnit: null,
    form: null,
    instructions: null,
    notes: null,
    prescribingProvider: null,
    startDate: now,
    endDate: null,
    quantityOnHand: null,
    refillThreshold: null,
    preferredPharmacy: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    doses: [
      {
        id: 101,
        medicationId: 1,
        label: 'Morning',
        timeOfDay: '08:00',
        timezone: 'America/Chicago',
        reminderWindowMinutes: 120,
        isActive: true,
        createdAt: now,
        updatedAt: now
      }
    ],
    upcomingIntakes: [
      {
        id: 201,
        medicationId: 1,
        doseId: 101,
        scheduledFor: new Date(now.getTime() + 45 * 60 * 1000) as unknown as Date,
        acknowledgedAt: null,
        status: 'expired',
        actorUserId: null,
        createdAt: now,
        updatedAt: now
      }
    ],
    refillProjection: null,
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  notifications.getPermissionsAsync.mockResolvedValue({
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never'
  } as any);
  notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  notifications.scheduleNotificationAsync.mockResolvedValue('notification-id');
  notifications.cancelScheduledNotificationAsync.mockResolvedValue();
});

describe('syncLocalMedicationReminders', () => {
  it('schedules reminders for upcoming intakes within the window', async () => {
    await syncLocalMedicationReminders([buildMedication()]);

    expect(notifications.getAllScheduledNotificationsAsync).toHaveBeenCalled();
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const [request] = notifications.scheduleNotificationAsync.mock.calls[0];
    expect(request.content?.data?.medicationId).toBe(1);
    expect(request.content?.categoryIdentifier).toBe('medication-reminder');
    expect(request.content?.data?.type).toBe('medication-reminder');
  });

  it('clears existing reminders when permission is denied', async () => {
    notifications.getPermissionsAsync.mockResolvedValueOnce({
      status: 'denied',
      granted: false,
      canAskAgain: false,
      expires: 'never'
    } as any);

    notifications.getAllScheduledNotificationsAsync.mockResolvedValueOnce([
      {
        identifier: 'abc',
        content: {
          title: 'Existing',
          body: 'Test',
          data: { 'carebase.localMedicationReminder': true }
        },
        trigger: { type: 'timeInterval', seconds: 60 }
      }
    ] as any);

    await syncLocalMedicationReminders([buildMedication()]);

    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('abc');
  });

  it('schedules overdue intakes shortly in the future', async () => {
    const past = new Date(Date.now() - 30 * 60 * 1000);
    const medication = buildMedication({
      upcomingIntakes: [
        {
          id: 300,
          medicationId: 1,
          doseId: 101,
          scheduledFor: past as unknown as Date,
          acknowledgedAt: null,
          status: 'expired',
          actorUserId: null,
          createdAt: past,
          updatedAt: past
        }
      ]
    });

    await syncLocalMedicationReminders([medication]);

    const [request] = notifications.scheduleNotificationAsync.mock.calls[0];
    const trigger = request.trigger as Date;
    expect(trigger.getTime()).toBeGreaterThan(Date.now());
  });
});
