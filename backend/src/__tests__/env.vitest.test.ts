import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('dotenv', () => ({
  default: {
    config: vi.fn()
  }
}));

const originalEnv = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  resetEnv();
});

afterEach(() => {
  resetEnv();
  vi.restoreAllMocks();
});

describe('env bootstrap', () => {
  it('fills deterministic secrets for tests without exiting', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://test-db';
    process.env.GOOGLE_CLIENT_ID = 'client';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    delete process.env.GOOGLE_AUTH_STATE_SECRET;
    delete process.env.GOOGLE_CREDENTIALS_ENCRYPTION_KEY;

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await import('../env.js');

    expect(process.env.GOOGLE_AUTH_STATE_SECRET).toBe('test-google-state-secret');
    expect(process.env.GOOGLE_CREDENTIALS_ENCRYPTION_KEY).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    expect(exitSpy).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('exits when required environment variables are missing', async () => {
    process.env.NODE_ENV = 'production';
    for (const key of ['DATABASE_URL', 'GOOGLE_AUTH_STATE_SECRET', 'GOOGLE_CREDENTIALS_ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
      delete process.env[key];
    }

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await import('../env.js');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
