import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const collaboratorMocks = vi.hoisted(() => ({
  ensureCollaboratorSchema: vi.fn().mockResolvedValue(undefined)
}));

const googleMocks = vi.hoisted(() => ({
  ensureGoogleIntegrationSchema: vi.fn().mockResolvedValue(undefined)
}));

let bootstrapDatabase: (typeof import('../bootstrap.js'))['bootstrapDatabase'];

describe('bootstrapDatabase', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock('../queries/collaborators.js', () => collaboratorMocks);
    vi.doMock('../queries/google.js', () => googleMocks);
    ({ bootstrapDatabase } = await import('../bootstrap.js'));
  });

  afterEach(() => {
    vi.unmock('../queries/collaborators.js');
    vi.unmock('../queries/google.js');
  });

  it('initializes collaborator and google schemas in parallel', async () => {
    await bootstrapDatabase();

    expect(collaboratorMocks.ensureCollaboratorSchema).toHaveBeenCalledTimes(1);
    expect(googleMocks.ensureGoogleIntegrationSchema).toHaveBeenCalledTimes(1);
  });
});

describe('migrate script', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unmock('../client.js');
    vi.unmock('fs');
    vi.unmock('../env.js');
    vi.restoreAllMocks();
  });

  it('logs success and exits with code 0 when migrations succeed', async () => {
    const queryMock = vi.fn().mockResolvedValue(undefined);
    const readFileSync = vi.fn(() => 'CREATE TABLE test ();');
    vi.doMock('../client.js', () => ({ default: { query: queryMock } }));
    const actualFs = await vi.importActual<typeof import('fs')>('fs');
    vi.doMock('fs', () => ({ ...actualFs, readFileSync }));
    vi.doMock('../env.js', () => ({}));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('../migrate.js');

    expect(readFileSync).toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledWith('CREATE TABLE test ();');
    expect(logSpy).toHaveBeenCalledWith('✓ Database migrations completed successfully');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('logs failure and exits with code 1 when migration throws', async () => {
    const error = new Error('db failed');
    const queryMock = vi.fn().mockRejectedValue(error);
    const readFileSync = vi.fn(() => 'CREATE TABLE test ();');
    vi.doMock('../client.js', () => ({ default: { query: queryMock } }));
    const actualFs = await vi.importActual<typeof import('fs')>('fs');
    vi.doMock('fs', () => ({ ...actualFs, readFileSync }));
    vi.doMock('../env.js', () => ({}));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await import('../migrate.js');

    expect(errorSpy).toHaveBeenCalledWith('✗ Migration failed:', error);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

afterAll(() => {
  vi.unmock('../queries/collaborators.js');
  vi.unmock('../queries/google.js');
});
