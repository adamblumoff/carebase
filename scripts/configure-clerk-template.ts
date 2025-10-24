import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import url from 'node:url';
import { config as loadEnv } from 'dotenv';

const DEFAULT_IDENTIFIER = process.env.CLERK_JWT_TEMPLATE_NAME ?? 'carebase-backend';
const DEFAULT_NAME = 'carebase-backend';
const TOKEN_LIFETIME_SECONDS = 30 * 60; // 30 minutes

function loadDotEnv(): void {
  const envPath = path.join(process.cwd(), '.env.development.local');
  if (fs.existsSync(envPath)) {
    loadEnv({ path: envPath });
  }
}

async function clerkRequest<T>(
  method: 'GET' | 'POST' | 'PATCH',
  pathname: string,
  body?: Record<string, unknown>,
  apiBase = '/v2'
): Promise<T> {
  const apiUrl = process.env.CLERK_API_URL ?? 'https://api.clerk.com';
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error('CLERK_SECRET_KEY is required to configure the JWT template.');
  }

  const apiVersion = process.env.CLERK_API_VERSION ?? '2025-04-10';
  const endpoint = new url.URL(`${apiBase}${pathname}`, apiUrl);

  const response = await fetch(endpoint, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secretKey}`,
      'Clerk-API-Version': apiVersion
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const error = new Error(
      `Clerk API ${method} ${endpoint.pathname} failed with ${response.status}: ${errorBody}`
    ) as Error & { status?: number };
    (error as any).status = response.status;
    throw error;
  }

  return (await response.json()) as T;
}

async function ensureTemplate(): Promise<void> {
  const identifier = DEFAULT_IDENTIFIER;

  let listResponse:
    | { data?: Array<{ id: string; identifier: string }> }
    | Array<{ id: string; identifier: string }>;
  try {
    listResponse = await clerkRequest('GET', '/jwt_templates?limit=100');
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      listResponse = await clerkRequest('GET', '/jwt_templates?limit=100', undefined, '/v1');
    } else {
      throw error;
    }
  }

  const templates =
    Array.isArray(listResponse) ? listResponse : listResponse?.data ?? [];
  const existing = templates.find((template) => template.identifier === identifier);

  const basePayload = {
    session_based: true,
    token_lifetime: TOKEN_LIFETIME_SECONDS,
    claims: {
      session_id: '{{ session.id }}'
    }
  };

  if (!existing) {
    try {
      await clerkRequest('POST', '/jwt_templates', { identifier, name: DEFAULT_NAME, ...basePayload });
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        await clerkRequest('POST', '/jwt_templates', { identifier, ...basePayload }, '/v1');
      } else {
        throw error;
      }
    }
    console.log(`Created Clerk JWT template "${identifier}" with 30 minute lifetime.`);
  } else {
    try {
      await clerkRequest('PATCH', `/jwt_templates/${existing.id}`, { name: DEFAULT_NAME, ...basePayload });
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        await clerkRequest('PATCH', `/jwt_templates/${existing.id}`, basePayload, '/v1');
      } else {
        throw error;
      }
    }
    console.log(`Updated Clerk JWT template "${identifier}" with 30 minute lifetime.`);
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  await ensureTemplate();
}

main().catch((error) => {
  const status = (error as { status?: number }).status;
  if (status === 404 || status === 422) {
    console.error(
      'Clerk API did not accept the automated template configuration. Please create or update the "carebase-backend" template manually via the Clerk dashboard with a 30 minute token lifetime and `session_id` claim.'
    );
  } else {
    console.error('Failed to configure Clerk JWT template:', error);
  }
  process.exitCode = 1;
});
