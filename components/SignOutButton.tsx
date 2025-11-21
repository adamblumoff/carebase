import React, { useState } from 'react'
import { Pressable, Text } from 'react-native'
import { useAuth } from '@clerk/clerk-expo'
import { useRouter } from 'expo-router'

export function SignOutButton() {
  const { signOut } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleSignOut = async () => {
    setLoading(true)
    try {
      await signOut()
      router.replace('/(auth)/sign-in')
    } catch (error) {
      console.error('Sign out failed:', error)
      // Optionally show an error message to the user
    } finally {
      setLoading(false)
    }
  }

  return (
    <Pressable
      className="mt-4 rounded-md border border-gray-300 px-3 py-2"
      onPress={handleSignOut}
      disabled={loading}
      style={({ pressed }) => ({ opacity: loading ? 0.5 : pressed ? 0.8 : 1 })}
    >
      <Text className="text-base text-gray-800">{loading ? 'Signing out…' : 'Sign out'}</Text>
    </Pressable>
  )
}
