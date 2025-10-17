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
    }
  },
  define: {
    __DEV__: true
  }
});
