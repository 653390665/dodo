import * as esbuild from 'esbuild';
import { copyFileSync } from 'node:fs';

await esbuild.build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-electron/server.cjs',
  external: [
    'better-sqlite3',
    'mammoth',
    'electron',
    'fsevents',
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

copyFileSync('src/lib/better-sqlite3-shim.cjs', 'dist-electron/better-sqlite3-shim.cjs');

console.log('server.cjs built');
