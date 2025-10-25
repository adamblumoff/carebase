import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env.js', () => ({}));

const appMock = {
  use: vi.fn(),
  get: vi.fn(),
  set: vi.fn()
};

const jsonMiddleware = vi.fn();
const urlencodedMiddleware = vi.fn();

vi.mock('express', () => {
  const expressFn = vi.fn(() => appMock);
  expressFn.json = vi.fn(() => jsonMiddleware);
  expressFn.urlencoded = vi.fn(() => urlencodedMiddleware);
  return {
    default: expressFn
  };
});

const listenSpy = vi.fn((_port?: number, _host?: string, cb?: () => void) => {
  cb?.();
  return undefined;
});

vi.mock('http', () => ({
  createServer: vi.fn(() => ({
    listen: listenSpy
  }))
}));

const socketInstance = { on: vi.fn(), emit: vi.fn() };
const socketCtor = vi.fn(() => socketInstance);

vi.mock('socket.io', () => ({
  Server: socketCtor
}));

const clerkMiddlewareFn = vi.fn(() => 'clerk-middleware');
vi.mock('@clerk/express', () => ({
  clerkMiddleware: clerkMiddlewareFn
}));

const registerRoutes = vi.fn();
vi.mock('../routes/registry.js', () => ({
  registerRoutes
}));

const attachBearerUser = vi.fn((_req, _res, next) => next?.());
vi.mock('../middleware/attachBearerUser.js', () => ({
  attachBearerUser
}));

const initRealtime = vi.fn();
vi.mock('../services/realtime.js', () => ({
  initRealtime
}));

const startGoogleSyncPolling = vi.fn();
vi.mock('../services/googleSync.js', () => ({
  startGoogleSyncPolling
}));

const getClerkClient = vi.fn(() => ({}));
const configureClerkJwks = vi.fn();
vi.mock('../services/clerkAuthGateway.js', () => ({
  getClerkClient
}));
vi.mock('../services/clerkJwksManager.js', () => ({
  configureClerkJwks
}));

const bootstrapDatabase = vi.fn(() => Promise.resolve());
vi.mock('../db/bootstrap.js', () => ({
  bootstrapDatabase
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  Object.assign(process.env, originalEnv, {
    NODE_ENV: 'test',
    GOOGLE_SYNC_POLLING_ENABLED: 'true'
  });
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
  vi.restoreAllMocks();
});

describe('server bootstrap', () => {
  it('registers routes, realtime, and conditional polling', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('../server.js');
    const expressModule = await import('express');
    const verify = (expressModule.default.json as vi.Mock).mock.calls[0][0].verify as (
      req: any,
      res: any,
      buffer: Buffer
    ) => void;
    const req = {};
    verify(req, {}, Buffer.from('payload'));

    expect(registerRoutes).toHaveBeenCalledWith(appMock);
    expect(appMock.get).toHaveBeenCalledWith('/', expect.any(Function));
    expect(appMock.get).toHaveBeenCalledWith('/health', expect.any(Function));
    expect(appMock.use).toHaveBeenCalledWith(jsonMiddleware);
    expect(appMock.use).toHaveBeenCalledWith(urlencodedMiddleware);
    expect(appMock.use).toHaveBeenCalledWith(attachBearerUser);
    expect(initRealtime).toHaveBeenCalledWith(socketInstance);
    expect(bootstrapDatabase).toHaveBeenCalled();
    expect(configureClerkJwks).toHaveBeenCalled();
    expect(startGoogleSyncPolling).toHaveBeenCalled();
    expect(listenSpy).toHaveBeenCalledWith(3000, '0.0.0.0', expect.any(Function));
    expect(consoleLog).toHaveBeenCalledWith('Server running on http://localhost:3000');
    expect((req as any).rawBody).toBe('payload');
  });
});
