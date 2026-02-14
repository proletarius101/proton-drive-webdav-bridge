import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: [
      path.resolve(__dirname, 'test/setup.ts'),
      path.resolve(__dirname, 'test/happydom.ts'),
      path.resolve(__dirname, 'test/testing-library.ts'),
    ],
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
