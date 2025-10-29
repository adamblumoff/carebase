import type * as Notifications from 'expo-notifications';

export type MedicationNotificationType = 'medication-reminder' | 'medication-missed';

export interface MedicationNotificationPayload {
  type: MedicationNotificationType;
  medicationId: number;
  intakeId?: number | null;
  medicationName?: string | null;
}

const MEDICATION_NOTIFICATION_TYPES: MedicationNotificationType[] = [
  'medication-reminder',
  'medication-missed',
];

function isMedicationNotificationType(value: unknown): value is MedicationNotificationType {
  if (typeof value !== 'string') return false;
  return MEDICATION_NOTIFICATION_TYPES.includes(value as MedicationNotificationType);
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseMedicationNotificationPayload(
  data: Notifications.Notification['request']['content']['data']
): MedicationNotificationPayload | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const record = data as Record<string, unknown>;
  const maybeType = record.type ?? record.intent ?? record.notificationType;
  const normalizedType = typeof maybeType === 'string' ? maybeType.toLowerCase() : null;

  if (!normalizedType || !isMedicationNotificationType(normalizedType)) {
    return null;
  }

  const medicationId = coerceNumber(record.medicationId) ?? coerceNumber(record.medication_id);
  if (medicationId == null) {
    return null;
  }

  const intakeId = coerceNumber(record.intakeId) ?? coerceNumber(record.intake_id);
  const medicationName = record.medicationName ?? record.medication_name ?? null;

  return {
    type: normalizedType,
    medicationId,
    intakeId: intakeId ?? null,
    medicationName: typeof medicationName === 'string' ? medicationName : null,
  };
}
