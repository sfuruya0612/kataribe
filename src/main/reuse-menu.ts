import type { MenuItemConstructorOptions } from 'electron';
import type { ReuseLicenseKind } from '../shared/reuse';
import { t } from './i18n';

/**
 * アプリメニューに置く、音声強調のライセンス項目を組み立てる。
 */
export function reuseLicenseMenuItems(
  openLicense: (kind: ReuseLicenseKind) => void,
): MenuItemConstructorOptions[] {
  return [
    {
      label: t('WebGPU エンジン'),
      click: () => openLicense('engine'),
    },
    {
      label: t('音声強調モデル'),
      click: () => openLicense('model'),
    },
  ];
}
