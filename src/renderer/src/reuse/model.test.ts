/**
 * safetensors の読み込みを小さな fixture で検証する。
 * 対応する要求: REQ-ENHANCE-001、共通基盤
 */
import { describe, expect, it } from 'vitest';

// model.js はモジュールの評価時に GPUBufferUsage を参照する。
// Node には WebGPU のグローバルがないため、読み込み前だけ数値を与える。
const scope = globalThis as unknown as {
  GPUBufferUsage: Record<string, number>;
};
scope.GPUBufferUsage = {
  STORAGE: 1,
  COPY_DST: 2,
  COPY_SRC: 4,
  UNIFORM: 8,
  MAP_READ: 16,
  QUERY_RESOLVE: 32,
};
const { parseSafetensors } = await import('./model.js');

function createSafetensors(
  tensors: Record<string, { dtype: string; shape: number[]; data: number[] }>,
): ArrayBuffer {
  const headerObject: Record<string, unknown> = {};
  let offset = 0;
  for (const [name, tensor] of Object.entries(tensors)) {
    const byteLength = tensor.data.length * 4;
    headerObject[name] = {
      dtype: tensor.dtype,
      shape: tensor.shape,
      data_offsets: [offset, offset + byteLength],
    };
    offset += byteLength;
  }
  const headerJson = JSON.stringify(headerObject);
  const padding = (8 - (headerJson.length % 8)) % 8;
  const headerBytes = new TextEncoder().encode(headerJson + ' '.repeat(padding));
  const buffer = new ArrayBuffer(8 + headerBytes.length + offset);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(headerBytes.length), true);
  new Uint8Array(buffer, 8, headerBytes.length).set(headerBytes);
  let dataOffset = 8 + headerBytes.length;
  for (const tensor of Object.values(tensors)) {
    const values = new Float32Array(tensor.data);
    new Uint8Array(buffer, dataOffset, values.byteLength).set(
      new Uint8Array(values.buffer),
    );
    dataOffset += values.byteLength;
  }
  return buffer;
}

describe('parseSafetensors', () => {
  it('restores a Float32 tensor and its shape', () => {
    const buffer = createSafetensors({
      'layer.weight': { dtype: 'F32', shape: [2], data: [1.5, -2] },
    });
    const parsed = parseSafetensors(buffer);
    expect(parsed['layer.weight']?.shape).toEqual([2]);
    expect([...parsed['layer.weight']?.data ?? []]).toEqual([1.5, -2]);
  });

  it('rejects a tensor whose dtype is not Float32', () => {
    const buffer = createSafetensors({
      half: { dtype: 'F16', shape: [1], data: [1] },
    });
    expect(() => parseSafetensors(buffer)).toThrow(/dtype F16 not supported/u);
  });
});
