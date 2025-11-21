import React from 'react'
import { Text, View } from 'react-native'

type Props = {
  message?: string | null
}

export function ErrorBanner({ message }: Props) {
  if (!message) return null
  return (
    <View className="w-full rounded-md bg-red-50 border border-red-200 px-3 py-2">
      <Text className="text-red-700 text-sm">{message}</Text>
    </View>
  )
}
