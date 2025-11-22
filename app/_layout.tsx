import '../global.css';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import React, { useEffect, useState } from 'react';

import { createQueryClient, createTrpcClient, trpc } from '@/lib/trpc/client';

export default function Layout() {
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

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
        <TrpcProvider>
          <AuthGate />
        </TrpcProvider>
      </SafeAreaProvider>
    </ClerkProvider>
  );
}

function TrpcProvider({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded } = useAuth();
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  const [queryClient] = useState(() => createQueryClient());
  const [trpcClient, setTrpcClient] = useState<ReturnType<typeof createTrpcClient> | null>(null);

  useEffect(() => {
    if (!isLoaded || !apiBaseUrl || trpcClient) return;

    const client = createTrpcClient(() => getToken({ template: 'trpc' }));
    setTrpcClient(client);
  }, [apiBaseUrl, getToken, isLoaded, trpcClient]);

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
