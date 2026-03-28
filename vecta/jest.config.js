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
    '^@vecta/types$':    '<rootDir>/backend/shared/types/src/index.ts',
    '^@vecta/auth/(.*)$':'<rootDir>/backend/shared/auth/src/$1',
    '^@vecta/crypto$':   '<rootDir>/backend/shared/crypto/src/index.ts',
    '^@vecta/logger$':   '<rootDir>/backend/shared/logger/src/index.ts',
    '^@vecta/database$': '<rootDir>/backend/shared/database/src/index.ts',
    '^@vecta/storage$':  '<rootDir>/backend/shared/storage/src/index.ts',
  },
  collectCoverageFrom: [
    'backend/shared/*/src/**/*.ts',
    'backend/services/*/src/**/*.ts',
    'backend/api-gateway/src/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageThreshold: {
    './backend/shared/auth/src/rbac.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
    },
    './backend/shared/crypto/src/index.ts': {
      branches: 90,
      functions: 100,
      lines: 95,
    },
  },
};
