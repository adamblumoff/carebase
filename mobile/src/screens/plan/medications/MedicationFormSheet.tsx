import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View
} from 'react-native';
import type { MedicationWithDetails } from '@carebase/shared';
import { useTheme, spacing, radius } from '../../../theme';

export interface MedicationFormValues {
  name: string;
  instructions: string;
  timeOfDay: string;
  timezone: string;
}

function buildInitialValues(medication: MedicationWithDetails | null, defaultTimezone: string): MedicationFormValues {
  if (!medication) {
    return {
      name: '',
      instructions: '',
      timeOfDay: '08:00',
      timezone: defaultTimezone
    };
  }
  const firstDose = medication.doses[0] ?? null;
  return {
    name: medication.name,
    instructions: medication.instructions ?? '',
    timeOfDay: firstDose?.timeOfDay ?? '08:00',
    timezone: firstDose?.timezone ?? defaultTimezone
  };
}

interface MedicationFormSheetProps {
  visible: boolean;
  mode: 'create' | 'edit';
  medication: MedicationWithDetails | null;
  defaultTimezone: string;
  onClose: () => void;
  onSubmit: (values: MedicationFormValues) => Promise<void>;
  submitting: boolean;
  error: string | null;
  ctaLabel?: string;
}

export type MedicationFormValidationErrors = Partial<Record<keyof MedicationFormValues, string>>;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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
  const trimmedTime = values.timeOfDay.trim();
  const trimmedTimezone = values.timezone.trim();

  const errors: MedicationFormValidationErrors = {};

  if (!trimmedName) {
    errors.name = 'Enter a medication name.';
  }

  const timeError = validateTimeOfDay(trimmedTime);
  if (timeError) {
    errors.timeOfDay = timeError;
  }

  const timezoneError = validateTimezone(trimmedTimezone);
  if (timezoneError) {
    errors.timezone = timezoneError;
  }

  return {
    errors,
    normalized: {
      name: trimmedName,
      instructions: trimmedInstructions,
      timeOfDay: trimmedTime,
      timezone: trimmedTimezone
    }
  };
}

export function MedicationFormSheet({
  visible,
  mode,
  medication,
  defaultTimezone,
  onClose,
  onSubmit,
  submitting,
  error,
  ctaLabel
}: MedicationFormSheetProps) {
  const { palette } = useTheme();
  const [values, setValues] = useState<MedicationFormValues>(() => buildInitialValues(medication, defaultTimezone));
  const [fieldErrors, setFieldErrors] = useState<MedicationFormValidationErrors>({});

  useEffect(() => {
    setValues(buildInitialValues(medication, defaultTimezone));
    setFieldErrors({});
  }, [medication, defaultTimezone, visible]);

  const canSubmit = values.name.trim().length > 0 && !submitting;

  const handleChange = (field: keyof MedicationFormValues, next: string) => {
    setValues((current) => ({ ...current, [field]: next }));
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const nextErrors = { ...prev };
      delete nextErrors[field];
      return nextErrors;
    });
  };

  const handleSubmit = async () => {
    const result = validateMedicationForm(values);
    if (Object.keys(result.errors).length > 0) {
      setFieldErrors(result.errors);
      return;
    }
    setFieldErrors({});
    await onSubmit(result.normalized);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheet, { backgroundColor: palette.canvas }]}>
          <View style={styles.grabberWrapper}>
            <View style={[styles.grabber, { backgroundColor: palette.border }]} />
          </View>
          <ScrollView
            style={styles.content}
            contentContainerStyle={{ paddingBottom: spacing(3) }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.title, { color: palette.textPrimary }]}>
              {mode === 'create' ? 'Add medication' : 'Edit medication'}
            </Text>

            <Text style={[styles.label, { color: palette.textSecondary }]}>Name</Text>
            <TextInput
              value={values.name}
              onChangeText={(text) => handleChange('name', text)}
              placeholder="e.g. Lipitor"
              style={[
                styles.input,
                {
                  borderColor: fieldErrors.name ? palette.danger : palette.border,
                  color: palette.textPrimary
                }
              ]}
              placeholderTextColor={palette.textMuted}
              autoCapitalize="words"
            />
            {fieldErrors.name ? (
              <Text style={[styles.inputErrorText, { color: palette.danger }]}>{fieldErrors.name}</Text>
            ) : null}

            <Text style={[styles.label, { color: palette.textSecondary }]}>Instructions</Text>
            <TextInput
              value={values.instructions}
              onChangeText={(text) => handleChange('instructions', text)}
              placeholder="Add instructions (optional)"
              style={[styles.input, styles.inputMultiline, { borderColor: palette.border, color: palette.textPrimary }]}
              placeholderTextColor={palette.textMuted}
              multiline
            />

            <Text style={[styles.sectionHeading, { color: palette.textPrimary }]}>Primary dose</Text>

            <Text style={[styles.label, { color: palette.textSecondary }]}>Time of day (HH:mm)</Text>
            <TextInput
              value={values.timeOfDay}
              onChangeText={(text) => handleChange('timeOfDay', text)}
              placeholder="08:00"
              style={[
                styles.input,
                {
                  borderColor: fieldErrors.timeOfDay ? palette.danger : palette.border,
                  color: palette.textPrimary
                }
              ]}
              placeholderTextColor={palette.textMuted}
              autoCapitalize="none"
              keyboardType="numeric"
            />
            {fieldErrors.timeOfDay ? (
              <Text style={[styles.inputErrorText, { color: palette.danger }]}>{fieldErrors.timeOfDay}</Text>
            ) : null}

            <Text style={[styles.label, { color: palette.textSecondary }]}>Timezone</Text>
            <TextInput
              value={values.timezone}
              onChangeText={(text) => handleChange('timezone', text)}
              placeholder="America/New_York"
              style={[
                styles.input,
                {
                  borderColor: fieldErrors.timezone ? palette.danger : palette.border,
                  color: palette.textPrimary
                }
              ]}
              placeholderTextColor={palette.textMuted}
              autoCapitalize="words"
            />
            {fieldErrors.timezone ? (
              <Text style={[styles.inputErrorText, { color: palette.danger }]}>{fieldErrors.timezone}</Text>
            ) : null}

            {error ? (
              <View style={[styles.errorBanner, { backgroundColor: palette.dangerSoft }]}>
                <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { borderColor: palette.border },
                  pressed && styles.secondaryButtonPressed
                ]}
                onPress={onClose}
                disabled={submitting}
              >
                <Text style={[styles.secondaryButtonText, { color: palette.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: palette.primary },
                  (disabled || submitting) && styles.primaryButtonDisabled,
                  pressed && !disabled && !submitting && styles.primaryButtonPressed
                ]}
                onPress={handleSubmit}
                disabled={!canSubmit}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>{ctaLabel ?? (mode === 'create' ? 'Save medication' : 'Save changes')}</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)'
  },
  backdrop: {
    flex: 1
  },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '85%',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -4 }
      },
      android: {
        elevation: 12
      }
    })
  },
  grabberWrapper: {
    alignItems: 'center',
    paddingVertical: spacing(1)
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 999
  },
  content: {
    paddingHorizontal: spacing(3)
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: spacing(2)
  },
  label: {
    fontSize: 13,
    marginTop: spacing(2)
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1.25),
    fontSize: 15
  },
  inputMultiline: {
    minHeight: spacing(8),
    textAlignVertical: 'top'
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: spacing(3)
  },
  actions: {
    flexDirection: 'row',
    gap: spacing(1.5),
    marginTop: spacing(3)
  },
  primaryButton: {
    flex: 1,
    paddingVertical: spacing(1.25),
    borderRadius: radius.sm,
    alignItems: 'center'
  },
  primaryButtonDisabled: {
    opacity: 0.65
  },
  primaryButtonPressed: {
    opacity: 0.9
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: spacing(1.25),
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center'
  },
  secondaryButtonPressed: {
    opacity: 0.9
  },
  secondaryButtonText: {
    fontWeight: '600',
    fontSize: 15
  },
  errorBanner: {
    marginTop: spacing(2),
    borderRadius: radius.sm,
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(1.5)
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center'
  }
});
