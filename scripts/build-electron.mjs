import * as esbuild from 'esbuild';
import { copyFileSync } from 'node:fs';

await esbuild.build({
  entryPoints: ['electron.cjs'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-electron/main.cjs',
  external: [
    'electron',
    'better-sqlite3',
    'mammoth',
    'child_process',
    'path',
    'http',
  ],
  plugins: [{
    name: 'external-node-modules',
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, args => {
        if (args.path.startsWith('node:')) return;
        return { external: true };
      });
    },
  }],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  minify: false,
  sourcemap: false,
});

copyFileSync('electron-preload.cjs', 'dist-electron/electron-preload.cjs');

console.log('main.cjs built');
