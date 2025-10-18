import { vi } from 'vitest';

export const ResponseType = {
  Code: 'code',
} as const;

export const useAutoDiscovery = vi.fn(() => ({
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
}));

const promptAsyncMock = vi.fn(async () => ({ type: 'dismiss', params: {} }));

export const useAuthRequest = vi.fn(() => [
  {
    codeVerifier: 'test-code-verifier',
    redirectUri: 'carebase://redirect',
  },
  null,
  promptAsyncMock,
]);

export const makeRedirectUri = vi.fn(() => 'carebase://redirect');

export { promptAsyncMock };
