import '../global.css';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import { Slot, useRouter, useSegments } from 'expo-router';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Animated, Pressable, Text, View } from 'react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PostHogProvider } from 'posthog-react-native';
import { useFonts } from 'expo-font';
import { Roboto_500Medium } from '@expo-google-fonts/roboto';
import { useColorScheme } from 'nativewind';

import { createQueryClientAndPersister, createTrpcClient, trpc } from '@/lib/trpc/client';
import { useUserTheme } from '@/app/(hooks)/useUserTheme';

export default function Layout() {
  useColorScheme();
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const posthogKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  const [fontsLoaded] = useFonts({
    Roboto_500Medium,
  });

  if (!fontsLoaded) {
    return (
      <SafeAreaProvider>
        <Text style={{ marginTop: 48, textAlign: 'center' }}>Loading fonts...</Text>
      </SafeAreaProvider>
    );
  }

  if (!publishableKey) {
    return (
      <SafeAreaProvider>
        <Text style={{ marginTop: 48, textAlign: 'center' }}>
          Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in .env
        </Text>
      </SafeAreaProvider>
    );
  }

  return (
    <ClerkProvider tokenCache={tokenCache} publishableKey={publishableKey}>
      <SafeAreaProvider>
        {posthogKey ? (
          <PostHogProvider
            apiKey={posthogKey}
            options={{
              host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
              enableSessionReplay: false,
            }}
            autocapture>
            <TrpcProvider>
              <AuthGate />
            </TrpcProvider>
          </PostHogProvider>
        ) : (
          <TrpcProvider>
            <AuthGate />
          </TrpcProvider>
        )}
      </SafeAreaProvider>
    </ClerkProvider>
  );
}

function TrpcProvider({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  const apiBaseUrl =
    process.env.NODE_ENV === 'production'
      ? (process.env.EXPO_PUBLIC_API_BASE_URL_PROD ?? process.env.EXPO_PUBLIC_API_BASE_URL)
      : process.env.EXPO_PUBLIC_API_BASE_URL;
  const { queryClient, persister } = useMemo(() => createQueryClientAndPersister(), []);
  const trpcClient = useMemo(() => {
    if (!apiBaseUrl) return null;
    return createTrpcClient(() => getToken({ template: 'trpc' }));
  }, [apiBaseUrl, getToken]);

  // Clear all cached data when the signed-in user changes to avoid cross-account leakage.
  const prevUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isLoaded) return;
    const prev = prevUserIdRef.current;
    if (prev !== userId) {
      queryClient.clear();
      prevUserIdRef.current = userId ?? null;
    }
  }, [isLoaded, isSignedIn, userId, queryClient]);

  if (!apiBaseUrl) {
    return (
      <Text style={{ marginTop: 48, textAlign: 'center' }}>
        Missing EXPO_PUBLIC_API_BASE_URL in .env
      </Text>
    );
  }

  if (!isLoaded || !trpcClient) return null;

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <ThemeGate>
          <PreloadTasks />
          {children}
        </ThemeGate>
      </trpc.Provider>
    </PersistQueryClientProvider>
  );
}

function AuthGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!isSignedIn && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
    } else if (isSignedIn && inAuthGroup) {
      router.replace('/');
    }
  }, [isLoaded, isSignedIn, segments, router]);

  if (!isLoaded) return null;
  return <Slot />;
}

function ThemeGate({ children }: { children: React.ReactNode }) {
  const { themeReady } = useUserTheme();

  if (!themeReady) return null;
  return (
    <PushToastLayer>
      <SetupGate>{children}</SetupGate>
    </PushToastLayer>
  );
}

function PreloadTasks() {
  const utils = trpc.useUtils();
  const { isSignedIn } = useAuth();

  useEffect(() => {
    if (!isSignedIn) return;
    utils.tasks.listThin.prefetch().catch(() => {});
    utils.tasks.stats.prefetch({ upcomingDays: 7 }).catch(() => {});
    utils.tasks.upcoming.prefetch({ days: 7 }).catch(() => {});
    utils.ingestionEvents.recent.prefetch({ limit: 1 }).catch(() => {});
  }, [
    isSignedIn,
    utils.ingestionEvents.recent,
    utils.tasks.listThin,
    utils.tasks.stats,
    utils.tasks.upcoming,
  ]);

  return null;
}

function SetupGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  const isInSetupRoute = segments[0] === '(setup)' || segments[0] === 'setup';

  const membershipQuery = trpc.careRecipients.my.useQuery(undefined, {
    enabled: isSignedIn,
    retry: false,
    staleTime: 30 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const errorCode =
    (membershipQuery.error as any)?.data?.code ?? (membershipQuery.error as any)?.code ?? null;

  const errorMessage =
    (membershipQuery.error as any)?.message ??
    (membershipQuery.error as any)?.data?.message ??
    null;

  const shouldRouteToSetup =
    errorCode === 'PRECONDITION_FAILED' ||
    errorCode === 'NOT_FOUND' ||
    errorMessage === 'Care recipient not set up';

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) return;
    if (membershipQuery.isLoading) return;

    if (membershipQuery.isSuccess) {
      if (isInSetupRoute) {
        router.replace('/');
      }
      return;
    }

    if (shouldRouteToSetup) {
      if (!isInSetupRoute) {
        router.replace('/setup');
      }
      return;
    }
  }, [
    isInSetupRoute,
    isLoaded,
    isSignedIn,
    membershipQuery.isLoading,
    membershipQuery.isSuccess,
    router,
    shouldRouteToSetup,
  ]);

  if (!isSignedIn) return <>{children}</>;

  if (membershipQuery.isSuccess) {
    return (
      <>
        <PreloadTasks />
        {children}
      </>
    );
  }

  if (shouldRouteToSetup) {
    // Avoid rendering the main app route while we redirect into setup.
    if (!isInSetupRoute) return null;
    return <>{children}</>;
  }

  if (membershipQuery.isLoading) return null;

  const message = membershipQuery.error?.message ?? 'Could not load your care hub.';
  const hint =
    typeof message === 'string' && message.toLowerCase().includes('relation')
      ? 'Hint: run `pnpm db:migrate` on the API database, then restart `pnpm api:dev`.'
      : 'Try refreshing. If this persists, the API may be down or missing migrations.';

  const textColor = '#FFFFFF';
  const mutedTextColor = 'rgba(255,255,255,0.75)';

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
        backgroundColor: '#000000',
      }}>
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8, color: textColor }}>
        Something went wrong
      </Text>
      <Text style={{ textAlign: 'center', marginBottom: 12, color: mutedTextColor }}>
        {message}
      </Text>
      <Text style={{ textAlign: 'center', marginBottom: 16, color: mutedTextColor }}>{hint}</Text>
      <Pressable
        onPress={() => membershipQuery.refetch()}
        style={({ pressed }) => ({
          paddingVertical: 10,
          paddingHorizontal: 16,
          borderRadius: 9999,
          backgroundColor: '#4A8F6A',
          opacity: pressed ? 0.85 : 1,
        })}>
        <Text style={{ color: '#fff', fontWeight: '600' }}>Retry</Text>
      </Pressable>

      <Pressable
        onPress={() => router.replace('/setup')}
        style={({ pressed }) => ({
          marginTop: 10,
          paddingVertical: 10,
          paddingHorizontal: 16,
          borderRadius: 9999,
          borderWidth: 1,
          borderColor: '#D1D5DB',
          opacity: pressed ? 0.85 : 1,
        })}>
        <Text style={{ fontWeight: '600', color: textColor }}>Go to setup</Text>
      </Pressable>
    </View>
  );
}

function PushToastLayer({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  const utils = trpc.useUtils();
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(12)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.timing(translate, { toValue: 12, duration: 160, useNativeDriver: true }),
    ]).start(() => setMessage(null));
  }, [opacity, translate]);

  const show = useCallback(
    (text: string) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setMessage(text);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.timing(translate, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start();
      hideTimer.current = setTimeout(hide, 2200);
    },
    [hide, opacity, translate]
  );

  trpc.ingestionEvents.onPush.useSubscription(undefined, {
    enabled: isSignedIn,
    onData: () => {
      void utils.tasks.listThin.invalidate();
      void utils.tasks.upcoming.invalidate();
      void utils.tasks.stats.invalidate({ upcomingDays: 7 });
      show('New task synced');
    },
    onError: (err) => {
      console.warn('push subscription error', err);
    },
  });

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <>
      {children}
      {message ? (
        <Animated.View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            bottom: 24,
            left: 16,
            right: 16,
            opacity,
            transform: [{ translateY: translate }],
          }}>
          <Text
            style={{
              textAlign: 'center',
              paddingVertical: 12,
              paddingHorizontal: 16,
              backgroundColor: '#1F2937',
              color: '#FFFFFF',
              borderRadius: 9999,
              overflow: 'hidden',
            }}>
            {message}
          </Text>
        </Animated.View>
      ) : null}
    </>
  );
}
