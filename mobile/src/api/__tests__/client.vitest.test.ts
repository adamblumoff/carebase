import AsyncStorage from '@react-native-async-storage/async-storage';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import apiClient from '../client';
import { authEvents } from '../../auth/authEvents';

const mockedAsyncStorage = AsyncStorage as unknown as {
  getItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
};

const requestHandler = apiClient.interceptors.request.handlers[0].fulfilled!;
const responseErrorHandler = apiClient.interceptors.response.handlers[0].rejected!;

describe('api client interceptors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAsyncStorage.getItem.mockResolvedValue(null);
    mockedAsyncStorage.removeItem.mockResolvedValue(undefined as any);
  });

  it('adds bearer token when stored', async () => {
    mockedAsyncStorage.getItem.mockResolvedValue('token-123');

    const config = await requestHandler({ headers: {} } as any);

    expect(config.headers.Authorization).toBe('Bearer token-123');
  });

  it('skips authorization header when no token', async () => {
    mockedAsyncStorage.getItem.mockResolvedValue(null);

    const config = await requestHandler({ headers: {} } as any);

    expect(config.headers.Authorization).toBeUndefined();
  });

  it('emits unauthorized event on 401 responses', async () => {
    const emitSpy = vi.spyOn(authEvents, 'emitUnauthorized');

    await expect(
      responseErrorHandler({
        response: {
          status: 401,
          data: { message: 'Unauthorized' }
        }
      })
    ).rejects.toMatchObject({ response: { status: 401 } });

    expect(mockedAsyncStorage.removeItem).toHaveBeenCalledWith('accessToken');
    expect(emitSpy).toHaveBeenCalled();
  });
});
