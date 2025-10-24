import { afterEach, beforeEach, vi } from 'vitest';

// Ensure a predictable baseline for all tests.
process.env.NODE_ENV = 'test';

const baselineEnv = { ...process.env };

beforeEach(() => {
  // Restore environment variables to their baseline snapshot.
  for (const key of Object.keys(process.env)) {
    if (!(key in baselineEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(baselineEnv)) {
    process.env[key] = value as string;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.clearAllTimers();
});
