import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View
} from 'react-native';
import type { MedicationDoseOccurrence, MedicationIntakeStatus, MedicationWithDetails } from '@carebase/shared';
import { useTheme, spacing, radius } from '../../../theme';
import { formatDisplayDate, formatDisplayTime, parseServerDate } from '../../../utils/date';
import { computeMedicationDailyCount } from './useMedicationSummary';

interface MedicationDetailSheetProps {
  visible: boolean;
  medication: MedicationWithDetails | null;
  canManage: boolean;
  onClose: () => void;
  onToggleOccurrence: (intakeId: number, status?: MedicationIntakeStatus) => Promise<void>;
  onConfirmOverride: (intakeId: number, status?: MedicationIntakeStatus) => Promise<void>;
  onUndoOccurrence: (intakeId: number) => Promise<void>;
  onEdit: () => void;
  onDeleteMedication: () => Promise<void>;
  onDeleteIntake: (intakeId: number) => Promise<void>;
  actionPending: boolean;
  actionError: string | null;
}

const STATUS_LABELS: Record<MedicationIntakeStatus, string> = {
  pending: 'Pending',
  taken: 'Taken',
  skipped: 'Skipped',
  expired: 'Expired'
};

function toDateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function formatScheduledLabel(scheduledFor: string | null): string | null {
  if (!scheduledFor) return null;
  const parsed = parseServerDate(scheduledFor);
  return `${formatDisplayDate(parsed)} · ${formatDisplayTime(parsed)}`;
}

export function MedicationDetailSheet({
  visible,
  medication,
  canManage,
  onClose,
  onToggleOccurrence,
  onConfirmOverride,
  onUndoOccurrence,
  onEdit,
  onDeleteMedication,
  onDeleteIntake,
  actionPending,
  actionError
}: MedicationDetailSheetProps) {
  const { palette } = useTheme();

  const {
    todayOccurrences,
    historyOccurrences,
    upcomingById,
    dailyCount,
    activeDoseCount,
    doseById
  } = useMemo((): {
    todayOccurrences: MedicationDoseOccurrence[];
    historyOccurrences: MedicationDoseOccurrence[];
    upcomingById: Map<number, MedicationWithDetails['upcomingIntakes'][number]>;
    dailyCount: ReturnType<typeof computeMedicationDailyCount> | null;
    activeDoseCount: number;
    doseById: Map<number, MedicationWithDetails['doses'][number]>;
  } => {
    if (!medication) {
      return {
        todayOccurrences: [],
        historyOccurrences: [],
        upcomingById: new Map(),
        dailyCount: null,
        activeDoseCount: 0,
        doseById: new Map()
      };
    }

    const upcomingMap = new Map<number, MedicationWithDetails['upcomingIntakes'][number]>();
    medication.upcomingIntakes.forEach((intake) => upcomingMap.set(intake.id, intake));
    const doseMap = new Map<number, MedicationWithDetails['doses'][number]>();
    medication.doses.forEach((dose) => {
      if (dose.id != null) {
        doseMap.set(dose.id, dose);
      }
    });

    const todayKey = toDateKey(new Date());
    const occurrences = (medication.occurrences ?? []) as MedicationDoseOccurrence[];

    const today = occurrences.filter((occurrence) => toDateKey(occurrence.occurrenceDate) === todayKey);
    const history = occurrences
      .filter((occurrence) => toDateKey(occurrence.occurrenceDate) !== todayKey)
      .sort((a, b) => toDateKey(b.occurrenceDate).localeCompare(toDateKey(a.occurrenceDate)));

    const dedupedHistory: MedicationDoseOccurrence[] = [];
    const seenHistoryKeys = new Set<string>();
    history.forEach((occurrence) => {
      const dedupeKey = `${occurrence.intakeId}-${toDateKey(occurrence.occurrenceDate)}`;
      if (seenHistoryKeys.has(dedupeKey)) {
        return;
      }
      seenHistoryKeys.add(dedupeKey);
      dedupedHistory.push(occurrence);
    });

    const activeDoseCount = medication.doses.filter((dose) => dose.isActive !== false).length || medication.doses.length;
    const dailyCountSummary = computeMedicationDailyCount(medication);

    return {
      todayOccurrences: today,
      historyOccurrences: dedupedHistory,
      upcomingById: upcomingMap,
      dailyCount: dailyCountSummary,
      activeDoseCount,
      doseById: doseMap
    };
  }, [medication]);

  const renderDoseCountPill = () => {
    if (!medication) {
      return null;
    }
    const recorded = dailyCount?.recordedCount ?? 0;
    const expectedBase = dailyCount?.expectedCount ?? 0;
    let denominator = Math.max(expectedBase, activeDoseCount);

    if (denominator === 0 && recorded > 0) {
      denominator = recorded;
    }

    if (denominator === 0 && recorded === 0) {
      return null;
    }

    const overrides = dailyCount?.overrideCount ?? 0;

    let textColor = palette.textMuted;
    let backgroundColor = palette.surfaceMuted;

    if (recorded === 0) {
      textColor = palette.textMuted;
      backgroundColor = palette.surfaceMuted;
    } else if (recorded > denominator) {
      textColor = palette.danger;
      backgroundColor = '#fee2e2';
    } else if (recorded === denominator && denominator > 0 && overrides === 0) {
      textColor = palette.success;
      backgroundColor = '#dcfce7';
    } else {
      textColor = palette.warning;
      backgroundColor = '#ffedd5';
    }

    return (
      <View style={[styles.doseCountPill, { backgroundColor }]}>
        <Text style={[styles.doseCountText, { color: textColor }]}>{recorded}/{denominator}</Text>
      </View>
    );
  };

  const doseCountPill = renderDoseCountPill();

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
                  medication.doses.map((dose) => (
                    <View key={dose.id} style={styles.row}>
                      <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>
                        {dose.label ?? 'Dose'}
                      </Text>
                      <Text style={[styles.rowMeta, { color: palette.textMuted }]}>
                        {dose.timeOfDay} · {dose.timezone}
                      </Text>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionHeading, { color: palette.textPrimary }]}>Today</Text>
                  {doseCountPill}
                </View>
                {todayOccurrences.length === 0 ? (
                  <Text style={[styles.sectionText, { color: palette.textMuted }]}>No doses scheduled today.</Text>
                ) : (
                  todayOccurrences.map((occurrence) => {
                    const intake = upcomingById.get(occurrence.intakeId) ?? null;
                    const dose = occurrence.doseId != null ? doseById.get(occurrence.doseId) ?? null : null;
                    const label = dose?.label ?? 'Dose';
                    const scheduledLabel = formatScheduledLabel(intake ? intake.scheduledFor as string : null);
                    const timezone = intake?.timezone ?? dose?.timezone ?? occurrence.timezone ?? null;
                    const statusLabel = STATUS_LABELS[occurrence.status];

                    return (
                      <View key={occurrence.intakeId} style={[styles.intakeCard, { borderColor: palette.border }]}>
                        <View style={styles.intakeHeader}>
                          <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>{label}</Text>
                          <Text
                            style={[
                              styles.statusBadge,
                              {
                                backgroundColor:
                                  occurrence.status === 'taken'
                                    ? palette.successSoft
                                    : occurrence.status === 'skipped'
                                      ? palette.warningSoft
                                      : palette.surfaceMuted,
                                color:
                                  occurrence.status === 'taken'
                                    ? palette.success
                                    : occurrence.status === 'skipped'
                                      ? palette.warning
                                      : palette.textMuted
                              }
                            ]}
                          >
                            {statusLabel}
                          </Text>
                        </View>
                        {scheduledLabel ? (
                          <Text style={[styles.rowMeta, { color: palette.textMuted }]}>
                            {scheduledLabel}
                            {timezone ? ` · ${timezone}` : ''}
                          </Text>
                        ) : null}

                        {canManage ? (
                          <View style={styles.intakeActions}>
                            {occurrence.status === 'pending' ? (
                              <>
                                <Pressable
                                  style={({ pressed }) => [
                                    styles.intakeButton,
                                    { backgroundColor: palette.success },
                                    pressed && styles.intakeButtonPressed,
                                    actionPending && styles.disabledAction
                                  ]}
                                  onPress={() => onToggleOccurrence(occurrence.intakeId, 'taken')}
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
                                  onPress={() => onToggleOccurrence(occurrence.intakeId, 'skipped')}
                                  disabled={actionPending}
                                >
                                  <Text style={styles.intakeButtonText}>Skip</Text>
                                </Pressable>
                              </>
                            ) : (
                              <>
                                <Pressable
                                  style={({ pressed }) => [
                                    styles.intakeButton,
                                    { backgroundColor: palette.surfaceMuted },
                                    pressed && styles.intakeButtonPressed,
                                    actionPending && styles.disabledAction
                                  ]}
                                  onPress={() => onUndoOccurrence(occurrence.intakeId)}
                                  disabled={actionPending}
                                >
                                  <Text style={[styles.intakeButtonText, { color: palette.textPrimary }]}>Undo</Text>
                                </Pressable>
                                <Pressable
                                  style={({ pressed }) => [
                                    styles.intakeButton,
                                    { backgroundColor: palette.primary },
                                    pressed && styles.intakeButtonPressed,
                                    actionPending && styles.disabledAction
                                  ]}
                                  onPress={() => onConfirmOverride(occurrence.intakeId, occurrence.status)}
                                  disabled={actionPending}
                                >
                                  <Text style={styles.intakeButtonText}>Override</Text>
                                </Pressable>
                              </>
                            )}
                          </View>
                        ) : (
                          <Text style={[styles.readOnlyMessage, { color: palette.textMuted }]}>
                            Only the plan owner can update intakes.
                          </Text>
                        )}

                        {canManage ? (
                          <Pressable
                            style={({ pressed }) => [
                              styles.intakeDeleteButton,
                              pressed && styles.intakeDeleteButtonPressed,
                              actionPending && styles.disabledAction
                            ]}
                            onPress={() => onDeleteIntake(occurrence.intakeId)}
                            disabled={actionPending}
                            accessibilityRole="button"
                          >
                            <Text style={[styles.intakeDeleteText, { color: palette.danger }]}>Delete entry</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })
                )}
              </View>

              <View style={styles.section}>
                <Text style={[styles.sectionHeading, { color: palette.textPrimary }]}>History</Text>
                {historyOccurrences.length === 0 ? (
                  <Text style={[styles.sectionText, { color: palette.textMuted }]}>No history recorded yet.</Text>
                ) : (
                  historyOccurrences.map((occurrence) => {
                    const statusLabel = STATUS_LABELS[occurrence.status];
                    const intake = upcomingById.get(occurrence.intakeId) ?? null;
                    const dose = occurrence.doseId != null ? doseById.get(occurrence.doseId) ?? null : null;
                    const scheduledLabel = formatScheduledLabel(intake ? intake.scheduledFor as string : null);
                    const historyEvent = occurrence.history[occurrence.history.length - 1] ?? null;
                    const historyKeySuffix = historyEvent?.id ?? 'base';
                    const occurredAtLabel = historyEvent
                      ? `${formatDisplayDate(historyEvent.occurredAt)} · ${formatDisplayTime(historyEvent.occurredAt)}`
                      : formatDisplayDate(occurrence.occurrenceDate);

                    return (
                      <View
                        key={`history-${occurrence.intakeId}-${toDateKey(occurrence.occurrenceDate)}-${historyKeySuffix}`}
                        style={styles.historyRow}
                      >
                        <View>
                          <Text style={[styles.historyLabel, { color: palette.textPrimary }]}>
                            {(dose?.label ?? 'Dose')} · {statusLabel}
                          </Text>
                          <Text style={[styles.historyMeta, { color: palette.textMuted }]}>
                            {occurredAtLabel}
                          </Text>
                          {scheduledLabel ? (
                            <Text style={[styles.historyMeta, { color: palette.textMuted }]}>
                              Scheduled {scheduledLabel}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })
                )}
              </View>

              {actionError ? (
                <View style={[styles.errorBanner, { backgroundColor: palette.dangerSoft }]}>
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
    backgroundColor: 'rgba(0, 0, 0, 0.45)'
  },
  backdrop: {
    flex: 1
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '94%'
  },
  grabberWrapper: {
    alignItems: 'center',
    paddingVertical: spacing(1)
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: radius.md
  },
  content: {
    paddingHorizontal: spacing(2)
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
    justifyContent: 'space-between',
    alignItems: 'center',
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
    paddingVertical: spacing(0.75),
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600'
  },
  rowMeta: {
    fontSize: 13,
    marginTop: spacing(0.5)
  },
  editButton: {
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.5),
    borderRadius: radius.md,
    borderWidth: 1
  },
  editButtonPressed: {
    opacity: 0.85
  },
  editButtonText: {
    fontSize: 13,
    fontWeight: '600'
  },
  doseCountPill: {
    paddingHorizontal: spacing(1.25),
    paddingVertical: spacing(0.5),
    borderRadius: radius.md
  },
  doseCountText: {
    fontSize: 13,
    fontWeight: '600'
  },
  intakeCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing(1.5),
    marginBottom: spacing(1.5)
  },
  intakeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  statusBadge: {
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.25),
    borderRadius: radius.md,
    fontSize: 12,
    fontWeight: '600'
  },
  intakeActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing(1),
    marginTop: spacing(1)
  },
  intakeButton: {
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.75),
    borderRadius: radius.md
  },
  intakeButtonPressed: {
    opacity: 0.85
  },
  intakeButtonText: {
    color: '#fff',
    fontWeight: '600'
  },
  intakeDeleteButton: {
    marginTop: spacing(1),
    paddingVertical: spacing(0.75)
  },
  intakeDeleteButtonPressed: {
    opacity: 0.85
  },
  intakeDeleteText: {
    fontWeight: '600',
    fontSize: 13
  },
  readOnlyMessage: {
    marginTop: spacing(1),
    fontSize: 13
  },
  historyRow: {
    paddingVertical: spacing(1),
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  historyLabel: {
    fontSize: 14,
    fontWeight: '600'
  },
  historyMeta: {
    fontSize: 13,
    marginTop: spacing(0.25)
  },
  errorBanner: {
    marginTop: spacing(2),
    padding: spacing(1.25),
    borderRadius: radius.md
  },
  errorText: {
    fontWeight: '600',
    fontSize: 13
  },
  deleteMedicationButton: {
    marginTop: spacing(3),
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing(1)
  },
  deleteMedicationButtonPressed: {
    opacity: 0.85
  },
  deleteMedicationText: {
    textAlign: 'center',
    fontWeight: '600'
  },
  disabledAction: {
    opacity: 0.5
  },
  closeButton: {
    marginTop: spacing(2),
    alignSelf: 'center'
  },
  closeButtonText: {
    fontWeight: '600',
    fontSize: 15
  },
  loadingState: {
    paddingVertical: spacing(4),
    alignItems: 'center'
  }
});
