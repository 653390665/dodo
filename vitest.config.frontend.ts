import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    globals: true,
    css: false, // 禁用 CSS 解析以大幅提高测试速度
    pool: 'threads',
    maxWorkers: 1,
    testTimeout: 30_000,
    include: ['src/tests/**/*.test.tsx', 'src/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json', 'html'],
      thresholds: {
        statements: 40,
        branches: 33,
        functions: 32,
        lines: 42,
      },
    },
  },
});
