import '../global.css';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { PostHogProvider } from 'posthog-react-native';

import { createQueryClient, createTrpcClient, trpc } from '@/lib/trpc/client';

export default function Layout() {
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const posthogKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;

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
  const { getToken, isLoaded } = useAuth();
  const queryClient = useMemo(() => createQueryClient(), []);
  const [trpcClient, setTrpcClient] = useState<ReturnType<typeof createTrpcClient> | null>(null);
  const [clientError, setClientError] = useState<Error | null>(null);

  useEffect(() => {
    try {
      const client = createTrpcClient(() => getToken({ template: 'trpc' }));
      setTrpcClient(client);
      setClientError(null);
    } catch (error: any) {
      setClientError(error instanceof Error ? error : new Error(String(error)));
      setTrpcClient(null);
    }
  }, [getToken]);

  if (clientError) {
    return (
      <Text style={{ marginTop: 48, textAlign: 'center' }}>
        {clientError.message || 'Failed to init API client'}
      </Text>
    );
  }

  if (!isLoaded || !trpcClient) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        {children}
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
