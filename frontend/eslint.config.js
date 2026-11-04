import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist', '**/.astro', '**/coverage', '**/*.gen.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // TanStack Router signals not-found and redirects by throwing its own values (ADR-0026).
      '@typescript-eslint/only-throw-error': [
        'error',
        {
          allow: [
            {
              from: 'package',
              package: '@tanstack/router-core',
              name: ['NotFoundError', 'Redirect'],
            },
          ],
        },
      ],
      // Code rules from frontend/AGENTS.md, marked (lint) there. Each helper file turns off only
      // its own rule below.
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='QueryClient']",
          message:
            'Create clients with createQueryClient() from src/queryClient.ts, in the app and in tests: it sets the 30 s staleTime and the shared retry policy (frontend/AGENTS.md).',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Intl',
          property: 'DateTimeFormat',
          message:
            'Building a formatter costs far more than formatting. Use the cached dateTimeFormat(locale, options), or browserTimeZone(), from features/agenda/dayTime.ts (frontend/AGENTS.md).',
        },
        ...['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].map((property) => ({
          property,
          message: `${property}() builds a formatter on every call. Use formatDateTime(instant, options) or dateTimeFormat(locale, options) from features/agenda/dayTime.ts (frontend/AGENTS.md).`,
        })),
      ],
    },
  },
  {
    files: ['apps/web/src/queryClient.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['apps/web/src/features/agenda/dayTime.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['**/*.config.{js,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
]);
