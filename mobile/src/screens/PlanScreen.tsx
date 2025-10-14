/**
 * Plan Screen
 * Simple weekly overview of appointments and bills
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import type { Appointment, Bill } from '@carebase/shared';
import apiClient from '../api/client';
import { API_ENDPOINTS } from '../config';
import { palette, spacing, radius, shadow } from '../theme';

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
  const [error, setError] = useState<string | null>(null);

  const fetchPlan = async () => {
    try {
      const response = await apiClient.get(API_ENDPOINTS.getPlan);
      setPlanData(response.data);
      setError(null);
    } catch (err) {
      setError('We couldn’t refresh your plan. Pull to try again.');
      console.error('Failed to fetch plan:', err);
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

const parseServerDate = (value: string) => new Date(value);

const formatDate = (dateString: string) => {
  const date = parseServerDate(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const formatTime = (dateString: string) => {
  const date = parseServerDate(dateString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  const appointmentCount = planData?.appointments.length ?? 0;
  const billsDue = planData?.bills.filter((bill) => bill.status !== 'paid').length ?? 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={palette.primary} />
          <Text style={styles.loadingText}>Loading your plan…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>This week</Text>
            <Text style={styles.headerSubtitle}>
              {planData?.dateRange
                ? `${formatDate(planData.dateRange.start)} – ${formatDate(planData.dateRange.end)}`
                : 'Connect your inbox to build a plan.'}
            </Text>
            <Text style={styles.headerMeta}>
              {appointmentCount} appointments • {billsDue} bills due
            </Text>
          </View>
          <View style={styles.headerButtons}>
            <TouchableOpacity
              style={styles.outlineButton}
              onPress={() => navigation.navigate('Camera')}
            >
              <Text style={styles.outlineButtonText}>Scan bill</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.outlineButton}
              onPress={() => navigation.navigate('Settings')}
            >
              <Text style={styles.outlineButtonText}>Settings</Text>
            </TouchableOpacity>
          </View>
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Upcoming visits</Text>
            {appointmentCount > 0 && <Text style={styles.sectionCount}>{appointmentCount}</Text>}
          </View>
          {appointmentCount === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No appointments</Text>
              <Text style={styles.emptyText}>
                Forward confirmation emails and we’ll add them to this list.
              </Text>
            </View>
          ) : (
            planData?.appointments.map((appt) => (
              <TouchableOpacity
                key={appt.id}
                style={[styles.itemCard, shadow.card]}
                onPress={() => navigation.navigate('AppointmentDetail', { appointment: appt })}
              >
                <Text style={styles.itemTitle}>{appt.summary}</Text>
                <Text style={styles.itemMeta}>
                  {formatDate(appt.startLocal)} at {formatTime(appt.startLocal)}
                </Text>
                {appt.location ? <Text style={styles.itemSub}>{appt.location}</Text> : null}
                {appt.prepNote ? (
                  <Text style={styles.itemNote}>{appt.prepNote}</Text>
                ) : null}
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Bills to handle</Text>
            {planData && planData.bills.length > 0 && (
              <Text style={styles.sectionCount}>{planData.bills.length}</Text>
            )}
          </View>
          {planData?.bills.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No bills due</Text>
              <Text style={styles.emptyText}>
                Upload a statement or forward billing emails to track them here.
              </Text>
            </View>
          ) : (
            planData?.bills.map((bill) => {
              const isPaid = bill.status === 'paid';
              const isOverdue = bill.status === 'overdue';
              return (
                <TouchableOpacity
                  key={bill.id}
                  style={[styles.itemCard, shadow.card]}
                  onPress={() => navigation.navigate('BillDetail', { bill })}
                >
                  <Text style={styles.itemTitle}>
                    {bill.amount ? formatCurrency(bill.amount) : 'Amount unknown'}
                  </Text>
                  <Text style={styles.itemMeta}>
                    {bill.dueDate ? `Due ${formatDate(bill.dueDate)}` : 'No due date'}
                  </Text>
                  <Text
                    style={[
                      styles.statusPill,
                      isPaid && styles.statusPillSuccess,
                      isOverdue && styles.statusPillOverdue,
                    ]}
                  >
                    {bill.status}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.background,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing(4),
  },
  loadingState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing(2),
    color: palette.textSecondary,
  },
  header: {
    paddingHorizontal: spacing(3),
    paddingTop: spacing(3),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing(2),
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  headerSubtitle: {
    fontSize: 14,
    color: palette.textSecondary,
    marginTop: spacing(0.5),
  },
  headerMeta: {
    fontSize: 13,
    color: palette.textMuted,
    marginTop: spacing(0.5),
  },
  headerButtons: {
    flexDirection: 'row',
    gap: spacing(1),
  },
  outlineButton: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.primary,
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(2),
  },
  outlineButtonText: {
    color: palette.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  errorBanner: {
    marginTop: spacing(2),
    marginHorizontal: spacing(3),
    backgroundColor: '#fee2e2',
    borderRadius: radius.sm,
    padding: spacing(1.5),
  },
  errorText: {
    color: palette.danger,
    textAlign: 'center',
    fontSize: 13,
  },
  section: {
    marginTop: spacing(3),
    paddingHorizontal: spacing(3),
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing(1.5),
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  sectionCount: {
    fontSize: 13,
    color: palette.textMuted,
  },
  itemCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(2),
    marginBottom: spacing(1.5),
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  itemMeta: {
    marginTop: spacing(0.5),
    fontSize: 13,
    color: palette.textSecondary,
  },
  itemSub: {
    marginTop: spacing(0.5),
    fontSize: 13,
    color: palette.textMuted,
  },
  itemNote: {
    marginTop: spacing(1),
    fontSize: 12,
    color: palette.primary,
  },
  emptyCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    padding: spacing(3),
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: palette.textPrimary,
    marginBottom: spacing(1),
  },
  emptyText: {
    fontSize: 14,
    color: palette.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  statusPill: {
    marginTop: spacing(1),
    alignSelf: 'flex-start',
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.5),
    borderRadius: radius.xs,
    fontSize: 12,
    fontWeight: '600',
    color: palette.warning,
    backgroundColor: '#fdecc8',
    textTransform: 'uppercase',
  },
  statusPillSuccess: {
    color: palette.success,
    backgroundColor: palette.primarySoft,
  },
  statusPillOverdue: {
    color: '#ffffff',
    backgroundColor: palette.danger,
  },
});
