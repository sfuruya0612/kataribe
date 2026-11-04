import { randomUUID } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReuseLicenseKind } from '../shared/reuse';
import type { ReuseModel } from '../shared/types';
import { isReuseModel, type ReuseModelManager } from './reuse-models';

export const REUSE_PROTOCOL_SCHEMES = ['kataribe-temp', 'kataribe-model'] as const;

export const REUSE_PROTOCOL_PRIVILEGES = {
  standard: false,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  corsEnabled: true,
} as const;

export type { ReuseLicenseKind };

const LICENSE_FILES: Record<ReuseLicenseKind, string> = {
  engine: 'reuse-webgpu-engine-LICENSE.txt',
  model: 'nvidia-nemotronlabs-re-use-LICENSE.txt',
};

const MAX_TOKEN_LENGTH = 128;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/u;

export function isReuseLicenseKind(value: unknown): value is ReuseLicenseKind {
  return value === 'engine' || value === 'model';
}

/**
 * `reuse:open-license` が開くライセンス本文の固定パスを返す。
 */
export function reuseLicensePath(
  kind: ReuseLicenseKind,
  options: {
    isPackaged: boolean;
    resourcesPath: string;
    appPath: string;
  },
): string {
  const root = options.isPackaged
    ? join(options.resourcesPath, 'licenses')
    : join(options.appPath, 'resources', 'licenses');
  return join(root, LICENSE_FILES[kind]);
}

export type ReuseRequestTarget =
  | { kind: 'temp'; token: string }
  | { kind: 'model'; model: ReuseModel };

/**
 * カスタムプロトコルの URL を、許可した種類と値へ分解する。
 *
 * クエリとフラグメントは受け付けない。URL の解析を 1 箇所に閉じ、
 * 任意のパスやモデル ID をプロトコルへ渡さないためである。
 */
export function parseReuseUrl(rawUrl: string): ReuseRequestTarget | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    return null;
  }
  if (url.protocol === 'kataribe-temp:') {
    if (url.hostname !== 'enhance') {
      return null;
    }
    const token = url.pathname.replace(/^\//u, '');
    if (
      token.length === 0 ||
      token.length > MAX_TOKEN_LENGTH ||
      !TOKEN_PATTERN.test(token)
    ) {
      return null;
    }
    return { kind: 'temp', token };
  }
  if (url.protocol === 'kataribe-model:') {
    if (url.hostname !== 'reuse') {
      return null;
    }
    const model = url.pathname.replace(/^\//u, '');
    if (!isReuseModel(model)) {
      return null;
    }
    return { kind: 'model', model };
  }
  return null;
}

export type ReuseTempTokenStoreOptions = {
  now?: () => number;
  ttlMs?: number;
  createToken?: () => string;
};

const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1000;

type TempToken = {
  path: string;
  expiresAt: number;
};

/**
 * 音声強調の入力 WAV を Renderer に返すための一時トークンを管理する。
 *
 * 期限はトークンの発行時ではなく最後の読み出しからの経過時間で判定し、
 * 処理中のジョブが長時間にわたって読み出しを続けられるようにする。
 */
export class ReuseTempTokenStore {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly createToken: () => string;
  private readonly tokens = new Map<string, TempToken>();

  constructor(options: ReuseTempTokenStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? DEFAULT_TOKEN_TTL_MS;
    this.createToken = options.createToken ?? (() => randomUUID());
  }

  issue(path: string): string {
    const token = this.createToken();
    this.tokens.set(token, {
      path,
      expiresAt: this.now() + this.ttlMs,
    });
    return token;
  }

  resolve(token: string): string | null {
    const entry = this.tokens.get(token);
    if (!entry) {
      return null;
    }
    const now = this.now();
    if (now >= entry.expiresAt) {
      this.tokens.delete(token);
      return null;
    }
    // 長い音声の強調ではチャンクの読み出しが 10 分を超えるため、
    // 読み出しが続いている間は期限を延ばし、無操作のときだけ失効させる。
    entry.expiresAt = now + this.ttlMs;
    return entry.path;
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  clear(): void {
    this.tokens.clear();
  }
}

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

function rangeNotSatisfiable(size: number): Response {
  return new Response('Range not satisfiable', {
    status: 416,
    headers: {
      'Content-Range': `bytes */${size}`,
    },
  });
}

type ByteRange = {
  start: number;
  end: number;
};

function parseRange(value: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, startText, endText] = match;
  if (startText.length === 0 && endText.length === 0) {
    return null;
  }
  if (startText.length === 0) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }
  const start = Number(startText);
  const requestedEnd = endText.length === 0 ? size - 1 : Number(endText);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null;
  }
  return { start, end: Math.min(size - 1, requestedEnd) };
}

async function readFileRange(
  path: string,
  start: number,
  end: number,
): Promise<Buffer> {
  const length = end - start + 1;
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const result = await handle.read(
        buffer,
        offset,
        length - offset,
        start + offset,
      );
      if (result.bytesRead <= 0) {
        throw new Error('file ended while reading the requested range');
      }
      offset += result.bytesRead;
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

/**
 * 許可済みのファイルを、HTTP Range に対応した Response として返す。
 */
export async function serveFileRange(
  path: string,
  request: Request,
  contentType: string,
): Promise<Response> {
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      return notFound();
    }
    size = info.size;
  } catch {
    return notFound();
  }

  const rangeHeader = request.headers.get('range');
  const baseHeaders = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
  };
  if (rangeHeader === null) {
    return new Response(await readFileRange(path, 0, size - 1), {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': String(size),
      },
    });
  }

  const range = parseRange(rangeHeader, size);
  if (!range) {
    return rangeNotSatisfiable(size);
  }
  const body = await readFileRange(path, range.start, range.end);
  return new Response(body, {
    status: 206,
    headers: {
      ...baseHeaders,
      'Content-Length': String(body.length),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
    },
  });
}

export type ReuseProtocolRegistrar = {
  handle(
    scheme: string,
    handler: (request: Request) => Promise<Response>,
  ): void;
};

export type ReuseProtocolOptions = {
  protocol: ReuseProtocolRegistrar;
  tempTokens: ReuseTempTokenStore;
  modelManager: ReuseModelManager;
};

/**
 * 一時 WAV とモデル重みだけを返すカスタムプロトコルを登録する。
 */
export function registerReuseProtocols(options: ReuseProtocolOptions): void {
  options.protocol.handle('kataribe-temp', async (request) => {
    const target = parseReuseUrl(request.url);
    if (target?.kind !== 'temp') {
      return notFound();
    }
    const path = options.tempTokens.resolve(target.token);
    if (!path) {
      return notFound();
    }
    return serveFileRange(path, request, 'audio/wav');
  });

  options.protocol.handle('kataribe-model', async (request) => {
    const target = parseReuseUrl(request.url);
    if (target?.kind !== 'model') {
      return notFound();
    }
    const path = await options.modelManager.installedPath(target.model);
    if (!path) {
      return notFound();
    }
    return serveFileRange(path, request, 'application/octet-stream');
  });
}
