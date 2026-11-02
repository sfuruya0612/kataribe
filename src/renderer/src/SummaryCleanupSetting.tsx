import type { AppSettings } from '../../shared/types';
import { useI18n } from './i18n';

type SummaryCleanupSettingProps = {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
};

/**
 * 要約の前に相槌と擬音を除くかを設定する。
 */
export function SummaryCleanupSetting({
  settings,
  onUpdateSettings,
}: SummaryCleanupSettingProps) {
  const { t } = useI18n();

  return (
    <section className="settings-section">
      <p className="settings-label">{t('要約の前処理')}</p>
      <div className="setting-card">
        <label className="setting-row">
          <span>
            <strong>{t('相槌と擬音を除いてから要約する')}</strong>
            <span className="muted">
              {t(
                '文字起こしを LLM に送って相槌と擬音を除き、その本文から要約を作ります。送信回数とトークン数が増えます。',
              )}
            </span>
          </span>
          <input
            type="checkbox"
            checked={settings.removeFillersBeforeSummary}
            onChange={(event) =>
              void onUpdateSettings({
                removeFillersBeforeSummary: event.target.checked,
              })
            }
          />
        </label>
      </div>
    </section>
  );
}
