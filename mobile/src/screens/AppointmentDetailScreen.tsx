/**
 * Appointment Detail Screen
 * Update appointment details, including date and time
 */
import React, { useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import apiClient from '../api/client';
import { API_ENDPOINTS } from '../config';
import { palette, spacing, radius, shadow } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'AppointmentDetail'>;

const pad = (value: number) => value.toString().padStart(2, '0');

const parseServerDate = (value: string) => new Date(value);

const formatDateInput = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const formatTimeInput = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

const formatDisplayDateTime = (dateString: string) => {
  const date = parseServerDate(dateString);
  return date.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const combineDateTime = (dateStr: string, timeStr: string) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    Number.isNaN(hour) ||
    Number.isNaN(minute)
  ) {
    return null;
  }
  const combined = new Date();
  combined.setFullYear(year, month - 1, day);
  combined.setHours(hour, minute, 0, 0);
  return combined;
};

const formatForPayload = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

export default function AppointmentDetailScreen({ route, navigation }: Props) {
  const { appointment } = route.params;
  const [currentAppointment, setCurrentAppointment] = useState(appointment);
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(appointment.summary);
  const [location, setLocation] = useState(appointment.location || '');
  const [prepNote, setPrepNote] = useState(appointment.prepNote || '');
  const [startDateInput, setStartDateInput] = useState(
    formatDateInput(parseServerDate(appointment.startLocal))
  );
  const [startTimeInput, setStartTimeInput] = useState(
    formatTimeInput(parseServerDate(appointment.startLocal))
  );
  const [endDateInput, setEndDateInput] = useState(
    formatDateInput(parseServerDate(appointment.endLocal))
  );
  const [endTimeInput, setEndTimeInput] = useState(
    formatTimeInput(parseServerDate(appointment.endLocal))
  );
  const [saving, setSaving] = useState(false);

  const syncFormFromAppointment = (appt: typeof currentAppointment) => {
    setSummary(appt.summary);
    setLocation(appt.location || '');
    setPrepNote(appt.prepNote || '');
    const start = parseServerDate(appt.startLocal);
    const end = parseServerDate(appt.endLocal);
    setStartDateInput(formatDateInput(start));
    setStartTimeInput(formatTimeInput(start));
    setEndDateInput(formatDateInput(end));
    setEndTimeInput(formatTimeInput(end));
  };

  const handleSave = async () => {
    const start = combineDateTime(startDateInput, startTimeInput);
    const end = combineDateTime(endDateInput, endTimeInput);

    if (!start || !end) {
      Alert.alert('Invalid date', 'Please enter a valid start and end time.');
      return;
    }

    if (end.getTime() <= start.getTime()) {
      Alert.alert('Invalid range', 'End time must be after start time.');
      return;
    }

    setSaving(true);
    try {
      const response = await apiClient.patch(API_ENDPOINTS.updateAppointment(appointment.id), {
        summary,
        location: location || undefined,
        prepNote: prepNote || undefined,
        startLocal: formatForPayload(start),
        endLocal: formatForPayload(end),
      });

      const updated = response.data;
      setCurrentAppointment(updated);
      syncFormFromAppointment(updated);
      Alert.alert('Saved', 'Appointment updated successfully');
      setEditing(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to update appointment');
      console.error('Update appointment error:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Appointment',
      'Are you sure you want to delete this appointment?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(API_ENDPOINTS.deleteAppointment(appointment.id));
              navigation.goBack();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete appointment');
            }
          },
        },
      ]
    );
  };

  const handleCancelEdit = () => {
    syncFormFromAppointment(currentAppointment);
    setEditing(false);
  };

  const startDisplay = formatDisplayDateTime(currentAppointment.startLocal);
  const locationDisplay = editing ? location : currentAppointment.location;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        bounces={false}
      >
        <View style={[styles.summaryCard, shadow.card]}>
          <View style={styles.summaryAccent} />
          <View style={styles.summaryBody}>
            <Text style={styles.summaryLabel}>Upcoming visit</Text>
            <Text style={styles.summaryTitle}>{editing ? summary : currentAppointment.summary}</Text>
            <Text style={styles.summaryMeta}>{startDisplay}</Text>
            {locationDisplay ? (
              <Text style={styles.summaryMeta}>📍 {locationDisplay}</Text>
            ) : null}
          </View>
        </View>

        {editing ? (
          <View style={styles.formCard}>
            <Text style={styles.formLabel}>Summary</Text>
            <TextInput
              style={styles.input}
              value={summary}
              onChangeText={setSummary}
              placeholder="Appointment title"
              placeholderTextColor={palette.textMuted}
            />

            <Text style={styles.formLabel}>Location</Text>
            <TextInput
              style={styles.input}
              value={location}
              onChangeText={setLocation}
              placeholder="Location (optional)"
              placeholderTextColor={palette.textMuted}
            />

            <Text style={styles.formLabel}>Start</Text>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.rowInput]}
                value={startDateInput}
                onChangeText={setStartDateInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={palette.textMuted}
                keyboardType="numbers-and-punctuation"
              />
              <TextInput
                style={[styles.input, styles.rowInput]}
                value={startTimeInput}
                onChangeText={setStartTimeInput}
                placeholder="HH:MM"
                placeholderTextColor={palette.textMuted}
                keyboardType="numbers-and-punctuation"
              />
            </View>

            <Text style={styles.formLabel}>End</Text>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.rowInput]}
                value={endDateInput}
                onChangeText={setEndDateInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={palette.textMuted}
                keyboardType="numbers-and-punctuation"
              />
              <TextInput
                style={[styles.input, styles.rowInput]}
                value={endTimeInput}
                onChangeText={setEndTimeInput}
                placeholder="HH:MM"
                placeholderTextColor={palette.textMuted}
                keyboardType="numbers-and-punctuation"
              />
            </View>

            <Text style={styles.formLabel}>Prep notes</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={prepNote}
              onChangeText={setPrepNote}
              placeholder="Preparation notes (optional)"
              placeholderTextColor={palette.textMuted}
              multiline
              numberOfLines={3}
            />

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.secondaryButton, styles.buttonFlex]}
                onPress={handleCancelEdit}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, styles.buttonFlex]}
                onPress={handleSave}
                disabled={saving}
              >
                <Text style={styles.primaryButtonText}>
                  {saving ? 'Saving…' : 'Save changes'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.detailsCard}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Prep note</Text>
              <Text
                style={currentAppointment.prepNote ? styles.detailValue : styles.detailValueMuted}
              >
                {currentAppointment.prepNote || 'Add a reminder for this visit.'}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => {
                syncFormFromAppointment(currentAppointment);
                setEditing(true);
              }}
            >
              <Text style={styles.primaryButtonText}>Edit visit details</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dangerButton} onPress={handleDelete}>
              <Text style={styles.dangerButtonText}>Delete appointment</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.surfaceMuted,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: spacing(3),
    paddingBottom: spacing(6),
  },
  summaryCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: spacing(3),
  },
  summaryAccent: {
    width: 6,
    backgroundColor: palette.primary,
  },
  summaryBody: {
    flex: 1,
    padding: spacing(2.5),
  },
  summaryLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    fontWeight: '700',
    color: palette.textMuted,
  },
  summaryTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: palette.textPrimary,
    marginTop: spacing(0.5),
  },
  summaryMeta: {
    marginTop: spacing(1),
    color: palette.textSecondary,
    fontSize: 14,
  },
  formCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    padding: spacing(3),
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.textSecondary,
    marginBottom: spacing(0.5),
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: palette.surfaceMuted,
    borderRadius: radius.sm,
    paddingVertical: spacing(1.25),
    paddingHorizontal: spacing(2),
    marginBottom: spacing(1.5),
    borderWidth: 1,
    borderColor: '#dbe7d7',
    fontSize: 16,
    color: palette.textPrimary,
  },
  textArea: {
    height: 112,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: spacing(1),
    marginBottom: spacing(1.5),
  },
  rowInput: {
    flex: 1,
    marginBottom: 0,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing(2),
    marginTop: spacing(1),
  },
  buttonFlex: {
    flex: 1,
  },
  primaryButton: {
    backgroundColor: palette.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing(1.5),
    alignItems: 'center',
    marginTop: spacing(3),
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.textMuted,
    paddingVertical: spacing(1.5),
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: palette.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  dangerButton: {
    marginTop: spacing(2),
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.danger,
    paddingVertical: spacing(1.5),
    alignItems: 'center',
  },
  dangerButtonText: {
    color: palette.danger,
    fontSize: 15,
    fontWeight: '600',
  },
  detailsCard: {
    marginTop: spacing(3),
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    padding: spacing(3),
    ...shadow.card,
  },
  detailRow: {
    marginBottom: spacing(2),
  },
  detailLabel: {
    fontSize: 12,
    color: palette.textMuted,
    textTransform: 'uppercase',
    fontWeight: '700',
    marginBottom: spacing(0.5),
  },
  detailValue: {
    fontSize: 15,
    color: palette.textPrimary,
    lineHeight: 22,
  },
  detailValueMuted: {
    fontSize: 15,
    color: palette.textMuted,
    lineHeight: 22,
  },
});
