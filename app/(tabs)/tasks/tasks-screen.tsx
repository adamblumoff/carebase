import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme } from 'nativewind';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { trpc } from '@/lib/trpc/client';
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
  assigneeId: value.assigneeId ?? null,
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
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
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

  const hubQuery = trpc.careRecipients.my.useQuery(undefined, {
    staleTime: 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const canEdit = hubQuery.data?.membership.role === 'owner';

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
        assigneeId: null,
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
    canEdit: boolean;
  };

  const TaskListItem = React.memo(
    ({
      item,
      isDeleting,
      onToggle,
      onEdit,
      onDelete,
      onOpenDetails,
      canEdit,
    }: TaskListItemProps) => {
      const isDone = item.status === 'done';
      const canToggle = canEdit && view !== 'review';
      return (
        <View className="rounded-lg border border-border bg-surface-strong px-4 py-3 dark:border-border-dark dark:bg-surface-card-dark">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center gap-3 pr-3">
              <Pressable
                accessibilityLabel={isDone ? 'Mark task as todo' : 'Mark task as done'}
                onPress={() => onToggle(item.id)}
                disabled={!canToggle}
                style={({ pressed }) => ({
                  opacity: !canToggle ? 0.4 : pressed ? 0.7 : 1,
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

                  {view === 'review' ? (
                    <View className="mt-3 flex-row items-center gap-2">
                      {canEdit ? (
                        <>
                          <Pressable
                            onPress={() => handleReview(item.id, 'approve')}
                            disabled={reviewTask.isLoading || suppressSender.isLoading}
                            className="flex-1 items-center justify-center rounded-full bg-primary px-3 py-2"
                            style={({ pressed }) => ({
                              opacity:
                                reviewTask.isLoading || suppressSender.isLoading
                                  ? 0.6
                                  : pressed
                                    ? 0.85
                                    : 1,
                            })}>
                            <Text className="text-sm font-semibold text-white">Accept</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => confirmIgnore(item)}
                            disabled={reviewTask.isLoading || suppressSender.isLoading}
                            className="flex-1 items-center justify-center rounded-full border border-border px-3 py-2 dark:border-border-dark"
                            style={({ pressed }) => ({
                              opacity:
                                reviewTask.isLoading || suppressSender.isLoading
                                  ? 0.6
                                  : pressed
                                    ? 0.75
                                    : 1,
                            })}>
                            <Text className="text-sm font-semibold text-text">Ignore</Text>
                          </Pressable>
                        </>
                      ) : (
                        <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                          Waiting for the hub owner to review.
                        </Text>
                      )}
                    </View>
                  ) : null}
                </View>
              </Pressable>
            </View>
            {view !== 'review' && canEdit ? (
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
            ) : null}
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
    utils.tasks.listThin.setData(undefined, (current) =>
      current ? current.map(updater) : current
    );
    utils.tasks.listThin.setData(listInput, (current) =>
      current ? current.map(updater) : current
    );
    utils.tasks.upcoming.setData(undefined, (current) =>
      current ? current.map(updater) : current
    );
  };

  const removeTaskFromListThinCaches = (
    id: string,
    targetListInput: typeof listInput,
    options?: { includeAll?: boolean }
  ) => {
    if (options?.includeAll) {
      utils.tasks.listThin.setData(undefined, (current) =>
        current ? current.filter((item) => item.id !== id) : current
      );
    }

    utils.tasks.listThin.setData(targetListInput, (current) =>
      current ? current.filter((item) => item.id !== id) : current
    );
  };

  const removeTaskFromUpcomingCache = (id: string) => {
    utils.tasks.upcoming.setData(undefined, (current) =>
      current ? current.filter((item) => item.id !== id) : current
    );
  };

  const applyTaskPatchNonPendingListInput = (
    updater: (task: Task) => Task,
    targetListInput: typeof listInput
  ) => {
    utils.tasks.listThin.setData(undefined, (current) =>
      current ? current.map(updater) : current
    );
    if (targetListInput && targetListInput.reviewState !== 'pending') {
      utils.tasks.listThin.setData(targetListInput, (current) =>
        current ? current.map(updater) : current
      );
    }
    utils.tasks.upcoming.setData(undefined, (current) =>
      current ? current.map(updater) : current
    );
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

  const optimisticReviewRef = useRef(new Map<string, number>());

  const reviewTask = trpc.tasks.review.useMutation({
    onMutate: (input) => {
      void utils.tasks.listThin.cancel();
      void utils.tasks.upcoming.cancel();

      const stamp = Date.now();
      optimisticReviewRef.current.set(input.id, stamp);

      const listInputAtMutate = listInput;
      const previousAll = utils.tasks.listThin.getData();
      const previousFiltered = listInputAtMutate
        ? utils.tasks.listThin.getData(listInputAtMutate)
        : undefined;
      const previousUpcoming = utils.tasks.upcoming.getData();
      const statsInput = { upcomingDays: 7 };
      const previousStats = utils.tasks.stats.getData(statsInput);

      const currentTask = getCurrentTask(input.id);
      const wasPendingReview = currentTask?.reviewState === 'pending';
      const wasUpcoming = !!previousUpcoming?.some((item) => item.id === input.id);

      if (input.action === 'ignore') {
        removeTaskFromListThinCaches(input.id, listInputAtMutate, { includeAll: true });
        removeTaskFromUpcomingCache(input.id);
      } else {
        if (listInputAtMutate?.reviewState === 'pending') {
          removeTaskFromListThinCaches(input.id, listInputAtMutate);
          applyTaskPatchNonPendingListInput(
            (item) => (item.id === input.id ? { ...item, reviewState: 'approved' } : item),
            listInputAtMutate
          );
        } else {
          applyTaskPatch((item) =>
            item.id === input.id ? { ...item, reviewState: 'approved' } : item
          );
        }
      }

      if (previousStats) {
        utils.tasks.stats.setData(statsInput, (current) => {
          if (!current) return current;
          const pendingDelta = wasPendingReview && current.pendingReviewCount > 0 ? 1 : 0;
          return {
            pendingReviewCount: Math.max(0, current.pendingReviewCount - pendingDelta),
            upcomingCount: wasUpcoming
              ? Math.max(0, current.upcomingCount - 1)
              : current.upcomingCount,
          };
        });
      }

      return {
        previousAll,
        previousFiltered,
        previousUpcoming,
        previousStats,
        stamp,
        listInputAtMutate,
      };
    },
    onError: (_error, _input, context) => {
      if (!context) return;
      if (optimisticReviewRef.current.get(_input.id) !== context.stamp) return;

      if (context?.previousAll) utils.tasks.listThin.setData(undefined, context.previousAll);
      if (context?.listInputAtMutate && context?.previousFiltered) {
        utils.tasks.listThin.setData(context.listInputAtMutate, context.previousFiltered);
      }
      if (context?.previousUpcoming) {
        utils.tasks.upcoming.setData(undefined, context.previousUpcoming);
      }
      if (context?.previousStats) {
        utils.tasks.stats.setData({ upcomingDays: 7 }, context.previousStats);
      }
    },
    onSuccess: (updated, input, context) => {
      if (!context) return;
      if (optimisticReviewRef.current.get(input.id) !== context.stamp) return;
      optimisticReviewRef.current.delete(input.id);

      if (input.action === 'ignore') {
        removeTaskFromListThinCaches(input.id, context.listInputAtMutate, { includeAll: true });
        removeTaskFromUpcomingCache(input.id);
        return;
      }

      const thin = asTaskThin(updated);
      utils.tasks.listThin.setData(undefined, (current) =>
        current
          ? current.map((item) => {
              if (item.id !== thin.id) return item;
              if (item.reviewState !== 'approved') return item;
              return { ...item, ...thin };
            })
          : current
      );

      if (context.listInputAtMutate && context.listInputAtMutate.reviewState !== 'pending') {
        utils.tasks.listThin.setData(context.listInputAtMutate, (current) =>
          current
            ? current.map((item) => {
                if (item.id !== thin.id) return item;
                if (item.reviewState !== 'approved') return item;
                return { ...item, ...thin };
              })
            : current
        );
      }
    },
    onSettled: () => {
      utils.tasks.listThin.invalidate();
      utils.tasks.upcoming.invalidate();
      utils.tasks.stats.invalidate();
    },
  });

  const handleReview = useCallback(
    (id: string, action: 'approve' | 'ignore') => {
      reviewTask.mutate({ id, action });
    },
    [reviewTask]
  );

  const suppressSender = trpc.senderSuppressions.suppress.useMutation({
    onSuccess: () => {
      utils.senderSuppressions.list.invalidate();
    },
  });

  const confirmIgnore = useCallback(
    (item: Task) => {
      Alert.alert(
        'Ignore task',
        item.senderDomain
          ? `Ignore this task, or always ignore future emails from ${item.senderDomain}?`
          : 'Ignore this task?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Ignore',
            style: 'destructive',
            onPress: () => handleReview(item.id, 'ignore'),
          },
          ...(item.senderDomain
            ? [
                {
                  text: 'Always ignore sender',
                  style: 'destructive' as const,
                  onPress: () => {
                    handleReview(item.id, 'ignore');
                    suppressSender.mutate(
                      { senderDomain: item.senderDomain! },
                      {
                        onError: (err: any) => {
                          Alert.alert('Could not suppress sender', err?.message ?? 'Unknown error');
                        },
                      }
                    );
                  },
                },
              ]
            : []),
        ],
        { cancelable: true }
      );
    },
    [handleReview, suppressSender]
  );

  const renderHeader = () => (
    <View className="pb-2">
      <View className="mb-3 flex-row items-center gap-2">
        <TasksTopNav
          pendingReviewCount={statsQuery.data?.pendingReviewCount}
          upcomingCount={statsQuery.data?.upcomingCount}
        />
        <Pressable
          accessibilityLabel="Filter tasks"
          onPress={() => setIsFilterModalOpen(true)}
          className="h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-strong dark:border-border-dark dark:bg-surface-card-dark"
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
          <Ionicons name="options-outline" size={20} color="#4A8F6A" />
        </Pressable>
      </View>

      {selectedType !== 'all' ? (
        <View className="mb-2 flex-row">
          <Pressable
            accessibilityLabel="Clear type filter"
            onPress={() => setSelectedType('all')}
            className="flex-row items-center gap-2 rounded-full border border-border bg-surface-strong px-3 py-2 dark:border-border-dark dark:bg-surface-card-dark"
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
            <Text className="text-sm font-semibold text-text dark:text-text-dark">
              Type: {formatType(selectedType)}
            </Text>
            <Ionicons name="close" size={16} color="#9CA3AF" />
          </Pressable>
        </View>
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
          {canEdit
            ? 'Add a task or wait for new emails to sync.'
            : 'Wait for the hub owner to add tasks or sync email.'}
        </Text>
      </View>
    );
  };

  const tasksForView = useMemo(() => {
    const list = tasksData ?? [];
    const typeFilter = selectedType === 'all' ? null : selectedType;

    if (view === 'upcoming') {
      const upcomingList = list.filter(
        (item) => item.type === 'appointment' || item.type === 'bill'
      );
      return typeFilter ? upcomingList.filter((item) => item.type === typeFilter) : upcomingList;
    }

    return typeFilter ? list.filter((item) => item.type === typeFilter) : list;
  }, [selectedType, tasksData, view]);

  const renderItem = useCallback(
    ({ item }: { item: Task }) => (
      <TaskListItem
        item={item}
        isDeleting={deleteTask.isLoading && deletingId === item.id}
        onToggle={handleToggleStatus}
        onEdit={openEditSheet}
        onDelete={confirmDelete}
        onOpenDetails={openDetails}
        canEdit={canEdit}
      />
    ),
    [
      TaskListItem,
      canEdit,
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
          scrollIndicatorInsets={{ top: 92 }}
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
          contentContainerStyle={{ paddingBottom: 24, gap: 12, paddingRight: 12 }}
        />
      </Container>

      <Modal
        visible={isFilterModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsFilterModalOpen(false)}
        statusBarTranslucent>
        <Pressable className="flex-1 bg-transparent" onPress={() => setIsFilterModalOpen(false)}>
          <Pressable
            className="absolute bottom-0 w-full rounded-t-3xl border border-border bg-white px-5 pb-8 pt-4 dark:border-border-dark dark:bg-surface-card-dark"
            onPress={() => {}}>
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-text dark:text-text-dark">Filter</Text>
              <Pressable
                accessibilityLabel="Close filters"
                onPress={() => setIsFilterModalOpen(false)}
                className="h-9 w-9 items-center justify-center rounded-full"
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Ionicons name="close" size={20} color="#9CA3AF" />
              </Pressable>
            </View>

            <Text className="mb-2 text-xs font-semibold text-text-muted dark:text-text-muted-dark">
              Type
            </Text>

            <View className="gap-2">
              {filterOptions.map((option) => {
                const active = selectedType === option;
                const label = option === 'all' ? 'All types' : formatType(option);

                return (
                  <Pressable
                    key={option}
                    onPress={() => {
                      setSelectedType(option);
                      setIsFilterModalOpen(false);
                    }}
                    className={`flex-row items-center justify-between rounded-2xl border px-4 py-3 ${
                      active
                        ? 'border-primary bg-primary/10'
                        : 'border-border dark:border-border-dark'
                    }`}
                    style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
                    <Text
                      className={`text-sm font-semibold ${
                        active ? 'text-primary' : 'text-text dark:text-text-dark'
                      }`}>
                      {label}
                    </Text>
                    {active ? (
                      <Ionicons name="checkmark" size={20} color="#4A8F6A" />
                    ) : (
                      <View style={{ width: 20, height: 20 }} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

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
