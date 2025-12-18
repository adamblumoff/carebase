import '../global.css';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Animated, Platform, Text } from 'react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PostHogProvider } from 'posthog-react-native';
import { useFonts } from 'expo-font';
import { Roboto_500Medium } from '@expo-google-fonts/roboto';
import { useColorScheme } from 'nativewind';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { getDeviceTimeZone } from '@/lib/device-timezone';

import { createQueryClientAndPersister, createTrpcClient, trpc } from '@/lib/trpc/client';
import { useUserTheme } from '@/app/(hooks)/useUserTheme';
import { AuthGate, SetupGate, FullScreenLoading } from '@/components/gates';

export default function Layout() {
  const { colorScheme } = useColorScheme();
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const posthogKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  const [fontsLoaded] = useFonts({
    Roboto_500Medium,
  });

  if (!fontsLoaded) {
    return (
      <SafeAreaProvider>
        <FullScreenLoading title="Loading…" colorScheme={colorScheme} />
      </SafeAreaProvider>
    );
  }

  if (!publishableKey) {
    return (
      <SafeAreaProvider>
        <FullScreenLoading
          title="Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in .env"
          colorScheme={colorScheme}
        />
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
  const { colorScheme } = useColorScheme();
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
      <FullScreenLoading
        title="Missing EXPO_PUBLIC_API_BASE_URL in .env"
        colorScheme={colorScheme}
      />
    );
  }

  if (!isLoaded || !trpcClient)
    return <FullScreenLoading title="Loading…" colorScheme={colorScheme} />;

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <ThemeGate>{children}</ThemeGate>
      </trpc.Provider>
    </PersistQueryClientProvider>
  );
}

function ThemeGate({ children }: { children: React.ReactNode }) {
  const { themeReady } = useUserTheme();
  const { colorScheme } = useColorScheme();

  if (!themeReady) return <FullScreenLoading title="Loading…" colorScheme={colorScheme} />;
  return (
    <PushToastLayer>
      <DeviceRegistration />
      <SetupGate preload={<PreloadTasks />}>{children}</SetupGate>
    </PushToastLayer>
  );
}

function PreloadTasks() {
  const utils = trpc.useUtils();
  const { isSignedIn } = useAuth();

  useEffect(() => {
    if (!isSignedIn) return;
    utils.today.feed.prefetch().catch(() => {});
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
    utils.today.feed,
  ]);

  return null;
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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function registerForPushNotificationsAsync() {
  if (Platform.OS === 'web') return null;
  if (!Device.isDevice) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4A8F6A',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const projectId =
    (Constants.expoConfig as any)?.extra?.eas?.projectId ??
    (Constants as any)?.easConfig?.projectId ??
    null;

  const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return token.data;
}

function DeviceRegistration() {
  const { isSignedIn } = useAuth();
  const { mutate: mutateTimezone } = trpc.caregivers.setTimezone.useMutation();
  const { mutate: mutatePushToken } = trpc.pushTokens.register.useMutation();
  const didSyncTimezoneRef = useRef(false);
  const didRegisterPushRef = useRef(false);

  useEffect(() => {
    if (!isSignedIn) {
      didSyncTimezoneRef.current = false;
      return;
    }
    if (didSyncTimezoneRef.current) return;
    const tz = getDeviceTimeZone();
    if (!tz) return;
    didSyncTimezoneRef.current = true;
    mutateTimezone({ timezone: tz });
  }, [isSignedIn, mutateTimezone]);

  useEffect(() => {
    if (!isSignedIn) {
      didRegisterPushRef.current = false;
      return;
    }
    if (didRegisterPushRef.current) return;
    didRegisterPushRef.current = true;

    let cancelled = false;
    void (async () => {
      const token = await registerForPushNotificationsAsync();
      if (cancelled) return;
      if (!token) return;
      const platform =
        Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
      mutatePushToken({ token, platform });
    })();

    return () => {
      cancelled = true;
    };
  }, [isSignedIn, mutatePushToken]);

  return null;
}
