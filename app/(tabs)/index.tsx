import { Stack } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { useColorScheme } from 'nativewind';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { trpc } from '@/lib/trpc/client';
import { Container } from '@/components/Container';
import { TaskDetailsSheet } from '@/components/TaskDetailsSheet';

export default function Home() {
  useColorScheme();
  const utils = trpc.useUtils();

  const todayQuery = trpc.today.feed.useQuery(undefined, {
    staleTime: 30 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const membershipQuery = trpc.careRecipients.my.useQuery(undefined, {
    staleTime: 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const canEdit = membershipQuery.data?.membership.role === 'owner';

  const [detailsTask, setDetailsTask] = useState<any | null>(null);

  const closeDetails = useCallback(() => setDetailsTask(null), []);

  const invalidateAll = useCallback(async () => {
    await Promise.all([
      utils.today.feed.invalidate(),
      utils.tasks.stats.invalidate({ upcomingDays: 7 }),
      utils.tasks.listThin.invalidate(),
      utils.tasks.upcoming.invalidate({ days: 7 }),
    ]);
  }, [utils]);

  const toggleStatus = trpc.tasks.toggleStatus.useMutation({
    onSuccess: () => {
      void invalidateAll();
    },
    onError: (err) => {
      Alert.alert('Could not update task', err.message);
    },
  });

  const reviewTask = trpc.tasks.review.useMutation({
    onSuccess: () => {
      void invalidateAll();
    },
    onError: (err) => {
      Alert.alert('Could not review task', err.message);
    },
  });

  const confirmIgnore = useCallback(
    (taskId: string) => {
      Alert.alert('Ignore task', 'Ignore this task?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Ignore',
          style: 'destructive',
          onPress: () => reviewTask.mutate({ id: taskId, action: 'ignore' }),
        },
      ]);
    },
    [reviewTask]
  );

  const Section = ({
    title,
    count,
    children,
  }: {
    title: string;
    count?: number;
    children: React.ReactNode;
  }) => (
    <View className="mb-5 gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-semibold text-text dark:text-text-dark">{title}</Text>
        {typeof count === 'number' ? (
          <Text className="text-xs font-semibold text-text-muted dark:text-text-muted-dark">
            {count}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );

  const TaskRow = ({ task, variant }: { task: any; variant: 'review' | 'toggle' }) => {
    const isDone = task.status === 'done';
    const busy = toggleStatus.isPending || reviewTask.isPending;

    return (
      <View className="rounded-2xl border border-border bg-surface-strong px-4 py-3 dark:border-border-dark dark:bg-surface-card-dark">
        <Pressable
          onPress={() => setDetailsTask(task)}
          className="gap-1"
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
          <Text className="text-base font-semibold text-text dark:text-text-dark">
            {task.title}
          </Text>
          <Text className="text-xs text-text-muted dark:text-text-muted-dark">
            {task.type?.toString()?.replace('_', ' ') ?? 'general'} •{' '}
            {task.reviewState === 'pending' ? 'needs review' : task.status?.replace('_', ' ')}
          </Text>
        </Pressable>

        {canEdit ? (
          <View className="mt-3 flex-row flex-wrap gap-2">
            {variant === 'review' ? (
              <>
                <Pressable
                  onPress={() => reviewTask.mutate({ id: task.id, action: 'approve' })}
                  disabled={busy}
                  className="rounded-full bg-primary px-3 py-2"
                  style={({ pressed }) => ({
                    opacity: busy ? 0.6 : pressed ? 0.85 : 1,
                  })}>
                  <Text className="text-sm font-semibold text-white">Approve</Text>
                </Pressable>
                <Pressable
                  onPress={() => confirmIgnore(task.id)}
                  disabled={busy}
                  className="rounded-full border border-border px-3 py-2 dark:border-border-dark"
                  style={({ pressed }) => ({
                    opacity: busy ? 0.6 : pressed ? 0.85 : 1,
                  })}>
                  <Text className="text-sm font-semibold text-text dark:text-text-dark">
                    Ignore
                  </Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                onPress={() => toggleStatus.mutate({ id: task.id })}
                disabled={busy}
                className={`flex-row items-center gap-2 rounded-full px-3 py-2 ${
                  isDone ? 'bg-surface' : 'bg-primary'
                }`}
                style={({ pressed }) => ({
                  opacity: busy ? 0.6 : pressed ? 0.85 : 1,
                })}>
                <Ionicons
                  name={isDone ? 'arrow-undo' : 'checkmark'}
                  size={18}
                  color={isDone ? '#111827' : '#FFFFFF'}
                />
                <Text className={`text-sm font-semibold ${isDone ? 'text-text' : 'text-white'}`}>
                  {isDone ? 'Undo' : 'Done'}
                </Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const handoffBody = todayQuery.data?.handoff?.body ?? null;

  const isRefreshing = todayQuery.isFetching && !todayQuery.isLoading;
  const onRefresh = useCallback(async () => {
    await invalidateAll();
  }, [invalidateAll]);

  const sections = useMemo(() => {
    const data = todayQuery.data;
    if (!data) return null;
    return [
      { key: 'review', title: 'Needs review', items: data.needsReview, variant: 'review' as const },
      { key: 'due', title: 'Due today', items: data.dueToday, variant: 'toggle' as const },
      {
        key: 'upcoming',
        title: 'Upcoming (7 days)',
        items: data.upcoming,
        variant: 'toggle' as const,
      },
      {
        key: 'mine',
        title: 'Assigned to me',
        items: data.assignedToMe,
        variant: 'toggle' as const,
      },
      {
        key: 'done',
        title: 'Recently completed (24h)',
        items: data.recentlyCompleted,
        variant: 'toggle' as const,
      },
    ] as const;
  }, [todayQuery.data]);

  return (
    <View className="flex flex-1 bg-surface dark:bg-surface-dark">
      <Stack.Screen options={{ title: 'Today' }} />
      <Container className="flex flex-1 px-4 pb-6 pt-4">
        {todayQuery.isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : todayQuery.isError ? (
          <View className="flex-1 items-center justify-center gap-2">
            <Text className="text-sm text-text-muted dark:text-text-muted-dark">
              Could not load Today.
            </Text>
            <Pressable
              onPress={() => todayQuery.refetch()}
              className="rounded-full bg-primary px-4 py-2"
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
              <Text className="text-sm font-semibold text-white">Retry</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
            contentContainerStyle={{ paddingBottom: 32 }}>
            <View className="mb-6 rounded-2xl border border-border bg-surface-strong p-4 dark:border-border-dark dark:bg-surface-card-dark">
              <Text className="text-base font-semibold text-text dark:text-text-dark">Handoff</Text>
              <Text className="mt-1 text-xs text-text-muted dark:text-text-muted-dark">
                {todayQuery.data.hubLocalDate} • {todayQuery.data.hubTimezone}
              </Text>
              <Text className="mt-3 text-sm leading-5 text-text dark:text-text-dark">
                {handoffBody ? handoffBody : 'No handoff note yet.'}
              </Text>
              {canEdit ? (
                <Text className="mt-3 text-xs text-text-muted dark:text-text-muted-dark">
                  Edit coming next (P1).
                </Text>
              ) : null}
            </View>

            {sections?.map((section) => (
              <Section key={section.key} title={section.title} count={section.items.length}>
                {section.items.length ? (
                  <View className="gap-3">
                    {section.items.map((task) => (
                      <TaskRow key={task.id} task={task} variant={section.variant} />
                    ))}
                  </View>
                ) : (
                  <Text className="text-sm text-text-muted dark:text-text-muted-dark">
                    Nothing here.
                  </Text>
                )}
              </Section>
            ))}
          </ScrollView>
        )}
      </Container>

      <TaskDetailsSheet visible={!!detailsTask} task={detailsTask} onClose={closeDetails} />
    </View>
  );
}
