import tseslint from '@typescript-eslint/eslint-plugin';
import parser from '@typescript-eslint/parser';

export default [
  {
    files: ['packages/*/src/**/*.{js,ts,jsx,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: parser,
      parserOptions: {
        project: './tsconfig.json'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    },
    rules: {
      // Basic TypeScript rules
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      
      // General rules
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always']
    }
  },
  {
    files: ['**/*.test.{js,ts,jsx,tsx}'],
    rules: {
      // Allow console in tests
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.d.ts',
      'packages/squizzle-core/test/infra/volumes/**'
    ]
  }
];