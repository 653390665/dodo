import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    globals: true,
    css: false, // 禁用 CSS 解析以大幅提高测试速度
    include: ['src/tests/**/*.test.tsx', 'src/tests/**/*.test.ts'],
  },
});
