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
  Alert,
  Platform,
  TextInput,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import apiClient from '../api/client';
import { API_ENDPOINTS } from '../config';
import { palette, spacing, radius, shadow } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'AppointmentDetail'>;

const pad = (value: number) => value.toString().padStart(2, '0');

const parseServerDate = (value: string) => new Date(value);

const formatDisplayDateTime = (date: Date) =>
  date.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
const formatDisplayDate = (date: Date) =>
  date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

const formatDisplayTime = (date: Date) =>
  date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

const formatForPayload = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

export default function AppointmentDetailScreen({ route, navigation }: Props) {
  const { appointment } = route.params;
  const [currentAppointment, setCurrentAppointment] = useState(appointment);
  const [startDateTime, setStartDateTime] = useState(parseServerDate(appointment.startLocal));
  const [pendingStart, setPendingStart] = useState(parseServerDate(appointment.startLocal));
  const [pendingSummary, setPendingSummary] = useState(appointment.summary);
  const [pendingLocation, setPendingLocation] = useState(appointment.location || '');
  const [pendingNote, setPendingNote] = useState(appointment.prepNote || '');
  const [editing, setEditing] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const initialDuration =
    parseServerDate(appointment.endLocal).getTime() -
    parseServerDate(appointment.startLocal).getTime();
  const durationMs = initialDuration > 0 ? initialDuration : 60 * 60 * 1000;

  const handleSave = async () => {
    const end = new Date(pendingStart.getTime() + durationMs);

    setSaving(true);
    try {
      const response = await apiClient.patch(API_ENDPOINTS.updateAppointment(appointment.id), {
        startLocal: formatForPayload(pendingStart),
        endLocal: formatForPayload(end),
        summary: pendingSummary,
        location: pendingLocation || undefined,
        prepNote: pendingNote || undefined,
      });

      const updated = response.data;
      setCurrentAppointment(updated);
      const updatedStart = parseServerDate(updated.startLocal);
      setStartDateTime(updatedStart);
      setPendingStart(updatedStart);
      setPendingSummary(updated.summary);
      setPendingLocation(updated.location || '');
      setPendingNote(updated.prepNote || '');
      Alert.alert('Saved', 'Appointment updated successfully');
      setShowDatePicker(false);
      setShowTimePicker(false);
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
    setPendingStart(new Date(startDateTime));
    setPendingSummary(currentAppointment.summary);
    setPendingLocation(currentAppointment.location || '');
    setPendingNote(currentAppointment.prepNote || '');
    setEditing(false);
    setShowDatePicker(false);
    setShowTimePicker(false);
  };

  const startDisplay = formatDisplayDateTime(startDateTime);
  const locationDisplay = currentAppointment.location;

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
            <Text style={styles.summaryTitle}>{currentAppointment.summary}</Text>
            <Text style={styles.summaryMeta}>{startDisplay}</Text>
            {locationDisplay ? (
              <Text style={styles.summaryMeta}>📍 {locationDisplay}</Text>
            ) : null}
          </View>
        </View>

        {editing ? (
          <View style={styles.formCard}>
            <Text style={styles.formLabel}>Title</Text>
            <TextInput
              style={styles.textInput}
              value={pendingSummary}
              onChangeText={setPendingSummary}
              placeholder="Appointment title"
              placeholderTextColor={palette.textMuted}
            />

            <Text style={styles.formLabel}>Location</Text>
            <TextInput
              style={styles.textInput}
              value={pendingLocation}
              onChangeText={setPendingLocation}
              placeholder="Location (optional)"
              placeholderTextColor={palette.textMuted}
            />

            <Text style={styles.formLabel}>Start date</Text>
            <TouchableOpacity
              style={styles.selectorRow}
              onPress={() => {
                setShowDatePicker(true);
                setShowTimePicker(false);
              }}
            >
              <Text style={styles.selectorValue}>{formatDisplayDate(pendingStart)}</Text>
              <Text style={styles.selectorHint}>Change</Text>
            </TouchableOpacity>

            <Text style={styles.formLabel}>Start time</Text>
            <TouchableOpacity
              style={styles.selectorRow}
              onPress={() => {
                setShowTimePicker(true);
                setShowDatePicker(false);
              }}
            >
              <Text style={styles.selectorValue}>{formatDisplayTime(pendingStart)}</Text>
              <Text style={styles.selectorHint}>Change</Text>
            </TouchableOpacity>

            <Text style={styles.formLabel}>Prep notes</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={pendingNote}
              onChangeText={setPendingNote}
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

            {(showDatePicker || showTimePicker) && (
              <DateTimePicker
                value={pendingStart}
                mode={showDatePicker ? 'date' : 'time'}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(event, selectedDate) => {
                  if (Platform.OS !== 'ios') {
                    setShowDatePicker(false);
                    setShowTimePicker(false);
                  }
                  if (selectedDate) {
                    const next = new Date(pendingStart);
                    if (showDatePicker) {
                      next.setFullYear(
                        selectedDate.getFullYear(),
                        selectedDate.getMonth(),
                        selectedDate.getDate()
                      );
                    } else {
                      next.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
                    }
                    setPendingStart(next);
                  }
                }}
                onTouchCancel={() => {
                  setShowDatePicker(false);
                  setShowTimePicker(false);
                }}
              />
            )}
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
                setPendingStart(new Date(startDateTime));
                setShowDatePicker(false);
                setShowTimePicker(false);
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
  textInput: {
    backgroundColor: palette.surfaceMuted,
    borderRadius: radius.sm,
    paddingVertical: spacing(1.25),
    paddingHorizontal: spacing(2),
    borderWidth: 1,
    borderColor: '#dbe7d7',
    fontSize: 16,
    color: palette.textPrimary,
    marginBottom: spacing(2),
  },
  textArea: {
    textAlignVertical: 'top',
  },
  selectorRow: {
    backgroundColor: palette.surfaceMuted,
    borderRadius: radius.sm,
    paddingVertical: spacing(1.25),
    paddingHorizontal: spacing(2),
    borderWidth: 1,
    borderColor: '#dbe7d7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing(2),
  },
  selectorValue: {
    fontSize: 16,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  selectorHint: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.primary,
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
