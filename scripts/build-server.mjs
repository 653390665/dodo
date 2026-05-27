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
  define: {
    'process.env.NODE_ENV': '"production"',
    '__CJS_BUNDLE__': 'true',
  },
  minify: false,
  sourcemap: false,
});

copyFileSync('src/lib/better-sqlite3-shim.cjs', 'dist-electron/better-sqlite3-shim.cjs');

console.log('server.cjs built');
