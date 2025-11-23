import { httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { QueryClient } from '@tanstack/react-query';

import type { AppRouter } from '@/api/trpc/root';

export const trpc = createTRPCReact<AppRouter>();

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });

export const createTrpcClient = (getToken: () => Promise<string | null>) => {
  const apiBaseUrl =
    (process.env.NODE_ENV === 'production'
      ? (process.env.EXPO_PUBLIC_API_BASE_URL_PROD ?? process.env.EXPO_PUBLIC_API_BASE_URL)
      : process.env.EXPO_PUBLIC_API_BASE_URL) ?? process.env.EXPO_PUBLIC_API_BASE_URL_PROD;

  if (!apiBaseUrl) {
    console.warn('TRPC client init: missing EXPO_PUBLIC_API_BASE_URL');
    throw new Error('Missing EXPO_PUBLIC_API_BASE_URL');
  }

  console.log(`TRPC client init: using ${apiBaseUrl}`);

  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${apiBaseUrl}/trpc`,
        async headers() {
          const token = await getToken();
          if (!token) {
            console.warn('TRPC client: no auth token returned for request');
          }
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
};
