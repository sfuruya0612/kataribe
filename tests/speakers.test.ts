/**
 * 話者名の抽出、検証、置換を検証する。
 * 対応する要求: REQ-DIAR-001
 */
import { describe, expect, it } from 'vitest';
import {
  extractTranscriptSpeakers,
  recoverTranscriptSpeakers,
  renameTranscriptSpeakers,
  speakerLabel,
  validateSpeakerNames,
} from '../src/shared/speakers';

describe('speakerLabel', () => {
  it('maps the first ten speakers to A through J', () => {
    expect(speakerLabel(0)).toBe('話者A');
    expect(speakerLabel(9)).toBe('話者J');
  });

  it('falls back to a numeric label after J', () => {
    expect(speakerLabel(10)).toBe('話者11');
  });
});

describe('extractTranscriptSpeakers', () => {
  it('returns distinct labels in first-appearance order', () => {
    const body = [
      '[00:00:01] 話者B: 先に話します。',
      '[00:00:04] 話者A: はい。',
      '[00:00:08] 話者B: 続けます。',
      'ラベルなしの行です。',
    ].join('\n');

    expect(extractTranscriptSpeakers(body)).toEqual(['話者B', '話者A']);
  });

  it('keeps renamed labels when they are known', () => {
    const body = [
      '[00:00:01] 田中: 会議は 10:30 に始めます。',
      '[00:00:09] 佐藤: はい。',
    ].join('\n');

    expect(extractTranscriptSpeakers(body, ['田中', '佐藤'])).toEqual([
      '田中',
      '佐藤',
    ]);
    expect(extractTranscriptSpeakers(body)).toEqual([]);
  });

  it('recognizes numeric auto labels after J', () => {
    const body = '[00:00:01] 話者11: はい。';

    expect(extractTranscriptSpeakers(body)).toEqual(['話者11']);
  });

  it('ignores an unlabeled sentence with a colon', () => {
    const body = [
      '[00:00:01] We will start with the agenda: budget, hiring.',
      '[00:00:05] 今日は: 晴れです。',
    ].join('\n');

    expect(extractTranscriptSpeakers(body)).toEqual([]);
  });

  it('ignores a label longer than 40 characters', () => {
    const body = `[00:00:01] ${'あ'.repeat(41)}: 長すぎるラベルです。`;

    expect(extractTranscriptSpeakers(body)).toEqual([]);
  });
});

describe('recoverTranscriptSpeakers', () => {
  it('recovers renamed labels when the count matches', () => {
    const body = [
      '[00:00:01] 田中: 一つ目です。',
      '[00:00:02] 佐藤: 二つ目です。',
    ].join('\n');

    expect(recoverTranscriptSpeakers(body, 2)).toEqual(['田中', '佐藤']);
    expect(recoverTranscriptSpeakers(body, 1)).toEqual([]);
    expect(recoverTranscriptSpeakers(body, 3)).toEqual([]);
  });

  it('does not recover an unlabeled sentence with a colon', () => {
    const body =
      '[00:00:01] We will start with the agenda: budget, hiring.';

    expect(recoverTranscriptSpeakers(body, 2)).toEqual([]);
  });
});

describe('validateSpeakerNames', () => {
  it('trims names and keeps the order', () => {
    expect(validateSpeakerNames([' 田中 ', '佐藤'])).toEqual(['田中', '佐藤']);
  });

  it('rejects empty, duplicate, and structured names', () => {
    expect(() => validateSpeakerNames([''])).toThrow(/空/);
    expect(() => validateSpeakerNames(['田中', '田中'])).toThrow(/重複/);
    expect(() => validateSpeakerNames(['田中: 営業'])).toThrow(/コロン/);
    expect(() => validateSpeakerNames(['田\n中'])).toThrow(/改行/);
    expect(() => validateSpeakerNames(['田[中]'])).toThrow(/角括弧/);
    expect(() => validateSpeakerNames(['あ'.repeat(41)])).toThrow(/40/);
  });
});

describe('renameTranscriptSpeakers', () => {
  it('replaces only the speaker prefix and keeps the text', () => {
    const markdown = [
      '---',
      'title: 定例',
      '---',
      '',
      '[00:00:01] 話者A: 今日は 10:30 に始めます。',
      '[00:00:05] 話者B: 了解です。',
    ].join('\n');
    const renamed = renameTranscriptSpeakers(
      markdown,
      new Map([
        ['話者A', '田中'],
        ['話者B', '佐藤'],
      ]),
    );

    expect(renamed).toBe(
      [
        '---',
        'title: 定例',
        '---',
        '',
        '[00:00:01] 田中: 今日は 10:30 に始めます。',
        '[00:00:05] 佐藤: 了解です。',
      ].join('\n'),
    );
  });

  it('swaps names without chaining replacements', () => {
    const markdown = [
      '[00:00:01] 話者A: 一つ目です。',
      '[00:00:05] 話者B: 二つ目です。',
    ].join('\n');
    const renamed = renameTranscriptSpeakers(
      markdown,
      new Map([
        ['話者A', '話者B'],
        ['話者B', '話者A'],
      ]),
    );

    expect(renamed).toBe(
      [
        '[00:00:01] 話者B: 一つ目です。',
        '[00:00:05] 話者A: 二つ目です。',
      ].join('\n'),
    );
  });

  it('prefers the longest matching label', () => {
    const markdown = [
      '[00:00:01] 話者Aさん: 長い名前です。',
      '[00:00:05] 話者A: 短い名前です。',
    ].join('\n');
    const renamed = renameTranscriptSpeakers(
      markdown,
      new Map([
        ['話者A', '田中'],
        ['話者Aさん', '佐藤'],
      ]),
    );

    expect(renamed).toBe(
      [
        '[00:00:01] 佐藤: 長い名前です。',
        '[00:00:05] 田中: 短い名前です。',
      ].join('\n'),
    );
  });

  it('leaves lines without a speaker label and CRLF endings intact', () => {
    const markdown = [
      '[00:00:01] ラベルなしです。',
      '[00:00:05] 話者A: ラベルありです。',
    ].join('\r\n');
    const renamed = renameTranscriptSpeakers(
      markdown,
      new Map([['話者A', '田中']]),
    );

    expect(renamed).toBe(
      [
        '[00:00:01] ラベルなしです。',
        '[00:00:05] 田中: ラベルありです。',
      ].join('\r\n'),
    );
  });

  it('round-trips a rename for generated transcripts', () => {
    let seed = 20261101;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    const pick = (values: readonly string[]) => values[next() % values.length];
    const labels = ['話者A', '話者B', '話者C', '田中', '佐藤'];
    const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    const safeNames = labels.map((label, index) => `${label}_${names[index]}`);

    for (let round = 0; round < 100; round += 1) {
      const lineCount = 1 + (next() % 20);
      const lines = Array.from({ length: lineCount }, (_, index) => {
        const label = pick(labels);
        return `[00:00:${String(index).padStart(2, '0')}] ${label}: 発話 ${index} です: 追加のコロン`;
      });
      const body = lines.join('\n');
      const forward = new Map(labels.map((label) => [label, `${label}_${names[labels.indexOf(label)]}`]));
      const backward = new Map(safeNames.map((name) => [name, name.split('_')[0]]));

      expect(renameTranscriptSpeakers(renameTranscriptSpeakers(body, forward), backward)).toBe(body);
    }
  });
});
