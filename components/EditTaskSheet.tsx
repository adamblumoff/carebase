import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

import { trpc } from '@/lib/trpc/client';

type TaskLike = {
  id: string;
  title: string;
  description?: string | null;
  type?: string | null;
};

const typeOptions = ['appointment', 'bill', 'medication', 'general'] as const;

const formatType = (type?: string | null) => {
  if (!type) return 'General';
  return type.charAt(0).toUpperCase() + type.slice(1);
};

export const EditTaskSheet = ({
  task,
  visible,
  onClose,
  onUpdated,
}: {
  task: TaskLike | null;
  visible: boolean;
  onClose: () => void;
  onUpdated: (updated: TaskLike) => void;
}) => {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [taskType, setTaskType] = useState<(typeof typeOptions)[number]>(
    (task?.type as (typeof typeOptions)[number]) ?? 'general'
  );

  useEffect(() => {
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setTaskType((task?.type as (typeof typeOptions)[number]) ?? 'general');
  }, [task?.id, task?.title, task?.description, task?.type]);

  const updateDetails = trpc.tasks.updateDetails.useMutation({
    onSuccess: (updated) => {
      onUpdated({
        id: updated.id,
        title: updated.title,
        description: updated.description,
        type: updated.type,
      });
      onClose();
    },
    onError: (error) => {
      const message = error.message?.includes('No procedure found')
        ? 'Update endpoint not available. Please restart the API (pnpm api:dev) to pick up the new route.'
        : error.message;
      Alert.alert('Could not save', message);
    },
  });

  const handleSave = () => {
    if (!task) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    updateDetails.mutate({
      id: task.id,
      title: trimmed,
      description: description?.trim(),
      type: taskType,
    });
  };

  const reset = () => {
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setTaskType((task?.type as (typeof typeOptions)[number]) ?? 'general');
  };

  const close = () => {
    if (updateDetails.isLoading) return;
    reset();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
      statusBarTranslucent>
      <KeyboardAwareScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
        enableOnAndroid
        keyboardOpeningTime={0}
        extraScrollHeight={70}
        extraHeight={70}
        keyboardShouldPersistTaps="handled"
        enableAutomaticScroll
        scrollEnabled>
        <View className="flex-1 bg-transparent">
          <Pressable className="flex-1" onPress={close} />
          <View className="rounded-t-3xl border border-border bg-white px-5 pb-8 pt-5 dark:border-border-dark dark:bg-surface-card-dark">
            <View className="mb-4 flex-row items-center justify-between gap-3">
              <Text className="text-base font-semibold text-text dark:text-text-dark">
                Edit task
              </Text>
              <View className="flex-row items-center gap-2">
                <Pressable
                  onPress={close}
                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                  <Text className="text-sm text-text-muted">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSave}
                  disabled={updateDetails.isLoading || !title.trim()}
                  className="rounded-full bg-primary px-4 py-2 dark:bg-primary-deep"
                  style={({ pressed }) => ({
                    opacity: updateDetails.isLoading || !title.trim() ? 0.5 : pressed ? 0.85 : 1,
                  })}>
                  {updateDetails.isLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className="text-sm font-semibold text-white">Save</Text>
                  )}
                </Pressable>
              </View>
            </View>

            <View className="gap-3 pb-2">
              <View className="gap-1">
                <Text className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted-dark">
                  Title
                </Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  editable={!updateDetails.isLoading}
                  className="rounded-lg border border-border bg-white px-3 py-2 text-base dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
                  placeholder="Task title"
                  returnKeyType="done"
                />
              </View>

              <View className="gap-1">
                <Text className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted-dark">
                  Type
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {typeOptions.map((option) => {
                    const isActive = taskType === option;
                    return (
                      <Pressable
                        key={option}
                        onPress={() => setTaskType(option)}
                        disabled={updateDetails.isLoading}
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
              </View>

              <View className="gap-1">
                <Text className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted-dark">
                  Description (optional)
                </Text>
                <TextInput
                  value={description ?? ''}
                  onChangeText={setDescription}
                  editable={!updateDetails.isLoading}
                  multiline
                  numberOfLines={4}
                  className="rounded-lg border border-border bg-white px-3 py-2 text-base dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
                  placeholder="Add a short note"
                  style={{ minHeight: 96, textAlignVertical: 'top' }}
                />
              </View>
            </View>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </Modal>
  );
};
