import { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Linking, Modal, Pressable, Text, View, Platform } from 'react-native';

import { trpc } from '@/lib/trpc/client';
import { buildCalshowUrl } from '@/lib/calendar-links';
import { isUuid } from '@/lib/uuid';
export type TaskLike = {
  id: string;
  title: string;
  type: string | null;
  provider?: string | null;
  reviewState?: string | null;
  status: string;
  assigneeId?: string | null;
  confidence?: number | string | null;
  sender?: string | null;
  sourceLink?: string | null;
  description?: string | null;
  rawSnippet?: string | null;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
  location?: string | null;
  organizer?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  dueAt?: string | Date | null;
  vendor?: string | null;
  statementPeriod?: string | null;
  referenceNumber?: string | null;
  medicationName?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  route?: string | null;
  prescribingProvider?: string | null;
};

const formatConfidence = (value?: number | string | null) => {
  if (value === null || value === undefined) return '—';
  const parsed = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(parsed)) return '—';
  return `${Math.round(parsed * 100)}%`;
};

const formatType = (type?: string | null) => {
  if (!type) return 'General';
  return type.charAt(0).toUpperCase() + type.slice(1);
};

const toDate = (value?: Date | string | null) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateTime = (value?: Date | string | null) => {
  const date = toDate(value);
  if (!date) return null;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatRange = (start?: Date | string | null, end?: Date | string | null) => {
  const startText = formatDateTime(start);
  const endText = formatDateTime(end);
  if (startText && endText) return `${startText} – ${endText}`;
  return startText ?? endText ?? null;
};

const formatMoney = (amount?: number | string | null, currency?: string | null) => {
  if (amount === null || amount === undefined) return null;
  const num = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(num)) return null;
  const prefix = currency ?? 'USD';
  const symbol = prefix === 'USD' ? '$' : `${prefix} `;
  return `${symbol}${num.toFixed(2)}`;
};

const badgeToneStyles: Record<string, string> = {
  neutral: 'bg-surface-strong text-text',
  muted: 'bg-surface text-text-muted',
  warn: 'bg-amber-100 text-amber-800',
};

const Badge = ({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: keyof typeof badgeToneStyles;
}) => (
  <View
    className={`rounded-full px-2 py-1 ${badgeToneStyles[tone]}`}
    style={{ borderRadius: 9999 }}>
    <Text className="text-[11px] font-semibold capitalize">{label}</Text>
  </View>
);

export const TaskDetailsSheet = ({
  visible,
  task,
  onClose,
}: {
  visible: boolean;
  task: TaskLike | null;
  onClose: () => void;
}) => {
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isSnoozeOpen, setIsSnoozeOpen] = useState(false);

  const canFetchDetails = Boolean(visible && task?.id && isUuid(task.id));
  const taskDetailsQuery = trpc.tasks.byId.useQuery(
    { id: task?.id ?? '00000000-0000-0000-0000-000000000000' },
    {
      enabled: canFetchDetails,
      staleTime: 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  );

  const resolvedTask = (taskDetailsQuery.data as any as TaskLike | null) ?? task;
  const taskId = resolvedTask?.id ?? task?.id ?? null;

  const canFetchEvents = Boolean(visible && taskId && isUuid(taskId));
  const taskEventsQuery = trpc.taskEvents.list.useQuery(
    { taskId: taskId ?? '00000000-0000-0000-0000-000000000000', limit: 30 },
    {
      enabled: canFetchEvents,
      staleTime: 30 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  );

  const membershipQuery = trpc.careRecipients.my.useQuery(undefined, {
    enabled: visible,
    staleTime: 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const canEdit = membershipQuery.data?.membership?.role === 'owner';

  const teamQuery = trpc.careRecipients.team.useQuery(undefined, {
    enabled: visible && canEdit,
    staleTime: 30 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const assign = trpc.tasks.assign.useMutation({
    onSuccess: () => {
      void taskDetailsQuery.refetch();
      setIsAssignOpen(false);
    },
  });

  const snooze = trpc.tasks.snooze.useMutation({
    onSuccess: () => {
      void taskDetailsQuery.refetch();
      setIsSnoozeOpen(false);
    },
  });

  const details = useMemo(() => {
    if (!resolvedTask) return [] as { label: string; value: string | null }[];
    const items: { label: string; value: string | null }[] = [];

    if (resolvedTask.type === 'appointment') {
      items.push({ label: 'When', value: formatRange(resolvedTask.startAt, resolvedTask.endAt) });
      items.push({ label: 'Location', value: resolvedTask.location ?? null });
      items.push({ label: 'Organizer', value: resolvedTask.organizer ?? null });
    } else if (resolvedTask.type === 'bill') {
      items.push({
        label: 'Amount',
        value: formatMoney(resolvedTask.amount, resolvedTask.currency),
      });
      items.push({ label: 'Due', value: formatDateTime(resolvedTask.dueAt) });
      items.push({ label: 'Vendor', value: resolvedTask.vendor ?? null });
      items.push({ label: 'Statement Period', value: resolvedTask.statementPeriod ?? null });
      items.push({ label: 'Reference', value: resolvedTask.referenceNumber ?? null });
    } else if (resolvedTask.type === 'medication') {
      items.push({ label: 'Medication', value: resolvedTask.medicationName ?? resolvedTask.title });
      items.push({ label: 'Dosage', value: resolvedTask.dosage ?? null });
      items.push({ label: 'Frequency', value: resolvedTask.frequency ?? null });
      items.push({ label: 'Route', value: resolvedTask.route ?? null });
      items.push({ label: 'Prescriber', value: resolvedTask.prescribingProvider ?? null });
    }

    return items.filter((item) => item.value);
  }, [resolvedTask]);

  const description = resolvedTask?.description ?? resolvedTask?.rawSnippet ?? null;
  const sender = resolvedTask?.sender ? `From ${resolvedTask.sender}` : null;
  const assigneeLabel = useMemo(() => {
    if (!resolvedTask?.assigneeId) return 'Unassigned';
    const person = teamQuery.data?.find((m) => m.caregiverId === resolvedTask.assigneeId);
    return person?.name ?? person?.email ?? 'Assigned';
  }, [resolvedTask?.assigneeId, teamQuery.data]);

  const handleOpenEmail = async () => {
    if (!resolvedTask?.sourceLink) return;
    const webUrl = resolvedTask.sourceLink;

    // Best-effort: on Android try to target the Gmail app explicitly; otherwise fall back to the web URL.
    if (Platform.OS === 'android') {
      // intent://<host>/<path>#Intent;package=com.google.android.gm;scheme=https;end
      const intentUrl = `intent://${webUrl.replace(/^https?:\/\//, '')}#Intent;package=com.google.android.gm;scheme=https;end`;
      try {
        const canOpenIntent = await Linking.canOpenURL(intentUrl);
        if (canOpenIntent) {
          await Linking.openURL(intentUrl);
          return;
        }
      } catch {
        // fall through to web URL
      }
    }

    if (Platform.OS === 'ios') {
      const gmailScheme = 'googlegmail://';
      try {
        const canOpenGmail = await Linking.canOpenURL(gmailScheme);
        if (canOpenGmail) {
          await Linking.openURL(gmailScheme);
          return;
        }
      } catch {
        // fall through to web URL
      }
    }

    // iOS and fallback
    await Linking.openURL(webUrl);
  };

  const handleOpenCalendar = async () => {
    // Use event link if we have one; otherwise fall back to Google Calendar web.
    const calendarUrl = resolvedTask?.sourceLink ?? 'https://calendar.google.com';

    if (Platform.OS === 'android') {
      // Try Google Calendar app first.
      const intentUrl = `intent://${calendarUrl.replace(/^https?:\/\//, '')}#Intent;package=com.google.android.calendar;scheme=https;end`;
      try {
        const canOpenIntent = await Linking.canOpenURL(intentUrl);
        if (canOpenIntent) {
          await Linking.openURL(intentUrl);
          return;
        }
      } catch {
        // fall back
      }
    }

    if (Platform.OS === 'ios') {
      // Try known Google Calendar URL schemes (undocumented but used in practice).
      const schemes = [
        'comgooglecalendar://',
        'googlecalendar://',
        'com.google.calendar://',
        'vnd.google.calendar://',
      ];
      for (const scheme of schemes) {
        try {
          const canOpen = await Linking.canOpenURL(scheme);
          if (canOpen) {
            await Linking.openURL(scheme);
            return;
          }
        } catch {
          // continue to next scheme
        }
      }
      // Fall back to default iOS Calendar if Google Calendar isn't available.
      if (resolvedTask?.startAt) {
        const date = new Date(resolvedTask.startAt);
        const calUrl = buildCalshowUrl(date);
        try {
          const canOpen = await Linking.canOpenURL(calUrl);
          if (canOpen) {
            await Linking.openURL(calUrl);
            return;
          }
        } catch {
          // fall through
        }
      }
      try {
        const defaultCal = 'calshow://';
        const canOpen = await Linking.canOpenURL(defaultCal);
        if (canOpen) {
          await Linking.openURL(defaultCal);
          return;
        }
      } catch {
        // fall through
      }
    }

    await Linking.openURL(calendarUrl);
  };

  const formatEvent = (event: any) => {
    const actor = event?.actor?.name ?? event?.actor?.email ?? 'Someone';
    const when = formatDateTime(event?.createdAt) ?? '';
    const type = event?.type as string | undefined;
    const payload = event?.payload as any;

    const base = (() => {
      if (type === 'created') return 'Created task';
      if (type === 'reviewed') {
        const action = payload?.action;
        if (action === 'approved') return 'Approved task';
        if (action === 'ignored') return 'Ignored task';
        return 'Reviewed task';
      }
      if (type === 'status_toggled') {
        const to = payload?.toStatus;
        if (to === 'done') return 'Marked done';
        if (to === 'todo') return 'Reopened';
        return 'Updated status';
      }
      if (type === 'assigned') {
        const to = payload?.toAssigneeId;
        return to ? 'Assigned task' : 'Unassigned task';
      }
      if (type === 'snoozed') {
        const days = payload?.days;
        if (typeof days === 'number') return `Snoozed ${days} day${days === 1 ? '' : 's'}`;
        return 'Snoozed';
      }
      if (type === 'updated_details') return 'Edited details';
      return 'Updated task';
    })();

    return `${base} • ${actor}${when ? ` • ${when}` : ''}`;
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View className="flex-1 bg-transparent">
        <Pressable className="flex-1" onPress={onClose} />
        <View className="max-h-[80%] rounded-t-3xl border border-border bg-white px-5 pb-8 pt-5 dark:border-border-dark dark:bg-surface-card-dark">
          <View className="mb-4 flex-row items-start justify-between gap-3">
            <View className="flex-1 gap-1">
              <Text className="text-base font-semibold text-text dark:text-text-dark">
                Task details
              </Text>
              <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                Tap outside to close
              </Text>
            </View>
            <Pressable onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <Ionicons name="close" size={22} color="#111827" />
            </Pressable>
          </View>

          {!resolvedTask ? (
            <Text className="text-sm text-text-muted">Task not available.</Text>
          ) : (
            <View className="gap-3">
              <View className="gap-2">
                <View className="flex-row flex-wrap items-center gap-2">
                  <Badge label={formatType(resolvedTask.type)} />
                  {resolvedTask.provider ? (
                    <Badge label={resolvedTask.provider} tone="muted" />
                  ) : null}
                  {resolvedTask.reviewState === 'pending' ? (
                    <Badge label="Needs review" tone="warn" />
                  ) : null}
                </View>
                <Text className="text-lg font-semibold text-text dark:text-text-dark">
                  {resolvedTask.title}
                </Text>
                <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                  Status: {resolvedTask.status.replace('_', ' ')} • Confidence{' '}
                  {formatConfidence(resolvedTask.confidence)}
                </Text>
              </View>

              {taskDetailsQuery.isFetching ? (
                <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                  Loading details…
                </Text>
              ) : null}

              <View className="flex-row gap-3">
                <Text className="w-28 text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted-dark">
                  Assigned
                </Text>
                <Text className="flex-1 text-sm text-text dark:text-text-dark">
                  {assigneeLabel}
                </Text>
              </View>

              {details.length ? (
                <View className="gap-2">
                  {details.map((item) => (
                    <View key={`${resolvedTask.id}-${item.label}`} className="flex-row gap-3">
                      <Text className="w-28 text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted-dark">
                        {item.label}
                      </Text>
                      <Text className="flex-1 text-sm text-text dark:text-text-dark">
                        {item.value}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {description ? (
                <View className="gap-1">
                  <Text className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted-dark">
                    Details
                  </Text>
                  <Text className="text-sm leading-5 text-text dark:text-text-dark">
                    {description}
                  </Text>
                </View>
              ) : null}

              {sender ? (
                <Text className="text-xs text-text-muted dark:text-text-muted-dark">{sender}</Text>
              ) : null}

              <View className="gap-1">
                <Text className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted-dark">
                  History
                </Text>
                {taskEventsQuery.isLoading ? (
                  <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                    Loading…
                  </Text>
                ) : taskEventsQuery.data?.length ? (
                  <View className="gap-1">
                    {taskEventsQuery.data.map((event: any) => (
                      <Text
                        key={event.id}
                        className="text-xs leading-5 text-text-muted dark:text-text-muted-dark">
                        {formatEvent(event)}
                      </Text>
                    ))}
                  </View>
                ) : (
                  <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                    No history yet.
                  </Text>
                )}
              </View>

              {canEdit ? (
                <View className="flex-row flex-wrap gap-3">
                  <Pressable
                    onPress={() => setIsAssignOpen(true)}
                    disabled={assign.isPending}
                    className="items-center justify-center rounded-full border border-border px-3 py-2 dark:border-border-dark"
                    style={({ pressed }) => ({
                      opacity: assign.isPending ? 0.6 : pressed ? 0.75 : 1,
                    })}>
                    <Text className="text-sm font-semibold text-primary">Assign</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setIsSnoozeOpen(true)}
                    disabled={snooze.isPending}
                    className="items-center justify-center rounded-full border border-border px-3 py-2 dark:border-border-dark"
                    style={({ pressed }) => ({
                      opacity: snooze.isPending ? 0.6 : pressed ? 0.75 : 1,
                    })}>
                    <Text className="text-sm font-semibold text-primary">Snooze</Text>
                  </Pressable>
                </View>
              ) : null}

              {resolvedTask.type === 'appointment' ? (
                <View className="flex-row gap-3">
                  <Pressable
                    onPress={handleOpenCalendar}
                    className="flex-1 items-center justify-center rounded-full border border-border px-3 py-2 dark:border-border-dark"
                    style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
                    <Text className="text-sm font-semibold text-primary">Open in Calendar</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleOpenEmail}
                    className="flex-1 items-center justify-center rounded-full border border-border px-3 py-2 dark:border-border-dark"
                    style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
                    <Text className="text-sm font-semibold text-primary">Open in Gmail</Text>
                  </Pressable>
                </View>
              ) : resolvedTask.sourceLink ? (
                <Pressable
                  onPress={handleOpenEmail}
                  className="self-start rounded-full border border-border px-3 py-1.5 dark:border-border-dark"
                  style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
                  <Text className="text-sm font-semibold text-primary">Open in Gmail</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      </View>

      <Modal
        visible={visible && isAssignOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsAssignOpen(false)}
        statusBarTranslucent>
        <Pressable
          className="flex-1 items-center justify-center bg-black/40 px-6"
          onPress={() => setIsAssignOpen(false)}>
          <Pressable
            onPress={() => {}}
            className="w-full max-w-md rounded-2xl border border-border bg-white p-5 dark:border-border-dark dark:bg-surface-card-dark">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-text dark:text-text-dark">
                Assign task
              </Text>
              <Pressable
                onPress={() => setIsAssignOpen(false)}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Ionicons name="close" size={20} color="#9CA3AF" />
              </Pressable>
            </View>

            <Pressable
              onPress={() =>
                resolvedTask && assign.mutate({ taskId: resolvedTask.id, caregiverId: null })
              }
              disabled={!resolvedTask || assign.isPending}
              className="mb-2 rounded-2xl border border-border px-4 py-3 dark:border-border-dark"
              style={({ pressed }) => ({ opacity: assign.isPending ? 0.6 : pressed ? 0.85 : 1 })}>
              <Text className="text-sm font-semibold text-text dark:text-text-dark">
                Unassigned
              </Text>
            </Pressable>

            {(teamQuery.data ?? []).map((member) => {
              const isActive = resolvedTask?.assigneeId === member.caregiverId;
              return (
                <Pressable
                  key={member.caregiverId}
                  onPress={() =>
                    resolvedTask &&
                    assign.mutate({ taskId: resolvedTask.id, caregiverId: member.caregiverId })
                  }
                  disabled={!resolvedTask || assign.isPending}
                  className={`mb-2 rounded-2xl border px-4 py-3 ${
                    isActive
                      ? 'border-primary bg-primary/10'
                      : 'border-border dark:border-border-dark'
                  }`}
                  style={({ pressed }) => ({
                    opacity: assign.isPending ? 0.6 : pressed ? 0.85 : 1,
                  })}>
                  <Text
                    className={`text-sm font-semibold ${
                      isActive ? 'text-primary' : 'text-text dark:text-text-dark'
                    }`}>
                    {member.name ?? member.email}
                  </Text>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={visible && isSnoozeOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsSnoozeOpen(false)}
        statusBarTranslucent>
        <Pressable
          className="flex-1 items-center justify-center bg-black/40 px-6"
          onPress={() => setIsSnoozeOpen(false)}>
          <Pressable
            onPress={() => {}}
            className="w-full max-w-md rounded-2xl border border-border bg-white p-5 dark:border-border-dark dark:bg-surface-card-dark">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-text dark:text-text-dark">Snooze</Text>
              <Pressable
                onPress={() => setIsSnoozeOpen(false)}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Ionicons name="close" size={20} color="#9CA3AF" />
              </Pressable>
            </View>

            {[1, 3, 7].map((days) => (
              <Pressable
                key={days}
                onPress={() => resolvedTask && snooze.mutate({ id: resolvedTask.id, days })}
                disabled={!resolvedTask || snooze.isPending}
                className="mb-2 rounded-2xl border border-border px-4 py-3 dark:border-border-dark"
                style={({ pressed }) => ({
                  opacity: snooze.isPending ? 0.6 : pressed ? 0.85 : 1,
                })}>
                <Text className="text-sm font-semibold text-text dark:text-text-dark">
                  Snooze {days} day{days === 1 ? '' : 's'}
                </Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
};
