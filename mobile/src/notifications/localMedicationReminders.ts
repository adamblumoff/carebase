import type { MedicationDose, MedicationWithDetails } from '@carebase/shared';
import * as Notifications from 'expo-notifications';

const REMINDER_DATA_FLAG = 'carebase.localMedicationReminder';
const REMINDER_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_TOTAL_REMINDERS = 6;
const SNOOZE_DELAY_MS = 2 * 60 * 1000; // 2 minutes for overdue doses

type NotificationPermission = Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>;

interface ReminderCandidate {
  medicationId: number;
  intakeId: number | null;
  medicationName: string;
  doseLabel: string | null;
  scheduledFor: number;
}

function isPermissionGranted(permission: NotificationPermission): boolean {
  return permission.status === 'granted' || permission.status === 'provisional';
}

function findDoseLabel(doses: MedicationDose[], doseId: number | null): string | null {
  if (doseId != null) {
    const match = doses.find((dose) => dose.id === doseId);
    if (match?.label) return match.label;
  }
  const fallback = doses[0];
  return fallback?.label ?? null;
}

function buildReminderCandidates(medications: MedicationWithDetails[]): ReminderCandidate[] {
  const now = Date.now();
  const cutoff = now + REMINDER_WINDOW_MS;
  const reminders: ReminderCandidate[] = [];

  medications.forEach((medication) => {
    if (medication.archivedAt) {
      return;
    }

    const pendingOccurrences = (medication.occurrences ?? [])
      .filter((occurrence) => occurrence.status === 'pending')
      .sort((a, b) => new Date(a.occurrenceDate).getTime() - new Date(b.occurrenceDate).getTime());

    const nextOccurrence = pendingOccurrences[0];
    if (!nextOccurrence) {
      return;
    }

    const matchingIntake = medication.upcomingIntakes.find((intake) => intake.id === nextOccurrence.intakeId);
    if (!matchingIntake) {
      return;
    }

    const scheduledAtRaw = new Date(matchingIntake.scheduledFor).getTime();
    if (!Number.isFinite(scheduledAtRaw) || scheduledAtRaw > cutoff) {
      return;
    }

    const scheduledAt = Number.isFinite(scheduledAtRaw) ? scheduledAtRaw : now;

    reminders.push({
      medicationId: medication.id,
      intakeId: matchingIntake.id,
      medicationName: medication.name,
      doseLabel: findDoseLabel(medication.doses, matchingIntake.doseId),
      scheduledFor: scheduledAt
    });
  });

  return reminders
    .sort((a, b) => a.scheduledFor - b.scheduledFor)
    .slice(0, MAX_TOTAL_REMINDERS);
}

async function cancelExistingLocalReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const cancellations = scheduled
    .filter((item) => item.content?.data?.[REMINDER_DATA_FLAG] === true)
    .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier));
  if (cancellations.length > 0) {
    await Promise.allSettled(cancellations);
  }
}

async function scheduleReminder(candidate: ReminderCandidate): Promise<void> {
  const now = Date.now();
  const triggerTime =
    candidate.scheduledFor > now ? candidate.scheduledFor : now + SNOOZE_DELAY_MS;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${candidate.medicationName}`,
      body: candidate.doseLabel
        ? `It's time for your ${candidate.doseLabel} dose.`
        : 'It’s time to take your medication.',
      sound: 'default',
      categoryIdentifier: 'medication-reminder',
      data: {
        type: 'medication-reminder',
        source: 'local-fallback',
        medicationId: candidate.medicationId,
        intakeId: candidate.intakeId,
        [REMINDER_DATA_FLAG]: true
      }
    },
    trigger: {
      type: 'date',
      date: new Date(triggerTime)
    }
  });
}

export async function syncLocalMedicationReminders(
  medications: MedicationWithDetails[]
): Promise<void> {
  try {
    const permission = await Notifications.getPermissionsAsync();

    if (!isPermissionGranted(permission)) {
      await cancelExistingLocalReminders();
      return;
    }

    await cancelExistingLocalReminders();

    const candidates = buildReminderCandidates(medications);
    if (candidates.length === 0) {
      return;
    }

    for (const candidate of candidates) {
      await scheduleReminder(candidate);
    }
  } catch (error) {
    console.warn('Local medication reminder sync failed', error);
  }
}
