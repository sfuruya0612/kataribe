import type { RecordingStopResult } from '../../shared/types';
import { formatDuration } from './recording-utils';

type ResultPanelProps = {
  result: RecordingStopResult;
  onOpenFolder: () => void;
  onOpenDetail: () => void;
};

export function ResultPanel({ result, onOpenFolder, onOpenDetail }: ResultPanelProps) {
  return (
    <section className="panel result-panel" data-testid="result">
      <div className="panel-head">
        <div>
          <p className="section-label">Saved</p>
          <h2>録音を保存しました</h2>
        </div>
        <span className="state state-finished">
          {result.hadChunkFailure ? '一部保存' : '変換待ち'}
        </span>
      </div>
      <p className="path" data-testid="result-path">
        {result.audioPath}
      </p>
      <dl className="stats-grid">
        <div>
          <dt>長さ</dt>
          <dd>{formatDuration(result.actualSamples / result.sampleRate)}</dd>
        </div>
        <div>
          <dt>実サンプル</dt>
          <dd>{result.actualSamples.toLocaleString('ja-JP')}</dd>
        </div>
        <div>
          <dt>期待サンプル</dt>
          <dd>{result.expectedSamples.toLocaleString('ja-JP')}</dd>
        </div>
        <div>
          <dt>サンプルレート</dt>
          <dd>{result.sampleRate.toLocaleString('ja-JP')} Hz</dd>
        </div>
      </dl>
      {result.actualSamples !== result.expectedSamples ? (
        <p className="alert alert-warning">
          期待サンプル数と実サンプル数が一致しません。一部の音声が欠落している可能性があります。
        </p>
      ) : null}
      {result.hadChunkFailure ? (
        <p className="alert alert-warning">
          保存に失敗したチャンクがあります。音声が欠落している可能性があります。
        </p>
      ) : null}
      <div className="result-actions">
        <button type="button" className="button button-secondary" onClick={onOpenFolder}>
          Finder で開く
        </button>
        <button type="button" className="button button-secondary" onClick={onOpenDetail}>
          会議詳細を開く
        </button>
        <span className="muted">
          mp3 への変換は次の実装で行います。現在は結合した WAV を保存しています。
        </span>
      </div>
    </section>
  );
}
