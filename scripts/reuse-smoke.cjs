#!/usr/bin/env node
// WebGPU 音声強調のスモークテストを実行する。
// 使い方: node scripts/reuse-smoke.cjs /path/to/nemotronlabs.safetensors

const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const modelPath =
  process.argv[2] ?? process.env.KATARIBE_REUSE_SMOKE_MODEL_PATH ?? '';
if (modelPath.length === 0) {
  console.error(
    'usage: node scripts/reuse-smoke.cjs <path-to-nemotronlabs.safetensors>',
  );
  process.exit(1);
}

const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const electron = require('electron');
const result = spawnSync(electron, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    KATARIBE_REUSE_SMOKE_TEST: '1',
    KATARIBE_REUSE_SMOKE_MODEL_PATH: resolve(modelPath),
  },
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
