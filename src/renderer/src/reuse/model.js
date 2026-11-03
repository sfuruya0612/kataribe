// Vendored from geronimi73/re-use-demo at commit 0d54dca074597b111a8e8c78f6067a6fa0231f75.
// MIT License. See resources/licenses/reuse-webgpu-engine-LICENSE.txt.

// RE-USE (NVIDIA NemotronLabs) speech enhancement on WebGPU.
// Input/output: compressed magnitude and phase spectrograms [F][T] (log1p magnitude, radians).

import * as K from "./kernels.js";
import { findAdapter, GPU_ERRORS, NEEDED_WORKGROUP_STORAGE } from "./gpu-check.js";

// ---------------------------------------------------------------- weights

// Parse a .safetensors file into { name: Float32Array }
export function parseSafetensors(buf) {
  const view = new DataView(buf);
  const n = Number(view.getBigUint64(0, true));
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n)));
  const out = {};
  for (const [name, info] of Object.entries(header)) {
    if (name === "__metadata__") continue;
    if (info.dtype !== "F32") throw new Error(`${name}: dtype ${info.dtype} not supported`);
    const [s, e] = info.data_offsets;
    out[name] = { data: new Float32Array(buf.slice(8 + n + s, 8 + n + e)), shape: info.shape };
  }
  return out;
}

// torch conv weight [Co][Ci][KT][KF] -> [(kt*KF + kf)*Ci + ci][Co]
function packConv({ data, shape }, transposeKernel = false) {
  let [Co, Ci, KT, KF] = shape;
  const out = new Float32Array(Co * Ci * KT * KF);
  // transposeKernel: a (1, k) kernel applied along T is stored as (k, 1)
  const kt_ = transposeKernel ? KF : KT, kf_ = transposeKernel ? KT : KF;
  for (let co = 0; co < Co; co++)
    for (let ci = 0; ci < Ci; ci++)
      for (let a = 0; a < KT; a++)
        for (let b = 0; b < KF; b++) {
          const kt = transposeKernel ? b : a, kf = transposeKernel ? a : b;
          out[((kt * kf_ + kf) * Ci + ci) * Co + co] = data[((co * Ci + ci) * KT + a) * KF + b];
        }
  return out;
}

// torch linear weight [out][in] -> [in][out]
function packLinear({ data, shape }) {
  const [O, I] = shape;
  const out = new Float32Array(O * I);
  for (let o = 0; o < O; o++) for (let i = 0; i < I; i++) out[i * O + o] = data[o * I + i];
  return out;
}

const cat = (...arrs) => {
  const out = new Float32Array(arrs.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

// InstanceNorm gamma, beta and PReLU slope of a conv_norm_act block
const normParams = (w, prefix) => cat(w[`${prefix}.1.weight`].data, w[`${prefix}.1.bias`].data, w[`${prefix}.2.weight`].data);

// Pack all layers into the layouts the kernels expect
export function packWeights(w) {
  const P = {};
  const enc = "dense_encoder";
  P.enc = {
    // First conv sees (mag, phase, 0, 0): weights padded from 2 to 4 input channels for the vec4 GEMM
    c1: { W: cat(packConv(w[`${enc}.dense_conv_1.0.weight`]), new Float32Array(2 * 64)), b: w[`${enc}.dense_conv_1.0.bias`].data, n: normParams(w, `${enc}.dense_conv_1`) },
    db: [0, 1, 2, 3].map((i) => ({
      W: packConv(w[`${enc}.dense_block.dense_block.${i}.0.weight`]),
      b: w[`${enc}.dense_block.dense_block.${i}.0.bias`].data,
      n: normParams(w, `${enc}.dense_block.dense_block.${i}`),
    })),
    c2: { W: packConv(w[`${enc}.dense_conv_2.0.weight`]), b: w[`${enc}.dense_conv_2.0.bias`].data, n: normParams(w, `${enc}.dense_conv_2`) },
  };

  P.mamba = [];
  for (let i = 0; i < 30; i++) {
    for (const axis of ["time_mamba", "freq_mamba"]) {
      const pre = `TSMamba.${i}.${axis}`;
      const fw = (k) => w[`${pre}.forward_blocks.${k}`];
      const bw = (k) => w[`${pre}.backward_blocks.${k}`];
      // in_proj of both directions side by side: [64][1024]
      const inF = packLinear(fw("in_proj.weight")), inB = packLinear(bw("in_proj.weight"));
      const Win = new Float32Array(64 * 1024);
      for (let k = 0; k < 64; k++) {
        Win.set(inF.subarray(k * 512, k * 512 + 512), k * 1024);
        Win.set(inB.subarray(k * 512, k * 512 + 512), k * 1024 + 512);
      }
      const Wx = cat(packLinear(fw("x_proj.weight")), packLinear(bw("x_proj.weight")));
      // Scan params per direction: A, dt_proj w, dt_proj b, D, conv w; then conv bias of both
      const dirParams = (g) => cat(
        g("A_log").data.map((v) => -Math.exp(v)),
        g("dt_proj.weight").data,
        g("dt_proj.bias").data,
        g("D").data,
        g("conv1d.weight").data,
      );
      const S = cat(dirParams(fw), dirParams(bw), fw("conv1d.bias").data, bw("conv1d.bias").data);
      // output_proj(cat(Wof y_f + x, Wob y_b + x)) = (Wp1 Wof) y_f + (Wp2 Wob) y_b + (Wp1 + Wp2) x + bp
      const Wp = w[`${pre}.output_proj.weight`].data;   // [64][128]
      const Wof = fw("out_proj.weight").data, Wob = bw("out_proj.weight").data;   // [64][256]
      const Wc = new Float32Array(576 * 64);
      for (let n = 0; n < 64; n++) {
        for (let k = 0; k < 256; k++) {
          let sf = 0, sb = 0;
          for (let j = 0; j < 64; j++) {
            sf += Wp[n * 128 + j] * Wof[j * 256 + k];
            sb += Wp[n * 128 + 64 + j] * Wob[j * 256 + k];
          }
          Wc[k * 64 + n] = sf;
          Wc[(256 + k) * 64 + n] = sb;
        }
        for (let k = 0; k < 64; k++) Wc[(512 + k) * 64 + n] = Wp[n * 128 + k] + Wp[n * 128 + 64 + k];
      }
      const ln = cat(w[`${pre}.norm.weight`].data, w[`${pre}.norm.bias`].data);
      P.mamba.push({ Win, Wx, S, Wc, bc: w[`${pre}.output_proj.bias`].data, ln });
    }
  }

  // Both decoders batched: magnitude first, phase second
  const dec = (name) => ({
    db: [0, 1, 2, 3].map((i) => ({
      W: packConv(w[`${name}.dense_block.dense_block.${i}.0.weight`]),
      b: w[`${name}.dense_block.dense_block.${i}.0.bias`].data,
      n: normParams(w, `${name}.dense_block.dense_block.${i}`),
    })),
    up1: { W: packConv(w[`${name}.up_conv1.0.conv.weight`]), b: w[`${name}.up_conv1.0.conv.bias`].data, n: normParams(w, `${name}.up_conv1`) },
    up2: { W: packConv(w[`${name}.up_conv2.0.conv.weight`], true), b: w[`${name}.up_conv2.0.conv.bias`].data, n: normParams(w, `${name}.up_conv2`) },
  });
  const dm = dec("mask_decoder"), dp = dec("phase_decoder");
  const pair = (a, b) => ({ W: cat(a.W, b.W), b: cat(a.b, b.b), n: cat(a.n, b.n), wSize: a.W.length, bSize: a.b.length });
  P.dec = {
    db: [0, 1, 2, 3].map((i) => pair(dm.db[i], dp.db[i])),
    up1: pair(dm.up1, dp.up1),
    up2: pair(dm.up2, dp.up2),
  };
  P.head = cat(
    w["mask_decoder.final_conv.weight"].data, w["mask_decoder.final_conv.bias"].data,
    w["phase_decoder.phase_conv_r.weight"].data, w["phase_decoder.phase_conv_r.bias"].data,
    w["phase_decoder.phase_conv_i.weight"].data, w["phase_decoder.phase_conv_i.bias"].data,
  );
  return P;
}

// ---------------------------------------------------------------- model

const U = GPUBufferUsage;

// Sizes (floats) of the big tensors for one spectrogram, and which of the two arenas each lives in
function tensorSizes(F, T) {
  const Tp = T + 2, Fp = F + 2, Pf = Tp * Fp;
  const Tl = Math.floor((Tp - 1) / 4) + 1, Fl = Math.floor((Fp - 3) / 2) + 1, P = Tl * Fl;
  const P1 = Tl * 2 * Fl, P2 = 4 * Tl * 2 * Fl;
  const sizes = {
    x0: [1, Pf * 4], dfull: [0, Pf * 256], e3: [1, Pf * 64],    // encoder
    xz: [0, P * 1024], y: [1, P * 512],                          // Mamba stack
    ddec: [0, 2 * P * 256], x3dec: [1, 2 * P * 64], u1: [0, 2 * P1 * 64], u2: [1, 2 * P2 * 64],   // decoders
  };
  const arenaSize = [0, 0];
  for (const [a, n] of Object.values(sizes)) arenaSize[a] = Math.max(arenaSize[a], n);
  return { Tp, Fp, Pf, Tl, Fl, P, P1, P2, sizes, arenaSize };
}

// Bytes of the largest single buffer for one spectrogram
export const largestBufferBytes = (F, T) => Math.max(...tensorSizes(F, T).arenaSize) * 4;

export class ReuseGPU {
  // profile: record GPU time per kernel with timestamp queries (slower, for benchmarking)
  static async create(weightsBuffer, { profile = false } = {}) {
    const { adapter, reason } = await findAdapter();
    if (!adapter) throw new Error(GPU_ERRORS[reason]);
    const features = profile && adapter.features.has("timestamp-query") ? ["timestamp-query"] : [];
    const device = await adapter.requestDevice({
      requiredFeatures: features,
      requiredLimits: {
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxComputeWorkgroupStorageSize: NEEDED_WORKGROUP_STORAGE,
      },
    });
    return new ReuseGPU(device, packWeights(parseSafetensors(weightsBuffer)), features.length > 0);
  }

  constructor(device, P, profile) {
    this.device = device;
    this.profile = profile;
    // Largest buffer this GPU can bind
    this.maxBufferBytes = Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize);
    const sources = {
      gemm: K.gemmSource(), gemmInplace: K.gemmSource({ inplace: true }),
      inPartial: K.IN_PARTIAL, inFinal: K.IN_FINAL, inApply: K.IN_APPLY,
      prep: K.PREP, core: K.MAMBA_CORE, head: K.HEAD, copy: K.COPY,
    };
    this.modules = {};
    this.pipes = {};
    for (const [k, code] of Object.entries(sources)) {
      this.modules[k] = device.createShaderModule({ code });
      this.pipes[k] = device.createComputePipeline({ layout: "auto", compute: { module: this.modules[k], entryPoint: "main" } });
    }
    const up = (arr) => {
      const b = device.createBuffer({ size: Math.max(16, arr.byteLength), usage: U.STORAGE | U.COPY_DST });
      device.queue.writeBuffer(b, 0, arr);
      return b;
    };
    const upLayer = (l) => ({ W: up(l.W), b: up(l.b), n: up(l.n), wSize: l.wSize, bSize: l.bSize });
    this.w = {
      enc: { c1: upLayer(P.enc.c1), db: P.enc.db.map(upLayer), c2: upLayer(P.enc.c2) },
      mamba: P.mamba.map((m) => ({ Win: up(m.Win), Wx: up(m.Wx), S: up(m.S), Wc: up(m.Wc), bc: up(m.bc), ln: up(m.ln) })),
      dec: { db: P.dec.db.map(upLayer), up1: upLayer(P.dec.up1), up2: upLayer(P.dec.up2) },
      head: up(P.head),
    };
    this.zeros = up(new Float32Array(1024));
    this.plan_ = null;
  }

  // Buffers and dispatches for one spectrogram size; only the latest size is kept
  plan(F, T) {
    if (this.plan_ && this.plan_.F === F && this.plan_.T === T) return this.plan_;
    this.release();
    const dev = this.device;
    const { Tp, Fp, Pf, Tl, Fl, P, P1, P2, sizes, arenaSize } = tensorSizes(F, T);
    const need = Math.max(...arenaSize) * 4;
    if (need > this.maxBufferBytes) {
      throw new Error(`Audio chunk too large for this GPU (needs ${Math.round(need / 2 ** 20)} MB buffers, limit ${Math.round(this.maxBufferBytes / 2 ** 20)} MB)`);
    }
    const owned = [];
    const buf = (floats) => {
      const b = dev.createBuffer({ size: Math.max(16, floats * 4), usage: U.STORAGE | U.COPY_SRC | U.COPY_DST });
      owned.push(b);
      return b;
    };
    // Big tensors live in two arena buffers. A tensor starts at offset 0 of its arena once the one
    // before it there is dead. Every dispatch that reads one big tensor and writes another uses one
    // from each arena (WebGPU tracks read/write conflicts per buffer, not per range).
    const arenas = arenaSize.map((n) => buf(n));
    const B = {
      mag: buf(F * T), pha: buf(F * T), magOut: buf(F * T), phaOut: buf(F * T),
      latA: buf(P * 64), latB: buf(P * 64),
      partial: buf(2 * 1024 * 4 * 64 * 2), stats: buf(2 * 64 * 2),
    };
    for (const [k, [a, n]] of Object.entries(sizes)) B[k] = { buffer: arenas[a], offset: 0, size: n * 4 };
    const steps = [];
    const uniform = (u32s) => {
      const arr = new Uint32Array(Math.ceil(u32s.length / 4) * 4);
      arr.set(u32s);
      const b = dev.createBuffer({ size: arr.byteLength, usage: U.UNIFORM | U.COPY_DST });
      dev.queue.writeBuffer(b, 0, arr);
      owned.push(b);
      return b;
    };
    // null entries are bindings the pipeline does not have
    // Entries are buffers or arena views { buffer, offset, size }
    const bind = (pipeline, buffers) => dev.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: buffers.map((b, i) => b && { binding: i, resource: b instanceof GPUBuffer ? { buffer: b } : b }).filter(Boolean),
    });
    // 1D thread count -> 2D workgroup grid (each dimension is limited to 65535)
    const grid = (threads) => {
      const wgs = Math.ceil(threads / 256);
      const x = Math.min(wgs, 65535);
      return [x, Math.ceil(wgs / x)];
    };
    const add = (label, pipeline, buffers, wg) => steps.push({ label, pipeline, group: bind(pipeline, buffers), wg });

    const gemm = (label, o) => {
      const g = [
        o.M, o.Fout ?? o.M, o.Cin, o.KT ?? 1, o.KF ?? 1, o.Tin ?? 1, o.Fin ?? o.M, o.inStride ?? o.Cin,
        o.inOff ?? 0, o.sT ?? 1, o.sF ?? 1, o.dT ?? 1, o.dF ?? 1, o.pT ?? 0, o.pF ?? 0, o.N,
        o.outStride ?? o.N, o.outOff ?? 0, o.mode ?? 0, o.r ?? 1, o.K2 ?? 0, o.in2Stride ?? 0, 0, o.aBatch ?? 0,
        o.wBatch ?? 0, o.oBatch ?? 0, o.bBatch ?? 0, 0,
      ];
      const inplace = o.A === o.O;
      add(label, inplace ? this.pipes.gemmInplace : this.pipes.gemm,
        [uniform(g), inplace ? null : o.A, o.W, o.bias ?? this.zeros, o.O, o.A2 ?? this.zeros, o.ln ?? this.zeros],
        [Math.ceil(o.M / 128), Math.ceil(o.N / 64), o.batch ?? 1]);
    };
    // InstanceNorm + affine + PReLU in place over Pn positions, 64 channels at stride/off
    const inorm = (label, X, Pn, stride, off, prm, batch = 1, batchStride = 0) => {
      const nWG = Math.min(1024, Math.ceil(Pn / 1024));
      const chunk = Math.ceil(Pn / nWG);
      const [gx, gy] = grid(Pn * 16);
      const u = uniform([Pn, stride, off, chunk, batchStride, nWG, gx, 0]);
      add(`${label}.in`, this.pipes.inPartial, [u, X, B.partial], [nWG, 1, batch]);
      add(`${label}.in`, this.pipes.inFinal, [u, X, B.partial, B.stats], [1, 1, batch]);
      add(`${label}.in`, this.pipes.inApply, [u, X, B.stats, prm], [gx, gy, batch]);
    };
    // DenseBlock: 4 dilated 3x3 convs. Slots in D (stride 256): [x2, x1, x0, input]; layer i reads
    // the last 64*(i+1) channels and writes the slot before them, the last layer writes `out`.
    const denseBlock = (label, D, out, Tn, Fn, layers, batch = 1) => {
      const Pn = Tn * Fn;
      for (let i = 0; i < 4; i++) {
        const last = i === 3;
        gemm(`${label}.conv`, {
          M: Pn, Fout: Fn, Tin: Tn, Fin: Fn, Cin: 64 * (i + 1), inStride: 256, inOff: (3 - i) * 64, KT: 3, KF: 3,
          dT: 2 ** i, pT: 2 ** i, pF: 1, A: D, W: layers[i].W, bias: layers[i].b, N: 64,
          O: last ? out : D, outStride: last ? 64 : 256, outOff: last ? 0 : (2 - i) * 64,
          batch, aBatch: Pn * 256, wBatch: layers[i].wSize ?? 0, bBatch: 64, oBatch: last ? Pn * 64 : Pn * 256,
        });
        inorm(label, last ? out : D, Pn, last ? 64 : 256, last ? 0 : (2 - i) * 64, layers[i].n, batch, last ? Pn * 64 : Pn * 256);
      }
    };

    // Encoder: [T+2][F+2] -> latent [Tl][Fl][64]
    const e = this.w.enc;
    {
      const [gx, gy] = grid(Pf);
      add("enc.prep", this.pipes.prep, [uniform([F, T, gx, 0]), B.mag, B.pha, B.x0], [gx, gy, 1]);
    }
    gemm("enc.conv", { M: Pf, Fout: Fp, Tin: Tp, Fin: Fp, Cin: 4, A: B.x0, W: e.c1.W, bias: e.c1.b, N: 64, O: B.dfull, outStride: 256, outOff: 192 });
    inorm("enc", B.dfull, Pf, 256, 192, e.c1.n);
    denseBlock("enc", B.dfull, B.e3, Tp, Fp, e.db);
    gemm("enc.conv", { M: P, Fout: Fl, Tin: Tp, Fin: Fp, Cin: 64, KF: 3, sT: 4, sF: 2, A: B.e3, W: e.c2.W, bias: e.c2.b, N: 64, O: B.latA });
    inorm("enc", B.latA, P, 64, 0, e.c2.n);
    const marks = { enc: steps.length };

    // 30 x (time Mamba, frequency Mamba). Time axis reads latA -> latB, frequency axis latB -> latA.
    for (let i = 0; i < 60; i++) {
      const m = this.w.mamba[i];
      const time = i % 2 === 0;
      const src = time ? B.latA : B.latB, dst = time ? B.latB : B.latA;
      const L = time ? Tl : Fl, nB = time ? Fl : Tl, bS = time ? 1 : Fl, lS = time ? Fl : 1;
      gemm("mamba.in_proj", { M: P, Cin: 64, A: src, W: m.Win, N: 1024, O: B.xz });
      add("mamba.core", this.pipes.core, [uniform([L, nB, bS, lS, P, 0, 0, 0]), B.xz, m.S, m.Wx, B.y], [2 * nB, 1, 1]);
      gemm("mamba.out", { M: P, Cin: 512, A: B.y, W: m.Wc, bias: m.bc, N: 64, O: dst, mode: 3, K2: 64, A2: src, in2Stride: 64, ln: m.ln });
      if (i === 1) marks.blk0 = steps.length;
    }
    marks.blk29 = steps.length;

    // Decoders, magnitude and phase batched over z
    const d = this.w.dec;
    {
      const [gx, gy] = grid(P * 64);
      add("dec.copy", this.pipes.copy, [uniform([P, 64, 0, 256, 192, P * 256, gx, 0]), B.latA, B.ddec], [gx, gy, 2]);
    }
    denseBlock("dec", B.ddec, B.x3dec, Tl, Fl, d.db, 2);
    gemm("dec.up", {
      M: P, Fout: Fl, Tin: Tl, Fin: Fl, Cin: 64, KF: 3, pF: 1, A: B.x3dec, W: d.up1.W, bias: d.up1.b, N: 128, O: B.u1,
      outStride: 64, mode: 1, r: 2, batch: 2, aBatch: P * 64, wBatch: d.up1.wSize, bBatch: 128, oBatch: P1 * 64,
    });
    inorm("dec", B.u1, P1, 64, 0, d.up1.n, 2, P1 * 64);
    gemm("dec.up", {
      M: P1, Fout: 2 * Fl, Tin: Tl, Fin: 2 * Fl, Cin: 64, KT: 3, pT: 1, A: B.u1, W: d.up2.W, bias: d.up2.b, N: 256, O: B.u2,
      outStride: 64, mode: 2, r: 4, batch: 2, aBatch: P1 * 64, wBatch: d.up2.wSize, bBatch: 256, oBatch: P2 * 64,
    });
    inorm("dec", B.u2, P2, 64, 0, d.up2.n, 2, P2 * 64);
    {
      const [hx, hy] = grid(F * T);
      add("head", this.pipes.head, [uniform([F, T, 2 * Fl, hx, P2 * 64, 0, 0, 0]), B.u2, this.w.head, B.magOut, B.phaOut], [hx, hy, 1]);
    }

    let query = null;
    if (this.profile) {
      query = {
        set: dev.createQuerySet({ type: "timestamp", count: steps.length * 2 }),
        resolve: dev.createBuffer({ size: steps.length * 16, usage: U.QUERY_RESOLVE | U.COPY_SRC }),
        read: dev.createBuffer({ size: steps.length * 16, usage: U.MAP_READ | U.COPY_DST }),
      };
      owned.push(query.set, query.resolve, query.read);
    }
    const read = dev.createBuffer({ size: F * T * 8, usage: U.MAP_READ | U.COPY_DST });
    owned.push(read);
    const bytes = owned.reduce((s, b) => s + (b.size ?? 0), 0);
    this.plan_ = { F, T, Tl, Fl, P, B, steps, marks, query, read, owned, bytes };
    return this.plan_;
  }

  // Throw the first GPU error of the current run, if any
  async checkErrors() {
    const validation = await this.device.popErrorScope();
    const memory = await this.device.popErrorScope();
    if (memory) { this.release(); throw new Error("The GPU ran out of memory"); }
    if (validation) { this.release(); throw new Error(`GPU error: ${validation.message}`); }
  }

  // Free the GPU buffers of the current plan
  release() {
    if (!this.plan_) return;
    for (const b of this.plan_.owned) b.destroy();
    this.plan_ = null;
  }

  // Encode steps [from, to) of a plan into one compute pass (one pass per step when profiling)
  encode(enc, plan, from = 0, to = plan.steps.length) {
    if (plan.query) {
      for (let i = from; i < to; i++) {
        const s = plan.steps[i];
        const pass = enc.beginComputePass({ timestampWrites: { querySet: plan.query.set, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1 } });
        pass.setPipeline(s.pipeline);
        pass.setBindGroup(0, s.group);
        pass.dispatchWorkgroups(...s.wg);
        pass.end();
      }
      return;
    }
    const pass = enc.beginComputePass();
    for (let i = from; i < to; i++) {
      const s = plan.steps[i];
      pass.setPipeline(s.pipeline);
      pass.setBindGroup(0, s.group);
      pass.dispatchWorkgroups(...s.wg);
    }
    pass.end();
  }

  // Run the model on one spectrogram. mag, pha: Float32Array [F][T].
  // Returns { mag, pha } [F][T] and, when profiling, GPU milliseconds per kernel label.
  // stopAt ("enc", "blk0", "blk29") stops early so intermediates can be read for testing.
  async run(mag, pha, F, T, { stopAt = null } = {}) {
    const dev = this.device;
    // Collect GPU errors, which WebGPU reports without throwing
    dev.pushErrorScope("out-of-memory");
    dev.pushErrorScope("validation");
    let plan;
    try {
      plan = this.plan(F, T);
    } catch (e) {
      await dev.popErrorScope(); await dev.popErrorScope();
      throw e;
    }
    dev.queue.writeBuffer(plan.B.mag, 0, mag);
    dev.queue.writeBuffer(plan.B.pha, 0, pha);
    const enc = dev.createCommandEncoder();
    const to = stopAt ? plan.marks[stopAt] : plan.steps.length;
    this.encode(enc, plan, 0, to);
    if (!stopAt) {
      enc.copyBufferToBuffer(plan.B.magOut, 0, plan.read, 0, F * T * 4);
      enc.copyBufferToBuffer(plan.B.phaOut, 0, plan.read, F * T * 4, F * T * 4);
    }
    if (plan.query) {
      enc.resolveQuerySet(plan.query.set, 0, to * 2, plan.query.resolve, 0);
      enc.copyBufferToBuffer(plan.query.resolve, 0, plan.query.read, 0, to * 16);
    }
    dev.queue.submit([enc.finish()]);
    let timings = null;
    if (plan.query) {
      await plan.query.read.mapAsync(GPUMapMode.READ, 0, to * 16);
      const ts = new BigInt64Array(plan.query.read.getMappedRange(0, to * 16).slice(0));
      plan.query.read.unmap();
      timings = {};
      for (let i = 0; i < to; i++) {
        const l = plan.steps[i].label;
        timings[l] = (timings[l] ?? 0) + Number(ts[2 * i + 1] - ts[2 * i]) / 1e6;
      }
    }
    if (stopAt) {
      await dev.queue.onSubmittedWorkDone();
      await this.checkErrors();
      return { timings };
    }
    await plan.read.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(plan.read.getMappedRange().slice(0));
    plan.read.unmap();
    await this.checkErrors();
    // Output that is all zeros or not a number means the GPU work did not run
    let finite = true, nonzero = false;
    for (let i = 0; i < F * T; i++) {
      const v = out[i];
      if (!Number.isFinite(v)) { finite = false; break; }
      if (v !== 0) nonzero = true;
    }
    if (!finite || !nonzero) throw new Error(`The GPU returned ${finite ? "empty" : "invalid"} output`);
    return { mag: out.subarray(0, F * T), pha: out.subarray(F * T), timings };
  }

  // Read back a buffer of the current plan (for testing)
  async readBuffer(buffer, floats) {
    const rb = this.device.createBuffer({ size: floats * 4, usage: U.MAP_READ | U.COPY_DST });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(buffer, 0, rb, 0, floats * 4);
    this.device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(rb.getMappedRange().slice(0));
    rb.destroy();
    return out;
  }
}
