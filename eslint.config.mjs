import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-electron',
      'dist-electron-test',
      'release',
      'node_modules',
      '.agents',
      'docs',
      'scratch_modify.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // 1. 前端 React / 浏览器环境规则
  {
    files: ['src/**/*.{ts,tsx}', 'main.tsx'],
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
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/exhaustive-deps': 'error', // 提升为 error，保障 React 副作用正确性
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }], // 保持为 warn，保障本地调试体验
      'no-constant-condition': 'off',
      'no-unused-expressions': 'warn',
      'no-prototype-builtins': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-fallthrough': 'warn',
      'no-redeclare': 'warn',
      'no-cond-assign': 'warn',
    },
  },
  // 2. 后端 Node.js / Electron 宿主与脚本环境及共享配置代码规则
  {
    files: [
      'server/**/*.ts',
      'server.ts',
      'electron.cjs',
      'electron-preload.cjs',
      'electron-startup-utils.cjs',
      'electron-close-handshake.cjs',
      'scripts/**/*.mjs',
      'shared/**/*.ts',
    ],
    languageOptions: {
      globals: {
        process: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AbortController: 'readonly',
        fetch: 'readonly',
        performance: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unsafe-function-type': 'off', // 允许使用 Function 类型作为通用的动态回调
      'preserve-caught-error': 'off', // 允许在不需要附带 cause 时直接抛出包装 Error
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': 'off',
    },
  },
  // 3. 测试代码：夹具塑形的 any 与空 catch 属测试惯用法，显式豁免；
  //    `_` 前缀占位符与死导入仍会被抓出，其余基础规则照常生效。
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  }
);
