import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { MedicationSummaryItem } from './useMedicationSummary';
import { formatDisplayDate, formatDisplayTime, parseServerDate } from '../../../utils/date';
import { useTheme, spacing, radius } from '../../../theme';

interface MedicationSummaryListProps {
  items: MedicationSummaryItem[];
  onSelect: (medicationId: number) => void;
}

export function MedicationSummaryList({ items, onSelect }: MedicationSummaryListProps) {
  const { palette } = useTheme();

  if (items.length === 0) {
    return null;
  }

  return (
    <View style={styles.list}>
      {items.map((item) => {
        const date = item.nextDoseTime ? parseServerDate(item.nextDoseTime) : null;
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
                {item.nextDoseLabel} · {formatDisplayDate(date)} at {formatDisplayTime(date)}
              </Text>
            ) : (
              <Text style={[styles.cardMeta, { color: palette.textMuted }]}>No upcoming doses</Text>
            )}
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
  }
});
