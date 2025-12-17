import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { SafeAreaView } from 'react-native-safe-area-context';

import { trpc } from '@/lib/trpc/client';

export default function SetupScreen() {
  useColorScheme();
  const router = useRouter();

  const [recipientName, setRecipientName] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const create = trpc.careRecipients.create.useMutation({
    onSuccess: () => {
      router.replace('/');
    },
    onError: (err) => setError(err.message ?? 'Could not create care recipient'),
  });

  const acceptInvite = trpc.careRecipients.acceptInvite.useMutation({
    onSuccess: () => {
      router.replace('/');
    },
    onError: (err) => setError(err.message ?? 'Could not accept invite'),
  });

  const isBusy = create.isLoading || acceptInvite.isLoading;

  const canCreate = useMemo(() => recipientName.trim().length > 0, [recipientName]);
  const canJoin = useMemo(() => inviteToken.trim().length >= 8, [inviteToken]);

  const submitCreate = () => {
    setError(null);
    if (!canCreate) return;
    create.mutate({ name: recipientName.trim() });
  };

  const submitJoin = () => {
    setError(null);
    if (!canJoin) return;
    acceptInvite.mutate({ token: inviteToken.trim() });
  };

  return (
    <View className="flex flex-1 bg-surface px-4 dark:bg-surface-dark">
      <Stack.Screen options={{ title: 'Setup' }} />
      <KeyboardAwareScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        enableOnAndroid
        keyboardOpeningTime={0}
        extraScrollHeight={64}
        keyboardShouldPersistTaps="handled">
        <SafeAreaView edges={['top', 'left', 'right']} className="flex flex-1 px-6 pb-6">
          <View className="pt-6" />
          <View className="mt-10 gap-2">
            <Text className="text-3xl font-semibold text-text dark:text-text-dark">
              Set up your care hub
            </Text>
            <Text className="text-base leading-5 text-text-muted dark:text-text-muted-dark">
              Start with one person you’re caring for. You can invite family caregivers later.
            </Text>
          </View>

          {error ? (
            <View className="mt-5 flex-row gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/40 dark:bg-rose-950/30">
              <Ionicons name="alert-circle-outline" size={18} color="#E06262" />
              <View className="flex-1">
                <Text className="text-sm font-semibold text-rose-900 dark:text-rose-200">
                  {error}
                </Text>
              </View>
            </View>
          ) : null}

          <View className="mt-6 gap-5 rounded-2xl border border-border bg-white p-5 dark:border-border-dark dark:bg-surface-card-dark">
            <View className="gap-1">
              <Text className="text-lg font-semibold text-text dark:text-text-dark">
                Create your hub
              </Text>
              <Text className="text-sm text-text-muted dark:text-text-muted-dark">
                This is the shared home for tasks, notes, and email sync.
              </Text>
            </View>

            <View className="gap-2">
              <Text className="text-sm font-semibold text-text dark:text-text-dark">
                Care recipient name
              </Text>
              <TextInput
                value={recipientName}
                onChangeText={setRecipientName}
                editable={!isBusy}
                placeholder="e.g., Mom"
                placeholderTextColor="#9CA3AF"
                className="rounded-xl border border-border bg-white px-4 py-3 text-[16px] leading-[20px] dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
                returnKeyType="done"
                onSubmitEditing={submitCreate}
              />
            </View>

            <Pressable
              disabled={!canCreate || isBusy}
              onPress={submitCreate}
              className="items-center rounded-full bg-primary px-4 py-3.5 dark:bg-primary-deep"
              style={({ pressed }) => ({
                opacity: !canCreate || isBusy ? 0.5 : pressed ? 0.88 : 1,
              })}>
              {create.isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-base font-semibold text-white">Create hub</Text>
              )}
            </Pressable>
          </View>

          <Pressable
            onPress={() => setShowInvite((v) => !v)}
            className="mt-4 flex-row items-center justify-between rounded-2xl border border-border bg-surface-strong px-5 py-4 dark:border-border-dark dark:bg-surface-card-dark"
            style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
            <View className="flex-row items-center gap-3">
              <Ionicons name="key-outline" size={18} color="#4A8F6A" />
              <View className="gap-0.5">
                <Text className="text-sm font-semibold text-text dark:text-text-dark">
                  Have an invite code?
                </Text>
                <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                  Join an existing family hub.
                </Text>
              </View>
            </View>
            <Ionicons name={showInvite ? 'chevron-up' : 'chevron-down'} size={18} color="#9CA3AF" />
          </Pressable>

          {showInvite ? (
            <View className="mt-3 gap-4 rounded-2xl border border-border bg-white p-5 dark:border-border-dark dark:bg-surface-card-dark">
              <View className="gap-2">
                <Text className="text-sm font-semibold text-text dark:text-text-dark">
                  Invite code
                </Text>
                <TextInput
                  value={inviteToken}
                  onChangeText={setInviteToken}
                  editable={!isBusy}
                  placeholder="Paste invite code"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="none"
                  className="rounded-xl border border-border bg-white px-4 py-3 text-[16px] leading-[20px] dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
                  returnKeyType="done"
                  onSubmitEditing={submitJoin}
                />
              </View>

              <Pressable
                disabled={!canJoin || isBusy}
                onPress={submitJoin}
                className="items-center rounded-full border border-border bg-transparent px-4 py-3.5 dark:border-border-dark"
                style={({ pressed }) => ({
                  opacity: !canJoin || isBusy ? 0.5 : pressed ? 0.88 : 1,
                })}>
                {acceptInvite.isLoading ? (
                  <ActivityIndicator />
                ) : (
                  <Text className="text-base font-semibold text-text dark:text-text-dark">
                    Join hub
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}

          <View style={{ height: 28 }} />
        </SafeAreaView>
      </KeyboardAwareScrollView>
    </View>
  );
}
