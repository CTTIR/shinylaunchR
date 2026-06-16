/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  env: {
    es2022: true,
    node: true,
    browser: true,
  },
  settings: {
    react: { version: 'detect' },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    '@typescript-eslint/no-floating-promises': 'error',
    // Async handlers on JSX attributes (onClick={asyncFn}) are idiomatic in
    // React and safe here; keep the check for statement positions only.
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
  },
  ignorePatterns: ['out/', 'dist/', 'release/', 'node_modules/', '*.config.ts', 'scripts/*.mjs'],
};
