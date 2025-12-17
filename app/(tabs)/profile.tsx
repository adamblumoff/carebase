import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Switch, Text, View, TextInput } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { Container } from '@/components/Container';
import { Button } from '@/components/Button';
import { SignOutButton } from '@/components/SignOutButton';
import { useUserTheme } from '@/app/(hooks)/useUserTheme';
import { trpc } from '@/lib/trpc/client';

export default function ProfileScreen() {
  const { systemColorScheme, isDark, setUserTheme, resetTheme, isUpdating } = useUserTheme();
  const router = useRouter();
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState('');

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
      meQuery.refetch();
    },
  });
  const teamQuery = trpc.careRecipients.team.useQuery(undefined, {
    enabled: hubQuery.isSuccess,
    staleTime: 30 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const isOwner = hubQuery.data?.membership.role === 'owner';

  const invite = trpc.careRecipients.invite.useMutation({
    onSuccess: (data) => {
      setInviteToken(data.token);
      setInviteExpiresAt(data.expiresAt ? new Date(data.expiresAt).toISOString() : null);
    },
  });

  const hubName = useMemo(() => hubQuery.data?.careRecipient?.name ?? null, [hubQuery.data]);

  return (
    <View className="flex flex-1 bg-surface px-4 dark:bg-surface-dark">
      <Stack.Screen options={{ title: 'Profile' }} />
      <Container>
        <View className="mt-4 w-full gap-4 rounded-xl border border-border bg-white p-4 dark:border-border-dark dark:bg-surface-card-dark">
          <View className="gap-1">
            <Text className="text-base font-semibold text-text dark:text-text-dark">Your name</Text>
            <Text className="text-sm text-text-muted dark:text-text-muted-dark">
              This is what your family sees in CareHub.
            </Text>
          </View>
          <TextInput
            value={displayNameDraft}
            onChangeText={setDisplayNameDraft}
            editable={!setName.isLoading}
            placeholder="Your name"
            className="rounded-xl border border-border bg-white px-4 py-3 text-[16px] leading-[20px] dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
          />
          <Pressable
            onPress={() => setName.mutate({ name: displayNameDraft.trim() })}
            disabled={setName.isLoading || !displayNameDraft.trim()}
            className="items-center rounded-full bg-primary px-4 py-3 dark:bg-primary-deep"
            style={({ pressed }) => ({
              opacity: setName.isLoading || !displayNameDraft.trim() ? 0.5 : pressed ? 0.85 : 1,
            })}>
            {setName.isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-sm font-semibold text-white">Save</Text>
            )}
          </Pressable>
          {meQuery.isError ? (
            <Text className="text-xs text-rose-700 dark:text-rose-200">
              {meQuery.error.message}
            </Text>
          ) : null}
          {setName.isError ? (
            <Text className="text-xs text-rose-700 dark:text-rose-200">
              {setName.error.message}
            </Text>
          ) : null}
        </View>

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

          {teamQuery.isLoading ? (
            <View className="items-center py-2">
              <ActivityIndicator />
            </View>
          ) : teamQuery.data?.length ? (
            <View className="gap-2">
              {teamQuery.data.map((member) => (
                <View key={member.caregiverId} className="flex-row items-center justify-between">
                  <View>
                    <Text className="text-sm font-semibold text-text dark:text-text-dark">
                      {member.name ?? member.email}
                    </Text>
                    <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                      {member.role}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text className="text-sm text-text-muted dark:text-text-muted-dark">
              No team members yet.
            </Text>
          )}

          {isOwner ? (
            <Pressable
              onPress={() => invite.mutate({})}
              disabled={invite.isLoading}
              className="items-center rounded-full bg-primary px-4 py-3 dark:bg-primary-deep"
              style={({ pressed }) => ({
                opacity: invite.isLoading ? 0.5 : pressed ? 0.85 : 1,
              })}>
              {invite.isLoading ? (
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
          <Button
            title="Suppressed senders"
            onPress={() => router.push('/(tabs)/suppressed-senders')}
          />
        </View>

        <View className="mt-4 w-full">
          <SignOutButton />
        </View>
      </Container>

      <Modal
        visible={!!inviteToken}
        transparent
        animationType="fade"
        onRequestClose={() => setInviteToken(null)}
        statusBarTranslucent>
        <Pressable
          className="flex-1 items-center justify-center bg-black/40 px-6"
          onPress={() => setInviteToken(null)}>
          <Pressable
            onPress={() => {}}
            className="w-full max-w-md rounded-2xl border border-border bg-white p-5 dark:border-border-dark dark:bg-surface-card-dark">
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-text dark:text-text-dark">
                Invite code
              </Text>
              <Pressable
                onPress={() => setInviteToken(null)}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Text className="text-sm font-semibold text-text-muted">Close</Text>
              </Pressable>
            </View>
            <Text className="text-xs text-text-muted dark:text-text-muted-dark">
              Have the other caregiver open Carebase → paste this code in Setup → Join hub.
            </Text>
            <View className="mt-3 rounded-xl border border-border bg-surface-strong p-4 dark:border-border-dark dark:bg-surface">
              <Text selectable className="text-base font-semibold text-text dark:text-text-dark">
                {inviteToken}
              </Text>
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
