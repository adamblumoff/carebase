import type { MedicationDose, MedicationWithDetails } from '@carebase/shared';

export interface DoseFormValue {
  id?: number;
  label: string;
  timeOfDay: string;
  timezone: string;
}

export interface MedicationFormValues {
  name: string;
  instructions: string;
  doses: DoseFormValue[];
}

export interface DoseFormValidationErrors {
  label?: string;
  timeOfDay?: string;
  timezone?: string;
}

export interface MedicationFormValidationErrors {
  name?: string;
  doses?: DoseFormValidationErrors[];
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const timeStringToMinutes = (value: string): number => {
  const [hours, minutes] = value.split(':').map((part) => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }
  return hours * 60 + minutes;
};

export const sortDosesDescending = (doses: MedicationDose[]): MedicationDose[] => {
  return [...doses].sort((a, b) => {
    const updatedA = a.updatedAt ? new Date(a.updatedAt).getTime() : null;
    const updatedB = b.updatedAt ? new Date(b.updatedAt).getTime() : null;
    if (updatedA != null && updatedB != null && updatedA !== updatedB) {
      return updatedB - updatedA;
    }
    const minutesA = timeStringToMinutes(a.timeOfDay);
    const minutesB = timeStringToMinutes(b.timeOfDay);
    if (minutesA !== minutesB) {
      return minutesB - minutesA;
    }
    return (a.label ?? '').localeCompare(b.label ?? '');
  });
};

export const buildInitialValues = (
  medication: MedicationWithDetails | null,
  defaultTimezone: string
): MedicationFormValues => {
  if (!medication) {
    return {
      name: '',
      instructions: '',
      doses: [
        {
          label: '',
          timeOfDay: '08:00',
          timezone: defaultTimezone
        }
      ]
    };
  }

  const mappedDoses =
    medication.doses.length > 0
      ? sortDosesDescending(medication.doses).map((dose) => ({
          id: dose.id,
          label: dose.label ?? '',
          timeOfDay: dose.timeOfDay,
          timezone: dose.timezone
        }))
      : [
          {
            label: '',
            timeOfDay: '08:00',
            timezone: defaultTimezone
          }
        ];

  return {
    name: medication.name,
    instructions: medication.instructions ?? '',
    doses: mappedDoses
  };
};

const validateTimeOfDay = (value: string): string | null => {
  if (!TIME_PATTERN.test(value)) {
    return 'Enter time as HH:mm (24-hour).';
  }
  return null;
};

const validateTimezone = (value: string): string | null => {
  if (!value) {
    return 'Enter a timezone (e.g. America/Chicago).';
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return null;
  } catch {
    return 'Enter a valid IANA timezone (e.g. America/Chicago).';
  }
};

export function validateMedicationForm(values: MedicationFormValues): {
  errors: MedicationFormValidationErrors;
  normalized: MedicationFormValues;
} {
  const trimmedName = values.name.trim();
  const trimmedInstructions = values.instructions.trim();
  const normalizedDoses = values.doses.map((dose) => ({
    id: dose.id,
    label: dose.label.trim(),
    timeOfDay: dose.timeOfDay.trim(),
    timezone: dose.timezone.trim()
  }));

  const errors: MedicationFormValidationErrors = {};
  const doseErrors: DoseFormValidationErrors[] = [];

  if (!trimmedName) {
    errors.name = 'Enter a medication name.';
  }

  if (normalizedDoses.length === 0) {
    errors.doses = [{ timeOfDay: 'Add at least one dose.' }];
  } else {
    normalizedDoses.forEach((dose) => {
      const currentErrors: DoseFormValidationErrors = {};
      const timeError = validateTimeOfDay(dose.timeOfDay);
      if (timeError) {
        currentErrors.timeOfDay = timeError;
      }
      const timezoneError = validateTimezone(dose.timezone);
      if (timezoneError) {
        currentErrors.timezone = timezoneError;
      }
      doseErrors.push(currentErrors);
    });
    if (doseErrors.some((entry) => Object.keys(entry).length > 0)) {
      errors.doses = doseErrors;
    }
  }

  return {
    errors,
    normalized: {
      name: trimmedName,
      instructions: trimmedInstructions,
      doses: normalizedDoses
    }
  };
}
