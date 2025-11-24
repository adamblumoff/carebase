import { useAuth, useUser } from '@clerk/clerk-expo';
import { useEffect, useCallback, useState } from 'react';
import { useColorScheme } from 'nativewind';

import { trpc } from '@/lib/trpc/client';

export type ThemePreference = 'light' | 'dark';

export function useUserTheme() {
  const { isLoaded: isAuthLoaded, isSignedIn, getToken } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();
  const { colorScheme, setColorScheme, systemColorScheme } = useColorScheme();
  const utils = trpc.useUtils();
  const [tokenReady, setTokenReady] = useState(false);
  const [hasTriedFetch, setHasTriedFetch] = useState(false);

  // Ensure we have a Clerk token before enabling TRPC queries to avoid initial 401s that block theme sync.
  useEffect(() => {
    if (!isSignedIn) {
      setTokenReady(false);
      return;
    }

    let mounted = true;
    getToken({ template: 'trpc' })
      .then(() => {
        if (mounted) setTokenReady(true);
      })
      .catch(() => {
        if (mounted) setTokenReady(true); // still allow query to proceed; retry logic will handle
      });

    return () => {
      mounted = false;
    };
  }, [getToken, isSignedIn]);

  const updateTheme = trpc.userTheme.set.useMutation({
    onMutate: async (variables) => {
      await utils.userTheme.get.cancel();
      const previousTheme = utils.userTheme.get.getData();

      setColorScheme(variables.themePreference);
      utils.userTheme.get.setData(undefined, { themePreference: variables.themePreference });

      return { previousTheme, previousColorScheme: colorScheme };
    },
    onSuccess: (data) => {
      setColorScheme(data.themePreference);
      utils.userTheme.get.setData(undefined, { themePreference: data.themePreference });
    },
    onError: (_error, _vars, context) => {
      const fallbackTheme = (context?.previousTheme as any)?.themePreference;
      if (fallbackTheme) setColorScheme(fallbackTheme);
      if (context?.previousTheme) {
        utils.userTheme.get.setData(undefined, context.previousTheme as any);
      }
    },
    onSettled: () => {
      utils.userTheme.get.invalidate();
    },
  });

  const themeQuery = trpc.userTheme.get.useQuery(undefined, {
    enabled: isSignedIn && !!user?.id && tokenReady,
    staleTime: 0,
    retry: 1,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    onSuccess: (data) => {
      setColorScheme(data.themePreference);
      setHasTriedFetch(true);
    },
    onError: () => {
      setHasTriedFetch(true);
    },
  });
  const { refetch } = themeQuery;

  useEffect(() => {
    if (updateTheme.isPending) return;
    if (themeQuery.isSuccess && themeQuery.data?.themePreference) {
      if (themeQuery.data.themePreference !== colorScheme) {
        setColorScheme(themeQuery.data.themePreference);
      }
    }
  }, [
    colorScheme,
    setColorScheme,
    themeQuery.data?.themePreference,
    themeQuery.isSuccess,
    updateTheme.isPending,
  ]);

  useEffect(() => {
    if (isSignedIn && user?.id) {
      refetch();
    }
  }, [isSignedIn, user?.id, refetch]);

  useEffect(() => {
    if (isAuthLoaded && isUserLoaded && !isSignedIn) {
      setColorScheme('dark');
    }
  }, [isAuthLoaded, isUserLoaded, isSignedIn, setColorScheme]);

  const setUserTheme = useCallback(
    (nextTheme: ThemePreference) => {
      setColorScheme(nextTheme); // optimistic
      if (isSignedIn && user?.id) {
        updateTheme.mutate({ themePreference: nextTheme });
      }
    },
    [isSignedIn, setColorScheme, updateTheme, user?.id]
  );

  const resetTheme = useCallback(() => {
    const fallback = 'dark';
    setUserTheme(fallback as ThemePreference);
  }, [setUserTheme, systemColorScheme]);

  return {
    colorScheme,
    systemColorScheme,
    isDark: colorScheme === 'dark',
    setUserTheme,
    resetTheme,
    isFetching: themeQuery.isLoading || themeQuery.isRefetching,
    isUpdating: updateTheme.isPending,
    themeReady:
      !isSignedIn ||
      (!themeQuery.enabled) ||
      themeQuery.isSuccess ||
      hasTriedFetch,
  };
}
