import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View
} from 'react-native';
import type { BillStatus, PendingReviewDraft, PendingReviewItem, ReviewBillPayload } from '@carebase/shared';
import { formatDisplayDate, parseServerDate } from '../../utils/date';
import { spacing, radius, useTheme, type Palette, type Shadow } from '../../theme';
import DateTimePickerModal from '../../components/DateTimePickerModal';

type DraftFormState = {
  amount: string;
  dueDate: string;
  statementDate: string;
  payUrl: string;
  status: BillStatus;
  notes: string;
};

type PendingReviewActions = {
  saveDraft: (itemId: number, payload: ReviewBillPayload) => Promise<PendingReviewDraft>;
  approve: (itemId: number, payload: ReviewBillPayload) => Promise<void>;
};

type ToastApi = {
  showToast: (message: string) => void;
};

type Props = {
  visible: boolean;
  item: PendingReviewItem | null;
  onClose: () => void;
  actions: PendingReviewActions;
  toast: ToastApi;
};

const toIsoDate = (value: Date): string => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const defaultDraft: DraftFormState = {
  amount: '',
  dueDate: '',
  statementDate: '',
  payUrl: '',
  status: 'todo',
  notes: ''
};

const hydrateDraft = (item: PendingReviewItem | null): DraftFormState => ({
  amount: item?.draft?.amount != null ? String(item.draft.amount) : '',
  dueDate: item?.draft?.dueDate ?? '',
  statementDate: item?.draft?.statementDate ?? '',
  payUrl: item?.draft?.payUrl ?? '',
  status: item?.draft?.status ?? 'todo',
  notes: item?.draft?.notes ?? ''
});

const pickerInitialDate = () => new Date();

export function PendingReviewModal({ visible, item, onClose, actions, toast }: Props) {
  const { palette, shadow } = useTheme();
  const styles = useMemo(() => createStyles(palette, shadow), [palette, shadow]);

  const [draftForm, setDraftForm] = useState<DraftFormState>(defaultDraft);
  const [dueDateValue, setDueDateValue] = useState<Date | null>(null);
  const [statementDateValue, setStatementDateValue] = useState<Date | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [modalAction, setModalAction] = useState<'save' | 'approve' | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState<'dueDate' | 'statementDate'>('dueDate');

  useEffect(() => {
    if (visible && item) {
      setDraftForm(hydrateDraft(item));
      setDueDateValue(item.draft?.dueDate ? parseServerDate(item.draft.dueDate) : null);
      setStatementDateValue(item.draft?.statementDate ? parseServerDate(item.draft.statementDate) : null);
      setReviewError(null);
      setModalAction(null);
      setPickerVisible(false);
    } else if (!visible) {
      setDraftForm(defaultDraft);
      setDueDateValue(null);
      setStatementDateValue(null);
      setReviewError(null);
      setModalAction(null);
      setPickerVisible(false);
    }
  }, [item, visible]);

  const updateDraftField = useCallback(<K extends keyof DraftFormState>(field: K, value: DraftFormState[K]) => {
    setDraftForm((prev) => ({
      ...prev,
      [field]: value
    }));
  }, []);

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
      notes: normalize(draftForm.notes)
    };
  }, [draftForm, dueDateValue, statementDateValue]);

  const handleDateConfirm = useCallback(
    (selectedDate: Date) => {
      if (pickerMode === 'dueDate') {
        setDueDateValue(selectedDate);
        updateDraftField('dueDate', toIsoDate(selectedDate));
      } else {
        setStatementDateValue(selectedDate);
        updateDraftField('statementDate', toIsoDate(selectedDate));
      }
      setPickerVisible(false);
    },
    [pickerMode, updateDraftField]
  );

  const clearDueDate = useCallback(() => {
    setDueDateValue(null);
    updateDraftField('dueDate', '');
  }, [updateDraftField]);

  const clearStatementDate = useCallback(() => {
    setStatementDateValue(null);
    updateDraftField('statementDate', '');
  }, [updateDraftField]);

  const formatReviewDate = useCallback((value: string | null | undefined) => {
    if (!value) return '—';
    try {
      return formatDisplayDate(parseServerDate(value));
    } catch {
      return value;
    }
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

  const isActionPending = modalAction !== null;

  const handleSaveDraft = useCallback(async () => {
    if (!item) return;
    try {
      const payload = buildReviewPayload();
      setModalAction('save');
      const draft = await actions.saveDraft(item.itemId, payload);
      setDraftForm({
        amount: draft.amount != null ? String(draft.amount) : '',
        dueDate: draft.dueDate ?? '',
        statementDate: draft.statementDate ?? '',
        payUrl: draft.payUrl ?? '',
        status: draft.status ?? 'todo',
        notes: draft.notes ?? ''
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
  }, [actions, buildReviewPayload, item, toast]);

  const handleApprove = useCallback(async () => {
    if (!item) return;
    try {
      const payload = buildReviewPayload();
      setModalAction('approve');
      await actions.approve(item.itemId, payload);
      setReviewError(null);
      toast.showToast('Bill approved and added to plan');
      onClose();
    } catch (error: any) {
      const apiError = error?.response?.data?.error;
      const message = apiError || error?.message || 'Unable to approve this bill right now.';
      setReviewError(message);
    } finally {
      setModalAction(null);
    }
  }, [actions, buildReviewPayload, item, onClose, toast]);

  const pickerValue = useMemo(() => {
    if (pickerMode === 'dueDate') {
      return dueDateValue ?? pickerInitialDate();
    }
    return statementDateValue ?? pickerInitialDate();
  }, [pickerMode, dueDateValue, statementDateValue]);

  if (!item) {
    return null;
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableWithoutFeedback onPress={onClose}>
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
              onDismiss={() => setPickerVisible(false)}
              onConfirm={handleDateConfirm}
            />
            <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalScrollContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Review bill</Text>
                <Text style={styles.modalSubtitle} numberOfLines={2}>
                  {item.source.subject || 'Bill candidate'}
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
                  style={({ pressed }) => [styles.selectorButton, pressed && styles.selectorButtonPressed]}
                  onPress={() => {
                    setPickerMode('dueDate');
                    setPickerVisible(true);
                  }}
                >
                  <Text style={styles.selectorValue}>{dueDateDisplay}</Text>
                </Pressable>
                {dueDateValue || draftForm.dueDate ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.selectorClearButton,
                      pressed && styles.selectorClearButtonPressed
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
                  style={({ pressed }) => [styles.selectorButton, pressed && styles.selectorButtonPressed]}
                  onPress={() => {
                    setPickerMode('statementDate');
                    setPickerVisible(true);
                  }}
                >
                  <Text style={styles.selectorValue}>{statementDateDisplay}</Text>
                </Pressable>
                {statementDateValue || draftForm.statementDate ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.selectorClearButton,
                      pressed && styles.selectorClearButtonPressed
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
                        pressed && styles.statusPillPressed
                      ]}
                      onPress={() => updateDraftField('status', status)}
                    >
                      <Text style={[styles.statusPillText, isActive && styles.statusPillTextActive]}>{status}</Text>
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
                  style={({ pressed }) => [styles.modalSecondaryButton, pressed && styles.modalSecondaryButtonPressed]}
                  onPress={handleSaveDraft}
                  disabled={isActionPending}
                >
                  <Text style={styles.modalSecondaryButtonText}>
                    {isActionPending && modalAction === 'save' ? 'Saving…' : 'Save draft'}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.modalPrimaryButton, pressed && styles.modalPrimaryButtonPressed]}
                  onPress={handleApprove}
                  disabled={isActionPending}
                >
                  <Text style={styles.modalPrimaryButtonText}>
                    {isActionPending && modalAction === 'approve' ? 'Approving…' : 'Approve bill'}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.modalLinkButton, pressed && styles.modalLinkButtonPressed]}
                  onPress={onClose}
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
  );
}

const createStyles = (palette: Palette, shadow: Shadow) =>
  StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    modalBackdrop: {
      flex: 1,
    },
    modalSheet: {
      maxHeight: '90%',
      backgroundColor: palette.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      overflow: 'hidden',
      ...shadow.depth2,
    },
    modalSheetInner: {
      maxHeight: '90%',
    },
    modalScrollContent: {
      paddingHorizontal: spacing(3),
      paddingBottom: spacing(3),
    },
    modalHeader: {
      paddingTop: spacing(3),
      paddingBottom: spacing(2),
      gap: spacing(0.5),
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: palette.text,
    },
    modalSubtitle: {
      color: palette.textSecondary,
    },
    modalLabel: {
      marginTop: spacing(2),
      marginBottom: spacing(0.5),
      fontWeight: '600',
      color: palette.text,
    },
    modalInput: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radius.md,
      padding: spacing(1.25),
      color: palette.text,
      backgroundColor: palette.surfaceElevated,
    },
    modalNotesInput: {
      minHeight: 80,
      textAlignVertical: 'top',
    },
    selectorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1),
    },
    selectorButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radius.md,
      padding: spacing(1.25),
      backgroundColor: palette.surfaceElevated,
    },
    selectorButtonPressed: {
      opacity: 0.9,
    },
    selectorValue: {
      color: palette.text,
    },
    selectorClearButton: {
      paddingVertical: spacing(1),
      paddingHorizontal: spacing(1.25),
    },
    selectorClearButtonPressed: {
      opacity: 0.8,
    },
    selectorClearButtonText: {
      color: palette.primary,
      fontWeight: '600',
    },
    statusSelectorRow: {
      flexDirection: 'row',
      gap: spacing(1),
      marginTop: spacing(1),
    },
    statusPill: {
      paddingVertical: spacing(0.75),
      paddingHorizontal: spacing(1.5),
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceElevated,
    },
    statusPillActive: {
      borderColor: palette.primary,
      backgroundColor: palette.primaryLight,
    },
    statusPillPressed: {
      opacity: 0.85,
    },
    statusPillText: {
      color: palette.text,
      fontWeight: '600',
      textTransform: 'capitalize',
    },
    statusPillTextActive: {
      color: palette.primary,
    },
    modalError: {
      color: palette.error,
      marginTop: spacing(1),
    },
    modalActions: {
      marginTop: spacing(3),
      gap: spacing(1),
    },
    modalSecondaryButton: {
      backgroundColor: palette.surfaceElevated,
      borderRadius: radius.md,
      paddingVertical: spacing(1.25),
      alignItems: 'center',
      borderWidth: 1,
      borderColor: palette.border,
    },
    modalSecondaryButtonPressed: {
      opacity: 0.9,
    },
    modalSecondaryButtonText: {
      color: palette.text,
      fontWeight: '600',
    },
    modalPrimaryButton: {
      backgroundColor: palette.primary,
      borderRadius: radius.md,
      paddingVertical: spacing(1.25),
      alignItems: 'center',
    },
    modalPrimaryButtonPressed: {
      opacity: 0.9,
    },
    modalPrimaryButtonText: {
      color: palette.onPrimary,
      fontWeight: '700',
    },
    modalLinkButton: {
      alignItems: 'center',
      paddingVertical: spacing(1),
    },
    modalLinkButtonPressed: {
      opacity: 0.8,
    },
    modalLinkButtonText: {
      color: palette.textSecondary,
      fontWeight: '500',
    }
  });
