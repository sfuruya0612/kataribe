import {
  translate,
  type MessageKey,
  type MessageParams,
} from '../shared/i18n';
import type { UiLanguage } from '../shared/types';

let currentLocale: UiLanguage = 'ja';

/**
 * main プロセスが表示する文言の言語を設定する。
 *
 * 設定の正は `SettingsStore` が持ち、この関数は `index.ts` からだけ呼ぶ。
 */
export function setUiLanguage(locale: UiLanguage): void {
  currentLocale = locale;
}

export function getUiLanguage(): UiLanguage {
  return currentLocale;
}

/**
 * main プロセスの現在の UI 言語でメッセージを返す。
 */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(currentLocale, key, params);
}
