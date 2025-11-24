import '../global.css';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import React, { useEffect, useMemo } from 'react';
import { PostHogProvider } from 'posthog-react-native';
import { useFonts } from 'expo-font';
import { Roboto_500Medium } from '@expo-google-fonts/roboto';
import { useColorScheme } from 'nativewind';

import { createQueryClient, createTrpcClient, trpc } from '@/lib/trpc/client';
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
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const apiBaseUrl =
    process.env.NODE_ENV === 'production'
      ? (process.env.EXPO_PUBLIC_API_BASE_URL_PROD ?? process.env.EXPO_PUBLIC_API_BASE_URL)
      : process.env.EXPO_PUBLIC_API_BASE_URL;
  const queryClient = useMemo(() => createQueryClient(), []);
  const trpcClient = useMemo(() => {
    if (!apiBaseUrl) return null;
    return createTrpcClient(() => getToken({ template: 'trpc' }));
  }, [apiBaseUrl, getToken]);

  // Clear all cached data when the signed-in user changes to avoid cross-account leakage.
  useEffect(() => {
    if (!isLoaded) return;
    queryClient.clear();
  }, [isLoaded, isSignedIn, queryClient]);

  if (!apiBaseUrl) {
    return (
      <Text style={{ marginTop: 48, textAlign: 'center' }}>
        Missing EXPO_PUBLIC_API_BASE_URL in .env
      </Text>
    );
  }

  if (!isLoaded || !trpcClient) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <ThemeGate>{children}</ThemeGate>
      </trpc.Provider>
    </QueryClientProvider>
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
  return <>{children}</>;
}
