import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  {
    ignores: ['.next/**', 'out/**', 'build/**', 'dist/**', 'coverage/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/app/**', '@/components/**', '@/lib/**'],
              message:
                'src/server/** must not import from src/app, src/components, or src/lib. Keep control-plane domain code isolated from UI-side code.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/server/domain/**/*.ts', 'src/server/renderer/**/*.ts'],
    // Tests in these dirs are allowed to use I/O (e.g. reading golden
    // fixtures from disk) — the purity rule applies to source modules only.
    ignores: ['src/server/domain/**/*.test.ts', 'src/server/renderer/**/*.test.ts'],
    rules: {
      // Override the broader src/server/** rule with one that also forbids
      // I/O modules — the domain layer and the pure renderer must remain
      // free of I/O. In ESLint flat config, options for the same rule do
      // NOT merge across blocks, so we re-state the UI-boundary patterns
      // from the parent rule here.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:fs',
              message:
                'src/server/domain/** and src/server/renderer/** are pure layers. I/O (fs, exec, db) must live in repositories, handlers, or the CLI.',
            },
            {
              name: 'node:fs/promises',
              message:
                'src/server/domain/** and src/server/renderer/** are pure layers. I/O (fs, exec, db) must live in repositories, handlers, or the CLI.',
            },
            {
              name: 'execa',
              message:
                'src/server/domain/** and src/server/renderer/** are pure layers. I/O (fs, exec, db) must live in repositories, handlers, or the CLI.',
            },
            {
              name: 'better-sqlite3',
              message:
                'src/server/domain/** and src/server/renderer/** are pure layers. I/O (fs, exec, db) must live in repositories, handlers, or the CLI.',
            },
          ],
          patterns: [
            {
              group: ['@/app/**', '@/components/**', '@/lib/**'],
              message:
                'src/server/** must not import from src/app, src/components, or src/lib. Keep control-plane domain code isolated from UI-side code.',
            },
          ],
        },
      ],
    },
  },
];

export default config;
