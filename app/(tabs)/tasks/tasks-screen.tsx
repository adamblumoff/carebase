import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'nativewind';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/Button';
import { Container } from '@/components/Container';
import { TaskDetailsSheet } from '@/components/TaskDetailsSheet';
import { EditTaskSheet } from '@/components/EditTaskSheet';
import { TasksTopNav } from '@/components/TasksTopNav';

const filterOptions = ['all', 'appointment', 'bill', 'medication', 'general'] as const;
type TaskTypeFilter = (typeof filterOptions)[number];
const createTypeOptions = ['general', 'appointment', 'bill', 'medication'] as const;
type CreateTaskType = (typeof createTypeOptions)[number];

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

const badgeToneStyles: Record<string, string> = {
  neutral: 'bg-surface-strong text-text',
  muted: 'bg-surface text-text-muted',
  warn: 'bg-amber-100 text-amber-800',
};

type BadgeTone = keyof typeof badgeToneStyles;

const Badge = ({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) => (
  <View
    className={`rounded-full px-2 py-1 ${badgeToneStyles[tone]}`}
    style={{ borderRadius: 9999 }}>
    <Text className="text-[11px] font-semibold capitalize">{label}</Text>
  </View>
);

const ROW_HEIGHT = 124;

type TasksView = 'all' | 'review' | 'upcoming';

type Task = NonNullable<ReturnType<typeof trpc.tasks.listThin.useQuery>['data']>[number];

const asTaskThin = (value: any): Task => ({
  id: value.id,
  title: value.title,
  description: value.description ?? null,
  type: value.type,
  status: value.status,
  reviewState: value.reviewState,
  confidence: value.confidence ?? null,
  provider: value.provider ?? null,
  sourceLink: value.sourceLink ?? null,
  sender: value.sender ?? null,
  senderDomain: value.senderDomain ?? null,
  rawSnippet: value.rawSnippet ?? null,
  startAt: value.startAt ?? null,
  endAt: value.endAt ?? null,
  location: value.location ?? null,
  dueAt: value.dueAt ?? null,
  amount: value.amount ?? null,
  currency: value.currency ?? null,
  vendor: value.vendor ?? null,
  referenceNumber: value.referenceNumber ?? null,
  statementPeriod: value.statementPeriod ?? null,
  medicationName: value.medicationName ?? null,
  dosage: value.dosage ?? null,
  frequency: value.frequency ?? null,
  route: value.route ?? null,
  prescribingProvider: value.prescribingProvider ?? null,
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
});

export const TasksScreen = ({ view }: { view: TasksView }) => {
  useColorScheme();
  const [title, setTitle] = useState('');
  const [newTaskType, setNewTaskType] = useState<CreateTaskType>('general');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<TaskTypeFilter>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const listInput = useMemo(() => {
    const typeFilter = selectedType === 'all' ? undefined : selectedType;
    const typePart = typeFilter ? { type: typeFilter } : undefined;

    if (view === 'review') {
      return { reviewState: 'pending' as const, ...(typePart ?? {}) };
    }

    return typePart;
  }, [selectedType, view]);

  const utils = trpc.useUtils();

  const statsQuery = trpc.tasks.stats.useQuery(
    { upcomingDays: 7 },
    {
      staleTime: 5 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  );

  const listThinQuery = trpc.tasks.listThin.useQuery(listInput, {
    enabled: view !== 'upcoming',
    keepPreviousData: true,
    placeholderData: (prev) => prev,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const upcomingQuery = trpc.tasks.upcoming.useQuery(
    { days: 7 },
    {
      enabled: view === 'upcoming',
      keepPreviousData: true,
      placeholderData: (prev) => prev,
      staleTime: 2 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  );

  const tasksData = view === 'upcoming' ? upcomingQuery.data : listThinQuery.data;
  const tasksError = view === 'upcoming' ? upcomingQuery.error : listThinQuery.error;
  const tasksIsError = view === 'upcoming' ? upcomingQuery.isError : listThinQuery.isError;
  const tasksIsLoading = view === 'upcoming' ? upcomingQuery.isLoading : listThinQuery.isLoading;
  const refetchTasks = view === 'upcoming' ? upcomingQuery.refetch : listThinQuery.refetch;

  useEffect(() => {
    if (tasksIsError) {
      console.error('tasks query failed', tasksError);
    }
  }, [tasksError, tasksIsError]);

  const pendingReview = useMemo(() => {
    return tasksData?.find((item) => item.reviewState === 'pending');
  }, [tasksData]);

  const onRefresh = async () => {
    try {
      setIsRefreshing(true);
      await Promise.all([refetchTasks(), statsQuery.refetch()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const createTask = trpc.tasks.create.useMutation({
    onMutate: async (input) => {
      const optimisticId = `temp-${Date.now()}`;
      const hasFilter = !!listInput;
      await Promise.all([
        utils.tasks.listThin.cancel(),
        hasFilter ? utils.tasks.listThin.cancel(listInput) : Promise.resolve(),
      ]);

      const previousAll = utils.tasks.listThin.getData();
      const previousFiltered = hasFilter ? utils.tasks.listThin.getData(listInput) : undefined;

      const optimisticTask: Task = {
        id: optimisticId,
        title: input.title,
        description: input.description ?? null,
        type: input.type ?? 'general',
        status: input.status ?? 'todo',
        reviewState: 'approved' as const,
        sourceLink: null,
        sender: null,
        senderDomain: null,
        rawSnippet: null,
        confidence: null,
        startAt: null,
        endAt: null,
        location: null,
        amount: null,
        currency: null,
        vendor: null,
        referenceNumber: null,
        statementPeriod: null,
        medicationName: null,
        dosage: null,
        frequency: null,
        route: null,
        prescribingProvider: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      utils.tasks.listThin.setData(undefined, (current) =>
        current ? [optimisticTask, ...current] : [optimisticTask]
      );

      if (hasFilter) {
        utils.tasks.listThin.setData(listInput, (current) => {
          if (!current) return [optimisticTask];
          if (listInput?.type && listInput.type !== optimisticTask.type) return current;
          return [optimisticTask, ...current];
        });
      }

      return { previousAll, previousFiltered, optimisticId };
    },
    onError: (_error, _input, context) => {
      console.error('tasks.create failed', _error);
      if (context?.previousAll) {
        utils.tasks.listThin.setData(undefined, context.previousAll);
      }
      if (listInput && context?.previousFiltered) {
        utils.tasks.listThin.setData(listInput, context.previousFiltered);
      }
    },
    onSuccess: (task, _input, context) => {
      const thin = asTaskThin(task);
      utils.tasks.listThin.setData(undefined, (current) => {
        if (!current) return [thin];
        if (!context) return [thin, ...current];
        return current.map((item) => (item.id === context.optimisticId ? thin : item));
      });

      if (listInput) {
        utils.tasks.listThin.setData(listInput, (current) => {
          if (!current) return [thin];
          return current.map((item) => (item.id === context?.optimisticId ? thin : item));
        });
      }
    },
    onSettled: () => {
      utils.tasks.listThin.invalidate();
      utils.tasks.stats.invalidate();
      setTitle('');
      setNewTaskType('general');
      setIsCreateModalOpen(false);
    },
  });

  const closeCreateModal = () => {
    if (createTask.isLoading) return;
    setIsCreateModalOpen(false);
    setTitle('');
    setNewTaskType('general');
  };

  const deleteTask = trpc.tasks.delete.useMutation({
    onMutate: async (input) => {
      setDeletingId(input.id);
      await utils.tasks.listThin.cancel();
      const previous = utils.tasks.listThin.getData();
      utils.tasks.listThin.setData(undefined, (current) =>
        current ? current.filter((item) => item.id !== input.id) : current
      );
      utils.tasks.listThin.setData(listInput, (current) =>
        current ? current.filter((item) => item.id !== input.id) : current
      );
      utils.tasks.upcoming.setData(undefined, (current) =>
        current ? current.filter((item) => item.id !== input.id) : current
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        utils.tasks.listThin.setData(undefined, context.previous);
        utils.tasks.listThin.setData(listInput, context.previous);
      }
    },
    onSettled: () => {
      setDeletingId(null);
      utils.tasks.listThin.invalidate();
      utils.tasks.upcoming.invalidate();
      utils.tasks.stats.invalidate();
    },
  });

  const handleAddTask = () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    createTask.mutate({ title: trimmed, status: 'todo', type: newTaskType });
  };

  const confirmDelete = useCallback(
    (id: string) => {
      Alert.alert(
        'Delete task',
        'Are you sure you want to delete this task?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => deleteTask.mutate({ id }),
          },
        ],
        { cancelable: true }
      );
    },
    [deleteTask]
  );

  type TaskListItemProps = {
    item: Task;
    isDeleting: boolean;
    onToggle: (id: string) => void;
    onEdit: (task: Task) => void;
    onDelete: (id: string) => void;
    onOpenDetails: (id: string) => void;
  };

  const TaskListItem = React.memo(
    ({ item, isDeleting, onToggle, onEdit, onDelete, onOpenDetails }: TaskListItemProps) => {
      const isDone = item.status === 'done';
      return (
        <View className="rounded-lg border border-border bg-surface-strong px-4 py-3 dark:border-border-dark dark:bg-surface-card-dark">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center gap-3 pr-3">
              <Pressable
                accessibilityLabel={isDone ? 'Mark task as todo' : 'Mark task as done'}
                onPress={() => onToggle(item.id)}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.7 : 1,
                })}>
                <View
                  className={`h-6 w-6 items-center justify-center rounded-full border ${
                    isDone ? 'border-primary bg-primary' : 'border-border dark:border-border-dark'
                  }`}>
                  {isDone && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
                </View>
              </Pressable>
              <Pressable
                className="flex-1"
                accessibilityLabel="Open task details"
                onPress={() => onOpenDetails(item.id)}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
                <View className="flex-1">
                  <View className="mb-1 flex-row flex-wrap items-center gap-2">
                    <Badge label={formatType(item.type)} />
                    {item.provider ? <Badge label={item.provider} tone="muted" /> : null}
                    {item.reviewState === 'pending' ? (
                      <Badge label="Needs review" tone="warn" />
                    ) : null}
                  </View>
                  <Text className="text-base font-semibold text-text dark:text-text-dark">
                    {item.title}
                  </Text>
                  <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                    Status: {item.status.replace('_', ' ')} • Confidence{' '}
                    {formatConfidence(item.confidence)}
                  </Text>
                  {item.sender ? (
                    <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                      From {item.sender}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            </View>
            <View className="flex-row items-center gap-3">
              <Pressable
                accessibilityLabel="Edit task"
                onPress={() => onEdit(item)}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.7 : 1,
                })}>
                <Ionicons name="create-outline" size={22} color="#4A8F6A" />
              </Pressable>
              <Pressable
                accessibilityLabel="Delete task"
                onPress={() => onDelete(item.id)}
                disabled={isDeleting}
                style={({ pressed }) => ({
                  opacity: isDeleting ? 0.5 : pressed ? 0.7 : 1,
                })}>
                {isDeleting ? (
                  <ActivityIndicator color="#E06262" />
                ) : (
                  <Ionicons name="trash-outline" size={22} color="#E06262" />
                )}
              </Pressable>
            </View>
          </View>
        </View>
      );
    }
  );

  const openDetails = useCallback((id: string) => {
    setDetailsId(id);
  }, []);

  const closeDetails = useCallback(() => setDetailsId(null), []);

  const openEditSheet = useCallback((task: Task) => {
    setEditTask(task);
  }, []);

  const closeEditSheet = useCallback(() => {
    setEditTask(null);
  }, []);

  const applyTaskPatch = (updater: (task: Task) => Task) => {
    utils.tasks.listThin.setData(undefined, (current) => (current ? current.map(updater) : current));
    utils.tasks.listThin.setData(listInput, (current) => (current ? current.map(updater) : current));
    utils.tasks.upcoming.setData(undefined, (current) => (current ? current.map(updater) : current));
  };

  const getCurrentTask = (id: string) => {
    const fromFiltered = listInput
      ? utils.tasks.listThin.getData(listInput)?.find((t) => t.id === id)
      : null;
    if (fromFiltered) return fromFiltered;
    const fromAll = utils.tasks.listThin.getData()?.find((t) => t.id === id) ?? null;
    if (fromAll) return fromAll;
    return utils.tasks.upcoming.getData()?.find((t) => t.id === id) ?? null;
  };

  const toggleStatus = trpc.tasks.toggleStatus.useMutation({
    onMutate: (input) => {
      void utils.tasks.listThin.cancel();
      void utils.tasks.upcoming.cancel();

      const previousAll = utils.tasks.listThin.getData();
      const previousFiltered = listInput ? utils.tasks.listThin.getData(listInput) : undefined;

      const currentTask = getCurrentTask(input.id);
      if (!currentTask) return { previousAll, previousFiltered };

      const optimisticStatus = currentTask.status === 'done' ? 'todo' : 'done';

      applyTaskPatch((item) =>
        item.id === input.id ? { ...item, status: optimisticStatus } : item
      );

      return { previousAll, previousFiltered, optimisticStatus };
    },
    onError: (_error, _input, context) => {
      if (context?.previousAll) utils.tasks.listThin.setData(undefined, context.previousAll);
      if (listInput && context?.previousFiltered) {
        utils.tasks.listThin.setData(listInput, context.previousFiltered);
      }
    },
    onSuccess: (updated, _input, context) => {
      if (!context) return;
      const thin = asTaskThin(updated);
      applyTaskPatch((item) => {
        if (item.id !== thin.id) return item;
        if (item.status !== context.optimisticStatus) return item;
        return { ...item, ...thin };
      });
    },
    onSettled: () => {
      utils.tasks.listThin.invalidate();
      utils.tasks.upcoming.invalidate();
      utils.tasks.stats.invalidate();
    },
  });

  const handleToggleStatus = useCallback(
    (id: string) => {
      toggleStatus.mutate({ id });
    },
    [toggleStatus]
  );

  const reviewTask = trpc.tasks.review.useMutation({
    onMutate: async (input) => {
      void utils.tasks.listThin.cancel();
      void utils.tasks.upcoming.cancel();
      const previousAll = utils.tasks.listThin.getData();
      const previousFiltered = listInput ? utils.tasks.listThin.getData(listInput) : undefined;

      if (input.action === 'ignore') {
        applyTaskPatch((item) =>
          item.id === input.id ? { ...item, reviewState: 'ignored', status: 'done' } : item
        );
      } else {
        applyTaskPatch((item) =>
          item.id === input.id ? { ...item, reviewState: 'approved' } : item
        );
      }

      return { previousAll, previousFiltered };
    },
    onError: (_error, _input, context) => {
      if (context?.previousAll) utils.tasks.listThin.setData(undefined, context.previousAll);
      if (listInput && context?.previousFiltered) {
        utils.tasks.listThin.setData(listInput, context.previousFiltered);
      }
    },
    onSettled: () => {
      utils.tasks.listThin.invalidate();
      utils.tasks.upcoming.invalidate();
      utils.tasks.stats.invalidate();
    },
  });

  const handleReview = useCallback(
    (action: 'approve' | 'ignore') => {
      if (!pendingReview) return;
      reviewTask.mutate({ id: pendingReview.id, action });
    },
    [pendingReview, reviewTask]
  );

  const renderHeader = () => (
    <View className="pb-2">
      <TasksTopNav
        pendingReviewCount={statsQuery.data?.pendingReviewCount}
        upcomingCount={statsQuery.data?.upcomingCount}
      />

      {view === 'all' && pendingReview ? (
        <View className="gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-semibold text-amber-900">Needs review</Text>
            <Text className="text-xs text-amber-800">
              {formatConfidence(pendingReview.confidence)} confident
            </Text>
          </View>
          <Text className="text-sm font-semibold text-text">{pendingReview.title}</Text>
          <Text className="text-xs text-text-muted dark:text-text-muted-dark">
            From {pendingReview.sender ?? 'unknown sender'}{' '}
            {pendingReview.provider ? `• ${pendingReview.provider}` : ''}
          </Text>
          <View className="mt-3 flex-row items-center gap-3">
            <Pressable
              onPress={() => handleReview('approve')}
              disabled={reviewTask.isLoading}
              className="flex-1 items-center justify-center rounded-full bg-primary px-4 py-2"
              style={({ pressed }) => ({
                opacity: reviewTask.isLoading ? 0.6 : pressed ? 0.85 : 1,
              })}>
              {reviewTask.isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-base font-semibold text-white">Accept</Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => handleReview('ignore')}
              disabled={reviewTask.isLoading}
              className="flex-1 items-center justify-center rounded-full border border-border px-4 py-2 dark:border-border-dark"
              style={({ pressed }) => ({
                opacity: reviewTask.isLoading ? 0.6 : pressed ? 0.75 : 1,
              })}>
              <Text className="text-base font-semibold text-text">Ignore</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {view === 'all' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: 8,
            paddingRight: 8,
            alignItems: 'center',
            paddingVertical: 2,
          }}
          style={{ minHeight: 44 }}
          className="mb-2">
          {filterOptions.map((option) => {
            const isActive = selectedType === option;
            return (
              <Pressable
                key={option}
                onPress={() => setSelectedType(option)}
                className={`rounded-full border px-3 py-2 ${
                  isActive
                    ? 'border-primary bg-primary/10'
                    : 'border-border dark:border-border-dark'
                }`}
                style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
                <Text
                  className={`text-sm font-semibold ${
                    isActive ? 'text-primary' : 'text-text dark:text-text-dark'
                  }`}>
                  {option === 'all' ? 'All' : formatType(option)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {view === 'all' ? (
        <Button
          title="Add task"
          onPress={() => {
            setTitle('');
            setNewTaskType('general');
            setIsCreateModalOpen(true);
          }}
          disabled={createTask.isLoading}
        />
      ) : null}
    </View>
  );

  const renderEmpty = () => {
    if (tasksIsLoading) {
      return (
        <View className="items-center justify-center py-10">
          <ActivityIndicator />
        </View>
      );
    }

    if (tasksIsError) {
      return (
        <View className="gap-2 py-8">
          <Text className="text-base text-red-600">Could not load tasks.</Text>
          <Text className="text-xs text-text-muted dark:text-text-muted-dark">
            {(tasksError as any)?.message ?? 'Unknown error'}
          </Text>
        </View>
      );
    }

    const emptyLabel =
      view === 'review'
        ? 'No tasks need review'
        : view === 'upcoming'
          ? 'Nothing upcoming'
          : 'No tasks yet';

    return (
      <View className="items-center gap-2 py-12">
        <Ionicons name="checkmark-done-outline" size={28} color="#9CA3AF" />
        <Text className="text-base font-semibold text-text dark:text-text-dark">{emptyLabel}</Text>
        <Text className="text-xs text-text-muted dark:text-text-muted-dark">
          Add a task or wait for new emails to sync.
        </Text>
      </View>
    );
  };

  const tasksForView = useMemo(() => {
    const list = tasksData ?? [];
    if (view !== 'upcoming') return list;
    return list.filter((item) => item.type === 'appointment' || item.type === 'bill');
  }, [tasksData, view]);

  const renderItem = useCallback(
    ({ item }: { item: Task }) => (
      <TaskListItem
        item={item}
        isDeleting={deleteTask.isLoading && deletingId === item.id}
        onToggle={handleToggleStatus}
        onEdit={openEditSheet}
        onDelete={confirmDelete}
        onOpenDetails={openDetails}
      />
    ),
    [
      TaskListItem,
      confirmDelete,
      deleteTask.isLoading,
      deletingId,
      handleToggleStatus,
      openDetails,
      openEditSheet,
    ]
  );

  return (
    <View className="flex flex-1 bg-surface px-4 dark:bg-surface-dark">
      <Stack.Screen
        options={{
          title: view === 'review' ? 'Review' : view === 'upcoming' ? 'Upcoming' : 'Tasks',
        }}
      />
      <Container>
        <FlatList
          data={tasksForView}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={8}
          removeClippedSubviews
          getItemLayout={(_, index) => ({
            length: ROW_HEIGHT,
            offset: ROW_HEIGHT * index,
            index,
          })}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#4A8F6A" />
          }
          contentContainerStyle={{ paddingBottom: 24, gap: 12 }}
        />
      </Container>

      <Modal
        visible={isCreateModalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeCreateModal}
        statusBarTranslucent>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-md rounded-2xl border border-border bg-white p-5 dark:border-border-dark dark:bg-surface-card-dark">
            <Text className="mb-3 text-lg font-semibold text-text dark:text-text-dark">
              Add task
            </Text>
            <TextInput
              className="mb-4 rounded-lg border border-border bg-white px-3 text-base dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              placeholder="Task title"
              value={title}
              onChangeText={setTitle}
              autoFocus
              editable={!createTask.isLoading}
              style={{ fontSize: 15, lineHeight: 18, paddingVertical: 8 }}
            />
            <View className="mb-4 flex-row flex-wrap gap-2">
              {createTypeOptions.map((option) => {
                const isActive = newTaskType === option;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setNewTaskType(option)}
                    className={`rounded-full border px-3 py-2 ${
                      isActive
                        ? 'border-primary bg-primary/10'
                        : 'border-border dark:border-border-dark'
                    }`}
                    style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
                    <Text
                      className={`text-sm font-semibold ${
                        isActive ? 'text-primary' : 'text-text dark:text-text-dark'
                      }`}>
                      {formatType(option)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View className="flex-row items-center justify-end gap-3">
              <Pressable
                onPress={handleAddTask}
                disabled={createTask.isLoading || !title.trim()}
                className="h-10 min-w-[92px] flex-row items-center justify-center rounded-full bg-primary px-4 dark:bg-primary-deep"
                style={({ pressed }) => ({
                  opacity: createTask.isLoading || !title.trim() ? 0.5 : pressed ? 0.85 : 1,
                })}>
                {createTask.isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-base font-semibold text-white">Add</Text>
                )}
              </Pressable>
              <Pressable
                onPress={closeCreateModal}
                disabled={createTask.isLoading}
                className="h-10 flex-row items-center justify-center rounded-full px-3"
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Text className="text-base font-semibold text-text-muted dark:text-text-muted-dark">
                  Cancel
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <TaskDetailsSheet
        visible={!!detailsId}
        task={detailsId ? (getCurrentTask(detailsId) ?? null) : null}
        onClose={closeDetails}
      />

      <EditTaskSheet
        task={editTask}
        visible={!!editTask}
        onClose={closeEditSheet}
        onUpdated={(updated) => {
          applyTaskPatch((item) => (item.id === updated.id ? { ...item, ...updated } : item));
          setEditTask(null);
          setTimeout(() => {
            Alert.alert('Saved', 'Task updated successfully');
          }, 0);
        }}
      />
    </View>
  );
};
