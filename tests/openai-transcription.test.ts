import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OpenAiTranscriptionService,
  OPENAI_MAX_REQUEST_BYTES,
  buildMultipartBody,
} from '../src/main/openai-transcription';
import { encodeWavMono16 } from '../src/main/wav';
import {
  buildOpenAiTranscriptionEndpoint,
  estimateOpenAiChunkCount,
  normalizeOpenAiLanguage,
  openAiModelHasSegmentTimestamps,
  parseOpenAiTranscriptionResponse,
} from '../src/shared/openai-transcription';

/**
 * 対応する要求: REQ-TRANS-001
 * OpenAI の文字起こし API のリクエスト、分割、再試行、部分結果を固定する。
 */

const roots: string[] = [];
const servers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((close) => close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type RecordedRequest = {
  url: string;
  method: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
};

async function startServer(
  handler: (request: RecordedRequest, response: ServerResponse) => void,
): Promise<{ baseUrl: string; requests: RecordedRequest[] }> {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const recorded = {
        url: request.url ?? '',
        method: request.method ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks),
      };
      requests.push(recorded);
      handler(recorded, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  servers.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests };
}

async function createAudio(seconds: number): Promise<{ root: string; wav: string }> {
  const root = await mkdtemp(join(tmpdir(), 'kataribe-openai-'));
  roots.push(root);
  const wav = join(root, 'audio.16k.wav');
  const samples = new Float32Array(16000 * seconds);
  for (let index = 0; index < 16000; index += 1) {
    samples[index] = Math.sin((index / 16000) * 440 * Math.PI * 2) * 0.2;
  }
  await writeFile(wav, encodeWavMono16(samples, 16000));
  return { root, wav };
}

function jsonResponse(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

describe('OpenAI transcription helpers', () => {
  it('req_trans_001_builds_the_endpoint_and_normalizes_models', () => {
    expect(buildOpenAiTranscriptionEndpoint('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1/audio/transcriptions',
    );
    expect(
      buildOpenAiTranscriptionEndpoint(
        'https://api.openai.com/v1/audio/transcriptions',
      ),
    ).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(buildOpenAiTranscriptionEndpoint('')).toBe('');
    expect(openAiModelHasSegmentTimestamps('whisper-1')).toBe(true);
    expect(openAiModelHasSegmentTimestamps('gpt-4o-transcribe')).toBe(false);
    expect(normalizeOpenAiLanguage('Japanese')).toBe('ja');
    expect(normalizeOpenAiLanguage('EN')).toBe('en');
    expect(normalizeOpenAiLanguage(null)).toBeNull();
    expect(estimateOpenAiChunkCount(0)).toBe(1);
    expect(estimateOpenAiChunkCount(60)).toBe(1);
    expect(estimateOpenAiChunkCount(601)).toBe(2);
    expect(estimateOpenAiChunkCount(3600)).toBe(6);
    expect(OPENAI_MAX_REQUEST_BYTES).toBe(25 * 1024 * 1024);
  });

  it('req_trans_001_parses_verbose_json_with_offsets', () => {
    const parsed = parseOpenAiTranscriptionResponse(
      JSON.stringify({
        language: 'japanese',
        segments: [
          { start: 0.5, end: 2.5, text: ' ひとつ目 ' },
          { start: 3, end: 4, text: ' ふたつ目 ' },
          { start: 5, end: 4, text: 'invalid' },
        ],
      }),
      'whisper-1',
      10,
      8,
    );
    expect(parsed.language).toBe('ja');
    expect(parsed.segments).toEqual([
      { startSeconds: 10.5, endSeconds: 12.5, text: 'ひとつ目' },
      { startSeconds: 13, endSeconds: 14, text: 'ふたつ目' },
    ]);
  });

  it('req_trans_001_uses_one_segment_for_models_without_timestamps', () => {
    const parsed = parseOpenAiTranscriptionResponse(
      JSON.stringify({ text: '本文' }),
      'gpt-4o-transcribe',
      20,
      5,
    );
    expect(parsed.language).toBeNull();
    expect(parsed.segments).toEqual([
      { startSeconds: 20, endSeconds: 25, text: '本文' },
    ]);
  });

  it('req_trans_001_returns_empty_segments_for_invalid_json', () => {
    expect(parseOpenAiTranscriptionResponse('{', 'whisper-1', 0, 1)).toEqual({
      segments: [],
      language: null,
    });
  });

  it('req_trans_001_builds_multipart_bodies_with_the_file_bytes', () => {
    const file = Buffer.from([0, 1, 2, 3, 255]);
    const multipart = buildMultipartBody(
      [
        ['model', 'whisper-1'],
        ['response_format', 'verbose_json'],
      ],
      {
        field: 'file',
        filename: 'audio-1.wav',
        contentType: 'audio/wav',
        data: file,
      },
    );
    expect(multipart.contentType.startsWith('multipart/form-data; boundary=')).toBe(
      true,
    );
    const text = multipart.body.toString('latin1');
    expect(text).toContain('name="model"');
    expect(text).toContain('whisper-1');
    expect(text).toContain('name="response_format"');
    expect(text).toContain('verbose_json');
    expect(text).toContain('filename="audio-1.wav"');
    expect(text).toContain('Content-Type: audio/wav');
    expect(multipart.body.includes(file)).toBe(true);
  });
});

describe('OpenAiTranscriptionService', () => {
  it('req_trans_001_splits_audio_and_adds_chunk_offsets', async () => {
    const { root, wav } = await createAudio(2);
    const server = await startServer((_request, response) => {
      jsonResponse(response, 200, {
        language: 'japanese',
        segments: [{ start: 0, end: 0.4, text: '発話' }],
      });
    });
    const service = new OpenAiTranscriptionService({
      fetch,
      sleep: async () => undefined,
      chunkSeconds: 1,
      maxBytes: 16_000 * 2,
    });
    const progress: number[] = [];
    const partials: number[] = [];
    const outcome = await service.transcribe({
      audioWavPath: wav,
      tempDir: root,
      durationSeconds: 2,
      model: 'whisper-1',
      endpoint: server.baseUrl,
      apiKey: 'sk-test',
      onUpdate: (value) => progress.push(value.ratio),
      onPartial: (value) => {
        partials.push(value.segments.length);
      },
    });

    expect(outcome.state).toBe('completed');
    expect(outcome.segments.length).toBeGreaterThanOrEqual(2);
    expect(outcome.segments[0]?.startSeconds).toBe(0);
    expect(outcome.segments[1]?.startSeconds).toBeGreaterThan(0.5);
    expect(outcome.language).toBe('ja');
    expect(progress.at(-1)).toBe(1);
    expect(partials.at(-1)).toBe(outcome.segments.length);
    expect(server.requests.length).toBe(outcome.segments.length);
    for (const request of server.requests) {
      expect(request.method).toBe('POST');
      expect(request.headers.authorization).toBe('Bearer sk-test');
      expect(request.headers['content-type']).toContain('multipart/form-data');
      expect(request.body.toString('utf8')).toContain('name="file"');
      expect(request.body.toString('utf8')).toContain('name="model"');
      expect(request.body.toString('utf8')).toContain('whisper-1');
    }
    const entries = await readdir(root);
    expect(entries.filter((entry) => entry.startsWith('openai-chunks-'))).toEqual(
      [],
    );
  });

  it('req_trans_001_retries_server_errors_and_succeeds', async () => {
    const { root, wav } = await createAudio(1);
    let calls = 0;
    const server = await startServer((_request, response) => {
      calls += 1;
      if (calls === 1) {
        jsonResponse(response, 500, { error: 'temporary' });
        return;
      }
      jsonResponse(response, 200, {
        segments: [{ start: 0, end: 0.5, text: '発話' }],
      });
    });
    const service = new OpenAiTranscriptionService({
      fetch,
      sleep: async () => undefined,
      maxAttempts: 2,
      chunkSeconds: 10,
    });
    const outcome = await service.transcribe({
      audioWavPath: wav,
      tempDir: root,
      durationSeconds: 1,
      model: 'whisper-1',
      endpoint: server.baseUrl,
      apiKey: 'sk-test',
    });
    expect(outcome.state).toBe('completed');
    expect(outcome.segments).toEqual([
      { startSeconds: 0, endSeconds: 0.5, text: '発話' },
    ]);
    expect(calls).toBe(2);
  });

  it('req_trans_001_requests_json_for_models_without_timestamps', async () => {
    const { root, wav } = await createAudio(1);
    const server = await startServer((_request, response) => {
      jsonResponse(response, 200, { text: '本文' });
    });
    const service = new OpenAiTranscriptionService({ fetch });
    const outcome = await service.transcribe({
      audioWavPath: wav,
      tempDir: root,
      durationSeconds: 1,
      model: 'gpt-4o-transcribe',
      endpoint: server.baseUrl,
      apiKey: 'sk-test',
    });
    expect(outcome.state).toBe('completed');
    expect(outcome.segments).toEqual([
      { startSeconds: 0, endSeconds: 1, text: '本文' },
    ]);
    const requestBody = server.requests[0]?.body.toString('utf8') ?? '';
    expect(requestBody).toContain('name="response_format"');
    expect(requestBody).toContain('json');
    expect(requestBody).not.toContain('verbose_json');
    expect(requestBody).not.toContain('name="temperature"');
  });

  it('req_trans_001_retries_an_invalid_json_response', async () => {
    const { root, wav } = await createAudio(1);
    let calls = 0;
    const server = await startServer((_request, response) => {
      calls += 1;
      if (calls === 1) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('not json');
        return;
      }
      jsonResponse(response, 200, {
        segments: [{ start: 0, end: 0.5, text: '発話' }],
      });
    });
    const service = new OpenAiTranscriptionService({
      fetch,
      sleep: async () => undefined,
      maxAttempts: 2,
    });
    const outcome = await service.transcribe({
      audioWavPath: wav,
      tempDir: root,
      durationSeconds: 1,
      model: 'whisper-1',
      endpoint: server.baseUrl,
      apiKey: 'sk-test',
    });
    expect(outcome.state).toBe('completed');
    expect(outcome.errorCode).toBeNull();
    expect(calls).toBe(2);
  });

  it('req_trans_001_does_not_retry_configuration_errors', async () => {
    const { root, wav } = await createAudio(1);
    let calls = 0;
    const server = await startServer((_request, response) => {
      calls += 1;
      jsonResponse(response, 401, { error: 'invalid key' });
    });
    const service = new OpenAiTranscriptionService({
      fetch,
      sleep: async () => undefined,
      maxAttempts: 3,
    });
    const outcome = await service.transcribe({
      audioWavPath: wav,
      tempDir: root,
      durationSeconds: 1,
      model: 'whisper-1',
      endpoint: server.baseUrl,
      apiKey: 'sk-test',
    });
    expect(outcome.state).toBe('failed');
    expect(outcome.errorCode).toBe('openai-config');
    expect(calls).toBe(1);
  });

  it('req_trans_001_reports_413_without_retrying', async () => {
    const { root, wav } = await createAudio(1);
    let calls = 0;
    const server = await startServer((_request, response) => {
      calls += 1;
      jsonResponse(response, 413, { error: 'too large' });
    });
    const service = new OpenAiTranscriptionService({
      fetch,
      sleep: async () => undefined,
      maxAttempts: 3,
    });
    const outcome = await service.transcribe({
      audioWavPath: wav,
      tempDir: root,
      durationSeconds: 1,
      model: 'whisper-1',
      endpoint: server.baseUrl,
      apiKey: 'sk-test',
    });
    expect(outcome.state).toBe('failed');
    expect(outcome.errorCode).toBe('file-too-large');
    expect(calls).toBe(1);
  });

  it('req_trans_001_keeps_successful_chunks_as_a_partial_result', async () => {
    const { root, wav } = await createAudio(2);
    let calls = 0;
    const server = await startServer((_request, response) => {
      calls += 1;
      if (calls === 1) {
        jsonResponse(response, 200, {
          segments: [{ start: 0, end: 0.4, text: '前半' }],
        });
        return;
      }
      jsonResponse(response, 500, { error: 'failed' });
    });
    const service = new OpenAiTranscriptionService({
      fetch,
      sleep: async () => undefined,
      maxAttempts: 1,
      chunkSeconds: 1,
      maxBytes: 16_000 * 2,
    });
    const partials: number[] = [];
    const outcome = await service.transcribe({
      audioWavPath: wav,
      tempDir: root,
      durationSeconds: 2,
      model: 'whisper-1',
      endpoint: server.baseUrl,
      apiKey: 'sk-test',
      onPartial: (value) => {
        partials.push(value.segments.length);
      },
    });
    expect(outcome.state).toBe('partial');
    expect(outcome.errorCode).toBe('openai-server');
    expect(outcome.segments.length).toBe(1);
    expect(partials.at(-1)).toBe(1);
  });

  it('req_trans_001_cancels_an_in_flight_request', async () => {
    const { root, wav } = await createAudio(1);
    let received: (() => void) | null = null;
    const receivedRequest = new Promise<void>((resolve) => {
      received = resolve;
    });
    const server = await startServer((_request, response) => {
      received?.();
      const timer = setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ segments: [{ start: 0, end: 0.5, text: '発話' }] }),
        );
      }, 5000);
      timer.unref?.();
    });
    const service = new OpenAiTranscriptionService({
      fetch,
      sleep: async () => undefined,
    });
    const controller = new AbortController();
    const pending = service.transcribe({
      audioWavPath: wav,
      tempDir: root,
      durationSeconds: 1,
      model: 'whisper-1',
      endpoint: server.baseUrl,
      apiKey: 'sk-test',
      signal: controller.signal,
    });
    await receivedRequest;
    controller.abort();
    const outcome = await pending;
    expect(outcome.state).toBe('cancelled');
    expect(outcome.errorCode).toBe('cancelled');
  });
});
