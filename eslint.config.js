import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Flat config for the whole monorepo. One config rather than one per workspace:
 * the rules that matter here are cross-cutting, and three copies drift.
 *
 * Several rules below are security controls rather than style preferences and
 * are marked as such. They are errors rather than warnings, because a warning
 * in CI is a rule nobody obeys.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/generated/**',
      '**/.vite/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },

  js.configs.recommended,

  // Type-aware linting for application source only. The type information is what
  // makes no-floating-promises possible, and that rule is the one that stops an
  // un-awaited payment call from failing silently.
  {
    files: ['**/src/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',

      // An `any` reaching a request handler defeats the point of validating the
      // boundary at all, so unsafe flows are errors rather than warnings.
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },

  // Rules that apply to every JavaScript and TypeScript file in the repo.
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': ['error', 'always'],
      'no-return-await': 'error',
      curly: ['error', 'multi-line'],

      // --- Security controls ---

      // Arbitrary code execution from a string. There is no legitimate use in
      // this codebase.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',

      // Prototype pollution: reading a user-controlled key straight off an
      // object is how a JSON body ends up mutating Object.prototype.
      'no-proto': 'error',
      'no-extend-native': 'error',

      // Tokens must never be reachable by injected JavaScript. The auth design
      // puts them in httpOnly cookies; this rule makes the alternative fail the
      // build rather than depend on a reviewer noticing it.
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message:
            'Auth tokens must live in httpOnly cookies. Any XSS can read localStorage. For non-sensitive UI preferences, use the storage helper in packages/ui.',
        },
        {
          name: 'sessionStorage',
          message:
            'Auth tokens must live in httpOnly cookies. Any XSS can read sessionStorage. For non-sensitive UI preferences, use the storage helper in packages/ui.',
        },
      ],

      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='JSON'][callee.property.name='parse'] > CallExpression[callee.object.name='localStorage']",
          message: 'Do not read state out of localStorage. See the no-restricted-globals note.',
        },
        {
          // Prisma parameterizes $queryRaw tagged templates. $queryRawUnsafe and
          // $executeRawUnsafe take a plain string and are an injection sink.
          selector: 'MemberExpression[property.name=/^\\$(query|execute)RawUnsafe$/]',
          message:
            'Raw unsafe SQL is an injection sink. Use the $queryRaw tagged template, which parameterizes, or Prisma.sql with placeholders.',
        },
      ],
    },
  },

  // Tooling and config files run in Node and are not part of an app tsconfig.
  {
    files: ['**/*.config.{js,mjs,ts}', 'scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': 'off',
    },
  },

  // Tests may reach for patterns that production code should not.
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  prettier
);
