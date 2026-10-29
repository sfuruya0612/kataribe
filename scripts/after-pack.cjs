const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const removedKeys = [
  'NSAudioCaptureUsageDescription',
  'NSScreenCaptureUsageDescription',
  'NSCameraUsageDescription',
];

module.exports = async function afterPack(context) {
  const appName = context.packager.appInfo.productFilename;
  const infoPlist = join(
    context.appOutDir,
    `${appName}.app`,
    'Contents',
    'Info.plist',
  );

  for (const key of removedKeys) {
    try {
      execFileSync('/usr/bin/plutil', ['-remove', key, infoPlist], {
        stdio: 'ignore',
      });
    } catch {
      // The key is absent in this Electron build.
    }
  }

  try {
    execFileSync(
      '/usr/bin/plutil',
      ['-replace', 'NSAppTransportSecurity.NSAllowsArbitraryLoads', '-bool', 'false', infoPlist],
      { stdio: 'ignore' },
    );
  } catch {
    // The ATS dictionary is absent.
  }
};
