/**
 * Environment parsing helpers for the mobile app.
 */

const rawEnv = typeof process !== 'undefined' && process.env ? process.env : {};

export const DEFAULT_DEV_URL = 'http://localhost:3000';
export const DEFAULT_PROD_URL = 'https://carebase.dev';

export function readEnv(key: string): string | undefined {
  const value = rawEnv[key];
  return typeof value === 'string' ? value : undefined;
}

export const API_BASE_URL =
  readEnv('EXPO_PUBLIC_API_BASE_URL') ||
  (__DEV__ ? DEFAULT_DEV_URL : DEFAULT_PROD_URL);

export const CLERK_PUBLISHABLE_KEY =
  readEnv('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY') ||
  readEnv('CLERK_PUBLISHABLE_KEY') ||
  '';

export const CLERK_SIGN_IN_URL =
  readEnv('EXPO_PUBLIC_CLERK_SIGN_IN_URL') || readEnv('CLERK_SIGN_IN_URL') || undefined;

export const CLERK_SIGN_UP_URL =
  readEnv('EXPO_PUBLIC_CLERK_SIGN_UP_URL') || readEnv('CLERK_SIGN_UP_URL') || undefined;

export const CLERK_JWT_TEMPLATE =
  readEnv('EXPO_PUBLIC_CLERK_JWT_TEMPLATE') || readEnv('CLERK_JWT_TEMPLATE') || undefined;
