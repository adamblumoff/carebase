import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View
} from 'react-native';
import type { MedicationWithDetails } from '@carebase/shared';
import { useTheme, spacing, radius } from '../../../theme';
import { formatDisplayDate, formatDisplayTime } from '../../../utils/date';

interface MedicationDetailSheetProps {
  visible: boolean;
  medication: MedicationWithDetails | null;
  canManage: boolean;
  onClose: () => void;
  onMarkTaken: (intakeId: number) => Promise<void>;
  onMarkSkipped: (intakeId: number) => Promise<void>;
  onRecordNow: () => Promise<void>;
  onEdit: () => void;
  onDeleteMedication: () => Promise<void>;
  onDeleteIntake: (intakeId: number) => Promise<void>;
  actionPending: boolean;
  actionError: string | null;
}

export function MedicationDetailSheet({
  visible,
  medication,
  canManage,
  onClose,
  onMarkTaken,
  onMarkSkipped,
  onRecordNow,
  onEdit,
  onDeleteMedication,
  onDeleteIntake,
  actionPending,
  actionError
}: MedicationDetailSheetProps) {
  const { palette } = useTheme();
  const sortedDoses = useMemo(() => {
    if (!medication) return [];
    return [...medication.doses].sort((a, b) => {
      const updatedA = a.updatedAt ? new Date(a.updatedAt).getTime() : null;
      const updatedB = b.updatedAt ? new Date(b.updatedAt).getTime() : null;
      if (updatedA != null && updatedB != null && updatedA !== updatedB) {
        return updatedB - updatedA;
      }
      if (a.timeOfDay !== b.timeOfDay) {
        return b.timeOfDay.localeCompare(a.timeOfDay);
      }
      return (a.label ?? '').localeCompare(b.label ?? '');
    });
  }, [medication]);

  const sortedIntakes = useMemo(() => {
    if (!medication) return [];
    return [...medication.upcomingIntakes].sort(
      (a, b) => new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime()
    );
  }, [medication]);

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
          {medication ? (
            <ScrollView
              style={styles.content}
              contentContainerStyle={{ paddingBottom: spacing(3) }}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.title, { color: palette.textPrimary }]}>{medication.name}</Text>
              {medication.instructions ? (
                <Text style={[styles.sectionText, { color: palette.textSecondary }]}>
                  {medication.instructions}
                </Text>
              ) : null}

              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionHeading, { color: palette.textPrimary }]}>Schedule</Text>
                  {canManage ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.editButton,
                        { borderColor: palette.primary },
                        pressed && styles.editButtonPressed
                      ]}
                      onPress={onEdit}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.editButtonText, { color: palette.primary }]}>Edit</Text>
                    </Pressable>
                  ) : null}
                </View>
                {medication.doses.length === 0 ? (
                  <Text style={[styles.sectionText, { color: palette.textMuted }]}>No doses configured.</Text>
                ) : (
                  sortedDoses.map((dose) => (
                    <View key={dose.id} style={styles.row}>
                      <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>
                        {dose.label ?? 'Dose'}
                      </Text>
                      <Text style={[styles.rowMeta, { color: palette.textMuted }]}
                      >
                        {dose.timeOfDay} · {dose.timezone}
                      </Text>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionHeading, { color: palette.textPrimary }]}>Upcoming doses</Text>
                  {canManage ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.recordNow,
                        { backgroundColor: palette.primary },
                        pressed && styles.recordNowPressed
                      ]}
                      onPress={onRecordNow}
                      disabled={actionPending}
                    >
                      {actionPending ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.recordNowText}>Mark taken now</Text>
                      )}
                    </Pressable>
                  ) : (
                    <Text style={[styles.readOnlyMessage, { color: palette.textMuted }]}>
                      Only the plan owner can update intakes.
                    </Text>
                  )}
                </View>
                {medication.upcomingIntakes.length === 0 ? (
                  <Text style={[styles.sectionText, { color: palette.textMuted }]}>No upcoming intakes.</Text>
                ) : (
                  sortedIntakes.slice(0, 5).map((intake) => (
                    <View key={intake.id} style={[styles.intakeCard, { borderColor: palette.border }]}>
                      <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>
                        {formatDisplayDate(intake.scheduledFor)} · {formatDisplayTime(intake.scheduledFor)}
                      </Text>
                      <Text style={[styles.rowMeta, { color: palette.textMuted }]}>Status: {intake.status}</Text>
                      {canManage ? (
                        <>
                          <View style={styles.intakeActions}>
                            <Pressable
                              style={({ pressed }) => [
                                styles.intakeButton,
                                { backgroundColor: palette.success },
                                pressed && styles.intakeButtonPressed,
                                actionPending && styles.disabledAction
                              ]}
                              onPress={() => onMarkTaken(intake.id)}
                              disabled={actionPending}
                            >
                              <Text style={styles.intakeButtonText}>Mark taken</Text>
                            </Pressable>
                            <Pressable
                              style={({ pressed }) => [
                                styles.intakeButton,
                                { backgroundColor: palette.warning },
                                pressed && styles.intakeButtonPressed,
                                actionPending && styles.disabledAction
                              ]}
                              onPress={() => onMarkSkipped(intake.id)}
                              disabled={actionPending}
                            >
                              <Text style={styles.intakeButtonText}>Skip</Text>
                            </Pressable>
                          </View>
                          <Pressable
                            style={({ pressed }) => [
                              styles.intakeDeleteButton,
                              pressed && styles.intakeDeleteButtonPressed,
                              actionPending && styles.disabledAction
                            ]}
                            onPress={() => onDeleteIntake(intake.id)}
                            disabled={actionPending}
                            accessibilityRole="button"
                          >
                            <Text style={[styles.intakeDeleteText, { color: palette.danger }]}>Delete entry</Text>
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  ))
                )}
              </View>

              {actionError ? (
                <View style={[styles.errorBanner, { backgroundColor: palette.dangerSoft }]}
                >
                  <Text style={[styles.errorText, { color: palette.danger }]}>{actionError}</Text>
                </View>
              ) : null}

              {canManage ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.deleteMedicationButton,
                    { borderColor: palette.danger },
                    pressed && styles.deleteMedicationButtonPressed,
                    actionPending && styles.disabledAction
                  ]}
                  onPress={onDeleteMedication}
                  disabled={actionPending}
                  accessibilityRole="button"
                >
                  <Text style={[styles.deleteMedicationText, { color: palette.danger }]}>
                    Delete medication
                  </Text>
                </Pressable>
              ) : null}

              <Pressable style={styles.closeButton} onPress={onClose} accessibilityRole="button">
                <Text style={[styles.closeButtonText, { color: palette.primary }]}>Close</Text>
              </Pressable>
            </ScrollView>
          ) : (
            <View style={styles.loadingState}>
              <ActivityIndicator color={palette.primary} />
            </View>
          )}
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
    maxHeight: '80%',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.2,
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
  loadingState: {
    padding: spacing(3)
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: spacing(1)
  },
  section: {
    marginTop: spacing(2)
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing(1)
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '600'
  },
  sectionText: {
    fontSize: 14,
    lineHeight: 20
  },
  row: {
    marginTop: spacing(1)
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600'
  },
  rowMeta: {
    marginTop: spacing(0.25),
    fontSize: 13
  },
  editButton: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.5)
  },
  editButtonPressed: {
    opacity: 0.85
  },
  editButtonText: {
    fontSize: 13,
    fontWeight: '600'
  },
  intakeCard: {
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing(1.5),
    marginTop: spacing(1)
  },
  intakeActions: {
    flexDirection: 'row',
    gap: spacing(1),
    marginTop: spacing(1)
  },
  intakeButton: {
    flex: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing(1),
    alignItems: 'center'
  },
  intakeButtonPressed: {
    opacity: 0.9
  },
  intakeButtonText: {
    color: '#fff',
    fontWeight: '600'
  },
  disabledAction: {
    opacity: 0.5
  },
  intakeDeleteButton: {
    marginTop: spacing(0.5),
    alignSelf: 'flex-start',
    paddingVertical: spacing(0.5),
    paddingHorizontal: spacing(0.5)
  },
  intakeDeleteButtonPressed: {
    opacity: 0.7
  },
  intakeDeleteText: {
    fontSize: 13,
    fontWeight: '600'
  },
  recordNow: {
    borderRadius: radius.sm,
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(1.5)
  },
  recordNowPressed: {
    opacity: 0.85
  },
  recordNowText: {
    color: '#fff',
    fontWeight: '600'
  },
  readOnlyMessage: {
    fontSize: 13,
    fontStyle: 'italic'
  },
  errorBanner: {
    marginTop: spacing(2),
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(1.5),
    borderRadius: radius.sm
  },
  errorText: {
    textAlign: 'center',
    fontSize: 13
  },
  deleteMedicationButton: {
    marginTop: spacing(3),
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing(1),
    alignItems: 'center'
  },
  deleteMedicationButtonPressed: {
    opacity: 0.85
  },
  deleteMedicationText: {
    fontSize: 14,
    fontWeight: '600'
  },
  closeButton: {
    marginTop: spacing(2),
    alignItems: 'center'
  },
  closeButtonText: {
    fontSize: 15,
    fontWeight: '600'
  }
});
