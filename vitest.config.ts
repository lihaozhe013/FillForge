import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/desktop/electron/**/*.test.ts',
      'tests/integration/**/*.test.ts'
    ],
    passWithNoTests: true
  }
});
