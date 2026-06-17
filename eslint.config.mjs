import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-electron',
      'release',
      'node_modules',
      'tests',
      'scripts',
      // server.ts 是 CJS/Node 环境，前端 ESLint 规则不适用
      'server.ts',
      'server',
      'electron.cjs',
      'electron-preload.cjs',
      'electron-startup-utils.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
        IntersectionObserver: 'readonly',
        MutationObserver: 'readonly',
        ResizeObserver: 'readonly',
        EventSource: 'readonly',
        FileReader: 'readonly',
        Image: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        FormData: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        AbortController: 'readonly',
        DOMParser: 'readonly',
        KeyboardEvent: 'readonly',
        DragEvent: 'readonly',
        PointerEvent: 'readonly',
        ClipboardEvent: 'readonly',
        FocusEvent: 'readonly',
        crypto: 'readonly',
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-constant-condition': 'off',
      // 以下规则降为 warn — 存量太多，逐步修复
      'no-unused-expressions': 'warn',
      'no-prototype-builtins': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-fallthrough': 'warn',
      'no-redeclare': 'warn',
      'no-cond-assign': 'warn',
    },
  }
);
