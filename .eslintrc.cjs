/* Mirrors ubq/current's eslintrc format for cross-repo consistency, but on a
   Node base — no React/JSX/airbnb. Revisit if ubq moves to flat config. */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  // projectService (typescript-eslint v8) auto-discovers the right tsconfig per
  // file and tolerates solution-style tsconfig.json (files:[] + references),
  // which `project: true` does not. Required for typed rules like
  // no-floating-promises.
  parserOptions: { projectService: true, tsconfigRootDir: __dirname },
  plugins: ['@typescript-eslint', 'import'],
  env: { node: true, es2022: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier'
  ],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    '**/*.generated.ts',
    '**/*.js',
    '**/*.cjs',
    '**/*.mjs'
  ],
  rules: {
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }
    ],
    '@typescript-eslint/no-explicit-any': 'off',
    'no-constant-condition': ['error', { checkLoops: false }],
    'import/no-relative-packages': 'error',
    'import/no-unresolved': 'off'
  }
};
