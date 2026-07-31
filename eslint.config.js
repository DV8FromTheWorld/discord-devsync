import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

import { preferAsyncAwait } from './eslint-rules/prefer-async-await.js';

// Adapted from Slopshop-Tools/slopshop-template. The React, JSX-a11y and
// no-parent-imports blocks are omitted: this is a single-package Node CLI with no JSX,
// and every import here is relative — there are no path aliases for that rule to enforce.
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', '**/*.cjs', '**/*.mjs'],
  },

  eslint.configs.recommended,
  eslintComments.recommended,

  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            // Node builtins and external packages
            ['^node:', '^[^.]'],
            // Relative imports
            ['^\\.'],
          ],
        },
      ],
      'simple-import-sort/exports': 'error',
    },
  },

  {
    plugins: {
      custom: {
        rules: { 'prefer-async-await': preferAsyncAwait },
      },
    },
    rules: {
      'custom/prefer-async-await': 'error',
    },
  },

  {
    rules: {
      '@eslint-community/eslint-comments/require-description': [
        'error',
        { ignore: ['eslint-enable'] },
      ],
      '@eslint-community/eslint-comments/no-unused-disable': 'error',

      curly: ['error', 'all'],
      'max-params': ['error', { max: 5 }],

      // Allow == null to catch both null and undefined in one check
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: true,
          allowNullableBoolean: true,
          allowNullableString: false,
          allowNullableNumber: false,
          allowNullableEnum: false,
          allowAny: false,
        },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // ignoreVoid: allows `void promise()` to explicitly discard a promise
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],

      // Allow unused vars prefixed with _ (destructuring, catch bindings)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      '@typescript-eslint/require-await': 'off',
    },
  },

  // node:test's test() returns a promise that the runner itself owns and reports on.
  // There is no caller to await it, so every test declaration would otherwise be flagged.
  {
    files: ['test/**/*.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },

  // Prettier — must be last to disable formatting-related rules
  prettierConfig,

  // Re-enable curly after prettier (prettier disables it but doesn't enforce braces)
  {
    rules: {
      curly: ['error', 'all'],
    },
  }
);
