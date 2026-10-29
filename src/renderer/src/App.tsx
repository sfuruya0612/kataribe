import { useEffect, useState } from 'react';
import type { AppInfo } from '../../shared/types';

const nextSteps = [
  {
    id: '0010',
    title: '録音中核',
    description: 'マイクと BlackHole の取得、ミックス、wav チャンク、meta.json',
  },
  {
    id: '0011',
    title: 'メニューバーと画面',
    description: '録音パネル、会議一覧、会議詳細、設定画面の土台',
  },
  {
    id: '0012',
    title: 'デバイス消失と権限',
    description: '録音中のデバイス消失、権限拒否、README への導線',
  },
  {
    id: '0013',
    title: 'リリース検証',
    description: '署名済みビルドの権限、entitlement、リリースチェックリスト',
  },
];

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    window.kataribe
      .getAppInfo()
      .then((value) => {
        if (!cancelled) {
          setInfo(value);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) {
          window.kataribe.ready();
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="app">
      <header className="hero">
        <p className="eyebrow">Kataribe</p>
        <h1>会議の声を、あとから読み返せる形に。</h1>
        <p className="lead">
          録音、文字起こし、要約、ToDo を 1 つのフォルダにまとめる macOS アプリです。
        </p>
      </header>

      <section className="status-card" aria-labelledby="status-title">
        <div className="status-head">
          <span className="badge">アプリ基盤</span>
          <span className="version">{info ? `v${info.version}` : 'v...'}</span>
        </div>
        <h2 id="status-title">基盤の起動に成功しました</h2>
        <p>
          Renderer は Node.js にアクセスできません。preload の IPC だけでメインプロセスと通信します。
        </p>
        {error ? <p className="error">バージョン取得に失敗しました: {error}</p> : null}
        <dl className="meta">
          <div>
            <dt>Platform</dt>
            <dd>{info?.platform ?? '...'}</dd>
          </div>
          <div>
            <dt>Renderer</dt>
            <dd>sandbox / contextIsolation</dd>
          </div>
          <div>
            <dt>Node.js</dt>
            <dd>無効</dd>
          </div>
        </dl>
      </section>

      <section className="next" aria-labelledby="next-title">
        <div className="section-head">
          <h2 id="next-title">次の実装</h2>
          <p>録音機能は issue 0010 以降で追加します。</p>
        </div>
        <ol className="steps">
          {nextSteps.map((step) => (
            <li key={step.id}>
              <span className="step-id">{step.id}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="footer">
        macOS 14.2 以降 / Apple Silicon
      </footer>
    </main>
  );
}
