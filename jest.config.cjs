/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  maxWorkers: 1,
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
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
};
