import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/Button';
import { Container } from '@/components/Container';

export default function TasksScreen() {
  const [title, setTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const utils = trpc.useUtils();

  const tasksQuery = trpc.tasks.list.useQuery();

  useEffect(() => {
    if (tasksQuery.isError) {
      console.error('tasks.list failed', tasksQuery.error);
    }
  }, [tasksQuery.isError, tasksQuery.error]);

  const createTask = trpc.tasks.create.useMutation({
    onMutate: async (input) => {
      const optimisticId = `temp-${Date.now()}`;
      await utils.tasks.list.cancel();

      const previous = utils.tasks.list.getData();

      const optimisticTask = {
        id: optimisticId,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? 'todo',
        dueAt: null,
        careRecipientId: input.careRecipientId ?? null,
        createdById: input.createdById ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      utils.tasks.list.setData(undefined, (current) =>
        current ? [optimisticTask, ...current] : [optimisticTask]
      );

      return { previous, optimisticId };
    },
    onError: (_error, _input, context) => {
      console.error('tasks.create failed', _error);
      if (context?.previous) {
        utils.tasks.list.setData(undefined, context.previous);
      }
    },
    onSuccess: (task, _input, context) => {
      utils.tasks.list.setData(undefined, (current) => {
        if (!current) return [task];
        if (!context) return [task, ...current];

        return current.map((item) => (item.id === context.optimisticId ? task : item));
      });
    },
    onSettled: () => {
      utils.tasks.list.invalidate();
    },
  });

  const deleteTask = trpc.tasks.delete.useMutation({
    onMutate: async (input) => {
      setDeletingId(input.id);
      await utils.tasks.list.cancel();
      const previous = utils.tasks.list.getData();
      utils.tasks.list.setData(undefined, (current) =>
        current ? current.filter((item) => item.id !== input.id) : current
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        utils.tasks.list.setData(undefined, context.previous);
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

    createTask.mutate({ title: trimmed, status: 'todo' });
    setTitle('');
  };

  const confirmDelete = (id: string) => {
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
  };

  const startEdit = (id: string, currentTitle: string) => {
    setEditingId(id);
    setEditingTitle(currentTitle);
  };

  const updateTitle = trpc.tasks.updateTitle.useMutation({
    onMutate: async (input) => {
      await utils.tasks.list.cancel();
      const previous = utils.tasks.list.getData();
      utils.tasks.list.setData(undefined, (current) =>
        current
          ? current.map((item) => (item.id === input.id ? { ...item, title: input.title } : item))
          : current
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        utils.tasks.list.setData(undefined, context.previous);
      }
    },
    onSettled: () => {
      utils.tasks.list.invalidate();
      setEditingId(null);
      setEditingTitle('');
    },
  });

  const handleSaveEdit = () => {
    const trimmed = editingTitle.trim();
    if (!editingId || !trimmed) return;
    updateTitle.mutate({ id: editingId, title: trimmed });
  };

  const closeEdit = () => {
    setEditingId(null);
    setEditingTitle('');
  };

  const toggleStatus = trpc.tasks.toggleStatus.useMutation({
    onMutate: async (input) => {
      await utils.tasks.list.cancel();
      const previous = utils.tasks.list.getData();
      utils.tasks.list.setData(undefined, (current) =>
        current
          ? current.map((item) =>
              item.id === input.id
                ? { ...item, status: item.status === 'done' ? 'todo' : 'done' }
                : item
            )
          : current
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        utils.tasks.list.setData(undefined, context.previous);
      }
    },
    onSettled: () => {
      utils.tasks.list.invalidate();
    },
  });

  const handleToggleStatus = (id: string) => {
    toggleStatus.mutate({ id });
  };

  return (
    <View className="flex flex-1 bg-surface px-4 dark:bg-surface-dark">
      <Stack.Screen options={{ title: 'Tasks' }} />
      <Container>
        <View className="mb-6 mt-2 gap-3">
          <TextInput
            className="rounded-lg border border-border bg-white px-3 text-base dark:border-border-dark dark:bg-surface-card-dark dark:text-text-dark"
            placeholder="New task title"
            value={title}
            onChangeText={setTitle}
            editable={!createTask.isLoading}
            style={{ fontSize: 15, lineHeight: 18, paddingVertical: 8 }}
          />
          <Button
            title={createTask.isLoading ? 'Adding...' : 'Add task'}
            onPress={handleAddTask}
            disabled={createTask.isLoading || !title.trim()}
          />
        </View>

        {tasksQuery.isLoading ? (
          <View className="py-6">
            <ActivityIndicator />
          </View>
        ) : tasksQuery.isError ? (
          <View className="gap-2">
            <Text className="text-base text-red-600">Could not load tasks.</Text>
            <Text className="text-xs text-text-muted dark:text-text-muted-dark">
              {tasksQuery.error.message}
            </Text>
          </View>
        ) : (
          <FlatList
            data={tasksQuery.data ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
            renderItem={({ item }) => {
              const isDone = item.status === 'done';
              return (
                <View className="flex-row items-center justify-between rounded-lg border border-border bg-surface-strong px-4 py-3 dark:border-border-dark dark:bg-surface-card-dark">
                  <View className="flex-1 flex-row items-center gap-3 pr-3">
                    <Pressable
                      accessibilityLabel={isDone ? 'Mark task as todo' : 'Mark task as done'}
                      onPress={() => handleToggleStatus(item.id)}
                      style={({ pressed }) => ({
                        opacity: pressed ? 0.7 : 1,
                      })}>
                      <View
                        className={`h-6 w-6 items-center justify-center rounded-full border ${
                          isDone
                            ? 'border-primary bg-primary'
                            : 'border-border dark:border-border-dark'
                        }`}>
                        {isDone && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
                      </View>
                    </Pressable>
                    <View className="flex-1">
                      <Text className="text-base font-semibold text-text dark:text-text-dark">
                        {item.title}
                      </Text>
                      <Text className="text-sm text-text-muted dark:text-text-muted-dark">
                        Status: {item.status.replace('_', ' ')}
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row items-center gap-3">
                    <Pressable
                      accessibilityLabel="Edit task title"
                      onPress={() => startEdit(item.id, item.title)}
                      style={({ pressed }) => ({
                        opacity: pressed ? 0.7 : 1,
                      })}>
                      <Ionicons name="create-outline" size={22} color="#4A8F6A" />
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Delete task"
                      onPress={() => confirmDelete(item.id)}
                      disabled={deleteTask.isLoading && deletingId === item.id}
                      style={({ pressed }) => ({
                        opacity:
                          deleteTask.isLoading && deletingId === item.id ? 0.5 : pressed ? 0.7 : 1,
                      })}>
                      {deleteTask.isLoading && deletingId === item.id ? (
                        <ActivityIndicator color="#E06262" />
                      ) : (
                        <Ionicons name="trash-outline" size={22} color="#E06262" />
                      )}
                    </Pressable>
                  </View>
                </View>
              );
            }}
          />
        )}
      </Container>

      <Modal
        visible={!!editingId}
        transparent
        animationType="fade"
        onRequestClose={closeEdit}
        statusBarTranslucent>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-md rounded-2xl border border-border bg-white p-5 dark:border-border-dark dark:bg-surface-card-dark">
            <Text className="mb-3 text-lg font-semibold text-text dark:text-text-dark">
              Edit task
            </Text>
            <TextInput
              className="mb-4 rounded-lg border border-border bg-white px-3 text-base dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              value={editingTitle}
              onChangeText={setEditingTitle}
              autoFocus
              placeholder="Task title"
              editable={!updateTitle.isLoading}
              style={{ fontSize: 15, lineHeight: 18, paddingVertical: 8 }}
            />
            <View className="flex-row items-center justify-end gap-3">
              <Pressable
                onPress={handleSaveEdit}
                disabled={updateTitle.isLoading || !editingTitle.trim()}
                className="h-10 min-w-[72px] flex-row items-center justify-center rounded-full bg-primary px-4 dark:bg-primary-deep"
                style={({ pressed }) => ({
                  opacity: updateTitle.isLoading || !editingTitle.trim() ? 0.5 : pressed ? 0.85 : 1,
                })}>
                {updateTitle.isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-base font-semibold text-white">Save</Text>
                )}
              </Pressable>
              <Pressable
                onPress={closeEdit}
                disabled={updateTitle.isLoading}
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
    </View>
  );
}
