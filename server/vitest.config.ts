import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globalSetup: './tests/globalSetup.ts',
    setupFiles: ['./tests/env.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
