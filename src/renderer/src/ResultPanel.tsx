import type { RecordingStopResult } from '../../shared/types';
import { useI18n } from './i18n';
import { formatDuration } from './recording-utils';

type ResultPanelProps = {
  result: RecordingStopResult;
  onOpenFolder: () => void;
  onOpenDetail: () => void;
};

export function ResultPanel({ result, onOpenFolder, onOpenDetail }: ResultPanelProps) {
  const { locale, t } = useI18n();
  return (
    <section className="panel result-panel" data-testid="result">
      <div className="panel-head">
        <div>
          <p className="section-label">{t('保存済み')}</p>
          <h2>{t('録音を保存しました')}</h2>
        </div>
        <span className="state state-finished">
          {result.hadChunkFailure ? t('一部保存') : t('変換と文字起こしを開始')}
        </span>
      </div>
      <p className="path" data-testid="result-path">
        {result.audioPath}
      </p>
      <dl className="stats-grid">
        <div>
          <dt>{t('長さ')}</dt>
          <dd>{formatDuration(result.actualSamples / result.sampleRate)}</dd>
        </div>
        <div>
          <dt>{t('実サンプル')}</dt>
          <dd>{result.actualSamples.toLocaleString(locale)}</dd>
        </div>
        <div>
          <dt>{t('期待サンプル')}</dt>
          <dd>{result.expectedSamples.toLocaleString(locale)}</dd>
        </div>
        <div>
          <dt>{t('サンプルレート')}</dt>
          <dd>{result.sampleRate.toLocaleString(locale)} Hz</dd>
        </div>
      </dl>
      {result.actualSamples !== result.expectedSamples ? (
        <p className="alert alert-warning">
          {t(
            '期待サンプル数と実サンプル数が一致しません。一部の音声が欠落している可能性があります。',
          )}
        </p>
      ) : null}
      {result.hadChunkFailure ? (
        <p className="alert alert-warning">
          {t('保存に失敗したチャンクがあります。音声が欠落している可能性があります。')}
        </p>
      ) : null}
      <div className="result-actions">
        <button type="button" className="button button-secondary" onClick={onOpenFolder}>
          {t('Finder で開く')}
        </button>
        <button type="button" className="button button-secondary" onClick={onOpenDetail}>
          {t('会議詳細を開く')}
        </button>
        <span className="muted">
          {t(
            'mp3 への変換と文字起こしはバックグラウンドで自動的に始まります。会議詳細で進捗を確認できます。',
          )}
        </span>
      </div>
    </section>
  );
}
