import { useEffect, useState } from 'react';
import type {
  RecordingAppStatus,
  RecordingCaptureStats,
  RecordingLevel,
  RecordingLevelUpdate,
} from '../../shared/types';
import {
  formatLevel,
  frameClockDeltaSeconds,
  isClipping,
  levelPercent,
} from './recording-utils';

type LevelPanelProps = {
  status: RecordingAppStatus;
  chunkCount: number;
};

export function LevelPanel({ status, chunkCount }: LevelPanelProps) {
  const [level, setLevel] = useState<RecordingLevel | null>(null);
  const [stats, setStats] = useState<RecordingCaptureStats | null>(null);

  useEffect(() => {
    let cancelled = false;

    void window.kataribe
      .getRecordingState()
      .then((state) => {
        if (!cancelled) {
          setLevel(state.level);
          setStats(state.captureStats);
        }
      })
      .catch(() => undefined);

    const unsubscribeLevel = window.kataribe.onRecordingLevel(
      (update: RecordingLevelUpdate) => {
        setLevel(update.level);
        setStats(update.stats);
      },
    );
    const unsubscribeState = window.kataribe.onRecordingState((state) => {
      setStats(state.captureStats);
      if (state.status === 'idle' || state.status === 'starting') {
        setLevel(null);
      }
      if (state.status === 'encoding' || state.status === 'error') {
        setLevel(null);
      }
    });

    return () => {
      cancelled = true;
      unsubscribeLevel();
      unsubscribeState();
    };
  }, []);

  const isActive = status === 'recording' || status === 'stopping';

  return (
    <section className="panel level-panel" aria-labelledby="level-title">
      <div className="panel-head">
        <div>
          <p className="section-label">Levels</p>
          <h2 id="level-title">入力レベル</h2>
        </div>
        <span className="panel-note">
          {isActive ? '100 ms 間隔' : '録音停止中'}
        </span>
      </div>

      <div className="meters">
        <div className="meter-row">
          <span className="meter-label">ピーク</span>
          <div className="meter" aria-hidden="true">
            <div
              className="meter-fill meter-peak"
              style={{ width: `${levelPercent(level?.peak ?? 0)}%` }}
            />
          </div>
          <span className="meter-value">{formatLevel(level?.peak ?? 0)}</span>
        </div>
        <div className="meter-row">
          <span className="meter-label">RMS</span>
          <div className="meter" aria-hidden="true">
            <div
              className="meter-fill meter-rms"
              style={{ width: `${levelPercent(level?.rms ?? 0)}%` }}
            />
          </div>
          <span className="meter-value">{formatLevel(level?.rms ?? 0)}</span>
        </div>
      </div>

      {isClipping(level?.peak ?? 0) ? (
        <p className="alert alert-warning">
          入力レベルが 0 dB に近づいています。マイクのゲインを下げてください。
        </p>
      ) : null}

      <dl className="stats-grid">
        <div>
          <dt>実フレーム</dt>
          <dd>{stats ? stats.frames.toLocaleString('ja-JP') : '0'}</dd>
        </div>
        <div>
          <dt>期待フレーム</dt>
          <dd>{stats ? stats.expectedFrames.toLocaleString('ja-JP') : '0'}</dd>
        </div>
        <div>
          <dt>欠落フレーム</dt>
          <dd>{stats ? stats.missedFrames.toLocaleString('ja-JP') : '0'}</dd>
        </div>
        <div>
          <dt>gap</dt>
          <dd>{stats ? `${stats.gaps} 回 / 最大 ${stats.maxGapFrames}` : '0 回'}</dd>
        </div>
        <div>
          <dt>コンテキスト差</dt>
          <dd>{stats ? `${frameClockDeltaSeconds(stats).toFixed(3)} 秒` : '0.000 秒'}</dd>
        </div>
        <div>
          <dt>保存済みチャンク</dt>
          <dd>{chunkCount}</dd>
        </div>
      </dl>

      {!stats ? (
        <p className="muted">
          録音を開始すると、AudioWorklet が数えた実フレーム数と入力レベルを表示します。
        </p>
      ) : null}
    </section>
  );
}
