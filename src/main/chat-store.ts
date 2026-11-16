import { randomUUID } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ChatMessage,
  ChatRole,
  ChatSource,
  MeetingSummary,
} from '../shared/types';
import { writePrivateText } from './private-file';

export const CHAT_FILE = 'chat.json';
export const CHAT_SCHEMA_VERSION = 1;
export const MAX_CHAT_MESSAGES = 100;
export const MAX_CHAT_TOTAL_CHARS = 400_000;
export const MAX_CHAT_CONTENT_CHARS = 20_000;
export const MAX_CHAT_SOURCES = 8;
export const MAX_CHAT_SOURCE_TITLE_CHARS = 300;
export const MAX_CHAT_SOURCE_SNIPPET_CHARS = 2_000;
export const MAX_CHAT_FILE_BYTES = 5_000_000;

export type ChatStoreReadResult = {
  messages: ChatMessage[];
  lastProfileId: string | null;
  contextHash: string | null;
  error: string | null;
};

type StoredChatFile = {
  schema_version: 1;
  updated_at: string;
  last_profile_id: string | null;
  context_hash: string | null;
  messages: ChatMessage[];
};

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function boundedString(value: unknown, maxChars: number): string | null {
  const text = asString(value);
  return text === null ? null : text.slice(0, maxChars);
}

function asRole(value: unknown): ChatRole | null {
  return value === 'user' || value === 'assistant' ? value : null;
}

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeSource(value: unknown, fallbackIndex: number): ChatSource | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const input = value as Record<string, unknown>;
  const url = safeUrl(typeof input.url === 'string' ? input.url : '');
  if (!url) {
    return null;
  }
  const displayUrl = safeUrl(
    typeof input.displayUrl === 'string' ? input.displayUrl : '',
  );
  const title =
    typeof input.title === 'string'
      ? input.title.trim().slice(0, MAX_CHAT_SOURCE_TITLE_CHARS)
      : '';
  const snippet =
    typeof input.snippet === 'string'
      ? input.snippet.trim().slice(0, MAX_CHAT_SOURCE_SNIPPET_CHARS)
      : '';
  return {
    index:
      typeof input.index === 'number' && Number.isFinite(input.index) && input.index > 0
        ? Math.floor(input.index)
        : fallbackIndex,
    title: title || url,
    url,
    displayUrl: displayUrl ?? (url.includes('search.brave.com') ? null : url),
    snippet,
  };
}

function normalizeMessage(value: unknown): ChatMessage | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const input = value as Record<string, unknown>;
  const role = asRole(input.role);
  const content =
    typeof input.content === 'string'
      ? input.content.slice(0, MAX_CHAT_CONTENT_CHARS)
      : '';
  if (!role || !content.trim()) {
    return null;
  }
  const sources: ChatSource[] = [];
  if (Array.isArray(input.sources)) {
    for (const entry of input.sources) {
      const source = normalizeSource(entry, sources.length + 1);
      if (source && !sources.some((item) => item.url === source.url)) {
        sources.push(source);
      }
      if (sources.length >= MAX_CHAT_SOURCES) {
        break;
      }
    }
  }
  return {
    id:
      typeof input.id === 'string' && input.id.length > 0
        ? input.id.slice(0, 100)
        : randomUUID(),
    role,
    content,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : '',
    profileId: boundedString(input.profileId, 200),
    model: boundedString(input.model, 200),
    webSearch: input.webSearch === true,
    sources,
    searchError: boundedString(input.searchError, 2_000),
  };
}

function trimMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  const trimmed = messages.slice(-MAX_CHAT_MESSAGES);
  let total = trimmed.reduce((sum, message) => sum + message.content.length, 0);
  while (trimmed.length > 1 && total > MAX_CHAT_TOTAL_CHARS) {
    const removed = trimmed.shift();
    total -= removed?.content.length ?? 0;
  }
  return trimmed;
}

export class ChatStore {
  async read(meeting: MeetingSummary): Promise<ChatStoreReadResult> {
    const path = join(meeting.meetingDir, CHAT_FILE);
    let text: string;
    try {
      const info = await stat(path);
      if (info.size > MAX_CHAT_FILE_BYTES) {
        return {
          messages: [],
          lastProfileId: null,
          contextHash: null,
          error: 'chat.json is too large',
        };
      }
      text = await readFile(path, 'utf8');
    } catch {
      return {
        messages: [],
        lastProfileId: null,
        contextHash: null,
        error: null,
      };
    }
    try {
      const parsed = JSON.parse(text) as Partial<StoredChatFile>;
      if (parsed.schema_version !== CHAT_SCHEMA_VERSION) {
        throw new Error('unsupported chat schema');
      }
      const messages = Array.isArray(parsed.messages)
        ? parsed.messages
            .map((value) => normalizeMessage(value))
            .filter((value): value is ChatMessage => value !== null)
        : [];
      return {
        messages: trimMessages(messages),
        lastProfileId: asString(parsed.last_profile_id),
        contextHash: asString(parsed.context_hash),
        error: null,
      };
    } catch (error) {
      return {
        messages: [],
        lastProfileId: null,
        contextHash: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async save(
    meeting: MeetingSummary,
    messages: readonly ChatMessage[],
    lastProfileId: string | null,
    contextHash: string | null,
  ): Promise<void> {
    const stored: StoredChatFile = {
      schema_version: CHAT_SCHEMA_VERSION,
      updated_at: new Date().toISOString(),
      last_profile_id: lastProfileId,
      context_hash: contextHash,
      messages: trimMessages(messages),
    };
    await writePrivateText(
      join(meeting.meetingDir, CHAT_FILE),
      `${JSON.stringify(stored, null, 2)}\n`,
    );
  }

  async clear(meeting: MeetingSummary): Promise<void> {
    await rm(join(meeting.meetingDir, CHAT_FILE), { force: true });
  }
}
