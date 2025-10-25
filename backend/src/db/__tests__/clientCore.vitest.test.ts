import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakePoolClient {
  query = vi.fn(async () => ({ rowCount: 1 }));
  release = vi.fn(async () => undefined);
}

interface HandlerMap {
  [event: string]: Array<(...args: any[]) => void>;
}

let lastPool: FakePool | null = null;
let lastClient: FakePoolClient | null = null;

class FakePool {
  query = vi.fn(async () => ({ rowCount: 1 }));
  connect = vi.fn(async () => {
    lastClient = new FakePoolClient();
    return lastClient;
  });
  end = vi.fn(async () => undefined);
  handlers: HandlerMap = {};

  constructor(_config: any) {
    lastPool = this;
  }

  on(event: string, handler: (...args: any[]) => void) {
    this.handlers[event] ??= [];
    this.handlers[event].push(handler);
    return this;
  }

  emit(event: string, ...args: any[]) {
    for (const handler of this.handlers[event] ?? []) {
      handler(...args);
    }
  }
}

vi.mock('pg', () => ({
  default: {
    Pool: FakePool
  }
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  lastPool = null;
  lastClient = null;
  Object.assign(process.env, originalEnv, {
    DATABASE_URL: 'postgres://test-db'
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

describe('db client', () => {
  it('logs query metrics when DEBUG_SQL is enabled', async () => {
    process.env.DEBUG_SQL = 'true';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const clientModule = await import('../client.js');
    await clientModule.query('SELECT 1');

    expect(lastPool?.query).toHaveBeenCalledWith('SELECT 1', undefined);
    expect(logSpy).toHaveBeenCalledWith('Executed query', expect.objectContaining({ rows: 1 }));
  });

  it('wraps pooled client with lastQuery tracking', async () => {
    const clientModule = await import('../client.js');
    const client = await clientModule.getClient();

    await client.query('SELECT 42', [1]);
    expect((client as any).lastQuery).toEqual(['SELECT 42', [1]]);

    await client.release();
    expect(lastClient?.release).toHaveBeenCalled();
  });

  it('exits process on pool errors', async () => {
    const clientModule = await import('../client.js');
    const error = new Error('boom');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    lastPool?.emit('error', error);

    expect(errorSpy).toHaveBeenCalledWith('Unexpected error on idle client', error);
    expect(exitSpy).toHaveBeenCalledWith(-1);
  });

  it('ends the pool on teardown', async () => {
    const clientModule = await import('../client.js');
    await clientModule.end();
    expect(lastPool?.end).toHaveBeenCalled();
  });
});
