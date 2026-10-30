import { useEffect, useState } from 'react';
import type { MeetingSummary } from '../../shared/types';
import { AudioPlayer } from './AudioPlayer';
import {
  formatDateTime,
  formatDuration,
  inputSourceLabel,
  meetingStatusClass,
  meetingStatusLabel,
} from './recording-utils';

type DetailTab = 'transcript' | 'summary';

type MeetingDetailProps = {
  meeting: MeetingSummary | null;
  onBack: () => void;
  onOpenFolder: () => void;
};

export function MeetingDetail({
  meeting,
  onBack,
  onOpenFolder,
}: MeetingDetailProps) {
  const [tab, setTab] = useState<DetailTab>('transcript');
  const [peaks, setPeaks] = useState<number[]>([]);
  const [waveformError, setWaveformError] = useState<string | null>(null);

  useEffect(() => {
    setTab('transcript');
    setPeaks([]);
    setWaveformError(null);
    if (!meeting?.audioUrl) {
      return;
    }
    let cancelled = false;
    void window.kataribe
      .getMeetingWaveform(meeting.id)
      .then((waveform) => {
        if (!cancelled) {
          setPeaks(waveform.peaks);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setWaveformError(String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [meeting?.id, meeting?.audioUrl]);

  if (!meeting) {
    return (
      <div className="detail-empty">
        <h1 className="page-title">会議が選ばれていません</h1>
        <p className="muted">会議一覧から録音を選ぶと、音声と処理状況を表示します。</p>
        <button type="button" className="button button-secondary" onClick={onBack}>
          会議一覧へ
        </button>
      </div>
    );
  }

  return (
    <article className="detail-panel">
      <div className="detail-toolbar">
        <button type="button" className="detail-back" onClick={onBack}>
          会議一覧へ
        </button>
        <span className="detail-toolbar-spacer" />
        <button type="button" className="button button-secondary" disabled title="文字起こしは未実装です">
          コピー
        </button>
        <button type="button" className="button button-primary" disabled title="要約は未実装です">
          要約を生成
        </button>
      </div>

      <div className="detail-head">
        <div className="detail-title-row">
          <h1 className="detail-title">{meeting.title}</h1>
          <button type="button" className="link-button" disabled title="タイトル編集は未実装です">
            タイトルを編集
          </button>
          <span className={`status-chip ${meetingStatusClass(meeting.status)}`}>
            {meetingStatusLabel(meeting.status)}
          </span>
        </div>
        <p className="detail-meta">
          {formatDateTime(meeting.startedAt)} · {formatDuration(meeting.duration)} ·{' '}
          {meeting.inputSource ? inputSourceLabel(meeting.inputSource) : '入力不明'} ·{' '}
          {meeting.sampleRate.toLocaleString('ja-JP')} Hz
        </p>
        <div className="detail-player-row">
          <AudioPlayer
            src={meeting.audioUrl}
            peaks={peaks}
            duration={meeting.duration}
          />
          <button type="button" className="button button-secondary" onClick={onOpenFolder}>
            Finder で開く
          </button>
        </div>
        {waveformError ? <p className="muted">波形を取得できませんでした。</p> : null}
      </div>

      <div className="detail-body">
        <section className="transcript-pane" aria-labelledby="transcript-title">
          <div className="transcript-bar">
            <div className="seg" role="tablist" aria-label="会議の表示">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'transcript'}
                aria-pressed={tab === 'transcript'}
                onClick={() => setTab('transcript')}
              >
                文字起こし
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'summary'}
                aria-pressed={tab === 'summary'}
                onClick={() => setTab('summary')}
              >
                要約
              </button>
            </div>
            <span className="detail-toolbar-spacer" />
            <button type="button" className="link-button" disabled>
              編集
            </button>
          </div>
          <div className="transcript-empty">
            <h2>{tab === 'transcript' ? '文字起こし' : '要約'}</h2>
            <p>
              {tab === 'transcript'
                ? '文字起こしはまだ実装されていません。録音した音声は上のプレイヤーで再生できます。'
                : '要約、決定事項、ToDo はまだ実装されていません。文字起こしの実装後に追加します。'}
            </p>
          </div>
        </section>

        <aside className="summary-pane" aria-labelledby="summary-title">
          <div className="summary-head">
            <h2 id="summary-title">要約</h2>
            <button type="button" className="link-button" disabled>
              再生成
            </button>
          </div>
          <div className="summary-empty">
            <p>要約はまだありません。</p>
            <p className="muted">
              文字起こしと LLM の実装後に、ここへ要約、決定事項、ToDo、未決事項を表示します。
            </p>
          </div>
        </aside>
      </div>
    </article>
  );
}
