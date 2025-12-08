import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'nativewind';
import { View } from 'react-native';

import { trpc } from '@/lib/trpc/client';

export default function Home() {
  useColorScheme();
  const utils = trpc.useUtils();

  useEffect(() => {
    utils.tasks.list.prefetch().catch((err) => {
      console.warn('tasks.list prefetch failed', err);
    });

    const filters = ['appointment', 'bill', 'medication', 'general'] as const;
    filters.forEach((type) => {
      utils.tasks.list.prefetch({ type }).catch(() => {});
    });

    // Warm recent ingestion events for Sync banner/indicators.
    utils.ingestionEvents.recent.prefetch({ limit: 1 }).catch(() => {});
  }, [utils.tasks.list]);

  return (
    <View className="flex flex-1 bg-surface px-4 dark:bg-surface-dark">
      <Stack.Screen options={{ title: 'Home' }} />
    </View>
  );
}
