import React from 'react';
import { View } from 'react-native';

type Props = {
  children: React.ReactNode;
};

export function AuthLayout({ children }: Props) {
  return (
    <View className="flex-1 items-center justify-center bg-surface px-6 dark:bg-surface-dark">
      <View className="w-full max-w-sm">{children}</View>
    </View>
  );
}
