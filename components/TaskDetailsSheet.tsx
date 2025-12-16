import { useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Linking, Modal, Pressable, Text, View, Platform } from 'react-native';

import { trpc } from '@/lib/trpc/client';
export type TaskLike = {
  id: string;
  title: string;
  type: string | null;
  provider?: string | null;
  reviewState?: string | null;
  status: string;
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
  const taskDetailsQuery = trpc.tasks.byId.useQuery(
    { id: task?.id ?? '00000000-0000-0000-0000-000000000000' },
    {
      enabled: visible && !!task?.id,
      staleTime: 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  );

  const resolvedTask = (taskDetailsQuery.data as any as TaskLike | null) ?? task;

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
        const seconds = Math.floor(date.getTime() / 1000);
        const calUrl = `calshow:${seconds}`;
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
    </Modal>
  );
};
