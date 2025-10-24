import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn(async () => ({ rows: [] }));

vi.mock('../client.js', () => ({
  default: {
    query: queryMock
  }
}));

vi.mock('../../realtime/emitter.js', () => ({
  getRealtimeEmitter: () => null
}));

const {
  ensureCollaboratorSchema,
  __resetCollaboratorSchemaForTests
} = await import('../queries/collaborators.js');

const {
  ensureGoogleIntegrationSchema,
  __setGoogleIntegrationSchemaEnsuredForTests
} = await import('../queries/google.js');

describe('schema ensure routines', () => {
  beforeEach(() => {
    queryMock.mockClear();
    __resetCollaboratorSchemaForTests();
    __setGoogleIntegrationSchemaEnsuredForTests(false);
  });

  it('ensures collaborator schema only once', async () => {
    await ensureCollaboratorSchema();
    const firstCalls = queryMock.mock.calls.length;

    await ensureCollaboratorSchema();

    expect(queryMock.mock.calls.length).toBe(firstCalls);
  });

  it('handles concurrent collaborator ensures without duplicate DDL', async () => {
    await Promise.all([
      ensureCollaboratorSchema(),
      ensureCollaboratorSchema(),
      ensureCollaboratorSchema()
    ]);
    const firstCalls = queryMock.mock.calls.length;

    await ensureCollaboratorSchema();

    expect(queryMock.mock.calls.length).toBe(firstCalls);
  });

  it('ensures Google integration schema only once', async () => {
    await ensureGoogleIntegrationSchema();
    const firstCalls = queryMock.mock.calls.length;

    await ensureGoogleIntegrationSchema();

    expect(queryMock.mock.calls.length).toBe(firstCalls);
  });
});
