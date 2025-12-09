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

export default function TasksScreen() {
  useColorScheme();
  const [title, setTitle] = useState('');
  const [newTaskType, setNewTaskType] = useState<CreateTaskType>('general');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<TaskTypeFilter>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const listInput = useMemo(
    () => (selectedType === 'all' ? undefined : { type: selectedType }),
    [selectedType]
  );
  const utils = trpc.useUtils();

  const tasksQuery = trpc.tasks.list.useQuery(listInput, {
    keepPreviousData: true,
    placeholderData: (prev) => prev,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (tasksQuery.isError) {
      console.error('tasks.list failed', tasksQuery.error);
    }
  }, [tasksQuery.isError, tasksQuery.error]);

  const pendingReview = useMemo(() => {
    return tasksQuery.data?.find((item) => item.reviewState === 'pending');
  }, [tasksQuery.data]);

  const onRefresh = async () => {
    try {
      setIsRefreshing(true);
      await tasksQuery.refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const createTask = trpc.tasks.create.useMutation({
    onMutate: async (input) => {
      const optimisticId = `temp-${Date.now()}`;
      const hasFilter = !!listInput;
      await Promise.all([
        utils.tasks.list.cancel(),
        hasFilter ? utils.tasks.list.cancel(listInput) : Promise.resolve(),
      ]);

      const previousAll = utils.tasks.list.getData();
      const previousFiltered = hasFilter ? utils.tasks.list.getData(listInput) : undefined;

      const optimisticTask = {
        id: optimisticId,
        title: input.title,
        description: input.description ?? null,
        type: input.type ?? 'general',
        status: input.status ?? 'todo',
        reviewState: 'approved' as const,
        dueAt: input.dueAt ?? null,
        provider: null,
        sourceId: null,
        sourceLink: null,
        sender: null,
        rawSnippet: null,
        confidence: null,
        syncedAt: null,
        ingestionId: null,
        careRecipientId: input.careRecipientId ?? null,
        createdById: null,
        startAt: null,
        endAt: null,
        location: null,
        organizer: null,
        attendees: null,
        amount: null,
        currency: null,
        vendor: null,
        referenceNumber: null,
        statementPeriod: null,
        medicationName: null,
        dosage: null,
        frequency: null,
        route: null,
        nextDoseAt: null,
        prescribingProvider: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      utils.tasks.list.setData(undefined, (current) =>
        current ? [optimisticTask, ...current] : [optimisticTask]
      );

      if (hasFilter) {
        utils.tasks.list.setData(listInput, (current) => {
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
        utils.tasks.list.setData(undefined, context.previousAll);
      }
      if (listInput && context?.previousFiltered) {
        utils.tasks.list.setData(listInput, context.previousFiltered);
      }
    },
    onSuccess: (task, _input, context) => {
      utils.tasks.list.setData(undefined, (current) => {
        if (!current) return [task];
        if (!context) return [task, ...current];
        return current.map((item) => (item.id === context.optimisticId ? task : item));
      });

      if (listInput) {
        utils.tasks.list.setData(listInput, (current) => {
          if (!current) return [task];
          return current.map((item) => (item.id === context?.optimisticId ? task : item));
        });
      }
    },
    onSettled: () => {
      utils.tasks.list.invalidate();
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
      await utils.tasks.list.cancel();
      const previous = utils.tasks.list.getData();
      utils.tasks.list.setData(undefined, (current) =>
        current ? current.filter((item) => item.id !== input.id) : current
      );
      utils.tasks.list.setData(listInput, (current) =>
        current ? current.filter((item) => item.id !== input.id) : current
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        utils.tasks.list.setData(undefined, context.previous);
        utils.tasks.list.setData(listInput, context.previous);
      }
    },
    onSettled: () => {
      setDeletingId(null);
      utils.tasks.list.invalidate();
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

  type Task = NonNullable<typeof tasksQuery.data>[number];

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

  const startEdit = useCallback(
    (task: Task) => {
      openEditSheet(task);
    },
    [openEditSheet]
  );

  const applyTaskPatch = (updater: (task: Task) => Task) => {
    utils.tasks.list.setData(undefined, (current) => (current ? current.map(updater) : current));
    utils.tasks.list.setData(listInput, (current) => (current ? current.map(updater) : current));
  };

  const getCurrentTask = (id: string) => {
    const fromFiltered = listInput
      ? utils.tasks.list.getData(listInput)?.find((t) => t.id === id)
      : null;
    if (fromFiltered) return fromFiltered;
    return utils.tasks.list.getData()?.find((t) => t.id === id) ?? null;
  };

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

  const toggleStatus = trpc.tasks.toggleStatus.useMutation({
    onMutate: (input) => {
      // Fire-and-forget cancel so optimistic UI is instant.
      void utils.tasks.list.cancel();

      const previousAll = utils.tasks.list.getData();
      const previousFiltered = listInput ? utils.tasks.list.getData(listInput) : undefined;

      const currentTask = getCurrentTask(input.id);
      const targetStatus = currentTask?.status === 'done' ? 'todo' : 'done';

      applyTaskPatch((item) =>
        item.id === input.id
          ? { ...item, status: targetStatus, updatedAt: new Date().toISOString() }
          : item
      );

      return { previousAll, previousFiltered, targetStatus };
    },
    onError: (_error, input, context) => {
      if (!context) return;
      // Only roll back if the cache still reflects this optimistic toggle (user may have toggled again).
      const stillOptimistic = getCurrentTask(input.id)?.status === context.targetStatus;
      if (!stillOptimistic) return;

      utils.tasks.list.setData(undefined, context.previousAll);
      if (listInput) {
        utils.tasks.list.setData(listInput, context.previousFiltered ?? context.previousAll);
      }
    },
    onSuccess: (task, input, context) => {
      if (!context) return;
      // Skip stale success if user already toggled again.
      const stillOptimistic = getCurrentTask(input.id)?.status === context.targetStatus;
      if (!stillOptimistic) return;

      applyTaskPatch((item) => (item.id === task.id ? task : item));
    },
    onSettled: () => {
      // Low-priority resync; keeps UI snappy while reconciling with server state.
      void utils.tasks.list.invalidate();
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
      await Promise.all([utils.tasks.list.cancel(listInput), utils.tasks.list.cancel()]);
      const previousSpecific = utils.tasks.list.getData(listInput);
      const previousAll = utils.tasks.list.getData();

      const updateReview = (current: typeof previousSpecific) => {
        if (!current) return current;
        if (input.action === 'ignore') return current.filter((item) => item.id !== input.id);
        return current.map((item) =>
          item.id === input.id
            ? {
                ...item,
                reviewState: 'approved',
                status: item.status,
              }
            : item
        );
      };

      utils.tasks.list.setData(listInput, updateReview);
      utils.tasks.list.setData(undefined, updateReview);

      return { previousSpecific, previousAll };
    },
    onError: (_error, _input, context) => {
      if (context?.previousSpecific) {
        utils.tasks.list.setData(listInput, context.previousSpecific);
      }
      if (context?.previousAll) {
        utils.tasks.list.setData(undefined, context.previousAll);
      }
    },
    onSettled: () => {
      utils.tasks.list.invalidate(listInput);
      utils.tasks.list.invalidate();
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
    <View className="gap-4 pb-4">
      {pendingReview ? (
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
                isActive ? 'border-primary bg-primary/10' : 'border-border dark:border-border-dark'
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

      <Button
        title="Add task"
        onPress={() => {
          setTitle('');
          setNewTaskType('general');
          setIsCreateModalOpen(true);
        }}
        disabled={createTask.isLoading}
      />
    </View>
  );

  const renderEmpty = () => {
    if (tasksQuery.isLoading) {
      return (
        <View className="items-center justify-center py-10">
          <ActivityIndicator />
        </View>
      );
    }

    if (tasksQuery.isError) {
      return (
        <View className="gap-2 py-8">
          <Text className="text-base text-red-600">Could not load tasks.</Text>
          <Text className="text-xs text-text-muted dark:text-text-muted-dark">
            {tasksQuery.error.message}
          </Text>
        </View>
      );
    }

    return (
      <View className="items-center gap-2 py-12">
        <Ionicons name="checkmark-done-outline" size={28} color="#9CA3AF" />
        <Text className="text-base font-semibold text-text dark:text-text-dark">No tasks yet</Text>
        <Text className="text-xs text-text-muted dark:text-text-muted-dark">
          Add a task or wait for new emails to sync.
        </Text>
      </View>
    );
  };

  const renderItem = useCallback(
    ({ item }: { item: Task }) => (
      <TaskListItem
        item={item}
        isDeleting={deleteTask.isLoading && deletingId === item.id}
        onToggle={handleToggleStatus}
        onEdit={startEdit}
        onDelete={confirmDelete}
        onOpenDetails={openDetails}
      />
    ),
    [confirmDelete, deleteTask.isLoading, deletingId, handleToggleStatus, openDetails, startEdit]
  );

  return (
    <View className="flex flex-1 bg-surface px-4 dark:bg-surface-dark">
      <Stack.Screen options={{ title: 'Tasks' }} />
      <Container>
        <FlatList
          data={tasksQuery.data ?? []}
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
            <RefreshControl
              refreshing={isRefreshing || tasksQuery.isRefetching}
              onRefresh={onRefresh}
              tintColor="#4A8F6A"
            />
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
}
