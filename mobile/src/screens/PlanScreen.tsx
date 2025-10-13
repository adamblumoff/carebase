/**
 * Plan Screen
 * Shows upcoming appointments (Show Up) and bills (Pay)
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import type { Appointment, Bill } from '@carebase/shared';
import apiClient from '../api/client';
import { API_ENDPOINTS } from '../config';
import { palette, spacing, shadow, radius } from '../theme';

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
    } catch (error) {
      setError('We couldn’t refresh your plan. Pull to retry.');
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

  const appointmentCount = planData?.appointments.length ?? 0;
  const billsDue = planData?.bills.filter((bill) => bill.status !== 'paid').length ?? 0;
  const billsPaid = planData?.bills.filter((bill) => bill.status === 'paid').length ?? 0;

  const nextAppointment = useMemo(() => {
    if (!planData || planData.appointments.length === 0) return null;
    return planData.appointments[0];
  }, [planData]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={palette.primary} />
          <Text style={styles.loadingText}>Loading your plan...</Text>
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
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>This Week</Text>
          <Text style={styles.heroTitle}>Stay on top of care tasks</Text>
          <Text style={styles.heroSubtitle}>
            {planData?.dateRange
              ? `${formatDate(planData.dateRange.start)} – ${formatDate(planData.dateRange.end)}`
              : 'Connect your inbox to build a plan.'}
          </Text>

          <View style={styles.heroActions}>
            <TouchableOpacity
              style={[styles.heroButton, styles.heroButtonPrimary]}
              onPress={() => navigation.navigate('Camera')}
            >
              <Text style={styles.heroButtonIcon}>📸</Text>
              <Text style={styles.heroButtonText}>Scan a bill</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.heroButton, styles.heroButtonSecondary]}
              onPress={() => navigation.navigate('Settings')}
            >
              <Text style={styles.heroButtonIcon}>⚙️</Text>
              <Text style={styles.heroButtonText}>Settings</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.metricRow}>
          <View style={[styles.metricCard, shadow.card]}>
            <Text style={styles.metricLabel}>Appointments</Text>
            <Text style={styles.metricValue}>{appointmentCount}</Text>
            <Text style={styles.metricHint}>
              {nextAppointment
                ? `Next: ${formatDate(nextAppointment.startLocal)}`
                : 'No visits scheduled'}
            </Text>
          </View>
          <View style={[styles.metricCard, shadow.card]}>
            <Text style={styles.metricLabel}>Bills</Text>
            <Text style={styles.metricValue}>{billsDue}</Text>
            <View style={styles.metricFooter}>
              <Text style={styles.metricBadge}>{billsPaid} paid</Text>
              <Text style={styles.metricBadgeWarning}>{billsDue} due</Text>
            </View>
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
            {appointmentCount > 0 && (
              <Text style={styles.sectionCount}>{appointmentCount}</Text>
            )}
          </View>
          {appointmentCount === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Add your first visit</Text>
              <Text style={styles.emptyText}>
                Forward appointment emails or upload docs to see them here.
              </Text>
            </View>
          ) : (
            planData?.appointments.map((appt) => (
              <TouchableOpacity
                key={appt.id}
                style={[styles.itemCard, shadow.card]}
                onPress={() => navigation.navigate('AppointmentDetail', { appointment: appt })}
              >
                <View style={[styles.itemAccent, { backgroundColor: palette.primary }]} />
                <View style={styles.itemContent}>
                  <View style={styles.itemHeaderRow}>
                    <Text style={styles.itemTitle}>{appt.summary}</Text>
                    <Text style={styles.itemTime}>{formatTime(appt.startLocal)}</Text>
                  </View>
                  <Text style={styles.itemMeta}>
                    {formatDate(appt.startLocal)}
                    {appt.location ? ` • ${appt.location}` : ''}
                  </Text>
                  {appt.prepNote ? (
                    <View style={styles.itemChip}>
                      <Text style={styles.itemChipText}>{appt.prepNote}</Text>
                    </View>
                  ) : null}
                </View>
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
              <Text style={styles.emptyTitle}>Nothing due</Text>
              <Text style={styles.emptyText}>
                Scan a statement or forward billing emails to see them here.
              </Text>
            </View>
          ) : (
            planData?.bills.map((bill) => {
              const isPaid = bill.status === 'paid';
              const isIgnored = bill.status === 'ignore';
              return (
                <TouchableOpacity
                  key={bill.id}
                  style={[styles.itemCard, shadow.card]}
                  onPress={() => navigation.navigate('BillDetail', { bill })}
                >
                  <View
                    style={[
                      styles.itemAccent,
                      { backgroundColor: isPaid ? palette.success : palette.warning },
                    ]}
                  />
                  <View style={styles.itemContent}>
                    <View style={styles.itemHeaderRow}>
                      <Text style={styles.itemTitle}>
                        {bill.amount ? formatCurrency(bill.amount) : 'Amount unknown'}
                      </Text>
                      <Text
                        style={[
                          styles.statusTag,
                          isPaid && styles.statusTagSuccess,
                          isIgnored && styles.statusTagMuted,
                        ]}
                      >
                        {bill.status}
                      </Text>
                    </View>
                    <Text style={styles.itemMeta}>
                      {bill.dueDate ? `Due ${formatDate(bill.dueDate)}` : 'No due date'}
                    </Text>
                    {bill.payUrl ? (
                      <View style={[styles.itemChip, styles.itemChipLink]}>
                        <Text style={styles.itemChipLinkText}>Pay online</Text>
                      </View>
                    ) : null}
                  </View>
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
    backgroundColor: palette.surfaceMuted,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing(6),
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: palette.surfaceMuted,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: palette.textMuted,
  },
  hero: {
    backgroundColor: palette.canvas,
    paddingHorizontal: spacing(3),
    paddingTop: spacing(4),
    paddingBottom: spacing(5),
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  heroEyebrow: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  heroTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    marginTop: spacing(1),
  },
  heroSubtitle: {
    color: '#cbd5f5',
    fontSize: 14,
    marginTop: spacing(1),
  },
  heroActions: {
    flexDirection: 'row',
    marginTop: spacing(3),
    gap: spacing(1.5),
  },
  heroButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing(1.5),
    borderRadius: radius.sm,
  },
  heroButtonPrimary: {
    backgroundColor: palette.accent,
  },
  heroButtonSecondary: {
    backgroundColor: 'rgba(148, 163, 184, 0.2)',
  },
  heroButtonIcon: {
    marginRight: spacing(1),
    fontSize: 16,
  },
  heroButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing(2),
    marginTop: -spacing(3),
    paddingHorizontal: spacing(3),
  },
  metricCard: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    padding: spacing(2.5),
  },
  metricLabel: {
    color: palette.textMuted,
    fontSize: 12,
    textTransform: 'uppercase',
    fontWeight: '600',
    marginBottom: spacing(0.5),
  },
  metricValue: {
    color: palette.textPrimary,
    fontSize: 28,
    fontWeight: '700',
  },
  metricHint: {
    marginTop: spacing(0.75),
    color: palette.textSecondary,
    fontSize: 13,
  },
  metricFooter: {
    flexDirection: 'row',
    gap: spacing(1),
    marginTop: spacing(1.5),
  },
  metricBadge: {
    fontSize: 12,
    color: palette.success,
    backgroundColor: '#dcfce7',
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.5),
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
  metricBadgeWarning: {
    fontSize: 12,
    color: palette.warning,
    backgroundColor: '#ffedd5',
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.5),
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
  errorBanner: {
    marginTop: spacing(3),
    marginHorizontal: spacing(3),
    backgroundColor: '#fee2e2',
    borderRadius: radius.sm,
    padding: spacing(1.5),
  },
  errorText: {
    color: palette.danger,
    fontSize: 14,
    textAlign: 'center',
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
    marginBottom: spacing(2),
    overflow: 'hidden',
    flexDirection: 'row',
  },
  itemAccent: {
    width: 6,
  },
  itemContent: {
    flex: 1,
    padding: spacing(2),
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: palette.textPrimary,
    flex: 1,
    marginRight: spacing(1),
  },
  itemTime: {
    fontSize: 13,
    color: palette.textMuted,
  },
  itemMeta: {
    fontSize: 13,
    color: palette.textSecondary,
    marginTop: spacing(0.5),
  },
  itemChip: {
    marginTop: spacing(1.5),
    backgroundColor: palette.primarySoft,
    borderRadius: radius.xs,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.75),
    alignSelf: 'flex-start',
  },
  itemChipText: {
    color: palette.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  itemChipLink: {
    backgroundColor: '#e0f2fe',
  },
  itemChipLinkText: {
    color: '#0284c7',
    fontSize: 12,
    fontWeight: '600',
  },
  statusTag: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: palette.warning,
  },
  statusTagSuccess: {
    color: palette.success,
  },
  statusTagMuted: {
    color: palette.textMuted,
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
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: palette.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
