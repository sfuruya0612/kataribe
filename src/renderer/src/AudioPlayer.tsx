import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { AudioVariantSelector, type AudioVariant } from './AudioVariantSelector';
import { useI18n } from './i18n';
import { formatDuration } from './recording-utils';

type AudioPlayerProps = {
  src: string | null;
  enhancedSrc?: string | null;
  peaks: number[];
  duration: number;
  initialTime?: number | null;
};

const FALLBACK_BARS = 72;

function fallbackPeaks(): number[] {
  return Array.from({ length: FALLBACK_BARS }, (_, index) => {
    return 0.25 + 0.65 * Math.abs(Math.sin((index + 1) * 1.37));
  });
}

export function AudioPlayer({
  src,
  enhancedSrc = null,
  peaks,
  duration,
  initialTime,
}: AudioPlayerProps) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(duration);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<'play' | 'load' | null>(null);
  const [variant, setVariant] = useState<AudioVariant>('raw');
  const selectedSrc = variant === 'enhanced' && enhancedSrc ? enhancedSrc : src;

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setMediaDuration(duration);
    setError(null);
    const audio = audioRef.current;
    if (audio && src) {
      audio.load();
      if (initialTime !== null && initialTime !== undefined && initialTime > 0) {
        const apply = () => {
          const total = Number.isFinite(audio.duration) ? audio.duration : duration;
          audio.currentTime = Math.max(0, Math.min(total, initialTime));
          setCurrent(audio.currentTime);
        };
        if (audio.readyState >= 1) {
          apply();
        } else {
          audio.addEventListener('loadedmetadata', apply, { once: true });
        }
      }
    }
  }, [selectedSrc, duration, initialTime]);

  useEffect(() => {
    setVariant('raw');
  }, [src]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !selectedSrc) {
      return;
    }
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setError('play');
      }
    } else {
      audio.pause();
    }
  };

  const seek = (event: MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const total = mediaDuration > 0 ? mediaDuration : duration;
    if (!audio || total <= 0) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * total;
    setCurrent(audio.currentTime);
  };

  const cycleSpeed = () => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  };

  if (!src) {
    return <div className="player-empty">{t('音声ファイルがありません。')}</div>;
  }

  const total = mediaDuration > 0 ? mediaDuration : duration;
  const progress = total > 0 ? Math.min(1, current / total) : 0;
  const bars = peaks.length > 0 ? peaks : fallbackPeaks();

  return (
    <div className="audio-player" data-testid="audio-player">
      <AudioVariantSelector
        value={variant}
        hasEnhanced={enhancedSrc !== null}
        onChange={setVariant}
      />
      <audio
        ref={audioRef}
        src={selectedSrc ?? undefined}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) {
            setMediaDuration(value);
          }
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onError={() => setError('load')}
      />
      <button
        type="button"
        className="play-button"
        onClick={() => void toggle()}
        aria-label={playing ? t('一時停止') : t('再生')}
      >
        {playing ? (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
            <rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 2.5 13 8 4 13.5Z" fill="currentColor" />
          </svg>
        )}
      </button>
      <span className="player-time">{formatDuration(current)}</span>
      <div
        className="waveform"
        onClick={seek}
        role="slider"
        aria-label={t('再生位置')}
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(current)}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            const audio = audioRef.current;
            if (audio) {
              audio.currentTime = Math.max(
                0,
                Math.min(total, audio.currentTime + (event.key === 'ArrowRight' ? 5 : -5)),
              );
            }
          }
        }}
      >
        {bars.map((peak, index) => (
          <span
            key={index}
            className={`waveform-bar ${
              index / bars.length <= progress ? 'is-played' : ''
            }`}
            style={{ height: `${Math.max(8, Math.round(peak * 100))}%` }}
          />
        ))}
      </div>
      <span className="player-time">{formatDuration(total)}</span>
      <button type="button" className="speed-button" onClick={cycleSpeed}>
        {speed.toFixed(1)}×
      </button>
      {error ? (
        <span className="player-error">
          {error === 'play'
            ? t('音声を再生できませんでした。')
            : t('音声を読み込めませんでした。')}
        </span>
      ) : null}
    </div>
  );
}
