import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const isPlaywrightTest = process.env.PLAYWRIGHT_TEST === 'true';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  // 依赖扫描只认真实入口：默认 **/*.html 会把 docs/archive 的历史报告 HTML
  // 拽进 dep-scan（2026-09-20 实测导致预打包失败跳过，前端裸导入 404）。
  optimizeDeps: {
    entries: ['index.html'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    hmr: isPlaywrightTest ? { port: 24679 } : true,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'radix-vendor': [
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
          ],
          lucide: ['lucide-react'],
          'markdown-vendor': ['react-markdown'],
        },
      },
    },
  },
});
