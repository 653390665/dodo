import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/vitest-node-compat.ts'],
    exclude: [
      '.agents/**',
      '.claude/**',
      '.reasonix/**',
      'docs/**',
      'node_modules/**',
    ],
  },
});
