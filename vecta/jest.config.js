// jest.config.js — root Jest configuration
/** @type {import('jest').Config} */
module.exports = {
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        strict: true,
        module: 'CommonJS',
        esModuleInterop: true,
      },
    }],
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@vecta/types$':    '<rootDir>/packages/types/src/index.ts',
    '^@vecta/auth/(.*)$':'<rootDir>/packages/auth/src/$1',
    '^@vecta/crypto$':   '<rootDir>/packages/crypto/src/index.ts',
    '^@vecta/logger$':   '<rootDir>/packages/logger/src/index.ts',
    '^@vecta/database$': '<rootDir>/packages/database/src/index.ts',
    '^@vecta/storage$':  '<rootDir>/packages/storage/src/index.ts',
  },
  collectCoverageFrom: [
    'packages/*/src/**/*.ts',
    'services/*/src/**/*.ts',
    'apps/api-gateway/src/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageThreshold: {
    './packages/auth/src/rbac.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
    },
    './packages/crypto/src/index.ts': {
      branches: 90,
      functions: 100,
      lines: 95,
    },
  },
};
