/**
 * Bill Detail Screen
 * Redesigned bill overview with actionable controls
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import apiClient from '../api/client';
import { API_ENDPOINTS } from '../config';
import { useTheme, spacing, radius, type Palette } from '../theme';
import { emitPlanChanged } from '../utils/planEvents';
import { useAuth } from '../auth/AuthContext';
import { fetchCollaborators, type CollaboratorResponse } from '../api/collaborators';

type Props = NativeStackScreenProps<RootStackParamList, 'BillDetail'>;

export default function BillDetailScreen({ route, navigation }: Props) {
  const { bill } = route.params;
  const auth = useAuth();
  const [currentBill, setCurrentBill] = useState(bill);
  const [updating, setUpdating] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { palette, shadow } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [collaborators, setCollaborators] = useState<CollaboratorResponse[]>([]);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(true);
  const [assignmentModalVisible, setAssignmentModalVisible] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState(false);

  useEffect(() => {
    return () => {
      if (returnTimerRef.current) {
        clearTimeout(returnTimerRef.current);
      }
    };
  }, []);

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

  const scheduleReturnToPlan = (message: string) => {
    setSuccessMessage(message);
    if (returnTimerRef.current) {
      clearTimeout(returnTimerRef.current);
    }
    returnTimerRef.current = setTimeout(() => {
      navigation.goBack();
    }, 1000);
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'Not available';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined) return 'Unknown amount';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

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
    if (!currentBill.assignedCollaboratorId) return null;
    const match = acceptedCollaborators.find(
      (collab) => collab.id === currentBill.assignedCollaboratorId
    );
    return match?.email ?? null;
  }, [acceptedCollaborators, currentBill.assignedCollaboratorId]);

  const handleMarkPaid = async () => {
    if (successMessage) {
      return;
    }
    setUpdating(true);
    try {
      const response = await apiClient.post(API_ENDPOINTS.markBillPaid(currentBill.id));
      setCurrentBill(response.data);
      emitPlanChanged();
      scheduleReturnToPlan('Bill marked as paid. Returning to plan...');
    } catch (error) {
      Alert.alert('Error', 'Failed to mark bill as paid');
      console.error('Mark bill paid error:', error);
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = () => {
    if (successMessage) {
      return;
    }
    Alert.alert('Delete Bill', 'Are you sure you want to delete this bill?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.delete(API_ENDPOINTS.deleteBill(currentBill.id));
            emitPlanChanged();
            scheduleReturnToPlan('Bill deleted. Returning to plan...');
          } catch (error) {
            Alert.alert('Error', 'Failed to delete bill');
          }
        },
      },
    ]);
  };

  const handleOpenPayLink = () => {
    if (currentBill.payUrl && currentBill.payUrl.startsWith('https://')) {
      Linking.openURL(currentBill.payUrl).catch(() => {
        Alert.alert('Error', 'Unable to open the payment website.');
      });
    } else {
      Alert.alert('Unavailable', 'This bill does not include an online payment link.');
    }
  };

  const handleAssignCollaborator = async (targetId: number | null) => {
    if (assignmentSaving) return;
    setAssignmentSaving(true);
    try {
      const response = await apiClient.patch(API_ENDPOINTS.updateBill(currentBill.id), {
        assignedCollaboratorId: targetId,
      });
      setCurrentBill(response.data);
      setAssignmentModalVisible(false);
      emitPlanChanged();
    } catch (error) {
      Alert.alert('Error', 'Failed to update assignment');
      console.error('Assign collaborator error:', error);
    } finally {
      setAssignmentSaving(false);
    }
  };

  const isPaid = currentBill.status === 'paid';
  const isOverdue = currentBill.status === 'overdue';

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        bounces={false}
      >
        {successMessage ? (
          <View style={styles.successBanner}>
            <Text style={styles.successText}>{successMessage}</Text>
          </View>
        ) : null}
        <View style={[styles.summaryCard, shadow.card]}>
          <View
            style={[
              styles.summaryAccent,
              { backgroundColor: isPaid ? palette.success : isOverdue ? palette.danger : palette.warning },
            ]}
          />
          <View style={styles.summaryBody}>
            <Text style={styles.summaryLabel}>Amount due</Text>
            <Text style={styles.summaryAmount}>{formatCurrency(currentBill.amount ?? null)}</Text>
            <Text style={styles.summaryStatus}>
              Status:{' '}
              <Text
                style={[
                  styles.statusValue,
                  isPaid && styles.statusValuePaid,
                  isOverdue && styles.statusValueOverdue,
                ]}
              >
                {currentBill.status}
              </Text>
            </Text>
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
                  {currentBill.assignedCollaboratorId ? 'Change assignment' : 'Assign collaborator'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={styles.infoGrid}>
          <View style={[styles.infoItem, shadow.card]}>
            <Text style={styles.infoLabel}>Due date</Text>
            <Text style={styles.infoValue}>{formatDate(currentBill.dueDate)}</Text>
          </View>
          <View style={[styles.infoItem, shadow.card]}>
            <Text style={styles.infoLabel}>Statement</Text>
            <Text style={styles.infoValue}>{formatDate(currentBill.statementDate)}</Text>
          </View>
        </View>

        <View style={[styles.actionsCard, shadow.card]}>
          {currentBill.payUrl && (
            <TouchableOpacity style={styles.primaryButton} onPress={handleOpenPayLink}>
              <Text style={styles.primaryButtonText}>Pay online</Text>
            </TouchableOpacity>
          )}

          {!isPaid && (
            <TouchableOpacity
              style={[styles.secondaryButton, updating && styles.secondaryButtonDisabled]}
              onPress={handleMarkPaid}
              disabled={updating}
            >
              <Text style={styles.secondaryButtonText}>
                {updating ? 'Updating…' : 'Mark as paid'}
              </Text>
            </TouchableOpacity>
          )}
          {isOwner ? (
            <TouchableOpacity style={styles.dangerButton} onPress={handleDelete}>
              <Text style={styles.dangerButtonText}>Delete bill</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={[styles.noteCard, shadow.card]}>
          <Text style={styles.noteTitle}>Need help?</Text>
          <Text style={styles.noteBody}>
            Upload billing statements from the camera tab or forward billing emails to keep this
            list current. Paid bills stay archived for quick reference.
          </Text>
        </View>
      </ScrollView>
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
                  currentBill.assignedCollaboratorId === null && styles.modalOptionSelected,
                ]}
                onPress={() => handleAssignCollaborator(null)}
                disabled={assignmentSaving}
              >
                <Text style={styles.modalOptionText}>
                  {assignmentSaving && currentBill.assignedCollaboratorId === null
                    ? 'Assigning…'
                    : 'Unassigned'}
                </Text>
              </TouchableOpacity>
              {acceptedCollaborators.length === 0 ? (
                <Text style={styles.modalEmpty}>Invite a collaborator to assign this bill.</Text>
              ) : (
                acceptedCollaborators.map((collaborator) => {
                  const isSelected = collaborator.id === currentBill.assignedCollaboratorId;
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
    </SafeAreaView>
  );
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
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
    summaryAmount: {
      fontSize: 32,
      fontWeight: '700',
      color: palette.textPrimary,
      marginTop: spacing(0.5),
    },
    summaryStatus: {
      marginTop: spacing(1),
      fontSize: 14,
      color: palette.textSecondary,
    },
    summaryMeta: {
      marginTop: spacing(0.5),
      fontSize: 13,
      color: palette.textSecondary,
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
    statusValue: {
      fontWeight: '700',
      color: palette.warning,
      textTransform: 'uppercase',
    },
    statusValuePaid: {
      color: palette.success,
    },
    statusValueOverdue: {
      color: palette.danger,
    },
    infoGrid: {
      flexDirection: 'row',
      gap: spacing(2),
      marginBottom: spacing(3),
    },
    infoItem: {
      flex: 1,
      backgroundColor: palette.surface,
      borderRadius: radius.md,
      padding: spacing(2),
    },
    infoLabel: {
      fontSize: 12,
      textTransform: 'uppercase',
      fontWeight: '600',
      color: palette.textMuted,
      marginBottom: spacing(0.5),
    },
    infoValue: {
      fontSize: 16,
      color: palette.textPrimary,
    },
    actionsCard: {
      backgroundColor: palette.surface,
      borderRadius: radius.md,
      padding: spacing(3),
      marginBottom: spacing(3),
    },
    primaryButton: {
      backgroundColor: palette.primary,
      borderRadius: radius.sm,
      paddingVertical: spacing(1.5),
      alignItems: 'center',
    },
    primaryButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '700',
    },
    secondaryButton: {
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: palette.success,
      paddingVertical: spacing(1.5),
      alignItems: 'center',
      marginTop: spacing(2),
    },
    secondaryButtonDisabled: {
      opacity: 0.6,
    },
    secondaryButtonText: {
      color: palette.success,
      fontSize: 15,
      fontWeight: '600',
    },
    dangerButton: {
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: palette.danger,
      paddingVertical: spacing(1.5),
      alignItems: 'center',
      marginTop: spacing(2),
    },
    dangerButtonText: {
      color: palette.danger,
      fontSize: 15,
      fontWeight: '600',
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
    noteCard: {
      backgroundColor: palette.surface,
      borderRadius: radius.md,
      padding: spacing(3),
      marginBottom: spacing(6),
    },
    noteTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.textPrimary,
      marginBottom: spacing(1),
    },
    noteBody: {
      fontSize: 14,
      color: palette.textSecondary,
      lineHeight: 20,
    },
  });
