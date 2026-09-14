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
      // Plan 223⑧：分母收窄到 src/**（前端可达面）——此前全仓分母把 server/** 等
      // 前端永不可达文件计为 0%，拉低均值并使棘轮基线随无关源文件漂移；
      // 输出目录独立为 coverage/frontend，不再与后端 node:test 的 coverage/ 互相覆盖。
      include: ['src/**'],
      reportsDirectory: 'coverage/frontend',
      thresholds: {
        // Plan 187 棘轮基线；Plan 223⑧ 按新分母（src/**）实测重锚
        // （2026-09-15 实测 66.45/59.43/59.44/68.83，向下取整）
        statements: 66,
        branches: 59,
        functions: 59,
        lines: 68,
      },
    },
  },
});
