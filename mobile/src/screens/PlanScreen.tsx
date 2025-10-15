/**
 * Plan Screen
 * Simple weekly overview of appointments and bills
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RootStackParamList } from '../navigation/AppNavigator';
import type { Appointment, Bill } from '@carebase/shared';
import apiClient from '../api/client';
import { API_ENDPOINTS } from '../config';
import { useTheme, spacing, radius, type Palette, type Shadow } from '../theme';
import { addPlanChangeListener } from '../utils/planEvents';
import { ensureRealtimeConnected, isRealtimeConnected } from '../utils/realtime';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../ui/ToastProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'Plan'>;

type PlanCollaborator = {
  id: number;
  recipientId: number;
  userId: number | null;
  email: string;
  role: 'owner' | 'contributor';
  status: 'pending' | 'accepted';
  inviteToken: string;
  invitedBy: number;
  invitedAt: string;
  acceptedAt: string | null;
};

interface PlanData {
  appointments: Appointment[];
  bills: Bill[];
  dateRange: {
    start: string;
    end: string;
  };
  planVersion: number;
  planUpdatedAt?: string | null;
  collaborators: PlanCollaborator[];
}

const MAX_FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 600;
const PLAN_CACHE_KEY = 'plan_cache_v1';

export default function PlanScreen({ navigation }: Props) {
  const { palette, shadow } = useTheme();
  const styles = useMemo(() => createStyles(palette, shadow), [palette, shadow]);
  const auth = useAuth();
  const toast = useToast();
  const [planData, setPlanData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestVersionRef = useRef<number>(0);
  const planDataRef = useRef<PlanData | null>(null);
  const cacheLoadedRef = useRef(false);

const AnimatedStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    if (status === 'overdue') {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.05, duration: 400, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 400, useNativeDriver: true }),
        ])
      );
      loop.start();
    } else {
      scale.setValue(1);
    }
    return () => {
      loop?.stop();
    };
  }, [scale, status]);

  const badgeStyle = [
    styles.statusBadge,
    status === 'paid' && styles.statusBadgeSuccess,
    status === 'overdue' && styles.statusBadgeOverdue,
    status === 'pending' && styles.statusBadgeWarning,
  ];

  const textStyle = [
    styles.statusBadgeText,
    status === 'paid' && styles.statusBadgeTextSuccess,
    status === 'overdue' && styles.statusBadgeTextOverdue,
    status === 'pending' && styles.statusBadgeTextWarning,
  ];

  return (
    <Animated.View style={[badgeStyle, status === 'overdue' && { transform: [{ scale }] }]}>
      <Text style={textStyle}>{status}</Text>
    </Animated.View>
  );
};

  useEffect(() => {
    planDataRef.current = planData;
  }, [planData]);

  const sleep = useCallback((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)), []);

  const fetchPlan = useCallback(
    async (options: { silent?: boolean; manual?: boolean; source?: 'realtime' | 'poll' } = {}) => {
      const { silent = false, manual = false, source } = options;
      if (!silent) {
        setLoading(true);
      }

      let success = false;

      try {
        for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
          try {
            const response = await apiClient.get(API_ENDPOINTS.getPlan);
            const collaborators = Array.isArray(response.data?.collaborators)
              ? (response.data.collaborators as PlanCollaborator[])
              : [];
            const data: PlanData = {
              ...response.data,
              collaborators,
            };
            setPlanData(data);
            latestVersionRef.current = typeof data.planVersion === 'number' ? data.planVersion : 0;
            await AsyncStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(data));
            setError(null);
            if (manual) {
              toast.showToast('Plan updated');
            } else if (source === 'realtime') {
              toast.showToast('Plan refreshed');
            }
            success = true;
            break;
          } catch (err) {
            console.error(`Failed to fetch plan (attempt ${attempt})`, err);
            if (attempt < MAX_FETCH_ATTEMPTS) {
              await sleep(RETRY_DELAY_MS * attempt);
            }
          }
        }

        if (!success) {
          setError('We couldn’t refresh your plan. Pull to try again.');
          if (planDataRef.current) {
            toast.showToast('Unable to refresh plan. Showing saved data');
          } else {
            toast.showToast('Unable to refresh plan');
          }
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
        setRefreshing(false);
      }
    },
    [sleep, toast]
  );

  useEffect(() => {
    let cancelled = false;

    const loadCacheAndFetch = async () => {
      try {
        const cached = await AsyncStorage.getItem(PLAN_CACHE_KEY);
        if (cached && !cancelled) {
          const parsedRaw = JSON.parse(cached);
          const parsed: PlanData = {
            ...parsedRaw,
            collaborators: Array.isArray(parsedRaw?.collaborators)
              ? (parsedRaw.collaborators as PlanCollaborator[])
              : [],
          };
          cacheLoadedRef.current = true;
          setPlanData(parsed);
          latestVersionRef.current = typeof parsed.planVersion === 'number' ? parsed.planVersion : 0;
          setLoading(false);
        }
      } catch (err) {
        console.warn('Failed to load cached plan', err);
      }

      if (!cancelled) {
        fetchPlan({ silent: cacheLoadedRef.current });
      }
    };

    loadCacheAndFetch();

    return () => {
      cancelled = true;
    };
  }, [fetchPlan]);

  useEffect(() => {
    const unsubscribePlan = addPlanChangeListener(() => {
      fetchPlan({ silent: true, source: 'realtime' });
    });
    ensureRealtimeConnected().catch((error) => {
      console.warn('Realtime connection failed', error);
    });
    return unsubscribePlan;
  }, [fetchPlan]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const pollIntervalMs = 15000;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const checkVersion = async () => {
        try {
          if (isRealtimeConnected()) {
            timer = setTimeout(checkVersion, pollIntervalMs);
            return;
          }
          const response = await apiClient.get(API_ENDPOINTS.getPlanVersion);
          const nextVersion = typeof response.data.planVersion === 'number' ? response.data.planVersion : 0;
          if (nextVersion > latestVersionRef.current) {
            await fetchPlan({ silent: true, source: 'poll' });
          }
        } catch (pollError) {
          console.warn('Plan version poll failed', pollError);
        } finally {
          if (!cancelled) {
            timer = setTimeout(checkVersion, pollIntervalMs);
          }
        }
      };

      timer = setTimeout(checkVersion, pollIntervalMs);

      return () => {
        cancelled = true;
        if (timer) {
          clearTimeout(timer);
        }
      };
    }, [fetchPlan])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPlan({ silent: true, manual: true });
  }, [fetchPlan]);

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

  const getCollaboratorName = useCallback(
    (collaboratorId: number | null) => {
      if (!collaboratorId || !planData?.collaborators) {
        return null;
      }
      const match = planData.collaborators.find((collaborator) => collaborator.id === collaboratorId);
      return match?.email ?? null;
    },
    [planData?.collaborators]
  );

  const appointmentCount = planData?.appointments.length ?? 0;
  const billsDue = planData?.bills.filter((bill) => bill.status !== 'paid').length ?? 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={palette.primary} />
          <Text style={styles.loadingText}>Loading your plan…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerButtons}>
            <Pressable
              style={({ pressed }) => [
                styles.actionPill,
                styles.actionPrimary,
                pressed && styles.actionPillPressed,
              ]}
              onPress={() => navigation.navigate('Camera')}
            >
              <Text style={styles.actionPrimaryText}>📷 Scan bill</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.actionPill,
                styles.actionSecondary,
                pressed && styles.actionPillPressed,
              ]}
              onPress={() => navigation.navigate('Settings')}
            >
              <Text style={styles.actionSecondaryText}>⚙️ Settings</Text>
            </Pressable>
          </View>
        <View style={styles.heroCard}>
          <View style={styles.heroRow}>
            <Text style={styles.heroIcon}>📅</Text>
            <Text style={styles.heroSubtitle}>
              {planData?.dateRange
                ? `${formatDate(planData.dateRange.start)} – ${formatDate(planData.dateRange.end)}`
                : 'Connect your inbox to build a plan.'}
            </Text>
          </View>
          <Text style={styles.heroMeta}>
            {appointmentCount} appointments • {billsDue} bills due
          </Text>
        </View>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionIcon}>🗓️</Text>
              <Text style={styles.sectionTitle}>Upcoming visits</Text>
            </View>
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
              <Pressable
                key={appt.id}
                style={({ pressed }) => [
                  styles.itemCard,
                  styles.appointmentCard,
                  pressed && styles.itemCardPressed,
                ]}
                onPress={() => navigation.navigate('AppointmentDetail', { appointment: appt })}
              >
                <View style={[styles.cardAccent, styles.appointmentAccent]} />
                <View style={styles.cardBody}>
                  <Text style={styles.itemTitle}>{appt.summary}</Text>
                  <Text style={styles.itemMeta}>
                    {formatDate(appt.startLocal)} at {formatTime(appt.startLocal)}
                  </Text>
                  {appt.location ? <Text style={styles.itemSub}>{appt.location}</Text> : null}
                  {appt.prepNote ? (
                    <Text style={styles.itemNote}>{appt.prepNote}</Text>
                  ) : null}
                  {getCollaboratorName(appt.assignedCollaboratorId) ? (
                    <Text style={styles.assignmentText}>
                      Assigned to {getCollaboratorName(appt.assignedCollaboratorId)}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionIcon}>💳</Text>
              <Text style={styles.sectionTitle}>Bills to handle</Text>
            </View>
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
            planData?.bills.map((bill) => (
              <Pressable
                key={bill.id}
                style={({ pressed }) => [
                  styles.itemCard,
                  styles.billCard,
                  pressed && styles.itemCardPressed,
                ]}
                onPress={() => navigation.navigate('BillDetail', { bill })}
              >
                <View style={[styles.cardAccent, styles.billAccent]} />
                <View style={styles.cardBody}>
                  <Text style={styles.itemTitle}>
                    {bill.amount ? formatCurrency(bill.amount) : 'Amount unknown'}
                  </Text>
                  <Text style={styles.itemMeta}>
                    {bill.dueDate ? `Due ${formatDate(bill.dueDate)}` : 'No due date'}
                  </Text>
                  {getCollaboratorName(bill.assignedCollaboratorId) ? (
                    <Text style={styles.assignmentText}>
                      Assigned to {getCollaboratorName(bill.assignedCollaboratorId)}
                    </Text>
                  ) : null}
                  <AnimatedStatusBadge status={bill.status} />
                </View>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (palette: Palette, shadow: Shadow) =>
  StyleSheet.create({
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
      paddingTop: spacing(2.5),
      gap: spacing(1.5),
      alignItems: 'stretch',
    },
    heroCard: {
      alignSelf: 'center',
      backgroundColor: palette.primarySoft,
      borderRadius: radius.md,
      paddingVertical: spacing(1.5),
      paddingHorizontal: spacing(1.75),
      borderWidth: 1,
      borderColor: palette.primary,
      alignItems: 'center',
      width: '100%',
      maxWidth: 320,
    },
    heroRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing(1),
    },
    heroIcon: {
      fontSize: 18,
    },
    heroSubtitle: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.textPrimary,
      textAlign: 'center',
    },
    heroMeta: {
      marginTop: spacing(0.75),
      fontSize: 13,
      color: palette.textMuted,
      textAlign: 'center',
    },
    headerButtons: {
      flexDirection: 'row',
      gap: spacing(0.75),
      alignSelf: 'center',
      justifyContent: 'center',
      width: '100%',
      maxWidth: 320,
    },
    actionPill: {
      borderRadius: radius.lg,
      paddingVertical: spacing(1),
      paddingHorizontal: spacing(2),
      minWidth: 110,
      alignItems: 'center',
    },
    actionPrimary: {
      backgroundColor: palette.primary,
    },
    actionPrimaryText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '600',
    },
    actionSecondary: {
      borderWidth: 1,
      borderColor: palette.primary,
      backgroundColor: 'transparent',
    },
    actionSecondaryText: {
      color: palette.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    actionPillPressed: {
      transform: [{ scale: 0.98 }],
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
    sectionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1),
    },
    sectionIcon: {
      fontSize: 16,
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
    sectionDivider: {
      height: 1,
      backgroundColor: palette.primary,
      opacity: 0.1,
      marginHorizontal: spacing(3),
      marginTop: spacing(3),
    },
    itemCard: {
      backgroundColor: palette.surface,
      borderRadius: radius.md,
      overflow: 'hidden',
      marginBottom: spacing(1.5),
      flexDirection: 'row',
      borderWidth: 1,
      borderColor: palette.border,
    },
    appointmentCard: {
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
      marginBottom: spacing(1.5),
    },
    billCard: {
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
      elevation: 4,
      marginBottom: spacing(1.5),
    },
    itemCardPressed: {
      transform: [{ scale: 0.98 }],
    },
    cardAccent: {
      width: 6,
    },
    appointmentAccent: {
      backgroundColor: palette.accent,
    },
    billAccent: {
      backgroundColor: palette.primary,
    },
    cardBody: {
      flex: 1,
      paddingHorizontal: spacing(2),
      paddingVertical: spacing(2),
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
    assignmentText: {
      marginTop: spacing(0.75),
      fontSize: 12,
      color: palette.textMuted,
      fontStyle: 'italic',
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
    statusBadge: {
      marginTop: spacing(1),
      alignSelf: 'flex-start',
      paddingHorizontal: spacing(1.5),
      paddingVertical: spacing(0.5),
      borderRadius: radius.xs,
      backgroundColor: palette.primarySoft,
    },
    statusBadgeText: {
      fontSize: 12,
      fontWeight: '600',
      textTransform: 'uppercase',
      color: palette.primary,
    },
    statusBadgeSuccess: {
      backgroundColor: palette.primarySoft,
    },
    statusBadgeTextSuccess: {
      color: palette.success,
    },
    statusBadgeOverdue: {
      backgroundColor: palette.danger,
    },
    statusBadgeTextOverdue: {
      color: '#ffffff',
    },
    statusBadgeWarning: {
      backgroundColor: '#fdecc8',
    },
    statusBadgeTextWarning: {
      color: palette.warning,
    },
  });
