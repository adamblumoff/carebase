import type { ClerkUser } from './clerkSyncService.js';

const DEFAULT_API_URL = 'https://api.clerk.dev';

class ClerkRestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getApiBase(): string {
  return process.env.CLERK_API_URL ?? DEFAULT_API_URL;
}

function getSecretKey(): string | null {
  return process.env.CLERK_SECRET_KEY ?? null;
}

async function restRequest<T>(path: string, searchParams?: Record<string, string | number | undefined>): Promise<T> {
  const secretKey = getSecretKey();
  if (!secretKey) {
    throw new ClerkRestError('CLERK_SECRET_KEY is not configured', 401);
  }

  const base = getApiBase();
  const url = new URL(path, base);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json'
    }
  });

  if (response.status === 404) {
    throw new ClerkRestError('Not Found', 404);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ClerkRestError(text || `Clerk request failed (${response.status})`, response.status);
  }

  return (await response.json()) as T;
}

type FetchUserListResponse = {
  data?: ClerkUser[];
  [key: string]: unknown;
} | ClerkUser[];

export async function fetchClerkUserById(userId: string): Promise<ClerkUser | null> {
  try {
    return await restRequest<ClerkUser>(`/v1/users/${userId}`);
  } catch (error) {
    if (error instanceof ClerkRestError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function fetchClerkUserByEmail(email: string): Promise<ClerkUser | null> {
  const params = { email_address: email.toLowerCase(), limit: 1 };
  try {
    const result = await restRequest<FetchUserListResponse>('/v1/users', params);
    const list = Array.isArray(result) ? result : result?.data ?? [];
    if (!Array.isArray(list) || list.length === 0) {
      return null;
    }
    return list[0] ?? null;
  } catch (error) {
    if (error instanceof ClerkRestError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function listClerkUsers(limit = 100): Promise<ClerkUser[]> {
  const result = await restRequest<FetchUserListResponse>('/v1/users', { limit });
  return Array.isArray(result) ? result : result?.data ?? [];
}

