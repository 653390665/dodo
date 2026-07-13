import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('packaged server includes and unpacks the complete ONNX runtime pair', () => {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
    build: { files: string[]; asarUnpack: string[] };
  };

  for (const dependency of ['onnxruntime-node', 'onnxruntime-common']) {
    const pattern = `node_modules/${dependency}/**/*`;
    assert.ok(packageJson.build.files.includes(pattern), `${dependency} must be packaged`);
    assert.ok(packageJson.build.asarUnpack.includes(pattern), `${dependency} must be unpacked beside its runtime peer`);
  }
});

test('server bundle preserves a runtime import.meta.url equivalent', () => {
  const buildScript = fs.readFileSync('scripts/build-server.mjs', 'utf8');
  assert.match(buildScript, /pathToFileURL\(__filename\)\.href/);
  assert.match(buildScript, /'import\.meta\.url': '__inkflow_import_meta_url__'/);
});
