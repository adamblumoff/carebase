import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useColorScheme } from 'nativewind';
import { ActivityIndicator, Alert, Animated, Pressable, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';

import { trpc } from '@/lib/trpc/client';
import { Container } from '@/components/Container';
import { Button } from '@/components/Button';

const statusStyles: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-900',
  errored: 'bg-rose-100 text-rose-900',
  disconnected: 'bg-surface text-text-muted',
};

export default function ConnectionsScreen() {
  useColorScheme();

  const hubQuery = trpc.careRecipients.my.useQuery(undefined, {
    staleTime: 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const isOwner = hubQuery.data?.membership.role === 'owner';
  const myCaregiverId = hubQuery.data?.membership.caregiverId ?? null;

  const redirectUri = useMemo(() => {
    const useProd =
      process.env.EXPO_PUBLIC_APP_ENV === 'prod' ||
      process.env.APP_ENV === 'prod' ||
      process.env.NODE_ENV === 'production';

    const primary = useProd
      ? process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI_PROD
      : process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI;

    const fallback = process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI;

    const chosen = primary || fallback;

    if (!chosen) {
      console.warn('Google redirect URI not set. Add EXPO_PUBLIC_GOOGLE_REDIRECT_URI(. ._PROD)');
    }

    return chosen ?? '';
  }, []);

  const sourcesQuery = trpc.sources.list.useQuery();
  const authUrlQuery = trpc.sources.authorizeUrl.useQuery({ redirectUri }, { enabled: false });

  const [connectError, setConnectError] = useState<string | null>(null);

  const hasRedirect = Boolean(redirectUri);
  const gmailSources = sourcesQuery.data?.filter((s) => s.provider === 'gmail') ?? [];
  const hasGmail = gmailSources.length > 0;

  const connectGoogle = trpc.sources.connectGoogle.useMutation({
    onSuccess: () => {
      sourcesQuery.refetch();
    },
  });

  const syncNow = trpc.ingestion.syncNow.useMutation({
    onSuccess: () => sourcesQuery.refetch(),
  });

  const disconnect = trpc.sources.disconnect.useMutation({
    onSuccess: () => sourcesQuery.refetch(),
  });

  const setPrimary = trpc.sources.setPrimary.useMutation({
    onSuccess: () => sourcesQuery.refetch(),
  });

  const registerWatch = trpc.watch.register.useMutation({
    onSuccess: () => sourcesQuery.refetch(),
  });

  const autoWatchRequested = useRef<Set<string>>(new Set());

  const triggerWatchIfNeeded = useCallback(
    (sources?: typeof sourcesQuery.data) => {
      if (!isOwner) return;
      const gmail =
        sources?.filter(
          (s) => s.provider === 'gmail' && s.status === 'active' && (s as any).isPrimary
        ) ?? [];
      const now = new Date();
      gmail.forEach((src) => {
        const needsWatch = !src.watchExpiration || new Date(src.watchExpiration) <= now;
        if (needsWatch && !autoWatchRequested.current.has(src.id) && !registerWatch.isLoading) {
          autoWatchRequested.current.add(src.id);
          registerWatch.mutate(
            { sourceId: src.id },
            {
              onError: () => autoWatchRequested.current.delete(src.id),
            }
          );
        }
      });
    },
    [isOwner, registerWatch, sourcesQuery]
  );

  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const prefetchingRef = useRef(false);

  const showToast = useCallback(
    (message: string) => {
      setSyncMessage(message);
      Animated.sequence([
        Animated.timing(toastOpacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.delay(1800),
        Animated.timing(toastOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start(() => setSyncMessage(null));
    },
    [toastOpacity]
  );

  const utils = trpc.useUtils();

  const prefetchTasks = useCallback(async () => {
    if (prefetchingRef.current) return;
    prefetchingRef.current = true;
    try {
      const filters: ({ type?: any; reviewState?: any } | undefined)[] = [
        undefined,
        { type: 'appointment' },
        { type: 'bill' },
        { type: 'medication' },
        { type: 'general' },
        { reviewState: 'pending' },
      ];
      await Promise.all(
        filters.map((f) => utils.tasks.list.prefetch(f as any).catch(() => undefined))
      );
    } finally {
      prefetchingRef.current = false;
    }
  }, [utils.tasks.list]);

  useFocusEffect(
    useCallback(() => {
      void prefetchTasks();
      return undefined;
    }, [prefetchTasks])
  );

  const handleConnect = useCallback(async () => {
    try {
      if (!hasRedirect) {
        console.warn('Missing Google redirect URI');
        return;
      }

      setConnectError(null);

      const { data } = await authUrlQuery.refetch();
      const url = data?.url;
      if (!url) return;

      const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);

      // Always refetch after browser closes to pick up server-side exchange
      const refreshed = await sourcesQuery.refetch();
      const nowHasGmail = refreshed.data?.some((s) => s.provider === 'gmail') ?? false;
      if (nowHasGmail && isOwner) {
        triggerWatchIfNeeded(refreshed.data);
      }

      if (nowHasGmail) {
        setConnectError(null);
        return;
      }

      if (result.type !== 'success') {
        setConnectError('Google sign-in was cancelled.');
        return;
      }

      if (result.url) {
        const parsed = new URL(result.url);
        const code = parsed.searchParams.get('code');
        const state = parsed.searchParams.get('state');
        if (code && state) {
          await connectGoogle.mutateAsync({ code, redirectUri, state });
          const refreshedAfterConnect = await sourcesQuery.refetch();
          if (isOwner) triggerWatchIfNeeded(refreshedAfterConnect.data);
        } else {
          setConnectError('No code/state returned from Google.');
        }
      }
    } catch (error: any) {
      console.warn('connect google failed', error);
      setConnectError(error?.message ?? 'Connect failed');
    } finally {
      sourcesQuery.refetch();
    }
  }, [
    authUrlQuery,
    connectGoogle,
    isOwner,
    redirectUri,
    hasRedirect,
    sourcesQuery,
    triggerWatchIfNeeded,
  ]);

  useEffect(() => {
    if (hasGmail && connectError) {
      setConnectError(null);
    }
  }, [hasGmail, connectError]);

  useEffect(() => {
    triggerWatchIfNeeded(sourcesQuery.data);
  }, [sourcesQuery.data, triggerWatchIfNeeded]);

  const handleSync = useCallback(
    async (id: string) => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await syncNow.mutateAsync({ sourceId: id });
      showToast('Just synced');
    },
    [syncNow, showToast]
  );

  const handleDisconnect = useCallback(
    async (id: string) => {
      Alert.alert('Disconnect Google', 'Are you sure you want to disconnect?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await disconnect.mutateAsync({ id });
            showToast('Disconnected');
          },
        },
      ]);
    },
    [disconnect, showToast]
  );

  const handleMakePrimary = useCallback(
    async (id: string) => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await setPrimary.mutateAsync({ sourceId: id });
      showToast('Set as primary');
    },
    [setPrimary, showToast]
  );

  const isBusy =
    connectGoogle.isLoading || syncNow.isLoading || disconnect.isLoading || sourcesQuery.isFetching;

  return (
    <View className="flex flex-1 bg-surface px-4 dark:bg-surface-dark">
      <Stack.Screen options={{ title: 'Sync' }} />
      <Container>
        <View className="mt-3 gap-3 rounded-2xl border border-border bg-white p-4 dark:border-border-dark dark:bg-surface-card-dark">
          <Text className="text-lg font-semibold text-text dark:text-text-dark">Google</Text>
          <Text className="text-sm text-text-muted dark:text-text-muted-dark">
            Connect your Gmail to auto-sync appointments, bills, and medications. We request
            read-only access and store the refresh token server-side.
          </Text>
          <Button
            title={
              connectGoogle.isLoading
                ? 'Connecting…'
                : hasGmail
                  ? 'Add another inbox'
                  : 'Connect Google'
            }
            onPress={handleConnect}
            disabled={isBusy || !hasRedirect}
          />
          {hasGmail ? (
            <Text className="text-xs text-text-muted dark:text-text-muted-dark">
              Only the Primary inbox syncs by default. {isOwner ? 'You can change it below.' : ''}
            </Text>
          ) : null}
          {!hasRedirect ? (
            <Text className="text-xs text-red-600">
              Set EXPO_PUBLIC_GOOGLE_REDIRECT_URI to enable Google connect.
            </Text>
          ) : null}
          {connectGoogle.isError ? (
            <Text className="text-xs text-red-600">{connectGoogle.error.message}</Text>
          ) : null}
          {connectError ? <Text className="text-xs text-red-600">{connectError}</Text> : null}
          {registerWatch.isError ? (
            <Text className="text-xs text-red-600">{registerWatch.error.message}</Text>
          ) : null}
          {syncMessage ? <Text className="text-xs text-emerald-700">{syncMessage}</Text> : null}
        </View>

        <View className="mt-4 gap-3">
          {sourcesQuery.isLoading ? (
            <View className="items-center py-4">
              <ActivityIndicator />
            </View>
          ) : sourcesQuery.isError ? (
            <Text className="text-sm text-red-600">Failed to load sources.</Text>
          ) : sourcesQuery.data?.length ? (
            sourcesQuery.data
              .filter((source) => source.provider === 'gmail' && source.status !== 'disconnected')
              .sort((a, b) => {
                const aPrimary = (a as any).isPrimary ? 1 : 0;
                const bPrimary = (b as any).isPrimary ? 1 : 0;
                return bPrimary - aPrimary;
              })
              .map((source) => {
                const tone = statusStyles[source.status] ?? statusStyles.active;
                const watchStatus = source.watchExpiration
                  ? new Date(source.watchExpiration) > new Date()
                    ? 'Active (push)'
                    : 'Renewing/polling'
                  : 'Polling';
                const isPrimary = Boolean((source as any).isPrimary);
                const canDisconnect =
                  isOwner ||
                  (myCaregiverId ? (source as any).caregiverId === myCaregiverId : false);
                const canSync = isOwner && isPrimary && source.status === 'active';
                return (
                  <View
                    key={source.id}
                    className="gap-2 rounded-2xl border border-border bg-white p-4 dark:border-border-dark dark:bg-surface-card-dark">
                    <View className="flex-row items-center justify-between">
                      <View>
                        <Text className="text-base font-semibold text-text dark:text-text-dark">
                          {source.accountEmail}
                        </Text>
                        <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                          Provider: {source.provider} •{' '}
                          {isPrimary ? `Primary • ${watchStatus}` : 'Not syncing'}
                        </Text>
                      </View>
                      <View className={`rounded-full px-2 py-1 ${tone}`}>
                        <Text className="text-[11px] font-semibold capitalize">
                          {source.status}
                        </Text>
                      </View>
                    </View>
                    {(source as any).caregiverName ? (
                      <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                        Connected by: {(source as any).caregiverName}
                      </Text>
                    ) : null}
                    <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                      Last sync:{' '}
                      {source.lastSyncAt ? new Date(source.lastSyncAt).toLocaleString() : 'never'}
                    </Text>
                    {isOwner && !isPrimary ? (
                      <Pressable
                        onPress={() => handleMakePrimary(source.id)}
                        disabled={setPrimary.isLoading || source.status !== 'active'}
                        className="self-start rounded-full border border-border px-3 py-1.5 dark:border-border-dark"
                        style={({ pressed }) => ({
                          opacity:
                            setPrimary.isLoading || source.status !== 'active'
                              ? 0.5
                              : pressed
                                ? 0.75
                                : 1,
                        })}>
                        <Text className="text-sm font-semibold text-primary">Make primary</Text>
                      </Pressable>
                    ) : null}
                    <View className="flex-row items-center gap-3">
                      <Pressable
                        onPress={() => handleSync(source.id)}
                        disabled={syncNow.isLoading || !canSync}
                        className="flex-1 items-center justify-center rounded-full bg-primary px-4 py-3"
                        style={({ pressed }) => ({
                          opacity: syncNow.isLoading || !canSync ? 0.5 : pressed ? 0.85 : 1,
                        })}>
                        {syncNow.isLoading ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text className="text-base font-semibold text-white">Sync now</Text>
                        )}
                      </Pressable>
                      <Pressable
                        onPress={() => handleDisconnect(source.id)}
                        disabled={disconnect.isLoading || !canDisconnect}
                        className="flex-1 items-center justify-center rounded-full border border-border px-4 py-3 dark:border-border-dark"
                        style={({ pressed }) => ({
                          opacity: disconnect.isLoading || !canDisconnect ? 0.5 : pressed ? 0.8 : 1,
                        })}>
                        {disconnect.isLoading ? (
                          <ActivityIndicator />
                        ) : (
                          <Text className="text-base font-semibold text-text">Disconnect</Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                );
              })
          ) : (
            <Text className="text-sm text-text-muted dark:text-text-muted-dark">
              No connected sources yet.
            </Text>
          )}
        </View>

        {syncMessage ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              bottom: 24,
              left: 16,
              right: 16,
              opacity: toastOpacity,
              transform: [
                {
                  translateY: toastOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: [12, 0],
                  }),
                },
              ],
            }}>
            <View className="items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 shadow-lg">
              <Text className="text-sm font-semibold text-white">{syncMessage}</Text>
            </View>
          </Animated.View>
        ) : null}
      </Container>
    </View>
  );
}
