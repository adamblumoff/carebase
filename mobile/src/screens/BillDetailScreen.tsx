/**
 * Bill Detail Screen
 * View and manage bill details
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import apiClient from '../api/client';
import { API_ENDPOINTS } from '../config';

type Props = NativeStackScreenProps<RootStackParamList, 'BillDetail'>;

export default function BillDetailScreen({ route, navigation }: Props) {
  const { bill } = route.params;
  const [currentBill, setCurrentBill] = useState(bill);
  const [loading, setLoading] = useState(false);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };

  const handleMarkPaid = async () => {
    setLoading(true);
    try {
      const response = await apiClient.post(API_ENDPOINTS.markBillPaid(currentBill.id));
      setCurrentBill(response.data);
      Alert.alert('Success', 'Bill marked as paid');
    } catch (error) {
      Alert.alert('Error', 'Failed to mark bill as paid');
      console.error('Mark bill paid error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePayOnline = () => {
    if (currentBill.payUrl) {
      Linking.openURL(currentBill.payUrl);
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

  const isPaid = currentBill.status === 'paid';

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>Amount Due</Text>
          <Text style={styles.amount}>
            {currentBill.amount ? formatCurrency(currentBill.amount) : 'Unknown'}
          </Text>
          {currentBill.status && (
            <Text
              style={[
                styles.status,
                isPaid && styles.statusPaid,
                currentBill.status === 'ignore' && styles.statusIgnored,
              ]}
            >
              {currentBill.status.toUpperCase()}
            </Text>
          )}
        </View>

        {currentBill.dueDate && (
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Due Date</Text>
            <Text style={styles.infoValue}>
              {formatDate(currentBill.dueDate)}
            </Text>
          </View>
        )}

        {currentBill.statementDate && (
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Statement Date</Text>
            <Text style={styles.infoValue}>
              {formatDate(currentBill.statementDate)}
            </Text>
          </View>
        )}

        {currentBill.payUrl && (
          <TouchableOpacity
            style={[styles.button, styles.buttonPrimary]}
            onPress={handlePayOnline}
          >
            <Text style={styles.buttonPrimaryText}>💳 Pay Online</Text>
          </TouchableOpacity>
        )}

        {!isPaid && (
          <TouchableOpacity
            style={[styles.button, styles.buttonSuccess]}
            onPress={handleMarkPaid}
            disabled={loading}
          >
            <Text style={styles.buttonSuccessText}>
              {loading ? 'Updating...' : '✓ Mark as Paid'}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.button, styles.buttonDanger]}
          onPress={handleDelete}
        >
          <Text style={styles.buttonDangerText}>Delete</Text>
        </TouchableOpacity>
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
  amountCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  amountLabel: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 8,
  },
  amount: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 8,
  },
  status: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f59e0b',
    textTransform: 'uppercase',
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#fef3c7',
    borderRadius: 12,
  },
  statusPaid: {
    color: '#10b981',
    backgroundColor: '#d1fae5',
  },
  statusIgnored: {
    color: '#94a3b8',
    backgroundColor: '#f1f5f9',
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
  button: {
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonPrimary: {
    backgroundColor: '#2563eb',
  },
  buttonSuccess: {
    backgroundColor: '#10b981',
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
  buttonSuccessText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDangerText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '600',
  },
});
