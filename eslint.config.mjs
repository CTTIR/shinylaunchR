import js from '@eslint/js';
import parser from '@typescript-eslint/parser';
import ts from '@typescript-eslint/eslint-plugin';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'out/**', 'dist/**', 'release/**', 'audit/**', '.audit/**', '**/*.config.ts', 'scripts/**'] },
  {
    files: ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}'],
    languageOptions: { parser, parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname }, globals: { ...globals.node, ...globals.browser } },
    plugins: { '@typescript-eslint': ts, 'react-hooks': hooks },
    rules: {
      ...js.configs.recommended.rules,
      ...ts.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    },
  },
];
