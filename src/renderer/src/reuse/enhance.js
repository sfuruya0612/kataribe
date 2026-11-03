// Vendored from geronimi73/re-use-demo at commit 0d54dca074597b111a8e8c78f6067a6fa0231f75.
// MIT License. See resources/licenses/reuse-webgpu-engine-LICENSE.txt.

// Waveform in, enhanced waveform out: STFT -> RE-USE on WebGPU -> iSTFT.

import { stft, istft, stftParams } from "./dsp.js";
import { largestBufferBytes } from "./model.js";

// One pass over a waveform. Returns the enhanced waveform and time spent per stage (ms).
export async function enhanceSegment(model, wav, sr) {
  const t = { stft: 0, model: 0, istft: 0 };
  let t0 = performance.now();
  const { nFft, hop } = stftParams(sr);
  const { re, im, F, T } = stft(wav, nFft, hop);
  const mag = new Float32Array(F * T), pha = new Float32Array(F * T);
  for (let i = 0; i < F * T; i++) {
    mag[i] = Math.log1p(Math.hypot(re[i], im[i]));
    pha[i] = Math.atan2(im[i], re[i]);
  }
  t.stft = performance.now() - t0;

  t0 = performance.now();
  const out = await model.run(mag, pha, F, T);
  t.model = performance.now() - t0;

  t0 = performance.now();
  // Silence frames where most bins come out as zero
  const amp = new Float32Array(F * T);
  for (let i = 0; i < F * T; i++) amp[i] = Math.expm1(Math.max(out.mag[i], 0));
  for (let tt = 0; tt < T; tt++) {
    let zeros = 0;
    for (let f = 0; f < F; f++) if (amp[f * T + tt] === 0) zeros++;
    if (zeros / F > 0.5) for (let f = 0; f < F; f++) amp[f * T + tt] = 0;
  }
  const outRe = new Float32Array(F * T), outIm = new Float32Array(F * T);
  for (let i = 0; i < F * T; i++) {
    outRe[i] = amp[i] * Math.cos(out.pha[i]);
    outIm[i] = amp[i] * Math.sin(out.pha[i]);
  }
  const res = istft(outRe, outIm, F, T, nFft, hop);
  const result = new Float32Array(wav.length).fill(1e-8);
  result.set(res.subarray(0, Math.min(res.length, wav.length)));
  t.istft = performance.now() - t0;
  return { wav: result, t };
}

// Longest chunk (seconds, up to max) whose largest GPU buffer fits this device, or 0
export function fitChunkSeconds(model, sr, max = 4) {
  const { nFft, hop } = stftParams(sr);
  const F = nFft / 2 + 1;
  // Single pass covers up to 1.25 chunks, so that length has to fit too
  const fits = (s) => largestBufferBytes(F, Math.floor((1.25 * s * sr) / hop) + 1) <= model.maxBufferBytes;
  if (fits(max)) return max;
  let lo = 0, hi = max;
  for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  return lo;
}

// Long files in chunks with a short linear crossfade between neighbours. GPU memory grows with
// chunk length (about 280 MB per second at 44.1 kHz), so chunks keep it bounded.
export async function enhance(model, wav, sr, { chunkSeconds = 4, overlapSeconds = 0.5, onProgress = null } = {}) {
  // Shorter chunks on GPUs with a small buffer limit
  chunkSeconds = Math.min(chunkSeconds, fitChunkSeconds(model, sr, chunkSeconds));
  if (chunkSeconds < 1) {
    throw new Error(`This device's GPU is too limited (largest buffer ${Math.round(model.maxBufferBytes / 2 ** 20)} MB)`);
  }
  overlapSeconds = Math.min(overlapSeconds, chunkSeconds / 4);
  const size = Math.floor(chunkSeconds * sr);
  if (wav.length <= size * 1.25) {
    const r = await enhanceSegment(model, wav, sr);
    onProgress?.(1);
    return r;
  }
  const fade = Math.floor(overlapSeconds * sr);
  const step = size - fade;
  const count = Math.ceil((wav.length - fade) / step);
  const out = new Float32Array(wav.length);
  const t = { stft: 0, model: 0, istft: 0 };
  for (let i = 0; i < count; i++) {
    // Last chunk is aligned to the end so every chunk has the same length (one GPU plan)
    const start = Math.min(i * step, wav.length - size);
    const seg = await enhanceSegment(model, wav.subarray(start, start + size), sr);
    for (const k in t) t[k] += seg.t[k];
    const prevEnd = i === 0 ? 0 : Math.min((i - 1) * step, wav.length - size) + size;
    for (let j = 0; j < size; j++) {
      const n = start + j;
      // Ramp in over the region the previous chunk also covers
      const w = n < prevEnd ? Math.min(1, (n - start) / Math.max(1, prevEnd - start)) : 1;
      out[n] = out[n] * (1 - w) + seg.wav[j] * w;
    }
    onProgress?.((i + 1) / count);
  }
  return { wav: out, t };
}
