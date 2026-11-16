/**
 * チャット履歴の読み書き、検証、上限、消去を検証する。
 * 対応する要求: REQ-CHAT-001
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage, MeetingSummary } from '../src/shared/types';
import {
  CHAT_FILE,
  ChatStore,
  MAX_CHAT_MESSAGES,
} from '../src/main/chat-store';

const roots: string[] = [];

async function createMeeting(): Promise<MeetingSummary> {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-chat-'));
  roots.push(root);
  return {
    id: 'meeting-1',
    title: '週次定例',
    meetingDir: root,
    startedAt: '2026-11-16T00:00:00.000Z',
    duration: 60,
    status: 'summarized',
    inputSource: 'both',
    sampleRate: 48000,
    audioUrl: null,
    chunkCount: 0,
    hasTranscript: true,
    hasSummary: true,
    transcriptPartial: false,
    translationLanguages: [],
    summaryLanguage: 'ja',
    pinned: false,
    enhancedModels: [],
    hasRawTranscript: false,
    transcriptModels: [],
    enhancementState: null,
  };
}

function message(index: number): ChatMessage {
  return {
    id: `message-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `メッセージ ${index}`,
    createdAt: '2026-11-16T00:00:00.000Z',
    profileId: 'claude',
    model: 'claude-test',
    webSearch: false,
    sources: [],
    searchError: null,
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('ChatStore', () => {
  it('returns an empty history when chat.json is missing', async () => {
    const meeting = await createMeeting();
    const store = new ChatStore();
    await expect(store.read(meeting)).resolves.toEqual({
      messages: [],
      lastProfileId: null,
      contextHash: null,
      error: null,
    });
  });

  it('saves and reads messages with the profile and context hash', async () => {
    const meeting = await createMeeting();
    const store = new ChatStore();
    await store.save(meeting, [message(1), message(2)], 'claude', 'hash-1');
    await expect(store.read(meeting)).resolves.toEqual({
      messages: [message(1), message(2)],
      lastProfileId: 'claude',
      contextHash: 'hash-1',
      error: null,
    });
    const file = JSON.parse(
      await readFile(join(meeting.meetingDir, CHAT_FILE), 'utf8'),
    );
    expect(file.schema_version).toBe(1);
  });

  it('drops invalid sources and unsupported roles', async () => {
    const meeting = await createMeeting();
    await writeFile(
      join(meeting.meetingDir, CHAT_FILE),
      JSON.stringify({
        schema_version: 1,
        updated_at: '2026-11-16T00:00:00.000Z',
        last_profile_id: 'claude',
        context_hash: null,
        messages: [
          {
            id: '1',
            role: 'system',
            content: 'ignore',
          },
          {
            id: '2',
            role: 'assistant',
            content: '回答',
            sources: [
              {
                index: 1,
                title: '安全でない URL',
                url: 'javascript:alert(1)',
                snippet: 'x',
              },
              {
                index: 2,
                title: 'Example',
                url: 'https://example.com/',
                snippet: 'snippet',
              },
            ],
          },
        ],
      }),
    );
    const store = new ChatStore();
    const result = await store.read(meeting);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.sources).toEqual([
      {
        index: 2,
        title: 'Example',
        url: 'https://example.com/',
        displayUrl: 'https://example.com/',
        snippet: 'snippet',
      },
    ]);
  });

  it('reports broken JSON without deleting the file', async () => {
    const meeting = await createMeeting();
    await writeFile(join(meeting.meetingDir, CHAT_FILE), '{broken');
    const store = new ChatStore();
    const result = await store.read(meeting);
    expect(result.error).not.toBeNull();
    expect(result.messages).toEqual([]);
    await expect(
      readFile(join(meeting.meetingDir, CHAT_FILE), 'utf8'),
    ).resolves.toBe('{broken');
  });

  it('keeps only the latest messages', async () => {
    const meeting = await createMeeting();
    const store = new ChatStore();
    const messages = Array.from(
      { length: MAX_CHAT_MESSAGES + 5 },
      (_, index) => message(index),
    );
    await store.save(meeting, messages, 'claude', null);
    const result = await store.read(meeting);
    expect(result.messages).toHaveLength(MAX_CHAT_MESSAGES);
    expect(result.messages[0]?.id).toBe('message-5');
    expect(result.messages[MAX_CHAT_MESSAGES - 1]?.id).toBe(
      `message-${MAX_CHAT_MESSAGES + 4}`,
    );
  });

  it('clears the history', async () => {
    const meeting = await createMeeting();
    const store = new ChatStore();
    await store.save(meeting, [message(1)], 'claude', null);
    await store.clear(meeting);
    await expect(store.read(meeting)).resolves.toMatchObject({
      messages: [],
    });
  });
});
