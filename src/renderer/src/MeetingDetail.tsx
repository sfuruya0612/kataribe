import { useState } from 'react';
import type { RecordingStopResult } from '../../shared/types';
import { formatDateTime, formatDuration } from './recording-utils';

type DetailTab = 'audio' | 'transcript' | 'summary';

type MeetingDetailProps = {
  result: RecordingStopResult | null;
};

const tabs: Array<{ value: DetailTab; label: string }> = [
  { value: 'audio', label: '音声' },
  { value: 'transcript', label: '文字起こし' },
  { value: 'summary', label: '要約' },
];

export function MeetingDetail({ result }: MeetingDetailProps) {
  const [tab, setTab] = useState<DetailTab>('audio');

  return (
    <section className="view-panel" aria-labelledby="detail-title">
      <div className="view-head">
        <div>
          <p className="section-label">Meeting</p>
          <h2 id="detail-title">会議詳細</h2>
        </div>
        <span className="panel-note">詳細の本実装は次の issue</span>
      </div>

      {result ? (
        <>
          <div className="detail-meta">
            <div>
              <span className="detail-label">録音日時</span>
              <strong>{formatDateTime(result.startedAt)}</strong>
            </div>
            <div>
              <span className="detail-label">長さ</span>
              <strong>{formatDuration(result.actualSamples / result.sampleRate)}</strong>
            </div>
            <div>
              <span className="detail-label">状態</span>
              <strong>{result.hadChunkFailure ? '一部保存' : '変換待ち'}</strong>
            </div>
          </div>
          <p className="path">{result.audioPath}</p>

          <div className="tabs" role="tablist" aria-label="会議詳細の表示">
            {tabs.map((entry) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab === entry.value}
                className={`tab ${tab === entry.value ? 'is-active' : ''}`}
                key={entry.value}
                onClick={() => setTab(entry.value)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="tab-content">
            {tab === 'audio' ? (
              <div className="empty-state">
                <h3>音声プレイヤー</h3>
                <p>
                  音声の再生と波形の表示は次の issue で追加します。現在は結合した WAV
                  を保存しています。
                </p>
              </div>
            ) : null}
            {tab === 'transcript' ? (
              <div className="empty-state">
                <h3>文字起こし</h3>
                <p>文字起こしの表示と編集は、文字起こしの実装後に追加します。</p>
              </div>
            ) : null}
            {tab === 'summary' ? (
              <div className="empty-state">
                <h3>要約</h3>
                <p>要約、決定事項、ToDo の表示は、要約の実装後に追加します。</p>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="empty-state">
          <h3>会議が選ばれていません</h3>
          <p>会議一覧から録音を選ぶと、音声、文字起こし、要約を表示します。</p>
        </div>
      )}
    </section>
  );
}
