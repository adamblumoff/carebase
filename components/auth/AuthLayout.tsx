import React from 'react';
import { View } from 'react-native';

type Props = {
  children: React.ReactNode;
};

export function AuthLayout({ children }: Props) {
  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <View className="flex-1 px-6 pt-16">{children}</View>
    </View>
  );
}
