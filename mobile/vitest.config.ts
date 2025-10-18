import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      'react-native': 'react-native-web',
      '@': path.resolve(__dirname, 'src')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: path.resolve(__dirname, 'vitest.setup.ts'),
    css: false,
    restoreMocks: true,
    server: {
      deps: {
        inline: ['react-native', '@testing-library/react-native']
      }
    },
    coverage: {
      reporter: ['text'],
      exclude: ['App.tsx', 'index.ts', 'src/screens/**/*', 'src/ui/**/*'],
      thresholds: {
        statements: 65,
        branches: 55,
        functions: 65,
        lines: 65
      }
    }
  },
  define: {
    __DEV__: true
  }
});
