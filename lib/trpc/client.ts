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

export const createTrpcClient = (getToken: () => Promise<string | null>) =>
  trpc.createClient({
    links: [
      httpBatchLink({
        url: `${process.env.EXPO_PUBLIC_API_BASE_URL}/trpc`,
        async headers() {
          const token = await getToken();

          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
