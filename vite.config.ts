import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    hmr: true,
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
            '@radix-ui/react-tooltip'
          ],
          'lucide': ['lucide-react'],
          'markdown-vendor': ['react-markdown'],
        }
      }
    }
  }
});
