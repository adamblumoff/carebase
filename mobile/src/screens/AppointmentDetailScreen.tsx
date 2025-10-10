/**
 * Appointment Detail Screen
 * View and edit appointment details
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import apiClient from '../api/client';
import { API_ENDPOINTS } from '../config';

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
      setEditing(false);
      Alert.alert('Success', 'Appointment updated successfully');
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
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        {editing ? (
          <>
            <Text style={styles.label}>Summary</Text>
            <TextInput
              style={styles.input}
              value={summary}
              onChangeText={setSummary}
              placeholder="Appointment title"
            />

            <Text style={styles.label}>Location</Text>
            <TextInput
              style={styles.input}
              value={location}
              onChangeText={setLocation}
              placeholder="Location (optional)"
            />

            <Text style={styles.label}>Prep Note</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={prepNote}
              onChangeText={setPrepNote}
              placeholder="Preparation notes (optional)"
              multiline
              numberOfLines={3}
            />

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.buttonSecondary]}
                onPress={() => setEditing(false)}
              >
                <Text style={styles.buttonSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.buttonPrimary]}
                onPress={handleSave}
                disabled={saving}
              >
                <Text style={styles.buttonPrimaryText}>
                  {saving ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.title}>{appointment.summary}</Text>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>When</Text>
              <Text style={styles.infoValue}>
                {formatDateTime(appointment.startLocal)}
              </Text>
            </View>

            {appointment.location && (
              <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>Where</Text>
                <Text style={styles.infoValue}>{appointment.location}</Text>
              </View>
            )}

            {appointment.prepNote && (
              <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>Preparation</Text>
                <Text style={styles.infoValue}>{appointment.prepNote}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.button, styles.buttonPrimary]}
              onPress={() => setEditing(true)}
            >
              <Text style={styles.buttonPrimaryText}>Edit</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.buttonDanger]}
              onPress={handleDelete}
            >
              <Text style={styles.buttonDangerText}>Delete</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 20,
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: '#1e293b',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  button: {
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonPrimary: {
    backgroundColor: '#2563eb',
    flex: 1,
  },
  buttonSecondary: {
    backgroundColor: '#e2e8f0',
    flex: 1,
  },
  buttonDanger: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  buttonPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonSecondaryText: {
    color: '#1e293b',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDangerText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '600',
  },
});
