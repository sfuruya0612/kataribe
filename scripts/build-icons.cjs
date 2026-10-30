// build/icon/ の SVG 原稿から macOS 用のアイコン素材を生成する。
//
// 生成物:
//   build/icon.iconset/          iconutil 用の PNG 一式 (16 から 1024 まで、@2x を含む)
//   build/icon.icns              electron-builder が Kataribe.app に埋め込むアプリアイコン
//   build/trayTemplate.png       メニューバー用テンプレート画像 (16 x 16、黒 + アルファ)
//   build/trayTemplate@2x.png    同上の Retina 用 (32 x 32)
//
// 依存: rsvg-convert (brew install librsvg) と iconutil (Xcode Command Line Tools)。

const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const sourceDir = join(root, 'build', 'icon');
const appIconSvg = join(sourceDir, 'app-icon.svg');
const trayTemplateSvg = join(sourceDir, 'tray-template.svg');
const iconsetDir = join(root, 'build', 'icon.iconset');
const icnsPath = join(root, 'build', 'icon.icns');
const trayTemplatePath = join(root, 'build', 'trayTemplate.png');
const trayTemplate2xPath = join(root, 'build', 'trayTemplate@2x.png');

// iconutil が要求するファイル名と、そのピクセルサイズ。
const iconsetEntries = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

function run(command, args) {
  return execFileSync(command, args, { stdio: ['ignore', 'pipe', 'inherit'] });
}

function resolveRsvgConvert() {
  const candidates = ['/opt/homebrew/bin/rsvg-convert', '/usr/local/bin/rsvg-convert'];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  try {
    return run('/usr/bin/which', ['rsvg-convert']).toString().trim();
  } catch {
    throw new Error('rsvg-convert not found: install it with "brew install librsvg"');
  }
}

function rasterize(rsvgConvert, svgPath, size, outputPath) {
  run(rsvgConvert, ['--width', String(size), '--height', String(size), svgPath, '--output', outputPath]);
}

function assertSource(path) {
  if (!existsSync(path)) {
    throw new Error(`icon source not found: ${path}`);
  }
}

function buildIconset(rsvgConvert) {
  // 古い PNG が混ざると iconutil が失敗するので、一式を作り直す。
  rmSync(iconsetDir, { recursive: true, force: true });
  mkdirSync(iconsetDir, { recursive: true });
  for (const [fileName, size] of iconsetEntries) {
    rasterize(rsvgConvert, appIconSvg, size, join(iconsetDir, fileName));
  }
  const generated = readdirSync(iconsetDir).length;
  if (generated !== iconsetEntries.length) {
    throw new Error(`iconset is incomplete: expected ${iconsetEntries.length} files, got ${generated}`);
  }
  console.log(`generated ${iconsetDir} (${generated} files)`);
}

function buildIcns() {
  if (existsSync(icnsPath)) {
    unlinkSync(icnsPath);
  }
  run('/usr/bin/iconutil', ['--convert', 'icns', iconsetDir, '--output', icnsPath]);
  if (!existsSync(icnsPath)) {
    throw new Error(`iconutil did not produce ${icnsPath}`);
  }
  console.log(`generated ${icnsPath}`);
}

function buildTrayTemplates(rsvgConvert) {
  rasterize(rsvgConvert, trayTemplateSvg, 16, trayTemplatePath);
  rasterize(rsvgConvert, trayTemplateSvg, 32, trayTemplate2xPath);
  console.log(`generated ${trayTemplatePath}`);
  console.log(`generated ${trayTemplate2xPath}`);
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('build-icons requires macOS because it depends on iconutil');
  }
  assertSource(appIconSvg);
  assertSource(trayTemplateSvg);
  const rsvgConvert = resolveRsvgConvert();
  buildIconset(rsvgConvert);
  buildIcns();
  buildTrayTemplates(rsvgConvert);
}

try {
  main();
} catch (error) {
  console.error(`build-icons failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
