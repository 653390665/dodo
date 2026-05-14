import * as esbuild from 'esbuild';
import { rmSync, mkdirSync, copyFileSync } from 'node:fs';

rmSync('dist-electron', { recursive: true, force: true });
mkdirSync('dist-electron', { recursive: true });

// Only externalize native/ platform-specific modules.
// Everything else gets bundled — eliminates MODULE_NOT_FOUND in packaged apps.
const NATIVE_EXTERNALS = new Set([
  'better-sqlite3',
  'electron',
  'fsevents',
]);

await esbuild.build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-electron/server.cjs',
  external: [...NATIVE_EXTERNALS],
  plugins: [{
    name: 'only-externalize-native',
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, args => {
        if (args.path.startsWith('node:')) return;
        const pkg = args.path.startsWith('@')
          ? args.path.split('/').slice(0, 2).join('/')
          : args.path.split('/')[0];
        if (NATIVE_EXTERNALS.has(pkg)) return { external: true };
        // Bundle everything else (express, jszip, mammoth, dotenv, etc.)
      });
    },
  }],
  define: {
    'process.env.NODE_ENV': '"production"',
    '__CJS_BUNDLE__': 'true',
  },
  minify: false,
  sourcemap: false,
});

copyFileSync('src/lib/better-sqlite3-shim.cjs', 'dist-electron/better-sqlite3-shim.cjs');

console.log('server.cjs built');
