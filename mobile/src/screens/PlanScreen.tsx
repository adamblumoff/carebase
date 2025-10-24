/**
 * Plan Screen
 * Simple weekly overview of appointments and bills
 */
import React, { useEffect, useCallback, useRef, useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Animated,
  Modal,
  TextInput,
  Alert,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import type { BillStatus, PendingReviewDraft, PendingReviewItem } from '@carebase/shared';
import { useTheme, spacing, radius, type Palette, type Shadow } from '../theme';
import { useToast } from '../ui/ToastProvider';
import { formatDisplayDate, formatDisplayTime, parseServerDate } from '../utils/date';
import { usePlan } from '../plan/PlanProvider';
import { formatCurrency } from '../utils/format';
import { decideRefreshToast, findCollaboratorEmail, summarizePlan } from './plan/presenter';
import { usePendingReviews } from '../hooks/usePendingReviews';
import type { ReviewBillPayload } from '../api/review';
import DateTimePickerModal from '../components/DateTimePickerModal';

type DraftFormState = {
  amount: string;
  dueDate: string;
  statementDate: string;
  payUrl: string;
  status: BillStatus;
  notes: string;
};

const toIsoDate = (value: Date): string => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

type Props = NativeStackScreenProps<RootStackParamList, 'Plan'>;

export default function PlanScreen({ navigation }: Props) {
  const { palette, shadow } = useTheme();
  const styles = useMemo(() => createStyles(palette, shadow), [palette, shadow]);
  const toast = useToast();
  const { plan, loading, error, refreshing, refresh, lastUpdate } = usePlan();
  const lastToastRef = useRef<number>(0);
  const summary = useMemo(() => summarizePlan(plan ?? null), [plan]);
  const pendingReviews = usePendingReviews();
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [selectedReview, setSelectedReview] = useState<PendingReviewItem | null>(null);
  const [draftForm, setDraftForm] = useState<DraftFormState>({
    amount: '',
    dueDate: '',
    statementDate: '',
    payUrl: '',
    status: 'todo',
    notes: '',
  });
  const [dueDateValue, setDueDateValue] = useState<Date | null>(null);
  const [statementDateValue, setStatementDateValue] = useState<Date | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [modalAction, setModalAction] = useState<'save' | 'approve' | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);

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

  const hydrateDraft = useCallback((item: PendingReviewItem): DraftFormState => ({
    amount: item.draft?.amount != null ? String(item.draft.amount) : '',
    dueDate: item.draft?.dueDate ?? '',
    statementDate: item.draft?.statementDate ?? '',
    payUrl: item.draft?.payUrl ?? '',
    status: item.draft?.status ?? 'todo',
    notes: item.draft?.notes ?? '',
  }), []);

  const openReviewModal = useCallback(
    (item: PendingReviewItem) => {
      setSelectedReview(item);
      setDraftForm(hydrateDraft(item));
      setReviewError(null);
      setDueDateValue(item.draft?.dueDate ? parseServerDate(item.draft.dueDate) : null);
      setStatementDateValue(item.draft?.statementDate ? parseServerDate(item.draft.statementDate) : null);
      setReviewModalVisible(true);
    },
    [hydrateDraft]
  );

  const closeReviewModal = useCallback(() => {
    setReviewModalVisible(false);
    setSelectedReview(null);
    setModalAction(null);
    setReviewError(null);
    setDueDateValue(null);
    setStatementDateValue(null);
    setPickerVisible(false);
  }, []);

  const updateDraftField = useCallback(
    <K extends keyof DraftFormState>(field: K, value: DraftFormState[K]) => {
      setDraftForm((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    []
  );

  const formatReviewDate = useCallback(
    (value: string | null | undefined) => {
      if (!value) return '—';
      return formatDisplayDate(parseServerDate(value));
    },
    []
  );

  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState<'dueDate' | 'statementDate'>('dueDate');

  const openDatePicker = useCallback((mode: 'dueDate' | 'statementDate') => {
    setPickerMode(mode);
    setPickerVisible(true);
  }, []);

  const closeDatePicker = useCallback(() => {
    setPickerVisible(false);
  }, []);

  const dueDateDisplay = useMemo(() => {
    if (dueDateValue) {
      return formatDisplayDate(dueDateValue);
    }
    if (draftForm.dueDate?.trim()) {
      try {
        return formatDisplayDate(parseServerDate(draftForm.dueDate));
      } catch {
        return draftForm.dueDate;
      }
    }
    return 'Select date';
  }, [dueDateValue, draftForm.dueDate]);

  const statementDateDisplay = useMemo(() => {
    if (statementDateValue) {
      return formatDisplayDate(statementDateValue);
    }
    if (draftForm.statementDate?.trim()) {
      try {
        return formatDisplayDate(parseServerDate(draftForm.statementDate));
      } catch {
        return draftForm.statementDate;
      }
    }
    return 'Select date';
  }, [statementDateValue, draftForm.statementDate]);

  const handleDateConfirm = useCallback(
    (selectedDate: Date) => {
      if (pickerMode === 'dueDate') {
        setDueDateValue(selectedDate);
        updateDraftField('dueDate', toIsoDate(selectedDate));
      } else {
        setStatementDateValue(selectedDate);
        updateDraftField('statementDate', toIsoDate(selectedDate));
      }
      closeDatePicker();
    },
    [closeDatePicker, pickerMode, updateDraftField]
  );

  const clearDueDate = useCallback(() => {
    setDueDateValue(null);
    updateDraftField('dueDate', '');
  }, [updateDraftField]);

  const clearStatementDate = useCallback(() => {
    setStatementDateValue(null);
    updateDraftField('statementDate', '');
  }, [updateDraftField]);

  const pickerValue = useMemo(() => {
    if (pickerMode === 'dueDate') {
      return dueDateValue ?? new Date();
    }
    return statementDateValue ?? new Date();
  }, [pickerMode, dueDateValue, statementDateValue]);

  const isActionPending = modalAction !== null;

  const buildReviewPayload = useCallback((): ReviewBillPayload => {
    const trimmedAmount = draftForm.amount.trim();
    const amount = trimmedAmount.length > 0 ? Number(trimmedAmount) : null;
    if (trimmedAmount.length > 0 && Number.isNaN(amount)) {
      throw new Error('Enter a valid amount (numbers only).');
    }

    const normalize = (value: string) => {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    return {
      amount,
      dueDate: dueDateValue ? toIsoDate(dueDateValue) : normalize(draftForm.dueDate),
      statementDate: statementDateValue ? toIsoDate(statementDateValue) : normalize(draftForm.statementDate),
      payUrl: normalize(draftForm.payUrl),
      status: draftForm.status ?? 'todo',
      notes: normalize(draftForm.notes),
    };
  }, [draftForm, dueDateValue, statementDateValue]);

  const handleSaveDraft = useCallback(async () => {
    if (!selectedReview) return;
    try {
      const payload = buildReviewPayload();
      setModalAction('save');
      const draft = await pendingReviews.saveDraft(selectedReview.itemId, payload);
      setDraftForm({
        amount: draft.amount != null ? String(draft.amount) : '',
        dueDate: draft.dueDate ?? '',
        statementDate: draft.statementDate ?? '',
        payUrl: draft.payUrl ?? '',
        status: draft.status ?? 'todo',
        notes: draft.notes ?? '',
      });
      setDueDateValue(draft.dueDate ? parseServerDate(draft.dueDate) : null);
      setStatementDateValue(draft.statementDate ? parseServerDate(draft.statementDate) : null);
      setReviewError(null);
      toast.showToast('Draft saved');
    } catch (error: any) {
      const message = error?.message || error?.response?.data?.error || 'Unable to save draft right now.';
      setReviewError(message);
    } finally {
      setModalAction(null);
    }
  }, [buildReviewPayload, pendingReviews, selectedReview, toast]);

  const handleApprove = useCallback(async () => {
    if (!selectedReview) return;
    try {
      const payload = buildReviewPayload();
      setModalAction('approve');
      await pendingReviews.approve(selectedReview.itemId, payload);
      setReviewError(null);
      toast.showToast('Bill approved and added to plan');
      closeReviewModal();
    } catch (error: any) {
      const apiError = error?.response?.data?.error;
      const message = apiError || error?.message || 'Unable to approve this bill right now.';
      setReviewError(message);
    } finally {
      setModalAction(null);
    }
  }, [buildReviewPayload, closeReviewModal, pendingReviews, selectedReview, toast]);

  const executeReject = useCallback(
    async (item: PendingReviewItem) => {
      try {
        setRejectingId(item.itemId);
        await pendingReviews.reject(item.itemId);
        toast.showToast('Marked as not a bill');
        if (selectedReview?.itemId === item.itemId) {
          closeReviewModal();
        }
      } catch (error) {
        toast.showToast('Could not update this item right now.');
      } finally {
        setRejectingId(null);
      }
    },
    [closeReviewModal, pendingReviews, selectedReview, toast]
  );

  const handleReject = useCallback(
    (item: PendingReviewItem) => {
      Alert.alert(
        'Mark as not a bill?',
        'This removes the item from your review queue.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Mark not a bill',
            style: 'destructive',
            onPress: () => executeReject(item),
          },
        ]
      );
    },
    [executeReject]
  );

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

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionIcon}>🧾</Text>
              <Text style={styles.sectionTitle}>Needs review</Text>
            </View>
            {pendingReviews.pendingCount > 0 && (
              <Text style={styles.sectionCount}>{pendingReviews.pendingCount}</Text>
            )}
          </View>

          {pendingReviews.loading ? (
            <View style={styles.reviewLoadingCard}>
              <ActivityIndicator color={palette.primary} />
              <Text style={styles.reviewLoadingText}>Checking your inbox…</Text>
            </View>
          ) : pendingReviews.error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{pendingReviews.error}</Text>
              <Pressable
                style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
                onPress={() => pendingReviews.refresh()}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : pendingReviews.items.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Nothing to review</Text>
              <Text style={styles.emptyText}>
                Upload bills that need confirmation and they’ll land here for quick approval.
              </Text>
            </View>
          ) : (
            pendingReviews.items.map((item) => {
              const amountLabel =
                item.draft?.amount != null ? formatCurrency(item.draft.amount) : 'Not detected';
              return (
                <View key={item.itemId} style={styles.reviewCard}>
                  <View style={styles.reviewCardHeader}>
                    <Text style={styles.reviewTitle}>
                      {item.source.subject || 'Bill candidate'}
                    </Text>
                    <Text style={styles.reviewTimestamp}>{formatReviewDate(item.createdAt)}</Text>
                  </View>
                  <Text style={styles.reviewExcerpt} numberOfLines={3}>
                    {item.source.shortExcerpt || 'No text captured from this upload yet.'}
                  </Text>
                  <View style={styles.reviewMetaRow}>
                    <Text style={styles.reviewMeta}>Amount: {amountLabel}</Text>
                    <Text style={styles.reviewMeta}>
                      Due: {formatReviewDate(item.draft?.dueDate ?? null)}
                    </Text>
                  </View>
                  <View style={styles.reviewActions}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.reviewPrimaryButton,
                        pressed && styles.reviewPrimaryButtonPressed,
                      ]}
                      onPress={() => openReviewModal(item)}
                    >
                      <Text style={styles.reviewPrimaryButtonText}>Edit & approve</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.reviewSecondaryButton,
                        pressed && styles.reviewSecondaryButtonPressed,
                        rejectingId === item.itemId && styles.reviewSecondaryButtonDisabled,
                      ]}
                      onPress={() => handleReject(item)}
                      disabled={rejectingId === item.itemId}
                    >
                      <Text style={styles.reviewSecondaryButtonText}>
                        {rejectingId === item.itemId ? 'Working…' : 'Not a bill'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
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

      <Modal
        visible={reviewModalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeReviewModal}
      >
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={closeReviewModal}>
            <View style={styles.modalBackdrop} />
          </TouchableWithoutFeedback>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={32}
            style={styles.modalSheet}
          >
            <View style={styles.modalSheetInner}>
              <DateTimePickerModal
                visible={pickerVisible}
                mode="date"
                value={pickerValue}
                onDismiss={closeDatePicker}
                onConfirm={handleDateConfirm}
              />
              <ScrollView
                bounces={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.modalScrollContent}
              >
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Review bill</Text>
                  <Text style={styles.modalSubtitle} numberOfLines={2}>
                    {selectedReview?.source.subject || 'Bill candidate'}
                  </Text>
                </View>

                <Text style={styles.modalLabel}>Amount</Text>
                <TextInput
                  value={draftForm.amount}
                  onChangeText={(value) => updateDraftField('amount', value)}
                  placeholder="e.g. 245.67"
                  keyboardType="decimal-pad"
                  style={styles.modalInput}
                />

                <Text style={styles.modalLabel}>Due date</Text>
                <View style={styles.selectorRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.selectorButton,
                      pressed && styles.selectorButtonPressed,
                    ]}
                    onPress={() => openDatePicker('dueDate')}
                  >
                    <Text style={styles.selectorValue}>{dueDateDisplay}</Text>
                  </Pressable>
                  {dueDateValue || draftForm.dueDate ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.selectorClearButton,
                        pressed && styles.selectorClearButtonPressed,
                      ]}
                      onPress={clearDueDate}
                    >
                      <Text style={styles.selectorClearButtonText}>Clear</Text>
                    </Pressable>
                  ) : null}
                </View>

                <Text style={styles.modalLabel}>Statement date</Text>
                <View style={styles.selectorRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.selectorButton,
                      pressed && styles.selectorButtonPressed,
                    ]}
                    onPress={() => openDatePicker('statementDate')}
                  >
                    <Text style={styles.selectorValue}>{statementDateDisplay}</Text>
                  </Pressable>
                  {statementDateValue || draftForm.statementDate ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.selectorClearButton,
                        pressed && styles.selectorClearButtonPressed,
                      ]}
                      onPress={clearStatementDate}
                    >
                      <Text style={styles.selectorClearButtonText}>Clear</Text>
                    </Pressable>
                  ) : null}
                </View>

                <Text style={styles.modalLabel}>Payment link</Text>
                <TextInput
                  value={draftForm.payUrl}
                  onChangeText={(value) => updateDraftField('payUrl', value)}
                  placeholder="https://billing.example.com/pay"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.modalInput}
                />

                <Text style={styles.modalLabel}>Status</Text>
                <View style={styles.statusSelectorRow}>
                  {(['todo', 'overdue', 'paid'] as BillStatus[]).map((status) => {
                    const isActive = draftForm.status === status;
                    return (
                      <Pressable
                        key={status}
                        style={({ pressed }) => [
                          styles.statusPill,
                          isActive && styles.statusPillActive,
                          pressed && styles.statusPillPressed,
                        ]}
                        onPress={() => updateDraftField('status', status)}
                      >
                        <Text style={[styles.statusPillText, isActive && styles.statusPillTextActive]}>
                          {status}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.modalLabel}>Notes</Text>
                <TextInput
                  value={draftForm.notes}
                  onChangeText={(value) => updateDraftField('notes', value)}
                  placeholder="Optional reviewer note"
                  multiline
                  style={[styles.modalInput, styles.modalNotesInput]}
                />

                {reviewError && <Text style={styles.modalError}>{reviewError}</Text>}

                <View style={styles.modalActions}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.modalSecondaryButton,
                      pressed && styles.modalSecondaryButtonPressed,
                    ]}
                    onPress={handleSaveDraft}
                    disabled={isActionPending}
                  >
                    <Text style={styles.modalSecondaryButtonText}>
                      {isActionPending && modalAction === 'save' ? 'Saving…' : 'Save draft'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.modalPrimaryButton,
                      pressed && styles.modalPrimaryButtonPressed,
                    ]}
                    onPress={handleApprove}
                    disabled={isActionPending}
                  >
                    <Text style={styles.modalPrimaryButtonText}>
                      {isActionPending && modalAction === 'approve' ? 'Approving…' : 'Approve bill'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.modalLinkButton,
                      pressed && styles.modalLinkButtonPressed,
                    ]}
                    onPress={closeReviewModal}
                    disabled={isActionPending}
                  >
                    <Text style={styles.modalLinkButtonText}>Cancel</Text>
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
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
    retryButton: {
      marginTop: spacing(1),
      alignSelf: 'center',
      paddingHorizontal: spacing(2),
      paddingVertical: spacing(0.75),
      borderRadius: radius.sm,
      backgroundColor: palette.danger,
    },
    retryButtonPressed: {
      opacity: 0.9,
    },
    retryButtonText: {
      color: '#fff',
      fontWeight: '600',
      fontSize: 13,
      textTransform: 'uppercase',
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
    reviewLoadingCard: {
      backgroundColor: palette.surface,
      borderRadius: radius.md,
      padding: spacing(2),
      alignItems: 'center',
      gap: spacing(1),
    },
    reviewLoadingText: {
      color: palette.textSecondary,
      fontSize: 14,
    },
    retryButton: {
      marginTop: spacing(1),
      alignSelf: 'center',
      paddingHorizontal: spacing(2),
      paddingVertical: spacing(0.75),
      borderRadius: radius.sm,
      backgroundColor: palette.danger,
    },
    retryButtonPressed: {
      opacity: 0.9,
    },
    retryButtonText: {
      color: '#fff',
      fontWeight: '600',
      fontSize: 13,
      textTransform: 'uppercase',
    },
    reviewCard: {
      backgroundColor: palette.surface,
      borderRadius: radius.md,
      padding: spacing(1.75),
      borderWidth: 1,
      borderColor: palette.border,
      gap: spacing(1),
    },
    reviewCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing(1),
    },
    reviewTitle: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: palette.textPrimary,
    },
    reviewTimestamp: {
      fontSize: 12,
      color: palette.textMuted,
    },
    reviewExcerpt: {
      fontSize: 14,
      color: palette.textSecondary,
      lineHeight: 20,
    },
    reviewMetaRow: {
      flexDirection: 'row',
      gap: spacing(2),
      flexWrap: 'wrap',
    },
    reviewMeta: {
      fontSize: 13,
      color: palette.textSecondary,
    },
    reviewActions: {
      flexDirection: 'row',
      gap: spacing(1),
    },
    reviewPrimaryButton: {
      flex: 1,
      backgroundColor: palette.primary,
      paddingVertical: spacing(1),
      borderRadius: radius.sm,
      alignItems: 'center',
    },
    reviewPrimaryButtonPressed: {
      opacity: 0.9,
    },
    reviewPrimaryButtonText: {
      color: '#fff',
      fontWeight: '600',
    },
    reviewSecondaryButton: {
      flex: 1,
      borderRadius: radius.sm,
      paddingVertical: spacing(1),
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: 'center',
      backgroundColor: palette.surfaceMuted,
    },
    reviewSecondaryButtonPressed: {
      opacity: 0.85,
    },
    reviewSecondaryButtonDisabled: {
      opacity: 0.6,
    },
    reviewSecondaryButtonText: {
      color: palette.textSecondary,
      fontWeight: '600',
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
      justifyContent: 'flex-end',
    },
    modalBackdrop: {
      flex: 1,
    },
    modalSheet: {
      width: '100%',
      maxHeight: '88%',
    },
    modalSheetInner: {
      backgroundColor: palette.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: spacing(3),
      paddingTop: spacing(3),
      paddingBottom: spacing(2.5),
      flexGrow: 1,
    },
    modalScrollContent: {
      paddingBottom: spacing(3),
    },
    modalHeader: {
      gap: spacing(0.5),
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: palette.textPrimary,
    },
    modalSubtitle: {
      fontSize: 14,
      color: palette.textSecondary,
    },
    modalLabel: {
      marginTop: spacing(1.5),
      fontSize: 12,
      fontWeight: '600',
      color: palette.textMuted,
      textTransform: 'uppercase',
    },
    modalInput: {
      marginTop: spacing(0.5),
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: spacing(1.25),
      paddingVertical: spacing(1),
      fontSize: 15,
      color: palette.textPrimary,
    },
    modalNotesInput: {
      minHeight: 90,
      textAlignVertical: 'top',
    },
    modalError: {
      marginTop: spacing(1),
      color: palette.danger,
      fontSize: 13,
    },
    modalActions: {
      marginTop: spacing(2),
      gap: spacing(1),
    },
    modalSecondaryButton: {
      backgroundColor: palette.surfaceMuted,
      borderRadius: radius.sm,
      paddingVertical: spacing(1.1),
      alignItems: 'center',
      borderWidth: 1,
      borderColor: palette.border,
    },
    modalSecondaryButtonPressed: {
      opacity: 0.85,
    },
    modalSecondaryButtonText: {
      color: palette.textPrimary,
      fontWeight: '600',
    },
    modalPrimaryButton: {
      backgroundColor: palette.primary,
      borderRadius: radius.sm,
      paddingVertical: spacing(1.1),
      alignItems: 'center',
    },
    modalPrimaryButtonPressed: {
      opacity: 0.9,
    },
    modalPrimaryButtonText: {
      color: '#fff',
      fontWeight: '700',
    },
    modalLinkButton: {
      paddingVertical: spacing(1),
      alignItems: 'center',
    },
    modalLinkButtonPressed: {
      opacity: 0.6,
    },
    modalLinkButtonText: {
      color: palette.textSecondary,
      fontWeight: '600',
    },
    selectorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1),
    },
    selectorButton: {
      flex: 1,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceMuted,
      paddingVertical: spacing(1),
      paddingHorizontal: spacing(1.25),
    },
    selectorButtonPressed: {
      opacity: 0.9,
    },
    selectorValue: {
      fontSize: 15,
      color: palette.textPrimary,
    },
    selectorClearButton: {
      paddingVertical: spacing(0.75),
      paddingHorizontal: spacing(1.25),
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
    },
    selectorClearButtonPressed: {
      opacity: 0.85,
    },
    selectorClearButtonText: {
      color: palette.textSecondary,
      fontWeight: '600',
      textTransform: 'uppercase',
      fontSize: 12,
    },
    statusSelectorRow: {
      flexDirection: 'row',
      gap: spacing(1),
      marginTop: spacing(0.75),
    },
    statusPill: {
      paddingHorizontal: spacing(1.25),
      paddingVertical: spacing(0.75),
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceMuted,
    },
    statusPillActive: {
      backgroundColor: palette.primarySoft,
      borderColor: palette.primary,
    },
    statusPillPressed: {
      opacity: 0.8,
    },
    statusPillText: {
      fontSize: 12,
      fontWeight: '600',
      color: palette.textMuted,
      textTransform: 'uppercase',
    },
    statusPillTextActive: {
      color: palette.primary,
    },
  });
