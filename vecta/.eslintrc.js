// .eslintrc.js — root ESLint config for all TypeScript workspaces
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  rules: {
    // Vecta security rules
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/no-misused-promises': 'error',

    // Prevent accidental PII logging
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.property.name='log'] > MemberExpression[object.name='console']",
        message: 'Use @vecta/logger instead of console.log. console.log may expose PII in production.',
      },
    ],
  },
  overrides: [
    // Relax rules for test files
    {
      files: ['**/*.test.ts', '**/__tests__/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-floating-promises': 'off',
      },
    },
    // Next.js pages — allow default exports
    {
      files: ['apps/landlord-portal/**/*.tsx', 'apps/student-app/**/*.tsx'],
      rules: {
        '@typescript-eslint/explicit-module-boundary-types': 'off',
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', '*.js', '!.eslintrc.js', '!next.config.js', '!tailwind.config.js'],
};
