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
  View,
  Keyboard,
  type KeyboardEvent
} from 'react-native';
import type { MedicationWithDetails } from '@carebase/shared';
import { useTheme, spacing, radius } from '../../../theme';
import DateTimePickerModal from '../../../components/DateTimePickerModal';
import {
  buildInitialValues,
  validateMedicationForm,
  type DoseFormValidationErrors,
  type DoseFormValue,
  type MedicationFormValidationErrors,
  type MedicationFormValues
} from './MedicationFormSheet.helpers';

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

const toTwoDigit = (value: number) => value.toString().padStart(2, '0');

const parseTimeToDate = (value: string): Date => {
  const [hours, minutes] = value.split(':').map((part) => Number(part));
  const date = new Date();
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    date.setHours(8, 0, 0, 0);
    return date;
  }
  date.setHours(hours, minutes, 0, 0);
  return date;
};

const formatDateToTime = (value: Date): string => `${toTwoDigit(value.getHours())}:${toTwoDigit(value.getMinutes())}`;

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
  const [keyboardPadding, setKeyboardPadding] = useState(0);
  const [activeDosePicker, setActiveDosePicker] = useState<{ index: number; date: Date } | null>(null);
  const [dosePickerVisible, setDosePickerVisible] = useState(false);

  useEffect(() => {
    setValues(buildInitialValues(medication, defaultTimezone));
    setFieldErrors({});
  }, [medication, defaultTimezone, visible]);

  const canSubmit = values.name.trim().length > 0 && values.doses.length > 0 && !submitting;

  const handleFieldChange = (field: 'name' | 'instructions', next: string) => {
    setValues((current) => ({ ...current, [field]: next }));
    if (field === 'name') {
      setFieldErrors((prev) => {
        if (!prev.name) return prev;
        const { name, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleDoseChange = (index: number, field: 'label' | 'timeOfDay' | 'timezone', next: string) => {
    setValues((current) => {
      const doses = current.doses.map((dose, idx) => (idx === index ? { ...dose, [field]: next } : dose));
      return { ...current, doses };
    });
    setFieldErrors((prev) => {
      if (!prev.doses) return prev;
      const dosesErrors = [...prev.doses];
      if (!dosesErrors[index]) return prev;
      const updatedDoseErrors = { ...dosesErrors[index] };
      delete (updatedDoseErrors as any)[field];
      dosesErrors[index] = updatedDoseErrors;
      if (dosesErrors.every((error) => !error || Object.keys(error).length === 0)) {
        const { doses, ...rest } = prev;
        return rest;
      }
      return { ...prev, doses: dosesErrors };
    });
  };

  const handleAddDose = () => {
    setValues((current) => ({
      ...current,
      doses: [
        {
          label: '',
          timeOfDay: '08:00',
          timezone: current.doses[0]?.timezone ?? defaultTimezone
        },
        ...current.doses
      ]
    }));
  };

  const handleRemoveDose = (index: number) => {
    setValues((current) => {
      if (current.doses.length <= 1) {
        return current;
      }
      const doses = current.doses.filter((_, idx) => idx !== index);
      return { ...current, doses };
    });
    setFieldErrors((prev) => {
      if (!prev.doses) return prev;
      const dosesErrors = prev.doses.filter((_, idx) => idx !== index);
      if (dosesErrors.every((error) => !error || Object.keys(error).length === 0)) {
        const { doses, ...rest } = prev;
        return rest;
      }
      return { ...prev, doses: dosesErrors };
    });
  };

  const openDoseTimePicker = (index: number) => {
    const dose = values.doses[index];
    setActiveDosePicker({ index, date: parseTimeToDate(dose.timeOfDay) });
    setDosePickerVisible(true);
  };

  const closeDoseTimePicker = () => {
    setDosePickerVisible(false);
    setActiveDosePicker(null);
  };

  const handleConfirmDoseTime = (selectedDate: Date) => {
    if (activeDosePicker == null) {
      closeDoseTimePicker();
      return;
    }
    const nextTime = formatDateToTime(selectedDate);
    handleDoseChange(activeDosePicker.index, 'timeOfDay', nextTime);
    closeDoseTimePicker();
  };

  const handleSubmit = async () => {
    const result = validateMedicationForm(values);
    const hasErrors = Boolean(result.errors.name) || Boolean(result.errors.doses);
    if (hasErrors) {
      setFieldErrors(result.errors);
      return;
    }
    setFieldErrors({});
    await onSubmit(result.normalized);
  };

  useEffect(() => {
    if (!visible) {
      setKeyboardPadding(0);
      return () => {};
    }
    const handleShow = (event: KeyboardEvent) => {
      setKeyboardPadding(event.endCoordinates?.height ?? 0);
    };
    const handleHide = () => {
      setKeyboardPadding(0);
    };
    const showListener = Keyboard.addListener('keyboardDidShow', handleShow);
    const hideListener = Keyboard.addListener('keyboardDidHide', handleHide);
    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, [visible]);

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
            contentContainerStyle={{
              paddingBottom: spacing(3) + keyboardPadding
            }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
              <Text style={[styles.title, { color: palette.textPrimary }]}>
                {mode === 'create' ? 'Add medication' : 'Edit medication'}
              </Text>

              <Text style={[styles.label, { color: palette.textSecondary }]}>Name</Text>
              <TextInput
                value={values.name}
                onChangeText={(text) => handleFieldChange('name', text)}
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
                onChangeText={(text) => handleFieldChange('instructions', text)}
                placeholder="Add instructions (optional)"
                style={[styles.input, styles.inputMultiline, { borderColor: palette.border, color: palette.textPrimary }]}
                placeholderTextColor={palette.textMuted}
                multiline
              />

              <Text style={[styles.sectionHeading, { color: palette.textPrimary }]}>Dose schedule</Text>

              {values.doses.map((dose, index) => {
                const doseError = fieldErrors.doses?.[index];
                return (
                  <View
                    key={dose.id ?? `dose-${index}`}
                    style={[
                      styles.doseCard,
                      {
                        borderColor: palette.border,
                        backgroundColor: palette.surface
                      }
                    ]}
                  >
                    <View style={styles.doseHeader}>
                      <Text style={[styles.doseTitle, { color: palette.textPrimary }]}>
                        {dose.label.trim() !== '' ? dose.label : `Dose ${index + 1}`}
                      </Text>
                      {values.doses.length > 1 ? (
                        <Pressable
                          style={({ pressed }) => [
                            styles.removeDoseButton,
                            pressed && styles.removeDoseButtonPressed
                          ]}
                          onPress={() => handleRemoveDose(index)}
                          accessibilityRole="button"
                        >
                          <Text style={[styles.removeDoseText, { color: palette.danger }]}>Remove</Text>
                        </Pressable>
                      ) : null}
                    </View>

                    <Text style={[styles.label, styles.doseSubLabel, { color: palette.textSecondary }]}>
                      Label (optional)
                    </Text>
                    <TextInput
                      value={dose.label}
                      onChangeText={(text) => handleDoseChange(index, 'label', text)}
                      placeholder={`Dose ${index + 1}`}
                      style={[
                        styles.input,
                        styles.doseInput,
                        {
                          borderColor: palette.border,
                          color: palette.textPrimary
                        }
                      ]}
                      placeholderTextColor={palette.textMuted}
                    />

                    <Text style={[styles.label, styles.doseSubLabel, { color: palette.textSecondary }]}>
                      Time of day (HH:mm)
                    </Text>
                    <Pressable
                      style={({ pressed }) => [
                        styles.doseTimeButton,
                        {
                          borderColor: doseError?.timeOfDay ? palette.danger : palette.border,
                          backgroundColor: palette.surface
                        },
                        pressed && styles.doseTimeButtonPressed
                      ]}
                      onPress={() => openDoseTimePicker(index)}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.doseTimeText, { color: palette.textPrimary }]}>{dose.timeOfDay}</Text>
                    </Pressable>
                    {doseError?.timeOfDay ? (
                      <Text style={[styles.inputErrorText, { color: palette.danger }]}>{doseError.timeOfDay}</Text>
                    ) : null}

                    <Text style={[styles.label, styles.doseSubLabel, { color: palette.textSecondary }]}>Timezone</Text>
                    <TextInput
                      value={dose.timezone}
                      onChangeText={(text) => handleDoseChange(index, 'timezone', text)}
                      placeholder="America/New_York"
                      style={[
                        styles.input,
                        styles.doseInput,
                        {
                          borderColor: doseError?.timezone ? palette.danger : palette.border,
                          color: palette.textPrimary
                        }
                      ]}
                      placeholderTextColor={palette.textMuted}
                      autoCapitalize="words"
                    />
                    {doseError?.timezone ? (
                      <Text style={[styles.inputErrorText, { color: palette.danger }]}>{doseError.timezone}</Text>
                    ) : null}
                  </View>
                );
              })}

              <Pressable
                style={({ pressed }) => [
                  styles.addDoseButton,
                  { borderColor: palette.primary },
                  pressed && styles.addDoseButtonPressed
                ]}
                onPress={handleAddDose}
                accessibilityRole="button"
              >
                <Text style={[styles.addDoseText, { color: palette.primary }]}>Add another dose</Text>
              </Pressable>

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
                    (!canSubmit || submitting) && styles.primaryButtonDisabled,
                    pressed && canSubmit && !submitting && styles.primaryButtonPressed
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
          <DateTimePickerModal
            visible={dosePickerVisible}
            mode="time"
            value={activeDosePicker?.date ?? new Date()}
            onDismiss={closeDoseTimePicker}
            onConfirm={handleConfirmDoseTime}
          />
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
  doseCard: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing(2),
    marginTop: spacing(2),
    gap: spacing(1.5)
  },
  doseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  doseTitle: {
    fontSize: 15,
    fontWeight: '600'
  },
  removeDoseButton: {
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.5),
    borderRadius: radius.sm
  },
  removeDoseButtonPressed: {
    opacity: 0.7
  },
  removeDoseText: {
    fontSize: 13,
    fontWeight: '600'
  },
  doseSubLabel: {
    marginTop: spacing(1)
  },
  doseInput: {
    marginTop: spacing(0.75)
  },
  doseTimeButton: {
    marginTop: spacing(0.75),
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(1.5),
    alignItems: 'flex-start'
  },
  doseTimeButtonPressed: {
    opacity: 0.85
  },
  doseTimeText: {
    fontSize: 15,
    fontWeight: '600'
  },
  addDoseButton: {
    marginTop: spacing(2),
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing(1),
    alignItems: 'center'
  },
  addDoseButtonPressed: {
    opacity: 0.8
  },
  addDoseText: {
    fontWeight: '600',
    fontSize: 14
  },
  inputErrorText: {
    fontSize: 12,
    marginTop: spacing(0.5)
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
