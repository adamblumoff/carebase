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

  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${apiBaseUrl}/trpc`,
        method: 'POST',
        fetch: jsonGuardFetch,
        // Disable batching for now; batched GET URLs were 404ing with the fastify CJS adapter/prefix combo.
        // Single-procedure POSTs are stable and low overhead at our current scale.
        maxBatchSize: 1,
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
