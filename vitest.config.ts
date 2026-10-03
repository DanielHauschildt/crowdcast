import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests are colocated with sources in src/; integration tests live in test/.
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['test/live/**'],
    typecheck: { tsconfig: './tsconfig.test.json' }
  }
});
