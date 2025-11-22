import React from 'react';
import { View } from 'react-native';

type Props = {
  children: React.ReactNode;
};

export function AuthLayout({ children }: Props) {
  return (
    <View className="flex-1 bg-white">
      <View className="flex-1 px-6 pt-16">{children}</View>
    </View>
  );
}
