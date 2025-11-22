import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/Button';
import { Container } from '@/components/Container';
import { ScreenContent } from '@/components/ScreenContent';

export default function TasksScreen() {
  const [title, setTitle] = useState('');
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

  const handleAddTask = () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    createTask.mutate({ title: trimmed, status: 'todo' });
    setTitle('');
  };

  return (
    <View className="flex flex-1 bg-white">
      <Stack.Screen options={{ title: 'Tasks' }} />
      <Container>
        <ScreenContent path="app/tasks/index.tsx" title="Tasks">
          <Text className="text-base text-gray-700">Track and add caregiver tasks.</Text>
        </ScreenContent>

        <View className="mb-6 gap-3">
          <TextInput
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-base"
            placeholder="New task title"
            value={title}
            onChangeText={setTitle}
            editable={!createTask.isLoading}
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
          <Text className="text-base text-red-600">Could not load tasks.</Text>
        ) : (
          <FlatList
            data={tasksQuery.data ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
            renderItem={({ item }) => (
              <View className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <Text className="text-base font-semibold text-gray-900">{item.title}</Text>
                <Text className="text-sm text-gray-600">
                  Status: {item.status.replace('_', ' ')}
                </Text>
              </View>
            )}
          />
        )}
      </Container>
    </View>
  );
}
