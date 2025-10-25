import type { Request, Response, NextFunction } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  startGoogleIntegration: vi.fn(),
  handleGoogleCallback: vi.fn(),
  loadGoogleIntegrationStatus: vi.fn(),
  connectGoogleIntegration: vi.fn(),
  disconnectGoogleIntegration: vi.fn(),
  manualGoogleSync: vi.fn(),
  verifyUser: vi.fn()
}));

const validationMocks = vi.hoisted(() => ({
  validateBody: vi.fn()
}));

const googleSyncMocks = vi.hoisted(() => ({
  handleGoogleWatchNotification: vi.fn()
}));

vi.mock('../../../../services/googleIntegrationService.js', () => serviceMocks);
vi.mock('../../../../utils/validation.js', () => validationMocks);
vi.mock('../../../../services/googleSync.js', () => googleSyncMocks);

const {
  startGoogleIntegration,
  handleGoogleCallback,
  loadGoogleIntegrationStatus,
  connectGoogleIntegration,
  disconnectGoogleIntegration,
  manualGoogleSync,
  verifyUser
} = serviceMocks;
const { validateBody } = validationMocks;
const { handleGoogleWatchNotification } = googleSyncMocks;

const module = await import('../google.js');
const {
  startGoogleIntegrationHandler,
  googleIntegrationCallbackHandler,
  getGoogleIntegrationStatusHandler,
  connectGoogleIntegrationHandler,
  disconnectGoogleIntegrationHandler,
  manualGoogleSyncHandler,
  googleIntegrationWebhookHandler
} = module;

function responseStub() {
  const res = {
    status: vi.fn(function (this: Response) {
      return this;
    }),
    json: vi.fn(function (this: Response) {
      return this;
    }),
    redirect: vi.fn(),
    end: vi.fn()
  } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    redirect: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };

  res.status = vi.fn((code: number) => {
    (res as any).__status = code;
    return res;
  });
  res.json = vi.fn((payload: unknown) => {
    (res as any).__json = payload;
    return res;
  });
  return res;
}

const next: NextFunction = vi.fn();
const user = { id: 42 } as any;

describe('google integration controllers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('startGoogleIntegrationHandler returns auth config for authenticated user', async () => {
    const res = responseStub();
    startGoogleIntegration.mockResolvedValueOnce({ authUrl: 'https://google', redirectUri: 'https://app/callback' });

    await startGoogleIntegrationHandler({ user } as Request, res, next);

    expect(startGoogleIntegration).toHaveBeenCalledWith(user);
    expect(res.json).toHaveBeenCalledWith({ authUrl: 'https://google', redirectUri: 'https://app/callback' });
  });

  it('startGoogleIntegrationHandler responds 401 when user missing', async () => {
    const res = responseStub();
    await startGoogleIntegrationHandler({} as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated', details: undefined });
  });

  it('googleIntegrationCallbackHandler redirects to returned url', async () => {
    const res = responseStub();
    handleGoogleCallback.mockResolvedValueOnce({ redirect: 'carebase://success' });

    await googleIntegrationCallbackHandler({ query: { code: 'abc', state: '123' } } as any, res);

    expect(handleGoogleCallback).toHaveBeenCalledWith({ code: 'abc', state: '123' });
    expect(res.redirect).toHaveBeenCalledWith('carebase://success');
  });

  it('getGoogleIntegrationStatusHandler returns status json', async () => {
    const res = responseStub();
    verifyUser.mockResolvedValueOnce(user);
    loadGoogleIntegrationStatus.mockResolvedValueOnce({ connected: true });

    await getGoogleIntegrationStatusHandler({ user } as Request, res, next);

    expect(loadGoogleIntegrationStatus).toHaveBeenCalledWith(user);
    expect(res.json).toHaveBeenCalledWith({ connected: true });
  });

  it('connectGoogleIntegrationHandler validates body and forwards to service', async () => {
    const res = responseStub();
    verifyUser.mockResolvedValueOnce(user);
    validateBody.mockReturnValueOnce({ accessToken: 'token' });
    connectGoogleIntegration.mockResolvedValueOnce({ connected: true });

    await connectGoogleIntegrationHandler({ user, body: {} } as Request, res, next);

    expect(connectGoogleIntegration).toHaveBeenCalledWith(user, { accessToken: 'token' });
    expect(res.json).toHaveBeenCalledWith({ connected: true });
  });

  it('disconnectGoogleIntegrationHandler returns result', async () => {
    const res = responseStub();
    verifyUser.mockResolvedValueOnce(user);
    disconnectGoogleIntegration.mockResolvedValueOnce({ disconnected: true });

    await disconnectGoogleIntegrationHandler({ user } as Request, res, next);

    expect(disconnectGoogleIntegration).toHaveBeenCalledWith(user);
    expect(res.json).toHaveBeenCalledWith({ disconnected: true });
  });

  it('manualGoogleSyncHandler uses validated payload', async () => {
    const res = responseStub();
    verifyUser.mockResolvedValueOnce(user);
    validateBody.mockReturnValueOnce({ forceFull: true, pullRemote: true, calendarId: 'primary' });
    manualGoogleSync.mockResolvedValueOnce({ pulled: 3 });

    await manualGoogleSyncHandler({ user, body: {} } as Request, res, next);

    expect(manualGoogleSync).toHaveBeenCalledWith(user, {
      forceFull: true,
      calendarId: 'primary',
      pullRemote: true
    });
    expect(res.json).toHaveBeenCalledWith({ pulled: 3 });
  });

  it('googleIntegrationWebhookHandler returns 204 on success', async () => {
    const res = responseStub();
    handleGoogleWatchNotification.mockResolvedValueOnce(undefined);

    await googleIntegrationWebhookHandler({ headers: { foo: 'bar' } } as Request, res);

    expect(handleGoogleWatchNotification).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('googleIntegrationWebhookHandler returns 500 on failure', async () => {
    const res = responseStub();
    const error = new Error('boom');
    handleGoogleWatchNotification.mockRejectedValueOnce(error);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await googleIntegrationWebhookHandler({ headers: {} } as Request, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.end).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
  });
});
