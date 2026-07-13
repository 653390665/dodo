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
