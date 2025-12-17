import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';

import { Container } from '@/components/Container';
import { trpc } from '@/lib/trpc/client';

export default function SetupScreen() {
  useColorScheme();
  const router = useRouter();

  const [recipientName, setRecipientName] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [error, setError] = useState<string | null>(null);

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
      <Container>
        <View className="mt-8 gap-2">
          <Text className="text-2xl font-semibold text-text dark:text-text-dark">
            Set up your care hub
          </Text>
          <Text className="text-base text-text-muted dark:text-text-muted-dark">
            Create a care recipient, or join an existing family hub with an invite code.
          </Text>
        </View>

        {error ? (
          <View className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/40 dark:bg-rose-950/30">
            <Text className="text-sm font-semibold text-rose-900 dark:text-rose-200">{error}</Text>
          </View>
        ) : null}

        <View className="mt-6 gap-4 rounded-xl border border-border bg-white p-4 dark:border-border-dark dark:bg-surface-card-dark">
          <Text className="text-base font-semibold text-text dark:text-text-dark">
            Create a new hub
          </Text>
          <View className="gap-1">
            <Text className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted-dark">
              Care recipient name
            </Text>
            <TextInput
              value={recipientName}
              onChangeText={setRecipientName}
              editable={!isBusy}
              placeholder="e.g., Mom"
              className="rounded-lg border border-border bg-white px-3 py-2 text-base dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              returnKeyType="done"
              onSubmitEditing={submitCreate}
            />
          </View>
          <Pressable
            disabled={!canCreate || isBusy}
            onPress={submitCreate}
            className="items-center rounded-full bg-primary px-4 py-3 dark:bg-primary-deep"
            style={({ pressed }) => ({
              opacity: !canCreate || isBusy ? 0.5 : pressed ? 0.85 : 1,
            })}>
            {create.isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-sm font-semibold text-white">Create hub</Text>
            )}
          </Pressable>
        </View>

        <View className="mt-4 gap-4 rounded-xl border border-border bg-white p-4 dark:border-border-dark dark:bg-surface-card-dark">
          <Text className="text-base font-semibold text-text dark:text-text-dark">
            Join with invite code
          </Text>
          <View className="gap-1">
            <Text className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted-dark">
              Invite code
            </Text>
            <TextInput
              value={inviteToken}
              onChangeText={setInviteToken}
              editable={!isBusy}
              placeholder="Paste invite code"
              autoCapitalize="none"
              className="rounded-lg border border-border bg-white px-3 py-2 text-base dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              returnKeyType="done"
              onSubmitEditing={submitJoin}
            />
          </View>
          <Pressable
            disabled={!canJoin || isBusy}
            onPress={submitJoin}
            className="items-center rounded-full bg-surface-strong px-4 py-3 dark:bg-surface"
            style={({ pressed }) => ({
              opacity: !canJoin || isBusy ? 0.5 : pressed ? 0.85 : 1,
            })}>
            {acceptInvite.isLoading ? (
              <ActivityIndicator color="#111" />
            ) : (
              <Text className="text-sm font-semibold text-text dark:text-text-dark">Join hub</Text>
            )}
          </Pressable>
        </View>
      </Container>
    </View>
  );
}
