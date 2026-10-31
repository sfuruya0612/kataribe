#!/usr/bin/env node
const { execFileSync, spawnSync } = require('node:child_process');
const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const appPath = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : join(process.cwd(), 'release', 'mac-arm64', 'Kataribe.app');
const strictSigning = process.argv.includes('--strict-signing');
const failures = [];
const notes = [];

function check(condition, message) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures.push(message);
    console.error(`ng: ${message}`);
  }
}

function plistJson(path) {
  const output = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], {
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

function walk(path, callback) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, callback);
    } else if (entry.isFile()) {
      callback(fullPath, entry.name);
    }
  }
}

if (!existsSync(appPath)) {
  console.error(`app bundle not found: ${appPath}`);
  process.exit(1);
}

const resources = join(appPath, 'Contents', 'Resources');
const infoPlist = join(appPath, 'Contents', 'Info.plist');
check(existsSync(infoPlist), 'Info.plist exists');
check(existsSync(resources), 'Resources exists');

if (existsSync(infoPlist)) {
  const info = plistJson(infoPlist);
  check(
    typeof info.NSMicrophoneUsageDescription === 'string' &&
      info.NSMicrophoneUsageDescription.length > 0,
    'NSMicrophoneUsageDescription is present',
  );
  check(
    typeof info.NSDocumentsFolderUsageDescription === 'string' &&
      info.NSDocumentsFolderUsageDescription.length > 0,
    'NSDocumentsFolderUsageDescription is present',
  );
  check(!('NSAudioCaptureUsageDescription' in info), 'NSAudioCaptureUsageDescription is absent');
  check(!('NSScreenCaptureUsageDescription' in info), 'NSScreenCaptureUsageDescription is absent');
  check(!('NSCameraUsageDescription' in info), 'NSCameraUsageDescription is absent');
  check(info.LSMinimumSystemVersion === '14.2', 'LSMinimumSystemVersion is 14.2');
  check(
    info.NSAppTransportSecurity &&
      info.NSAppTransportSecurity.NSAllowsArbitraryLoads === false,
    'NSAllowsArbitraryLoads is false',
  );
}

const entitlementsPath = join(process.cwd(), 'build', 'entitlements.mac.plist');
if (existsSync(entitlementsPath)) {
  const entitlements = plistJson(entitlementsPath);
  for (const key of [
    'com.apple.security.device.audio-input',
    'com.apple.security.cs.allow-jit',
    'com.apple.security.cs.allow-unsigned-executable-memory',
    'com.apple.security.cs.allow-dyld-environment-variables',
    'com.apple.security.cs.disable-library-validation',
  ]) {
    check(entitlements[key] === true, `entitlement ${key} is true`);
  }
} else {
  check(false, 'build/entitlements.mac.plist exists');
}

if (existsSync(resources)) {
  check(existsSync(join(resources, 'README.md')), 'README.md is bundled as a resource');
  const iconFile = existsSync(infoPlist) ? plistJson(infoPlist).CFBundleIconFile : undefined;
  const bundledIcon = typeof iconFile === 'string' ? join(resources, iconFile) : undefined;
  check(bundledIcon !== undefined && existsSync(bundledIcon), 'CFBundleIconFile points to a bundled icon');
  const sourceIcon = join(process.cwd(), 'build', 'icon.icns');
  check(
    bundledIcon !== undefined &&
      existsSync(bundledIcon) &&
      existsSync(sourceIcon) &&
      readFileSync(bundledIcon).equals(readFileSync(sourceIcon)),
    'bundled icon matches build/icon.icns',
  );
  check(existsSync(join(resources, 'trayTemplate.png')), 'trayTemplate.png is bundled');
  check(existsSync(join(resources, 'trayTemplate@2x.png')), 'trayTemplate@2x.png is bundled');
  check(existsSync(join(resources, 'app-icon.png')), 'app-icon.png is bundled');
  check(
    existsSync(join(resources, 'bin', 'arm64', 'whisper-cli')),
    'whisper-cli is bundled for arm64',
  );
  check(
    existsSync(join(resources, 'bin', 'arm64', 'ffmpeg')),
    'ffmpeg is bundled for arm64',
  );
  check(
    existsSync(join(resources, 'bin', 'arm64', 'kataribe-multi-output')),
    'Multi-Output helper is bundled for arm64',
  );
  check(
    existsSync(join(resources, 'licenses', 'whisper.cpp-LICENSE.txt')),
    'whisper.cpp license is bundled',
  );
  check(
    existsSync(join(resources, 'licenses', 'ffmpeg-LICENSE.txt')),
    'ffmpeg license is bundled',
  );
  check(
    existsSync(join(resources, 'licenses', 'lame-LICENSE.txt')),
    'LAME license is bundled',
  );

  const blackholeFiles = [];
  walk(resources, (fullPath) => {
    if (/blackhole/i.test(fullPath)) {
      blackholeFiles.push(fullPath);
    }
  });
  check(blackholeFiles.length === 0, 'BlackHole binaries are not bundled');
}

const outDir = join(process.cwd(), 'out');
if (existsSync(outDir)) {
  const forbidden = [];
  walk(outDir, (fullPath) => {
    if (!/\.(js|mjs|cjs|html|json)$/i.test(fullPath)) {
      return;
    }
    const text = readFileSync(fullPath, 'utf8');
    if (text.includes('desktopCapturer') || text.includes('getDisplayMedia')) {
      forbidden.push(fullPath);
    }
  });
  check(forbidden.length === 0, 'desktopCapturer and getDisplayMedia paths are absent');
}

try {
  const sizeKb = Number(
    execFileSync('/usr/bin/du', ['-sk', appPath], { encoding: 'utf8' }).trim().split(/\s+/)[0],
  );
  check(sizeKb <= 300 * 1024, `app bundle is ${Math.round(sizeKb / 1024)} MB (limit 300 MB)`);
} catch (error) {
  notes.push(`could not measure app size: ${String(error)}`);
}

const codesign = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], {
  encoding: 'utf8',
});
if (codesign.status === 0) {
  console.log('ok: codesign verification passed');
  const entitlements = spawnSync(
    '/usr/bin/codesign',
    ['-d', '--entitlements', ':-', appPath],
    { encoding: 'utf8' },
  );
  const output = `${entitlements.stdout ?? ''}\n${entitlements.stderr ?? ''}`;
  check(
    output.includes('com.apple.security.device.audio-input'),
    'signed app has the audio-input entitlement',
  );
} else {
  const message = 'codesign verification failed (unsigned local build)';
  if (strictSigning) {
    failures.push(message);
    console.error(`ng: ${message}`);
  } else {
    notes.push(message);
  }
}

const gatekeeper = spawnSync(
  '/usr/sbin/spctl',
  ['--assess', '--type', 'execute', '--verbose=4', appPath],
  { encoding: 'utf8' },
);
if (gatekeeper.status === 0) {
  console.log('ok: Gatekeeper assessment passed');
} else {
  const message = 'Gatekeeper assessment failed (not notarized for this local build)';
  if (strictSigning) {
    failures.push(message);
    console.error(`ng: ${message}`);
  } else {
    notes.push(message);
  }
}

for (const note of notes) {
  console.log(`note: ${note}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall local bundle checks passed');
