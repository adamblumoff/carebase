import React, { useState } from 'react'
import { Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useOAuth } from '@clerk/clerk-expo'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { PrimaryButton } from '@/components/auth/PrimaryButton'
import { ErrorBanner } from '@/components/auth/ErrorBanner'

export default function SignInScreen() {
  const router = useRouter()
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_google' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError(null)
    try {
      const { createdSessionId, setActive, signIn, signUp } = await startOAuthFlow()

      const sessionId =
        createdSessionId ??
        signIn?.createdSessionId ??
        signUp?.createdSessionId

      if (sessionId && setActive) {
        await setActive({ session: sessionId })
        router.replace('/')
        return
      }

      setError('Could not complete Google sign-in. Please try again.')
    } catch (err: any) {
      const message = err?.errors?.[0]?.message ?? err?.message ?? 'Something went wrong. Please try again.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <View className="gap-6">
        <View className="gap-2">
          <Text className="text-2xl font-semibold">Welcome back</Text>
          <Text className="text-base text-gray-600">Sign in with Google to continue.</Text>
        </View>

        <ErrorBanner message={error} />

        <PrimaryButton title="Continue with Google" onPress={handleGoogleSignIn} loading={loading} />
      </View>
    </AuthLayout>
  )
}
