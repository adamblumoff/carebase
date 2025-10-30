import React from 'react';
import { Alert, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { MedicationSummaryItem } from './useMedicationSummary';
import { formatDisplayDate, formatDisplayTime, parseServerDate } from '../../../utils/date';
import { useTheme, spacing, radius } from '../../../theme';
import type { MedicationIntakeStatus } from '@carebase/shared';

interface MedicationSummaryListProps {
  items: MedicationSummaryItem[];
  onSelect: (medicationId: number) => void;
  onToggleOccurrence: (medicationId: number, intakeId: number, status?: MedicationIntakeStatus) => Promise<void>;
  onConfirmOverride: (medicationId: number, intakeId: number, status?: MedicationIntakeStatus) => Promise<void>;
  canManage: boolean;
}

export function MedicationSummaryList({
  items,
  onSelect,
  onToggleOccurrence,
  onConfirmOverride,
  canManage
}: MedicationSummaryListProps) {
  const { palette } = useTheme();

  if (items.length === 0) {
    return null;
  }

  const handleStatusPress = (
    item: MedicationSummaryItem,
    occurrenceId: number,
    status: MedicationIntakeStatus,
    event?: any
  ) => {
    if (event?.stopPropagation) {
      event.stopPropagation();
    }

    if (!canManage) {
      onSelect(item.id);
      return;
    }

    if (status === 'pending') {
      void onToggleOccurrence(item.id, occurrenceId, 'taken');
      return;
    }

    Alert.alert(
      'Already recorded',
      'You already marked this dose. Override the status?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Override',
          style: 'destructive',
          onPress: () => {
            void onConfirmOverride(item.id, occurrenceId, status);
          }
        }
      ]
    );
  };

  return (
    <View style={styles.list}>
      {items.map((item) => {
        const date = item.nextOccurrenceTime ? parseServerDate(item.nextOccurrenceTime) : null;

        return (
          <TouchableOpacity
            key={item.id}
            onPress={() => onSelect(item.id)}
            style={[
              styles.card,
              {
                backgroundColor: palette.surface,
                borderColor: item.isArchived ? palette.border : 'transparent'
              }
            ]}
            accessibilityRole="button"
          >
            <View style={styles.cardRow}>
              <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>{item.name}</Text>
              {item.isOverdue ? (
                <Text style={[styles.cardBadge, { color: palette.danger }]} accessibilityRole="text">
                  Overdue
                </Text>
              ) : null}
            </View>
            {date ? (
              <Text style={[styles.cardMeta, { color: palette.textMuted }]}>
                {item.nextOccurrenceLabel ?? 'Dose'} · {formatDisplayDate(date)} at {formatDisplayTime(date)}
              </Text>
            ) : (
              <Text style={[styles.cardMeta, { color: palette.textMuted }]}>No upcoming doses</Text>
            )}

            <View style={styles.occurrenceRow}>
              {item.occurrences.map((occurrence) => {
                const isPending = occurrence.status === 'pending';
                const isTaken = occurrence.status === 'taken';
                const isSkipped = occurrence.status === 'skipped';

                return (
                  <Pressable
                    key={occurrence.intakeId}
                    onPress={(event) => handleStatusPress(item, occurrence.intakeId, occurrence.status, event)}
                    style={({ pressed }) => [
                      styles.occurrenceChip,
                      {
                        borderColor: isTaken
                          ? palette.success
                          : isSkipped
                            ? palette.warning
                            : palette.border,
                        backgroundColor: isPending ? palette.surface : palette.surfaceMuted
                      },
                      pressed && styles.occurrenceChipPressed
                    ]}
                    accessibilityRole="button"
                    testID={`medication-chip-${item.id}-${occurrence.intakeId}`}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        {
                          borderColor: isPending ? palette.border : 'transparent',
                          backgroundColor: isTaken
                            ? palette.success
                            : isSkipped
                              ? palette.warning
                              : palette.canvas
                        }
                      ]}
                    >
                      {isTaken ? <Text style={styles.checkboxMark}>✓</Text> : null}
                      {isSkipped ? <Text style={styles.checkboxMark}>!</Text> : null}
                    </View>
                    <View style={styles.chipTextWrapper}>
                      <Text style={[styles.chipLabel, { color: palette.textPrimary }]} numberOfLines={1}>
                        {occurrence.label ?? 'Dose'}
                      </Text>
                      {occurrence.scheduledFor ? (
                        <Text style={[styles.chipMeta, { color: palette.textMuted }]}>
                          {formatDisplayTime(parseServerDate(occurrence.scheduledFor))}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    marginTop: spacing(1.5)
  },
  card: {
    borderRadius: radius.md,
    paddingVertical: spacing(1.5),
    paddingHorizontal: spacing(2),
    marginBottom: spacing(1),
    borderWidth: 1
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600'
  },
  cardBadge: {
    fontSize: 12,
    fontWeight: '600'
  },
  cardMeta: {
    marginTop: spacing(0.75),
    fontSize: 13
  },
  occurrenceRow: {
    marginTop: spacing(1),
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing(1)
  },
  occurrenceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(1.25),
    paddingVertical: spacing(0.75),
    borderRadius: radius.lg,
    borderWidth: 1
  },
  occurrenceChipPressed: {
    opacity: 0.9
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: radius.xs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginRight: spacing(0.75)
  },
  checkboxMark: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700'
  },
  chipTextWrapper: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600'
  },
  chipMeta: {
    fontSize: 12,
    marginLeft: spacing(0.5)
  }
});
