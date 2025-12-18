import { createWSClient, httpBatchLink, splitLink, wsLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { QueryClient } from '@tanstack/react-query';
import {
  createAsyncStoragePersister,
  type AsyncStoragePersister,
} from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AppRouter } from '@/api/trpc/root';

export const trpc = createTRPCReact<AppRouter>();

export const createQueryClientAndPersister = () => {
  const queryClient = new QueryClient({
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

  const persister: AsyncStoragePersister = createAsyncStoragePersister({
    storage: AsyncStorage,
    key: 'carebase-query-cache',
    throttleTime: 1000,
  });

  return { queryClient, persister };
};

const jsonGuardFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const preview = await res.text().catch(() => '');
    const err = new Error(
      `Unexpected API response (status ${res.status}); check EXPO_PUBLIC_API_BASE_URL. Preview: ${preview.slice(
        0,
        200
      )}`
    );
    // Surface status so tRPC error logging has more context.
    (err as any).status = res.status;
    throw err;
  }
  return res;
};

export const createTrpcClient = (getToken: () => Promise<string | null>) => {
  const useProd =
    process.env.EXPO_PUBLIC_APP_ENV === 'prod' ||
    process.env.APP_ENV === 'prod' ||
    process.env.NODE_ENV === 'production';
  const apiBaseUrl = useProd
    ? (process.env.EXPO_PUBLIC_API_BASE_URL_PROD ?? process.env.EXPO_PUBLIC_API_BASE_URL)
    : process.env.EXPO_PUBLIC_API_BASE_URL;

  if (!apiBaseUrl) {
    console.warn('TRPC client init: missing EXPO_PUBLIC_API_BASE_URL');
    throw new Error('Missing EXPO_PUBLIC_API_BASE_URL');
  }

  console.log(`TRPC client init: using ${apiBaseUrl}`);

  const wsUrl = (() => {
    try {
      const url = new URL(apiBaseUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = '/trpc';
      return url.toString();
    } catch {
      return null;
    }
  })();

  const wsClient = wsUrl
    ? createWSClient({
        url: wsUrl,
        lazy: true,
        connectionParams: async () => {
          const token = await getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        onOpen: () => console.log('[trpc-ws] open'),
        onClose: () => console.log('[trpc-ws] close'),
        onError: (err) => console.warn('[trpc-ws] error', err),
      })
    : null;

  return trpc.createClient({
    links: [
      wsClient
        ? splitLink({
            condition: (op) => op.type === 'subscription',
            true: wsLink({ client: wsClient }),
            false: httpBatchLink({
              url: `${apiBaseUrl}/trpc`,
              method: 'POST',
              fetch: jsonGuardFetch,
              maxBatchSize: 10,
              async headers() {
                const token = await getToken();
                if (!token) {
                  console.warn('TRPC client: no auth token returned for request');
                }
                return token ? { Authorization: `Bearer ${token}` } : {};
              },
            }),
          })
        : httpBatchLink({
            url: `${apiBaseUrl}/trpc`,
            method: 'POST',
            fetch: jsonGuardFetch,
            maxBatchSize: 10,
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
