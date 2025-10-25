import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.vitest.test.ts'],
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      reporter: ['text', 'json-summary'],
      include: ['../backend/src/**/*.ts'],
      exclude: ['../backend/src/**/*.d.ts', '../backend/src/**/*.test.ts']
    }
  }
});
