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

test('packaged server includes sharp with its nested runtime dependencies', () => {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
    build: { files: string[]; asarUnpack: string[] };
  };
  const runtimePackages = [
    'sharp',
    'color',
    'color-convert',
    'color-name',
    'color-string',
    'simple-swizzle',
    'is-arrayish',
    'detect-libc',
  ];

  for (const dependency of runtimePackages) {
    const pattern = `node_modules/${dependency}/**/*`;
    assert.ok(packageJson.build.files.includes(pattern), `${dependency} must be packaged for sharp`);
    assert.ok(packageJson.build.asarUnpack.includes(pattern), `${dependency} must be unpacked beside sharp`);
  }
});

test('server bundle preserves a runtime import.meta.url equivalent', () => {
  const buildScript = fs.readFileSync('scripts/build-server.mjs', 'utf8');
  assert.match(buildScript, /pathToFileURL\(__filename\)\.href/);
  assert.match(buildScript, /'import\.meta\.url': '__inkflow_import_meta_url__'/);
});

test('package command runs artifact smoke check after electron-builder', () => {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
    build: {
      mac: Record<string, unknown>;
      linux: { target: Array<{ target: string; arch: string[] }>; artifactName: string; executableName: string };
    };
  };
  const artifactCheckScript = fs.readFileSync('scripts/check-package-artifacts.mjs', 'utf8');
  const buildWorkflow = fs.readFileSync('.github/workflows/build.yml', 'utf8');

  assert.equal(packageJson.scripts['smoke:package-artifacts'], 'node scripts/check-package-artifacts.mjs');
  assert.match(packageJson.scripts.package, /node scripts\/package-electron\.mjs && npm run smoke:package-artifacts/);
  assert.equal(packageJson.build.mac.identity, undefined);
  assert.equal(packageJson.build.mac.hardenedRuntime, true);
  assert.equal(packageJson.build.mac.notarize, true);
  assert.equal(packageJson.build.mac.entitlements, 'build/entitlements.mac.plist');
  assert.deepEqual(packageJson.build.linux.target, [{ target: 'AppImage', arch: ['x64'] }]);
  assert.equal(packageJson.build.linux.artifactName, 'InkFlow-${version}-linux-${arch}.${ext}');
  assert.equal(packageJson.build.linux.executableName, 'inkflow');
  assert.match(artifactCheckScript, /dist-electron\/server\.cjs/);
  assert.match(artifactCheckScript, /InkFlow-\$\{version\}-mac-\$\{process\.arch\}\.dmg/);
  assert.match(artifactCheckScript, /InkFlow-\$\{version\}-win-x64\.exe/);
  assert.match(artifactCheckScript, /InkFlow-\$\{version\}-linux-x64\.AppImage/);
  assert.match(artifactCheckScript, /linux-unpacked/);
  assert.match(buildWorkflow, /^ {2}linux:\n/m);
  assert.match(buildWorkflow, /xvfb-run -a npm run smoke:packaged-editor/);
});
