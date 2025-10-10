/**
 * Plan Screen
 * Shows upcoming appointments (Show Up) and bills (Pay)
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import type { Appointment, Bill } from '@carebase/shared';
import apiClient from '../api/client';
import { API_ENDPOINTS } from '../config';

type Props = NativeStackScreenProps<RootStackParamList, 'Plan'>;

interface PlanData {
  appointments: Appointment[];
  bills: Bill[];
  dateRange: {
    start: string;
    end: string;
  };
}

export default function PlanScreen({ navigation }: Props) {
  const [planData, setPlanData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPlan = async () => {
    try {
      const response = await apiClient.get(API_ENDPOINTS.getPlan);
      setPlanData(response.data);
    } catch (error) {
      console.error('Failed to fetch plan:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPlan();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPlan();
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Loading your plan...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Your Week</Text>
        <Text style={styles.headerSubtitle}>
          {planData?.dateRange && `${formatDate(planData.dateRange.start)} - ${formatDate(planData.dateRange.end)}`}
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => navigation.navigate('Camera')}
          >
            <Text style={styles.headerButtonText}>📸 Scan Bill</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={styles.headerButtonText}>⚙️ Settings</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Show Up Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📍 Show Up</Text>
        {planData?.appointments.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No upcoming appointments</Text>
          </View>
        ) : (
          planData?.appointments.map((appt) => (
            <TouchableOpacity
              key={appt.id}
              style={styles.card}
              onPress={() => navigation.navigate('AppointmentDetail', { appointment: appt })}
            >
              <Text style={styles.cardTitle}>{appt.summary}</Text>
              <Text style={styles.cardDetail}>
                {formatDate(appt.startLocal)} at {formatTime(appt.startLocal)}
              </Text>
              {appt.location && (
                <Text style={styles.cardDetail}>📍 {appt.location}</Text>
              )}
              {appt.prepNote && (
                <Text style={styles.prepNote}>💡 {appt.prepNote}</Text>
              )}
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* Pay Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>💳 Pay</Text>
        {planData?.bills.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No upcoming bills</Text>
          </View>
        ) : (
          planData?.bills.map((bill) => (
            <TouchableOpacity
              key={bill.id}
              style={[
                styles.card,
                bill.status === 'paid' && styles.cardPaid,
              ]}
              onPress={() => navigation.navigate('BillDetail', { bill })}
            >
              <View style={styles.billHeader}>
                <Text style={styles.cardTitle}>
                  {bill.amount ? formatCurrency(bill.amount) : 'Amount unknown'}
                </Text>
                <Text style={[
                  styles.status,
                  bill.status === 'paid' && styles.statusPaid,
                  bill.status === 'ignore' && styles.statusIgnored,
                ]}>
                  {bill.status}
                </Text>
              </View>
              {bill.dueDate && (
                <Text style={styles.cardDetail}>
                  Due: {formatDate(bill.dueDate)}
                </Text>
              )}
            </TouchableOpacity>
          ))
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#64748b',
  },
  header: {
    backgroundColor: '#2563eb',
    padding: 20,
    paddingTop: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#dbeafe',
    marginTop: 4,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  headerButton: {
    backgroundColor: '#3b82f6',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  headerButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardPaid: {
    opacity: 0.6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 4,
  },
  cardDetail: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
  },
  prepNote: {
    fontSize: 13,
    color: '#2563eb',
    marginTop: 8,
    fontStyle: 'italic',
  },
  billHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  status: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f59e0b',
    textTransform: 'uppercase',
  },
  statusPaid: {
    color: '#10b981',
  },
  statusIgnored: {
    color: '#94a3b8',
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#94a3b8',
  },
});
