/**
 * UI 言語の辞書とメッセージ整形を検証する。
 * 対応する要求: REQ-UI-001
 */
import { describe, expect, it } from 'vitest';
import {
  EN_MESSAGES,
  interpolate,
  isUiLanguage,
  placeholders,
  translate,
  translateCount,
} from '../src/shared/i18n';

describe('req_ui_001_translate', () => {
  it('returns the Japanese source text for Japanese', () => {
    expect(translate('ja', '録音を開始')).toBe('録音を開始');
    expect(translate('ja', '状態: {status}', { status: '録音中' })).toBe(
      '状態: 録音中',
    );
  });

  it('returns the English text for English', () => {
    expect(translate('en', '録音を開始')).toBe('Start recording');
    expect(translate('en', '状態: {status}', { status: 'Recording' })).toBe(
      'Status: Recording',
    );
  });

  it('keeps every placeholder in the English translation', () => {
    for (const [key, value] of Object.entries(EN_MESSAGES)) {
      expect(new Set(placeholders(value))).toEqual(new Set(placeholders(key)));
    }
  });

  it('uses no Japanese characters in the English translations', () => {
    for (const value of Object.values(EN_MESSAGES)) {
      expect(value).not.toMatch(/[\u3040-\u30ff\u3400-\u9fff]/u);
    }
  });

  it('req_ui_001_composes_the_sync_warning_with_the_service_name', () => {
    const key =
      '保存先が {service} の同期対象です。音声と文字起こしが端末外に同期されます。';

    expect(translate('ja', key, { service: 'iCloud Drive' })).toBe(
      '保存先が iCloud Drive の同期対象です。音声と文字起こしが端末外に同期されます。',
    );
    expect(translate('en', key, { service: 'iCloud Drive' })).toBe(
      'The save location is synced by iCloud Drive. Audio and transcripts are synced off this device.',
    );
  });

  it('keeps a placeholder that has no value', () => {
    expect(interpolate('残り {seconds} 秒', {})).toBe('残り {seconds} 秒');
    expect(interpolate('{count} 件', { count: 3 })).toBe('3 件');
  });

  it('selects singular and plural count messages', () => {
    expect(translateCount('en', 1, '1 人', '{count} 人')).toBe('1 person');
    expect(translateCount('en', 3, '1 人', '{count} 人')).toBe('3 people');
    expect(translateCount('ja', 1, '1 人', '{count} 人')).toBe('1 人');
    expect(translateCount('ja', 3, '1 人', '{count} 人')).toBe('3 人');
  });
});

describe('req_ui_001_is_ui_language', () => {
  it('accepts only the supported languages', () => {
    expect(isUiLanguage('ja')).toBe(true);
    expect(isUiLanguage('en')).toBe(true);
    expect(isUiLanguage('fr')).toBe(false);
    expect(isUiLanguage(null)).toBe(false);
  });
});
