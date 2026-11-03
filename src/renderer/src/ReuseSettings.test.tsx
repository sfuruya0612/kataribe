/**
 * 音声強調設定のモデル一覧、ライセンス、WebGPU の理由を検証する。
 * 対応する要求: REQ-ENHANCE-001
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReuseModelList } from '../../shared/types';
import { I18nProvider } from './i18n';
import { ReuseSettingsView, type ReuseGpuStatus } from './ReuseSettings';

const availableGpu: ReuseGpuStatus = { available: true, reason: null };

const modelList: ReuseModelList = {
  modelsDir: '/tmp/Kataribe/models/reuse',
  models: [
    {
      id: 'nemotronlabs',
      label: 'NVIDIA NemotronLabs RE-USE',
      license: 'OpenMDW-1.1',
      sizeBytes: 38_592_940,
      installed: false,
      downloading: false,
      progress: null,
      error: null,
    },
  ],
};

function render(
  models: ReuseModelList,
  gpu: ReuseGpuStatus = availableGpu,
  locale: 'ja' | 'en' = 'ja',
  savedAudioEnabled = false,
): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(ReuseSettingsView, {
        models,
        gpu,
        savedAudioEnabled,
        busy: null,
        error: null,
        notice: null,
        onToggleSavedAudio: () => undefined,
        onDownload: () => undefined,
        onCancel: () => undefined,
        onDelete: () => undefined,
        onOpenLicense: () => undefined,
      }),
    }),
  );
}

describe('req_enhance_001_reuse_settings', () => {
  it('renders the commercial model, its license, and the download action', () => {
    const html = render(modelList);
    expect(html).toContain('音声強調 (RE-USE)');
    expect(html).toContain('NVIDIA NemotronLabs RE-USE');
    expect(html).toContain('OpenMDW-1.1');
    expect(html).toContain('>ダウンロード</button>');
    expect(html).toContain('WebGPU エンジンのライセンス');
    expect(html).toContain('音声強調モデルのライセンス');
    expect(html).toContain('研究および教育用のモデルは');
    expect(html).toContain('/tmp/Kataribe/models/reuse');
    expect(html).not.toContain('RE-USE (research)');
  });

  it('renders the saved audio enhancement setting as off by default', () => {
    const html = render(modelList);
    expect(html).toContain('録音停止後の保存音声の強調');
    expect(html).toMatch(
      /<strong>録音停止後の保存音声の強調<\/strong>[\s\S]*?type="checkbox"\/>/,
    );
  });

  it('marks the saved audio enhancement setting as on', () => {
    const html = render(modelList, availableGpu, 'ja', true);
    expect(html).toMatch(
      /<strong>録音停止後の保存音声の強調<\/strong>[\s\S]*?type="checkbox" checked=""/,
    );
  });

  it('renders the installed state and the delete action', () => {
    const installed: ReuseModelList = {
      ...modelList,
      models: [{ ...modelList.models[0], installed: true }],
    };
    const html = render(installed);
    expect(html).toContain('>インストール済み</span>');
    expect(html).toContain('>削除</button>');
    expect(html).not.toContain('>ダウンロード</button>');
  });

  it('renders download progress and the cancel action', () => {
    const downloading: ReuseModelList = {
      ...modelList,
      models: [
        {
          ...modelList.models[0],
          downloading: true,
          progress: 0.5,
        },
      ],
    };
    const html = render(downloading);
    expect(html).toContain('ダウンロード中 (50%)');
    expect(html).toContain('>中止</button>');
  });

  it('explains why WebGPU is unavailable and does not claim it works', () => {
    const html = render(modelList, { available: false, reason: 'limits' });
    expect(html).toContain(
      'この GPU は音声強調モデルに必要な容量を満たしません。',
    );
    expect(html).not.toContain('音声強調を実行できます。');
  });

  it('renders the English labels', () => {
    const html = render(modelList, availableGpu, 'en');
    expect(html).toContain('Speech enhancement (RE-USE)');
    expect(html).toContain('WebGPU engine license');
    expect(html).toContain('Speech enhancement model license');
    expect(html).toContain('>Download</button>');
  });
});
