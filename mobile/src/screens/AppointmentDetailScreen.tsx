/**
 * Appointment Detail Screen
 * Update appointment details, including date and time
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import apiClient from '../api/client';
import { API_ENDPOINTS } from '../config';
import { useTheme, spacing, radius, type Palette } from '../theme';
import { emitPlanChanged } from '../utils/planEvents';
import { KeyboardScreen } from '../components/KeyboardScreen';
import DateTimePickerModal from '../components/DateTimePickerModal';
import { useAuth } from '../auth/AuthContext';
import { fetchCollaborators, type CollaboratorResponse } from '../api/collaborators';
import { formatDisplayDate, formatDisplayTime, formatForPayload, parseServerDate } from '../utils/date';

type Props = NativeStackScreenProps<RootStackParamList, 'AppointmentDetail'>;

const formatDisplayDateTime = (date: Date) =>
  date.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export default function AppointmentDetailScreen({ route, navigation }: Props) {
  const { appointment } = route.params;
  const { palette, shadow } = useTheme();
  const auth = useAuth();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [currentAppointment, setCurrentAppointment] = useState(appointment);
  const [startDateTime, setStartDateTime] = useState(parseServerDate(appointment.startLocal));
  const [pendingStart, setPendingStart] = useState(parseServerDate(appointment.startLocal));
  const [pendingSummary, setPendingSummary] = useState(appointment.summary);
const [pendingLocation, setPendingLocation] = useState(appointment.location || '');
const [pendingNote, setPendingNote] = useState(appointment.prepNote || '');
const [editing, setEditing] = useState(false);
  const [isPickerVisible, setPickerVisible] = useState(false);
  const [activePickerMode, setActivePickerMode] = useState<'date' | 'time'>('date');
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [collaborators, setCollaborators] = useState<CollaboratorResponse[]>([]);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(true);
  const [assignmentModalVisible, setAssignmentModalVisible] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState(false);

  const initialDuration =
    parseServerDate(appointment.endLocal).getTime() -
    parseServerDate(appointment.startLocal).getTime();
const durationMs = initialDuration > 0 ? initialDuration : 60 * 60 * 1000;

const acceptedCollaborators = useMemo(
  () => collaborators.filter((collab) => collab.status === 'accepted'),
  [collaborators]
);
const currentCollaborator = useMemo(
  () => acceptedCollaborators.find((collab) => collab.userId === auth.user?.id),
  [acceptedCollaborators, auth.user?.id]
);
const isOwner = currentCollaborator?.role === 'owner';
const isContributor = currentCollaborator?.role === 'contributor';

const assignedCollaboratorEmail = useMemo(() => {
  if (!currentAppointment.assignedCollaboratorId) return null;
  const match = acceptedCollaborators.find(
    (collab) => collab.id === currentAppointment.assignedCollaboratorId
  );
  return match?.email ?? null;
}, [acceptedCollaborators, currentAppointment.assignedCollaboratorId]);

useEffect(() => {
  let active = true;
  const load = async () => {
    try {
      const data = await fetchCollaborators();
      if (!active) return;
      setCollaborators(data);
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('Failed to load collaborators', error);
      }
    } finally {
      if (active) {
        setCollaboratorsLoading(false);
      }
    }
  };

  load();
  return () => {
    active = false;
  };
}, []);

useEffect(() => {
  return () => {
    if (returnTimerRef.current) {
      clearTimeout(returnTimerRef.current);
    }
  };
}, []);

const scheduleReturnToPlan = (message: string) => {
  setSuccessMessage(message);
  if (returnTimerRef.current) {
    clearTimeout(returnTimerRef.current);
  }
  returnTimerRef.current = setTimeout(() => {
    navigation.goBack();
  }, 1000);
};

const updateDatePart = (source: Date, mode: 'date' | 'time', nextValue: Date) => {
  const updated = new Date(source);
  if (mode === 'date') {
    updated.setFullYear(nextValue.getFullYear(), nextValue.getMonth(), nextValue.getDate());
  } else {
    updated.setHours(nextValue.getHours(), nextValue.getMinutes(), 0, 0);
  }
  return updated;
};

const openPicker = (mode: 'date' | 'time') => {
  setActivePickerMode(mode);
  setPickerVisible(true);
};

const closePicker = () => {
  setPickerVisible(false);
};

  const handleSave = async () => {
    if (successMessage) {
      return;
    }
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
      emitPlanChanged();
      closePicker();
      setEditing(false);
      scheduleReturnToPlan('Appointment updated. Returning to plan...');
    } catch (error) {
      Alert.alert('Error', 'Failed to update appointment');
      console.error('Update appointment error:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (successMessage) {
      return;
    }
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
              emitPlanChanged();
              scheduleReturnToPlan('Appointment deleted. Returning to plan...');
            } catch (error) {
              Alert.alert('Error', 'Failed to delete appointment');
            }
          },
        },
      ]
    );
  };

  const handleAssignCollaborator = async (targetId: number | null) => {
    if (assignmentSaving) return;
    setAssignmentSaving(true);
    try {
      const response = await apiClient.patch(API_ENDPOINTS.updateAppointment(appointment.id), {
        assignedCollaboratorId: targetId,
      });
      const updated = response.data;
      setCurrentAppointment(updated);
      setAssignmentModalVisible(false);
      emitPlanChanged();
    } catch (error) {
      Alert.alert('Error', 'Failed to update assignment');
      console.error('Assign collaborator error:', error);
    } finally {
      setAssignmentSaving(false);
    }
  };

  const handleMarkHandled = async () => {
    if (successMessage) {
      return;
    }
    const now = new Date();
    const note = `Handled by ${auth.user?.email ?? 'care teammate'} on ${now.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`;
    setSaving(true);
    try {
      const response = await apiClient.patch(API_ENDPOINTS.updateAppointment(appointment.id), {
        prepNote: note,
      });
      const updated = response.data;
      setCurrentAppointment(updated);
      setPendingNote(updated.prepNote || '');
      emitPlanChanged();
      scheduleReturnToPlan('Visit marked as handled. Returning to plan...');
    } catch (error) {
      Alert.alert('Error', 'Failed to update visit');
      console.error('Mark handled error:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setPendingStart(new Date(startDateTime));
    setPendingSummary(currentAppointment.summary);
    setPendingLocation(currentAppointment.location || '');
    setPendingNote(currentAppointment.prepNote || '');
    setEditing(false);
    setPickerVisible(false);
  };

  const startDisplay = formatDisplayDateTime(startDateTime);
  const locationDisplay = currentAppointment.location;

  return (
    <KeyboardScreen
      containerStyle={styles.safe}
      contentContainerStyle={styles.content}
    >
        <DateTimePickerModal
          visible={isPickerVisible}
          mode={activePickerMode}
          value={pendingStart}
          onDismiss={closePicker}
          onConfirm={(selectedDate) => {
            setPendingStart((prev) => updateDatePart(prev, activePickerMode, selectedDate));
          }}
        />
        {successMessage ? (
          <View style={styles.successBanner}>
            <Text style={styles.successText}>{successMessage}</Text>
          </View>
        ) : null}
        <View style={[styles.summaryCard, shadow.card]}>
          <View style={styles.summaryAccent} />
          <View style={styles.summaryBody}>
            <Text style={styles.summaryLabel}>Upcoming visit</Text>
            <Text style={styles.summaryTitle}>{currentAppointment.summary}</Text>
            <Text style={styles.summaryMeta}>{startDisplay}</Text>
            {locationDisplay ? (
              <Text style={styles.summaryMeta}>📍 {locationDisplay}</Text>
            ) : null}
            {assignedCollaboratorEmail ? (
              <Text style={styles.summaryMeta}>Assigned to {assignedCollaboratorEmail}</Text>
            ) : isOwner && !collaboratorsLoading ? (
              <Text style={styles.summaryMeta}>Unassigned</Text>
            ) : null}
            {isOwner && acceptedCollaborators.length > 0 ? (
              <TouchableOpacity
                style={styles.assignLink}
                onPress={() => setAssignmentModalVisible(true)}
              >
                <Text style={styles.assignLinkText}>
                  {currentAppointment.assignedCollaboratorId ? 'Change assignment' : 'Assign collaborator'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {editing ? (
        <View style={[styles.formCard, shadow.card]}>
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
              onPress={() => openPicker('date')}
            >
              <Text style={styles.selectorValue}>{formatDisplayDate(pendingStart)}</Text>
              <Text style={styles.selectorHint}>Change</Text>
            </TouchableOpacity>

            <Text style={styles.formLabel}>Start time</Text>
            <TouchableOpacity
              style={styles.selectorRow}
              onPress={() => openPicker('time')}
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
                style={[styles.actionButton, styles.secondaryButton, styles.buttonFlex]}
                onPress={handleCancelEdit}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.primaryButton, styles.buttonFlex]}
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
          <View style={[styles.detailsCard, shadow.card]}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Prep note</Text>
              <Text
                style={currentAppointment.prepNote ? styles.detailValue : styles.detailValueMuted}
              >
                {currentAppointment.prepNote || 'Add a reminder for this visit.'}
              </Text>
            </View>

            {isOwner ? (
              <TouchableOpacity
                style={[styles.actionButton, styles.primaryButton]}
                onPress={() => {
                  setPendingStart(new Date(startDateTime));
                  setPickerVisible(false);
                  setEditing(true);
                }}
              >
                <Text style={styles.primaryButtonText}>Edit visit details</Text>
              </TouchableOpacity>
            ) : null}
            {isContributor ? (
              <TouchableOpacity
                style={[styles.actionButton, styles.primaryButton]}
                onPress={handleMarkHandled}
                disabled={saving}
              >
                <Text style={styles.primaryButtonText}>
                  {saving ? 'Updating…' : 'Mark visit handled'}
                </Text>
              </TouchableOpacity>
            ) : null}
            {isOwner ? (
              <TouchableOpacity style={styles.dangerButton} onPress={handleDelete}>
                <Text style={styles.dangerButtonText}>Delete appointment</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
        {isOwner && (
          <Modal
            visible={assignmentModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => {
              if (!assignmentSaving) setAssignmentModalVisible(false);
            }}
          >
            <View style={styles.modalBackdrop}>
              <View style={[styles.modalCard, shadow.card]}>
                <Text style={styles.modalTitle}>Assign to…</Text>
                <TouchableOpacity
                  style={[
                    styles.modalOption,
                    currentAppointment.assignedCollaboratorId === null && styles.modalOptionSelected,
                  ]}
                  onPress={() => handleAssignCollaborator(null)}
                  disabled={assignmentSaving}
                >
                  <Text style={styles.modalOptionText}>
                    {assignmentSaving && currentAppointment.assignedCollaboratorId === null
                      ? 'Assigning…'
                      : 'Unassigned'}
                  </Text>
                </TouchableOpacity>
                {acceptedCollaborators.length === 0 ? (
                  <Text style={styles.modalEmpty}>Invite a collaborator to assign this visit.</Text>
                ) : (
                  acceptedCollaborators.map((collaborator) => {
                    const isSelected = collaborator.id === currentAppointment.assignedCollaboratorId;
                    return (
                      <TouchableOpacity
                        key={collaborator.id}
                        style={[
                          styles.modalOption,
                          isSelected && styles.modalOptionSelected,
                        ]}
                        onPress={() => handleAssignCollaborator(collaborator.id)}
                        disabled={assignmentSaving}
                      >
                        <Text style={styles.modalOptionText}>
                          {assignmentSaving && isSelected ? 'Assigning…' : collaborator.email}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                )}
                <TouchableOpacity
                  style={styles.modalCancel}
                  onPress={() => setAssignmentModalVisible(false)}
                  disabled={assignmentSaving}
                >
                  <Text style={styles.modalCancelText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}
    </KeyboardScreen>
  );
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: palette.surfaceMuted,
    },
    content: {
      padding: spacing(3),
      paddingBottom: spacing(10),
    },
    successBanner: {
      backgroundColor: palette.primarySoft,
      borderRadius: radius.sm,
      paddingVertical: spacing(1),
      paddingHorizontal: spacing(2),
      marginBottom: spacing(2),
    },
    successText: {
      color: palette.primary,
      fontWeight: '600',
      textAlign: 'center',
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
      paddingVertical: spacing(1.5),
      paddingHorizontal: spacing(2),
      borderWidth: 1,
      borderColor: palette.border,
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
      borderColor: palette.border,
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
    actionButton: {
      borderRadius: radius.sm,
      paddingVertical: spacing(1.5),
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing(3),
    },
    primaryButton: {
      backgroundColor: palette.primary,
    },
    primaryButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '700',
    },
    secondaryButton: {
      borderWidth: 1,
      borderColor: palette.border,
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
      justifyContent: 'center',
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
    assignLink: {
      marginTop: spacing(1),
      alignSelf: 'flex-start',
      paddingVertical: spacing(0.5),
      paddingHorizontal: spacing(1.25),
      backgroundColor: palette.surfaceMuted,
      borderRadius: radius.sm,
    },
    assignLinkText: {
      color: palette.primary,
      fontWeight: '600',
      fontSize: 13,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing(3),
    },
    modalCard: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: palette.canvas,
      borderRadius: radius.md,
      padding: spacing(3),
    },
    modalTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: palette.textPrimary,
      marginBottom: spacing(2),
    },
    modalOption: {
      paddingVertical: spacing(1.25),
      paddingHorizontal: spacing(1.5),
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: palette.border,
      marginBottom: spacing(1),
    },
    modalOptionSelected: {
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
    },
    modalOptionText: {
      fontSize: 15,
      color: palette.textPrimary,
      fontWeight: '600',
    },
    modalEmpty: {
      fontSize: 13,
      color: palette.textMuted,
      marginBottom: spacing(1.5),
    },
    modalCancel: {
      marginTop: spacing(1.5),
      alignSelf: 'flex-end',
    },
    modalCancelText: {
      color: palette.primary,
      fontWeight: '600',
      fontSize: 14,
    },
  });
