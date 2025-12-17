import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';

import { Container } from '@/components/Container';
import { Button } from '@/components/Button';
import { SignOutButton } from '@/components/SignOutButton';
import { useUserTheme } from '@/app/(hooks)/useUserTheme';
import { trpc } from '@/lib/trpc/client';

export default function ProfileScreen() {
  const { systemColorScheme, isDark, setUserTheme, resetTheme, isUpdating } = useUserTheme();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [isInviteCopied, setIsInviteCopied] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [isEditNameOpen, setIsEditNameOpen] = useState(false);
  const [editNameError, setEditNameError] = useState<string | null>(null);

  const toggleTheme = (value: boolean) => {
    setUserTheme(value ? 'dark' : 'light');
  };

  const resetToSystem = () => {
    resetTheme();
  };

  const hubQuery = trpc.careRecipients.my.useQuery(undefined, {
    staleTime: 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const meQuery = trpc.caregivers.me.useQuery(undefined, {
    staleTime: 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  React.useEffect(() => {
    if (!meQuery.data?.name) return;
    setDisplayNameDraft((current) => (current ? current : meQuery.data!.name));
  }, [meQuery.data]);

  const setName = trpc.caregivers.setName.useMutation({
    onSuccess: () => {
      void utils.caregivers.me.invalidate();
      setEditNameError(null);
      setIsEditNameOpen(false);
    },
  });

  const isOwner = hubQuery.data?.membership.role === 'owner';
  const myRoleLabel = isOwner ? 'Owner' : 'Viewer';

  const invite = trpc.careRecipients.invite.useMutation({
    onSuccess: (data) => {
      setInviteToken(data.token);
      setInviteExpiresAt(data.expiresAt ? new Date(data.expiresAt).toISOString() : null);
    },
  });

  const hubName = useMemo(() => hubQuery.data?.careRecipient?.name ?? null, [hubQuery.data]);
  const myDisplayName = meQuery.data?.name ?? meQuery.data?.email ?? 'You';

  const copyInviteToken = async () => {
    if (!inviteToken) return;
    try {
      await Clipboard.setStringAsync(inviteToken);
      setIsInviteCopied(true);
      setTimeout(() => setIsInviteCopied(false), 1500);
    } catch {
      // no-op
    }
  };

  return (
    <View className="flex flex-1 bg-surface px-4 dark:bg-surface-dark">
      <Stack.Screen options={{ title: 'Profile' }} />
      <Container>
        <View className="mt-4 w-full gap-4 rounded-xl border border-border bg-white p-4 dark:border-border-dark dark:bg-surface-card-dark">
          <View className="flex-row items-center justify-between">
            <View className="gap-1">
              <Text className="text-base font-semibold text-text dark:text-text-dark">
                Dark mode
              </Text>
              <Text className="text-sm text-text-muted dark:text-text-muted-dark">
                Follow system by default; override anytime.
              </Text>
            </View>
            <Switch value={isDark} onValueChange={toggleTheme} disabled={isUpdating} />
          </View>
          <Text className="text-sm font-semibold text-accent underline" onPress={resetToSystem}>
            Reset to system theme ({systemColorScheme ?? 'light'})
          </Text>
        </View>

        <View className="mt-6 w-full gap-4 rounded-xl border border-border bg-white p-4 dark:border-border-dark dark:bg-surface-card-dark">
          <View className="gap-1">
            <Text className="text-base font-semibold text-text dark:text-text-dark">CareHub</Text>
            <Text className="text-sm text-text-muted dark:text-text-muted-dark">
              {hubName ? `Recipient: ${hubName}` : 'Loading…'}
            </Text>
          </View>

          <View className="flex-row items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 dark:border-border-dark dark:bg-surface-dark">
            <Text className="flex-1 pr-3 text-base font-semibold text-text dark:text-text-dark">
              {myDisplayName}
            </Text>
            <View className="flex-row items-center gap-2">
              <View className="rounded-full bg-surface-strong px-3 py-1 dark:bg-border-dark">
                <Text className="text-xs font-semibold text-text-muted dark:text-text-muted-dark">
                  {myRoleLabel}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setEditNameError(null);
                  setDisplayNameDraft(meQuery.data?.name ?? '');
                  setIsEditNameOpen(true);
                }}
                className="rounded-full bg-surface-strong px-4 py-2 dark:bg-border-dark"
                style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
                <Text className="text-sm font-semibold text-text dark:text-text-dark">Edit</Text>
              </Pressable>
            </View>
          </View>

          {isOwner ? (
            <Pressable
              onPress={() => invite.mutate({})}
              disabled={invite.isPending}
              className="items-center rounded-full bg-primary px-4 py-3 dark:bg-primary-deep"
              style={({ pressed }) => ({
                opacity: invite.isPending ? 0.5 : pressed ? 0.85 : 1,
              })}>
              {invite.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-sm font-semibold text-white">Create invite code</Text>
              )}
            </Pressable>
          ) : (
            <Text className="text-xs text-text-muted dark:text-text-muted-dark">
              Only the hub owner can invite others.
            </Text>
          )}
        </View>

        <View className="mt-6 w-full">
          <Button title="Suppressed senders" onPress={() => router.push('/suppressed-senders')} />
        </View>

        <View className="mt-4 w-full">
          <SignOutButton />
        </View>
      </Container>

      <Modal
        visible={isEditNameOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (setName.isPending) return;
          setIsEditNameOpen(false);
          setEditNameError(null);
        }}
        statusBarTranslucent>
        <Pressable
          className="flex-1 items-center justify-center bg-black/40 px-6"
          onPress={() => {
            if (setName.isPending) return;
            setIsEditNameOpen(false);
            setEditNameError(null);
          }}>
          <Pressable
            onPress={() => {}}
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 dark:border-border-dark dark:bg-surface-card-dark">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-text dark:text-text-dark">
                Edit your name
              </Text>
              <Pressable
                onPress={() => {
                  if (setName.isPending) return;
                  setIsEditNameOpen(false);
                  setEditNameError(null);
                }}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Text className="text-sm font-semibold text-text-muted dark:text-text-muted-dark">
                  Close
                </Text>
              </Pressable>
            </View>

            <TextInput
              value={displayNameDraft}
              onChangeText={(text) => {
                setEditNameError(null);
                setDisplayNameDraft(text);
              }}
              editable={!setName.isPending}
              placeholder="Your name"
              autoFocus
              className="rounded-xl border border-border bg-surface px-4 py-3 text-[16px] leading-[20px] dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
            />

            {editNameError ? (
              <Text className="mt-2 text-xs text-rose-700 dark:text-rose-200">{editNameError}</Text>
            ) : null}
            {setName.isError ? (
              <Text className="mt-2 text-xs text-rose-700 dark:text-rose-200">
                {setName.error.message}
              </Text>
            ) : null}

            <View className="mt-4 flex-row gap-3">
              <Pressable
                onPress={() => {
                  if (setName.isPending) return;
                  setIsEditNameOpen(false);
                  setEditNameError(null);
                }}
                className="flex-1 items-center rounded-full border border-border px-4 py-3 dark:border-border-dark"
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
                <Text className="text-sm font-semibold text-text dark:text-text-dark">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const trimmed = displayNameDraft.trim();
                  if (!trimmed) {
                    setEditNameError('Please enter a name.');
                    return;
                  }
                  setName.mutate({ name: trimmed });
                }}
                disabled={setName.isPending}
                className="flex-1 items-center rounded-full bg-primary px-4 py-3 dark:bg-primary-deep"
                style={({ pressed }) => ({
                  opacity: setName.isPending ? 0.5 : pressed ? 0.85 : 1,
                })}>
                {setName.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-sm font-semibold text-white">Save</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={!!inviteToken}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setInviteToken(null);
          setIsInviteCopied(false);
        }}
        statusBarTranslucent>
        <Pressable
          className="flex-1 items-center justify-center bg-black/40 px-6"
          onPress={() => {
            setInviteToken(null);
            setIsInviteCopied(false);
          }}>
          <Pressable
            onPress={() => {}}
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 dark:border-border-dark dark:bg-surface-card-dark">
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-text dark:text-text-dark">
                Invite code
              </Text>
              <Pressable
                onPress={() => {
                  setInviteToken(null);
                  setIsInviteCopied(false);
                }}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Text className="text-sm font-semibold text-text-muted dark:text-text-muted-dark">
                  Close
                </Text>
              </Pressable>
            </View>
            <Text className="text-xs text-text-muted dark:text-text-muted-dark">
              Have the other caregiver open Carebase → paste this code in Setup → Join hub.
            </Text>
            <View className="mt-3 flex-row items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 dark:border-border-dark dark:bg-surface-dark">
              <Text
                selectable
                className="flex-1 text-base font-semibold text-text dark:text-text-dark">
                {inviteToken}
              </Text>
              <Pressable
                onPress={copyInviteToken}
                className="rounded-full bg-surface-strong px-4 py-2 dark:bg-border-dark"
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
                <Text className="text-sm font-semibold text-text dark:text-text-dark">
                  {isInviteCopied ? 'Copied' : 'Copy'}
                </Text>
              </Pressable>
            </View>
            {inviteExpiresAt ? (
              <Text className="mt-2 text-xs text-text-muted dark:text-text-muted-dark">
                Expires: {new Date(inviteExpiresAt).toLocaleString()}
              </Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
