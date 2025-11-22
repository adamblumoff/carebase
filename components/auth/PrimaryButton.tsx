import React from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';

type Props = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

export function PrimaryButton({ title, onPress, loading = false, disabled = false }: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      className="w-full items-center justify-center rounded-lg bg-black py-3"
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => ({
        opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
      })}>
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text className="text-base font-semibold text-white">{title}</Text>
      )}
    </Pressable>
  );
}
