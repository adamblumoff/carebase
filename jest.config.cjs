/** @type {import('jest').Config} */
module.exports = {
  maxWorkers: 1,
  projects: [
    {
      displayName: 'node',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/**/*.test.ts'],
      testPathIgnorePatterns: ['<rootDir>/tests/app/'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
      },
      transform: {
        '^.+\\.tsx?$': [
          'ts-jest',
          {
            diagnostics: false,
            tsconfig: {
              target: 'ES2022',
              module: 'CommonJS',
              esModuleInterop: true,
              resolveJsonModule: true,
              skipLibCheck: true,
              strict: true,
              isolatedModules: true,
            },
          },
        ],
      },
      clearMocks: true,
    },
    {
      displayName: 'app',
      preset: 'react-native',
      testMatch: ['<rootDir>/tests/app/**/*.test.ts?(x)'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
      },
      clearMocks: true,
    },
  ],
};
