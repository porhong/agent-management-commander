import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/release/**',
      'fixtures/**',
      '.remember/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  // Architecture boundary: core and adapters stay Electron-free and app-independent so the
  // CLI can reuse them and they can be tested in plain Node (docs/plan/engineering-practices.md).
  {
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'packages/* must not depend on Electron.' }],
          patterns: [
            { group: ['electron/*'], message: 'packages/* must not depend on Electron.' },
            { group: ['@amc/desktop', '**/apps/**'], message: 'packages/* must not import apps.' },
          ],
        },
      ],
    },
  },
);
