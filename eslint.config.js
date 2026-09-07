import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import boundaries from 'eslint-plugin-boundaries';

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
    files: ['**/src/**/*.{ts,tsx}', '**/prisma/seed.ts'],
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

  // Module boundaries inside the API. See docs/build-plan.md section 3: a
  // module exposes a service interface through its index.ts and nothing else.
  // Reaching into another module's repository or internal files directly is
  // what makes a later split into separate services a rewrite instead of a
  // deployment change, so it is a lint error rather than a convention.
  {
    files: ['apps/api/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'module', pattern: 'apps/api/src/modules/*' },
        { type: 'adapter', pattern: 'apps/api/src/adapters/*' },
        { type: 'platform', pattern: 'apps/api/src/platform/**' },
      ],
      // Needed so a `.js`-suffixed specifier resolves to its `.ts` source file
      // under NodeNext module resolution. Without this, boundaries cannot
      // resolve any import in this codebase and silently checks nothing.
      'import/resolver': {
        typescript: { project: 'apps/api/tsconfig.json' },
      },
    },
    rules: {
      // Imports within the same module (order/service.ts -> order/repository.ts)
      // are internal to one element instance and are not covered by any policy
      // below, so they are unaffected by this rule. Only cross-instance imports
      // are checked, which is what "module boundary" means here.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            // A module may reach another module only through that module's
            // index.ts. modules/order/service.ts importing
            // modules/catalog/repository.ts directly is what this blocks;
            // modules/order/service.ts importing modules/catalog/index.ts
            // (its declared service interface) is allowed.
            {
              from: { element: { type: 'module' } },
              allow: { to: { element: { type: 'module', internalPath: 'index.ts' } } },
            },
            {
              from: { element: { type: 'module' } },
              allow: { to: { element: { types: { anyOf: ['adapter', 'platform'] } } } },
            },
            {
              from: { element: { type: 'adapter' } },
              allow: { to: { element: { types: { anyOf: ['adapter', 'platform'] } } } },
            },
            {
              from: { element: { type: 'platform' } },
              allow: { to: { element: { type: 'platform' } } },
            },
          ],
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
      // supertest types `res.body` as `any` by design, and reading it back
      // (res.body.merchant.id, mapping over res.body.items, and so on) is
      // the normal way to write an integration test against it. Annotating
      // every call site would just be noise; this is not a general license
      // for `any` in test code, only an acknowledgment of that one library.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // A fake/mock implementing an async interface for a test double has no
      // real I/O to await; the async signature exists to satisfy the
      // interface, not because the method suspends.
      '@typescript-eslint/require-await': 'off',
    },
  },

  prettier
);
