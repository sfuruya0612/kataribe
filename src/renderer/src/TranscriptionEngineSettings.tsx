import {
  normalizeOpenAiTranscriptionModel,
  OPENAI_TRANSCRIPTION_MODELS,
  openAiModelHasSegmentTimestamps,
} from '../../shared/openai-transcription';
import type { AppSettings, LlmProfilesState } from '../../shared/types';
import { useI18n } from './i18n';

type TranscriptionEngineSettingsProps = {
  settings: AppSettings;
  llmProfiles: LlmProfilesState | null;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onOpenSummary: () => void;
};

/**
 * 文字起こしエンジンと OpenAI の送信条件を設定する。
 */
export function TranscriptionEngineSettings({
  settings,
  llmProfiles,
  onUpdateSettings,
  onOpenSummary,
}: TranscriptionEngineSettingsProps) {
  const { t } = useI18n();
  const chatGptProfiles = (llmProfiles?.profiles ?? []).filter(
    (profile) => profile.provider === 'chatgpt',
  );

  return (
    <section className="settings-section">
      <p className="settings-label">{t('文字起こしエンジン')}</p>
      <div className="setting-card">
        <div className="seg settings-source-seg">
          <button
            type="button"
            aria-pressed={settings.transcriptionEngine === 'whisper-cpp'}
            onClick={() =>
              void onUpdateSettings({ transcriptionEngine: 'whisper-cpp' })
            }
          >
            {t('ローカル (whisper.cpp)')}
          </button>
          <button
            type="button"
            aria-pressed={settings.transcriptionEngine === 'openai'}
            onClick={() => void onUpdateSettings({ transcriptionEngine: 'openai' })}
          >
            {t('OpenAI API')}
          </button>
        </div>
        {settings.transcriptionEngine === 'openai' ? (
          <>
            <p className="alert alert-warning">
              {t(
                '文字起こしを開始する前に、送信先、モデル、音声の長さ、分割数を確認します。音声ファイルは端末外に出ます。',
              )}
            </p>
            <label className="field">
              <span>{t('ChatGPT プロファイル')}</span>
              <select
                className="setting-input"
                value={settings.openaiTranscriptionProfileId}
                onChange={(event) =>
                  void onUpdateSettings({
                    openaiTranscriptionProfileId: event.target.value,
                  })
                }
              >
                {chatGptProfiles.length === 0 ? (
                  <option value="">{t('ChatGPT のプロファイルがありません')}</option>
                ) : null}
                {chatGptProfiles.length > 0 &&
                settings.openaiTranscriptionProfileId === '' ? (
                  <option value="">{t('選択してください')}</option>
                ) : null}
                {chatGptProfiles.map((profile) => (
                  <option value={profile.id} key={profile.id}>
                    {profile.id}
                    {profile.apiKeyConfigured ? '' : t('（API キー未設定）')}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('OpenAI の文字起こしモデル')}</span>
              <select
                className="setting-input"
                value={settings.openaiTranscriptionModel}
                onChange={(event) =>
                  void onUpdateSettings({
                    openaiTranscriptionModel: normalizeOpenAiTranscriptionModel(
                      event.target.value,
                    ),
                  })
                }
              >
                {OPENAI_TRANSCRIPTION_MODELS.map((model) => (
                  <option value={model} key={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            {openAiModelHasSegmentTimestamps(settings.openaiTranscriptionModel) ? null : (
              <p className="alert alert-warning">
                {t(
                  'このモデルは区間のタイムスタンプを返しません。文字起こしの時刻は分割した区間の単位になります。',
                )}
              </p>
            )}
            <div className="setting-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={onOpenSummary}
              >
                {t('OpenAI の API キーを設定')}
              </button>
            </div>
            <p className="muted">
              {t(
                'API キーは「要約」タブの ChatGPT プロファイルに保存したキーを使います。送信を承認しなかった場合は、下のローカルモデルで文字起こしを続けます。',
              )}
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}
