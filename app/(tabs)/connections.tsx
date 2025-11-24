import { useCallback, useMemo } from 'react';
import { useColorScheme } from 'nativewind';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

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

  const handleConnect = useCallback(async () => {
    try {
      const { data } = await authUrlQuery.refetch();
      const url = data?.url;
      if (!url) return;

      const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
      if (result.type === 'success' && result.url) {
        const parsed = new URL(result.url);
        const code = parsed.searchParams.get('code');
        if (code) {
          await connectGoogle.mutateAsync({ code, redirectUri });
        }
      }
    } catch (error) {
      console.warn('connect google failed', error);
    }
  }, [authUrlQuery, connectGoogle, redirectUri]);

  const handleSync = useCallback(
    async (id: string) => {
      await syncNow.mutateAsync({ sourceId: id });
    },
    [syncNow]
  );

  const handleDisconnect = useCallback(
    async (id: string) => {
      await disconnect.mutateAsync({ id });
    },
    [disconnect]
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
            title={connectGoogle.isLoading ? 'Connecting…' : 'Connect Google'}
            onPress={handleConnect}
            disabled={isBusy}
          />
        </View>

        <View className="mt-4 gap-3">
          {sourcesQuery.isLoading ? (
            <View className="items-center py-4">
              <ActivityIndicator />
            </View>
          ) : sourcesQuery.isError ? (
            <Text className="text-sm text-red-600">Failed to load sources.</Text>
          ) : sourcesQuery.data?.length ? (
            sourcesQuery.data.map((source) => {
              const tone = statusStyles[source.status] ?? statusStyles.active;
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
                        Provider: {source.provider}
                      </Text>
                    </View>
                    <View className={`rounded-full px-2 py-1 ${tone}`}>
                      <Text className="text-[11px] font-semibold capitalize">{source.status}</Text>
                    </View>
                  </View>
                  <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                    Last sync:{' '}
                    {source.lastSyncAt ? new Date(source.lastSyncAt).toLocaleString() : 'never'}
                  </Text>
                  <View className="flex-row items-center gap-3">
                    <Pressable
                      onPress={() => handleSync(source.id)}
                      disabled={syncNow.isLoading || source.status === 'disconnected'}
                      className="flex-1 items-center justify-center rounded-full bg-primary px-4 py-3"
                      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
                      {syncNow.isLoading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text className="text-base font-semibold text-white">Sync now</Text>
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => handleDisconnect(source.id)}
                      disabled={disconnect.isLoading}
                      className="flex-1 items-center justify-center rounded-full border border-border px-4 py-3 dark:border-border-dark"
                      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
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
      </Container>
    </View>
  );
}
