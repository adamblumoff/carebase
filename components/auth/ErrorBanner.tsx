import React from 'react';
import { Text, View } from 'react-native';

type Props = {
  message?: string | null;
};

export function ErrorBanner({ message }: Props) {
  if (!message) return null;
  return (
    <View className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-2">
      <Text className="text-sm text-red-700">{message}</Text>
    </View>
  );
}
