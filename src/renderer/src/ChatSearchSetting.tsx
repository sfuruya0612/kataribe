import type { AppSettings } from '../../shared/types';
import { useI18n } from './i18n';

type ChatSearchSettingProps = {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
};

/**
 * 会議チャットの Web 検索を既定で使うかを設定する。
 */
export function ChatSearchSetting({
  settings,
  onUpdateSettings,
}: ChatSearchSettingProps) {
  const { t } = useI18n();

  return (
    <section className="settings-section">
      <p className="settings-label">{t('会議チャット')}</p>
      <div className="setting-card">
        <label className="setting-row">
          <span className="setting-row-text">
            <strong>{t('会議チャットで Web 検索を既定で使う')}</strong>
            <span className="muted">
              {t(
                '検索語は Brave Search または DuckDuckGo に送信されます。検索結果は回答の参考にだけ使い、元のページはアプリ内で開きません。',
              )}
            </span>
            <span className="muted">
              {t(
                'API キーは不要です。検索エンジンの仕様変更で使えなくなる場合があります。',
              )}
            </span>
          </span>
          <input
            type="checkbox"
            checked={settings.chatWebSearchDefault}
            onChange={(event) =>
              void onUpdateSettings({
                chatWebSearchDefault: event.target.checked,
              })
            }
          />
        </label>
      </div>
    </section>
  );
}
