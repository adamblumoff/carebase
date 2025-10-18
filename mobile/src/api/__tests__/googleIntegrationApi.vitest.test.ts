import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginGoogleIntegrationConnect,
  disconnectGoogleIntegration,
  fetchGoogleIntegrationStatus,
  triggerGoogleManualSync,
} from '../googleIntegration';

const getMock = vi.fn();
const postMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('../client', () => ({
  default: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
    delete: (...args: unknown[]) => deleteMock(...args),
  },
}));

describe('google integration API', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    deleteMock.mockReset();
  });

  it('fetchGoogleIntegrationStatus returns status payload', async () => {
    const payload = { connected: true, calendarId: 'primary' };
    getMock.mockResolvedValue({ data: payload });

    const result = await fetchGoogleIntegrationStatus();

    expect(getMock).toHaveBeenCalledWith('/api/integrations/google/status');
    expect(result).toBe(payload);
  });

  it('beginGoogleIntegrationConnect posts to start endpoint', async () => {
    const data = { authUrl: 'https://auth', redirectUri: 'https://cb' };
    postMock.mockResolvedValue({ data });

    const result = await beginGoogleIntegrationConnect();

    expect(postMock).toHaveBeenCalledWith('/api/integrations/google/connect/start');
    expect(result).toBe(data);
  });

  it('disconnectGoogleIntegration deletes integration', async () => {
    deleteMock.mockResolvedValue(undefined);

    await disconnectGoogleIntegration();

    expect(deleteMock).toHaveBeenCalledWith('/api/integrations/google/connect');
  });

  it('triggerGoogleManualSync posts options and logs summary in non-production', async () => {
    const summary = { pushed: 1, pulled: 2, deleted: 0, calendarId: 'primary', errors: [] };
    postMock.mockResolvedValue({ data: summary });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await triggerGoogleManualSync({ forceFull: true, calendarId: 'primary', pullRemote: false });

    expect(postMock).toHaveBeenCalledWith('/api/integrations/google/sync', {
      forceFull: true,
      calendarId: 'primary',
      pullRemote: false,
    });
    expect(logSpy).toHaveBeenCalledWith('[GoogleSync] summary', JSON.stringify(summary));
    expect(result).toBe(summary);

    logSpy.mockRestore();
  });
});
