/**
 * Bill Detail Screen
 * Redesigned bill overview with actionable controls
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
  Linking,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import apiClient from '../api/client';
import { API_ENDPOINTS } from '../config';
import { palette, spacing, radius, shadow } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'BillDetail'>;

export default function BillDetailScreen({ route, navigation }: Props) {
  const { bill } = route.params;
  const [currentBill, setCurrentBill] = useState(bill);
  const [updating, setUpdating] = useState(false);

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

  const handleMarkPaid = async () => {
    setUpdating(true);
    try {
      const response = await apiClient.post(API_ENDPOINTS.markBillPaid(currentBill.id));
      setCurrentBill(response.data);
      Alert.alert('Done', 'Bill marked as paid');
    } catch (error) {
      Alert.alert('Error', 'Failed to mark bill as paid');
      console.error('Mark bill paid error:', error);
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete Bill', 'Are you sure you want to delete this bill?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.delete(API_ENDPOINTS.deleteBill(currentBill.id));
            navigation.goBack();
          } catch (error) {
            Alert.alert('Error', 'Failed to delete bill');
          }
        },
      },
    ]);
  };

  const handleOpenPayLink = () => {
    if (currentBill.payUrl) {
      Linking.openURL(currentBill.payUrl);
    }
  };

  const isPaid = currentBill.status === 'paid';
  const isOverdue = currentBill.status === 'overdue';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        bounces={false}
      >
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
          </View>
        </View>

        <View style={styles.infoGrid}>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Due date</Text>
            <Text style={styles.infoValue}>{formatDate(currentBill.dueDate)}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Statement</Text>
            <Text style={styles.infoValue}>{formatDate(currentBill.statementDate)}</Text>
          </View>
        </View>

        <View style={styles.actionsCard}>
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

          <TouchableOpacity style={styles.dangerButton} onPress={handleDelete}>
            <Text style={styles.dangerButtonText}>Delete bill</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>Need help?</Text>
          <Text style={styles.noteBody}>
            Upload billing statements from the camera tab or forward billing emails to keep this
            list current. Paid bills stay archived for quick reference.
          </Text>
        </View>
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
    ...shadow.card,
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
    ...shadow.card,
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
  noteCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    padding: spacing(3),
    ...shadow.card,
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
