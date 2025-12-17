import React, { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-expo';
import { Slot, router, useSegments } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useColorScheme } from 'nativewind';

import { trpc } from '@/lib/trpc/client';

export function AuthGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const segments = useSegments();
  const { colorScheme } = useColorScheme();

  useEffect(() => {
    if (!isLoaded) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!isSignedIn && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
    } else if (isSignedIn && inAuthGroup) {
      router.replace('/');
    }
  }, [isLoaded, isSignedIn, segments]);

  if (!isLoaded) return <FullScreenLoading title="Loading…" colorScheme={colorScheme} />;

  const backgroundColor = colorScheme === 'dark' ? '#1C2521' : '#F5F7F6';
  return (
    <View style={{ flex: 1, backgroundColor }}>
      <Slot />
    </View>
  );
}

export function SetupGate({
  children,
  preload,
}: {
  children: React.ReactNode;
  preload?: React.ReactNode;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const segments = useSegments();
  const { colorScheme } = useColorScheme();
  const [showMembershipError, setShowMembershipError] = useState(false);

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
    if (membershipQuery.isError && !membershipQuery.isFetching && !shouldRouteToSetup) {
      const timer = setTimeout(() => setShowMembershipError(true), 500);
      return () => clearTimeout(timer);
    }
    setShowMembershipError(false);
  }, [membershipQuery.isError, membershipQuery.isFetching, shouldRouteToSetup]);

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
    shouldRouteToSetup,
  ]);

  if (!isSignedIn) return <>{children}</>;

  if (membershipQuery.isSuccess) {
    return (
      <>
        {preload ?? null}
        {children}
      </>
    );
  }

  if (shouldRouteToSetup) {
    if (!isInSetupRoute) return <FullScreenLoading title="Loading…" colorScheme={colorScheme} />;
    return <>{children}</>;
  }

  if (membershipQuery.isLoading || membershipQuery.isFetching || !showMembershipError) {
    return <FullScreenLoading title="Loading…" colorScheme={colorScheme} />;
  }

  const message = membershipQuery.error?.message ?? 'Could not load your CareHub.';
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

export function FullScreenLoading({
  title,
  colorScheme,
}: {
  title: string;
  colorScheme?: 'light' | 'dark';
}) {
  const backgroundColor = colorScheme === 'dark' ? '#1C2521' : '#F5F7F6';
  const textColor = colorScheme === 'dark' ? '#FFFFFF' : '#0E1A14';
  return (
    <View style={{ flex: 1, backgroundColor, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ textAlign: 'center', color: textColor, paddingHorizontal: 20 }}>{title}</Text>
    </View>
  );
}
