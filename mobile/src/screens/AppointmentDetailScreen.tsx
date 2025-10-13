/**
 * Appointment Detail Screen
 * View and edit appointment details with refreshed UI
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

export default function AppointmentDetailScreen({ route, navigation }: Props) {
  const { appointment } = route.params;
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(appointment.summary);
  const [location, setLocation] = useState(appointment.location || '');
  const [prepNote, setPrepNote] = useState(appointment.prepNote || '');
  const [saving, setSaving] = useState(false);

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.patch(API_ENDPOINTS.updateAppointment(appointment.id), {
        summary,
        location: location || undefined,
        prepNote: prepNote || undefined,
      });
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
            <Text style={styles.summaryTitle}>{summary}</Text>
            <Text style={styles.summaryMeta}>{formatDateTime(appointment.startLocal)}</Text>
            {location ? (
              <Text style={styles.summaryMeta}>📍 {location}</Text>
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
                onPress={() => setEditing(false)}
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
                style={prepNote ? styles.detailValue : styles.detailValueMuted}
              >
                {prepNote || 'Add a reminder for this visit.'}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setEditing(true)}
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
    paddingVertical: spacing(1.5),
    paddingHorizontal: spacing(2),
    marginBottom: spacing(2),
    borderWidth: 1,
    borderColor: '#e2e8f0',
    fontSize: 16,
    color: palette.textPrimary,
  },
  textArea: {
    height: 112,
    textAlignVertical: 'top',
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
