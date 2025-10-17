import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.vitest.test.ts'],
    globals: true,
    coverage: {
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts']
    }
  }
});
