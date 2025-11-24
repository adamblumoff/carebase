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
  }, [utils.tasks.list]);

  return (
    <View className="flex flex-1 bg-surface px-4 dark:bg-surface-dark">
      <Stack.Screen options={{ title: 'Home' }} />
    </View>
  );
}
