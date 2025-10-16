import { jest } from '@jest/globals';

export const ResponseType = {
  Code: 'code',
} as const;

export const useAutoDiscovery = jest.fn(() => ({
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
}));

const promptAsyncMock = jest.fn(async () => ({ type: 'dismiss', params: {} }));

export const useAuthRequest = jest.fn(() => [
  {
    codeVerifier: 'test-code-verifier',
    redirectUri: 'carebase://redirect',
  },
  null,
  promptAsyncMock,
]);

export const makeRedirectUri = jest.fn(() => 'carebase://redirect');

export { promptAsyncMock };
