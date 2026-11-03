/**
 * アプリメニューの音声強調ライセンス項目を検証する。
 * 対応する要求: REQ-ENHANCE-001、共通基盤
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setUiLanguage } from '../src/main/i18n';
import { reuseLicenseMenuItems } from '../src/main/reuse-menu';

afterEach(() => {
  setUiLanguage('ja');
});

describe('reuseLicenseMenuItems', () => {
  it('offers the engine and model licenses and calls the fixed kinds', () => {
    setUiLanguage('ja');
    const opened: string[] = [];
    const items = reuseLicenseMenuItems((kind) => opened.push(kind));
    expect(items.map((item) => item.label)).toEqual([
      'WebGPU エンジン',
      '音声強調モデル',
    ]);
    for (const item of items) {
      const click = item.click;
      if (typeof click === 'function') {
        click(undefined as never, undefined, undefined as never);
      }
    }
    expect(opened).toEqual(['engine', 'model']);
  });

  it('uses the English labels', () => {
    setUiLanguage('en');
    const items = reuseLicenseMenuItems(() => undefined);
    expect(items.map((item) => item.label)).toEqual([
      'WebGPU engine',
      'Speech enhancement model',
    ]);
  });
});
