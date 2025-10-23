import { describe, expect, it, beforeEach, vi } from 'vitest';
import apiClient from '../client';
import { authEvents } from '../../auth/authEvents';
import { fetchClerkSessionToken } from '../../auth/clerkTokenCache';

vi.mock('../../auth/clerkTokenCache', () => ({
  fetchClerkSessionToken: vi.fn()
}));

const mockedTokenFetcher = fetchClerkSessionToken as unknown as ReturnType<typeof vi.fn>;

const requestHandler = apiClient.interceptors.request.handlers[0].fulfilled!;
const responseErrorHandler = apiClient.interceptors.response.handlers[0].rejected!;

describe('api client interceptors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedTokenFetcher.mockResolvedValue(null);
  });

  it('adds bearer token when stored', async () => {
    mockedTokenFetcher.mockResolvedValue('token-123');

    const config = await requestHandler({ headers: {} } as any);

    expect(config.headers.Authorization).toBe('Bearer token-123');
  });

  it('skips authorization header when no token', async () => {
    mockedTokenFetcher.mockResolvedValue(null);

    const config = await requestHandler({ headers: {} } as any);

    expect(config.headers.Authorization).toBeUndefined();
  });

  it('logs when token lookup fails', async () => {
    mockedTokenFetcher.mockRejectedValue(new Error('storage failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await requestHandler({ headers: {} } as any);

    expect(errorSpy).toHaveBeenCalledWith('[API] Failed to resolve Clerk session token:', expect.any(Error));
    errorSpy.mockRestore();
  });

  it('emits unauthorized event on 401 responses', async () => {
    const emitSpy = vi.spyOn(authEvents, 'emitUnauthorized');

    await expect(
      responseErrorHandler({
        config: {
          headers: {
            Authorization: 'Bearer token-123'
          }
        },
        response: {
          status: 401,
          data: { message: 'Unauthorized' }
        }
      })
    ).rejects.toMatchObject({ response: { status: 401 } });

    expect(emitSpy).toHaveBeenCalled();
    emitSpy.mockRestore();
  });

  it('skips unauthorized emission when no bearer token was sent', async () => {
    const emitSpy = vi.spyOn(authEvents, 'emitUnauthorized');

    await expect(
      responseErrorHandler({
        response: {
          status: 401,
          data: { message: 'Unauthorized' }
        }
      })
    ).rejects.toMatchObject({ response: { status: 401 } });

    expect(emitSpy).not.toHaveBeenCalled();
    emitSpy.mockRestore();
  });

  it('logs network errors without response payload', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      responseErrorHandler({
        message: 'Network down'
      })
    ).rejects.toMatchObject({ message: 'Network down' });

    expect(errorSpy).toHaveBeenCalledWith('[API] Network error:', 'Network down');
    errorSpy.mockRestore();
  });
});
