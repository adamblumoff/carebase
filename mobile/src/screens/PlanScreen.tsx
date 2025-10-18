/**
 * Plan Screen
 * Simple weekly overview of appointments and bills
 */
import React, { useEffect, useCallback, useRef, useMemo } from 'react';
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
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useTheme, spacing, radius, type Palette, type Shadow } from '../theme';
import { useToast } from '../ui/ToastProvider';
import { formatDisplayDate, formatDisplayTime, parseServerDate } from '../utils/date';
import { usePlan } from '../plan/PlanProvider';
import { formatCurrency } from '../utils/format';
import { decideRefreshToast, findCollaboratorEmail, summarizePlan } from './plan/presenter';

type Props = NativeStackScreenProps<RootStackParamList, 'Plan'>;

export default function PlanScreen({ navigation }: Props) {
  const { palette, shadow } = useTheme();
  const styles = useMemo(() => createStyles(palette, shadow), [palette, shadow]);
  const toast = useToast();
  const { plan, loading, error, refreshing, refresh, lastUpdate } = usePlan();
  const lastToastRef = useRef<number>(0);
  const summary = useMemo(() => summarizePlan(plan ?? null), [plan]);

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

  const onRefresh = useCallback(() => {
    refresh({ source: 'manual', silent: true }).catch(() => {
      // errors surface via provider state
    });
  }, [refresh]);

  const formatDate = useCallback(
    (dateString: string) => formatDisplayDate(parseServerDate(dateString)),
    []
  );

  const formatTime = useCallback(
    (dateString: string) => formatDisplayTime(parseServerDate(dateString)),
    []
  );

  const getCollaboratorName = useCallback(
    (collaboratorId: number | null) => findCollaboratorEmail(plan ?? null, collaboratorId),
    [plan]
  );

  useEffect(() => {
    const decision = decideRefreshToast(lastUpdate ?? null, Boolean(plan), lastToastRef.current);
    if (decision.message && decision.timestamp) {
      toast.showToast(decision.message);
      lastToastRef.current = decision.timestamp;
    }
  }, [lastUpdate, plan, toast]);

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
                {summary.dateRange
                  ? `${formatDate(summary.dateRange.start)} – ${formatDate(summary.dateRange.end)}`
                  : 'Connect your inbox to build a plan.'}
            </Text>
          </View>
          <Text style={styles.heroMeta}>
              {summary.appointmentCount} appointments • {summary.billsDueCount} bills due
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
            {summary.appointmentCount > 0 && <Text style={styles.sectionCount}>{summary.appointmentCount}</Text>}
          </View>
          {summary.appointmentCount === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No appointments</Text>
              <Text style={styles.emptyText}>
                Forward confirmation emails and we’ll add them to this list.
              </Text>
            </View>
          ) : (
            plan?.appointments.map((appt) => (
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
                  {appt.prepNote ? <Text style={styles.itemNote}>{appt.prepNote}</Text> : null}
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
            {plan && summary.totalBills > 0 && <Text style={styles.sectionCount}>{summary.totalBills}</Text>}
          </View>
          {summary.totalBills === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No bills due</Text>
              <Text style={styles.emptyText}>
                Upload a statement or forward billing emails to track them here.
              </Text>
            </View>
          ) : (
            plan?.bills.map((bill) => (
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
                    {formatCurrency(bill.amount, { unknownLabel: 'Amount unknown' })}
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
      opacity: 0.85,
      transform: [{ scale: 0.98 }],
    },
    heroCardDivider: {
      height: 1,
      backgroundColor: palette.border,
      marginVertical: spacing(1.25),
      width: '100%',
    },
    errorBanner: {
      backgroundColor: palette.dangerSoft,
      paddingVertical: spacing(1.25),
      paddingHorizontal: spacing(2),
      marginHorizontal: spacing(3),
      borderRadius: radius.sm,
      marginTop: spacing(2),
    },
    errorText: {
      color: palette.danger,
      fontSize: 13,
      textAlign: 'center',
    },
    section: {
      marginTop: spacing(3),
      paddingHorizontal: spacing(3),
      gap: spacing(1.5),
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sectionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1),
    },
    sectionIcon: {
      fontSize: 18,
    },
    sectionTitle: {
      fontSize: 16,
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
