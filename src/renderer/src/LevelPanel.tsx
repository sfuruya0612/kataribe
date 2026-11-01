import { useEffect, useState } from 'react';
import type {
  RecordingAppStatus,
  RecordingCaptureStats,
  RecordingClippingReport,
  RecordingLevel,
  RecordingLevelUpdate,
  RecordingSilenceReport,
} from '../../shared/types';
import { useI18n } from './i18n';
import {
  formatLevel,
  frameClockDeltaSeconds,
  levelPercent,
} from './recording-utils';

type LevelPanelProps = {
  status: RecordingAppStatus;
  chunkCount: number;
  clipping: RecordingClippingReport | null;
  silence: RecordingSilenceReport | null;
};

export function LevelPanel({
  status,
  chunkCount,
  clipping,
  silence,
}: LevelPanelProps) {
  const { locale, t } = useI18n();
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
          <p className="section-label">{t('レベル')}</p>
          <h2 id="level-title">{t('入力レベル')}</h2>
        </div>
        <span className="panel-note">
          {isActive ? t('100 ms 間隔') : t('録音停止中')}
        </span>
      </div>

      <div className="meters">
        <div className="meter-row">
          <span className="meter-label">{t('ピーク')}</span>
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

      {clipping?.active ? (
        <p className="alert alert-warning">
          {t(
            'マイク入力がクリップしています。macOS の入力音量、マイクのゲイン、マイクとの距離を調整してください。',
          )}
        </p>
      ) : null}

      {silence?.active ? (
        <p className="alert alert-warning">
          {t(
            'システム音声が届いていません。Multi-Output Device と macOS の出力設定を確認してください。',
          )}
        </p>
      ) : null}

      <dl className="stats-grid">
        <div>
          <dt>{t('実フレーム')}</dt>
          <dd>{stats ? stats.frames.toLocaleString(locale) : '0'}</dd>
        </div>
        <div>
          <dt>{t('期待フレーム')}</dt>
          <dd>{stats ? stats.expectedFrames.toLocaleString(locale) : '0'}</dd>
        </div>
        <div>
          <dt>{t('欠落フレーム')}</dt>
          <dd>{stats ? stats.missedFrames.toLocaleString(locale) : '0'}</dd>
        </div>
        <div>
          <dt>{t('ギャップ')}</dt>
          <dd>
            {stats
              ? t('{gaps} 回 / 最大 {max}', {
                  gaps: stats.gaps,
                  max: stats.maxGapFrames,
                })
              : t('0 回')}
          </dd>
        </div>
        <div>
          <dt>{t('コンテキスト差')}</dt>
          <dd>
            {stats
              ? t('{seconds} 秒', {
                  seconds: frameClockDeltaSeconds(stats).toFixed(3),
                })
              : t('0.000 秒')}
          </dd>
        </div>
        <div>
          <dt>{t('保存済みチャンク')}</dt>
          <dd>{chunkCount}</dd>
        </div>
      </dl>

      {!stats ? (
        <p className="muted">
          {t(
            '録音を開始すると、AudioWorklet が数えた実フレーム数と入力レベルを表示します。',
          )}
        </p>
      ) : null}
    </section>
  );
}
