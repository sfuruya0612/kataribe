// Vendored from geronimi73/re-use-demo at commit 0d54dca074597b111a8e8c78f6067a6fa0231f75.
// MIT License. See resources/licenses/reuse-webgpu-engine-LICENSE.txt.

// WGSL compute kernels for RE-USE. All activations are channels-last: [T, F, C], float32.

const R = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join("\n");
const comp = "xyzw";

// GEMM / implicit-GEMM convolution. Output tile 128 x 64, 256 threads as 16 x 16, each thread
// 8 rows x 4 columns (rows and columns in groups of 4, interleaved by 16), K in chunks of 32.
// Output position m maps to (t, f) = (m / Fout, m % Fout) and reads input (t*sT - pT + kt*dT,
// f*sF - pF + kf*dF). Per-thread work is unrolled into plain variables so it stays in registers.
// Epilogue modes: 0 plain, 1 pixel-shuffle along F by r, 2 pixel-shuffle along T by r,
// 3 LayerNorm over the 64 outputs of each row + residual from the second input A2.
// A2 (1x1, K2 channels, same position m) is accumulated after the main K loop.
// All buffers are vec4: channel counts, strides, offsets, N / r and batch strides must be multiples of 4.
// inplace: input and output are the same buffer (DenseBlock reads earlier slots, writes a new one).
export function gemmSource({ inplace = false } = {}) {
  const TM = 8, BM = 128, BN = 64, BK = 32, KQ = BK / 4;
  const C = (r) => `c${r}`;
  const rowIdx = (r) => `m0 + (${Math.floor(r / 4) * 16}u + ty) * 4u + ${r % 4}u`;
  const redIdx = (r) => `((${Math.floor(r / 4) * 16}u + ty) * 4u + ${r % 4}u) * 16u`;

  // Each thread loads 4 rows (rg*4 .. +4) x one vec4 of k, transposes them, stores 4 vec4s
  const loadA = (second) => `    {
${R(4, (i) => second
    ? `      var r${i} = vec4f(0.0);
      { let m = m0 + rg * 4u + ${i}u; let k = k0 + kq * 4u; if (m < p.M && k < p.K2) { r${i} = A2[(aBase + m * p.in2Stride + p.in2Off + k) / 4u]; } }`
    : `      var r${i} = vec4f(0.0);
      {
        let ti = rowT${i} + kt;
        let fi = rowF${i} + kf;
        let ci = ci0 + kq * 4u;
        if (rowOk${i} && ci < p.Cin && ti >= 0 && ti < i32(p.Tin) && fi >= 0 && fi < i32(p.Fin)) {
          r${i} = A[(aBase + (u32(ti) * p.Fin + u32(fi)) * p.inStride + p.inOff + ci) / 4u];
        }
      }`)}
${R(4, (j) => `      As[(kq * 4u + ${j}u) * ${BM / 4}u + rg] = vec4f(r0.${comp[j]}, r1.${comp[j]}, r2.${comp[j]}, r3.${comp[j]});`)}
    }`;
  const loadB = (second) => R((BN * BK) / 4 / 256, (j) => `    {
      let e = (lid + ${j * 256}u) * 4u;
      let bk = e / ${BN}u;
      let n = n0 + e % ${BN}u;
      var v = vec4f(0.0);
      ${second
        ? `if (k0 + bk < p.K2 && n < p.N) { v = W[(wBase + (Kmain + k0 + bk) * p.N + n) / 4u]; }`
        : `if (ci0 + bk < p.Cin && n < p.N) { v = W[(wBase + (kpos * p.Cin + ci0 + bk) * p.N + n) / 4u]; }`}
      Bs[e / 4u] = v;
    }`);
  const mma = `    for (var k = 0u; k < ${BK}u; k++) {
      let a0 = As[k * ${BM / 4}u + ty];
      let a1 = As[k * ${BM / 4}u + 16u + ty];
      let b0 = Bs[k * ${BN / 4}u + tx];
${R(TM, (r) => `      ${C(r)} += a${Math.floor(r / 4)}.${comp[r % 4]} * b0;`)}
    }`;

  let src = /* wgsl */ `
struct P {
  M: u32, Fout: u32, Cin: u32, KT: u32,
  KF: u32, Tin: u32, Fin: u32, inStride: u32,
  inOff: u32, sT: u32, sF: u32, dT: u32,
  dF: u32, pT: u32, pF: u32, N: u32,
  outStride: u32, outOff: u32, mode: u32, r: u32,
  K2: u32, in2Stride: u32, in2Off: u32, aBatch: u32,
  wBatch: u32, oBatch: u32, bBatch: u32, pad0: u32,
}
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> A: array<vec4f>;
@group(0) @binding(2) var<storage, read> W: array<vec4f>;      // [K][N]
@group(0) @binding(3) var<storage, read> bias: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> O: array<vec4f>;
@group(0) @binding(5) var<storage, read> A2: array<vec4f>;
@group(0) @binding(6) var<storage, read> ln: array<vec4f>;     // LayerNorm gamma[64], beta[64]

var<workgroup> As: array<vec4f, ${(BK * BM) / 4}>;   // [BK][BM / 4]
var<workgroup> Bs: array<vec4f, ${(BK * BN) / 4}>;   // [BK][BN / 4]
var<workgroup> red: array<f32, ${BM * 16}>;          // LayerNorm partial sums [BM][16]

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let z = wid.z;
  let m0 = wid.x * ${BM}u;
  let n0 = wid.y * ${BN}u;
  let tx = lid % 16u;
  let ty = lid / 16u;
  let aBase = z * p.aBatch;
  let wBase = z * p.wBatch;
  let bBase = z * p.bBatch;
  let oBase = z * p.oBatch;
  let kq = lid % ${KQ}u;
  let rg = lid / ${KQ}u;
${R(4, (i) => `  let gm${i} = m0 + rg * 4u + ${i}u;
  let rowOk${i} = gm${i} < p.M;
  let rowT${i} = i32(gm${i} / p.Fout) * i32(p.sT);
  let rowF${i} = i32(gm${i} % p.Fout) * i32(p.sF);`)}
${R(TM, (r) => `  var ${C(r)} = vec4f(0.0);`)}

  let cinChunks = (p.Cin + ${BK - 1}u) / ${BK}u;
  let chunks = p.KT * p.KF * cinChunks;
  let Kmain = p.KT * p.KF * p.Cin;
  for (var kc = 0u; kc < chunks; kc++) {
    let kpos = kc / cinChunks;
    let ci0 = (kc % cinChunks) * ${BK}u;
    let kt = i32((kpos / p.KF) * p.dT) - i32(p.pT);
    let kf = i32((kpos % p.KF) * p.dF) - i32(p.pF);
${loadA(false)}
${loadB(false)}
    workgroupBarrier();
${mma}
    workgroupBarrier();
  }

  let chunks2 = (p.K2 + ${BK - 1}u) / ${BK}u;
  for (var kc = 0u; kc < chunks2; kc++) {
    let k0 = kc * ${BK}u;
${loadA(true)}
${loadB(true)}
    workgroupBarrier();
${mma}
    workgroupBarrier();
  }

  if (p.mode == 3u) {
    // LayerNorm over the 64 outputs of each row, then add the residual (second input)
    let bv = bias[tx];
${R(TM, (r) => `    ${C(r)} += bv;
    red[${redIdx(r)} + tx] = ${C(r)}.x + ${C(r)}.y + ${C(r)}.z + ${C(r)}.w;`)}
    workgroupBarrier();
${R(TM, (r) => `    var mean${r} = 0.0;
    for (var j = 0u; j < 16u; j++) { mean${r} += red[${redIdx(r)} + j]; }
    let d${r} = ${C(r)} - mean${r} / 64.0;`)}
    workgroupBarrier();
${R(TM, (r) => `    red[${redIdx(r)} + tx] = dot(d${r}, d${r});`)}
    workgroupBarrier();
    let gam = ln[tx];
    let bet = ln[16u + tx];
${R(TM, (r) => `    {
      var s = 0.0;
      for (var j = 0u; j < 16u; j++) { s += red[${redIdx(r)} + j]; }
      let m = ${rowIdx(r)};
      if (m < p.M) {
        let y = d${r} * inverseSqrt(s / 64.0 + 1e-5) * gam + bet;
        O[(oBase + m * p.outStride + p.outOff) / 4u + tx] = y + A2[(aBase + m * p.in2Stride + p.in2Off) / 4u + tx];
      }
    }`)}
    return;
  }

  let Cr = p.N / max(p.r, 1u);
  let n = n0 + tx * 4u;
  if (n >= p.N) { return; }
  let bv = bias[(bBase + n) / 4u];
${R(TM, (r) => `  {
    let m = ${rowIdx(r)};
    if (m < p.M) {
      let mt = m / p.Fout;
      let mf = m % p.Fout;
      var idx: u32;
      if (p.mode == 0u) {
        idx = m * p.outStride + p.outOff + n;
      } else if (p.mode == 1u) {
        idx = (mt * p.Fout * p.r + mf * p.r + n / Cr) * p.outStride + p.outOff + n % Cr;
      } else {
        idx = ((mt * p.r + n / Cr) * p.Fout + mf) * p.outStride + p.outOff + n % Cr;
      }
      O[(oBase + idx) / 4u] = ${C(r)} + bv;
    }
  }`)}
}
`;
  if (inplace) {
    src = src.replace("@group(0) @binding(1) var<storage, read> A: array<vec4f>;", "").replaceAll("A[", "O[");
  }
  return src;
}

// InstanceNorm statistics, pass 1: per-workgroup partial sums (shifted by the first value per channel)
export const IN_PARTIAL = /* wgsl */ `
struct P { P: u32, stride: u32, off: u32, chunk: u32, batchStride: u32, nWG: u32, gridX: u32, pad: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read_write> partial: array<f32>;   // [batch][nWG][4 rows][64][2]

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let c = lid % 64u;
  let row = lid / 64u;
  let base = wid.z * p.batchStride + p.off + c;
  let shift = X[base];
  let start = wid.x * p.chunk;
  let end = min(start + p.chunk, p.P);
  var s1 = 0.0;
  var s2 = 0.0;
  for (var pos = start + row; pos < end; pos += 4u) {
    let d = X[base + pos * p.stride] - shift;
    s1 += d;
    s2 += d * d;
  }
  let o = (((wid.z * p.nWG + wid.x) * 4u + row) * 64u + c) * 2u;
  partial[o] = s1;
  partial[o + 1u] = s2;
}
`;

// InstanceNorm statistics, pass 2: combine partials into mean and 1/std per channel
export const IN_FINAL = /* wgsl */ `
struct P { P: u32, stride: u32, off: u32, chunk: u32, batchStride: u32, nWG: u32, gridX: u32, pad: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> partial: array<f32>;
@group(0) @binding(3) var<storage, read_write> stats: array<f32>;     // [batch][64][2] mean, rstd

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) c: u32) {
  var s1 = 0.0;
  var s2 = 0.0;
  for (var i = 0u; i < p.nWG * 4u; i++) {
    let o = ((wid.z * p.nWG * 4u + i) * 64u + c) * 2u;
    s1 += partial[o];
    s2 += partial[o + 1u];
  }
  let n = f32(p.P);
  let shift = X[wid.z * p.batchStride + p.off + c];
  let m = s1 / n;
  let v = max(s2 / n - m * m, 0.0);
  stats[(wid.z * 64u + c) * 2u] = shift + m;
  stats[(wid.z * 64u + c) * 2u + 1u] = inverseSqrt(v + 1e-5);
}
`;

// InstanceNorm apply + affine + PReLU, in place. One thread per 4 channels.
export const IN_APPLY = /* wgsl */ `
struct P { P: u32, stride: u32, off: u32, chunk: u32, batchStride: u32, nWG: u32, gridX: u32, pad: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> X: array<f32>;
@group(0) @binding(2) var<storage, read> stats: array<f32>;
@group(0) @binding(3) var<storage, read> prm: array<f32>;      // [batch][3][64] gamma, beta, prelu

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let gid = (wid.y * p.gridX + wid.x) * 256u + lid;
  let pos = gid / 16u;
  if (pos >= p.P) { return; }
  let c0 = (gid % 16u) * 4u;
  let z = wid.z;
  let base = z * p.batchStride + pos * p.stride + p.off + c0;
  for (var j = 0u; j < 4u; j++) {
    let c = c0 + j;
    let s = (z * 64u + c) * 2u;
    var y = (X[base + j] - stats[s]) * stats[s + 1u] * prm[z * 192u + c] + prm[z * 192u + 64u + c];
    if (y < 0.0) { y *= prm[z * 192u + 128u + c]; }
    X[base + j] = y;
  }
}
`;

// Spectrogram [F][T] mag and phase -> [T+2][F+2][4] (mag, phase, 0, 0), zero padded at the end
export const PREP = /* wgsl */ `
struct P { F: u32, T: u32, gridX: u32, pad: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> mag: array<f32>;
@group(0) @binding(2) var<storage, read> pha: array<f32>;
@group(0) @binding(3) var<storage, read_write> X: array<vec4f>;

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let gid = (wid.y * p.gridX + wid.x) * 256u + lid;
  let Fp = p.F + 2u;
  if (gid >= (p.T + 2u) * Fp) { return; }
  let t = gid / Fp;
  let f = gid % Fp;
  var v = vec4f(0.0);
  if (t < p.T && f < p.F) { v = vec4f(mag[f * p.T + t], pha[f * p.T + t], 0.0, 0.0); }
  X[gid] = v;
}
`;

// Fused Mamba core for both directions: causal conv + SiLU, x_proj, dt_proj + softplus,
// selective scan, D skip and SiLU(z) gate. One workgroup per (direction, sequence), one thread per
// channel. Works in chunks of 16 steps: conv outputs and x_proj outputs live in workgroup memory,
// so u, dt, B and C never touch VRAM. Sequence element l of sequence b sits at position b*bS + l*lS;
// the backward direction walks it from the end.
// S per direction: A 4096, dt_proj w 1024, dt_proj b 256, D 256, conv w 1024; then conv bias [2][256].
export const MAMBA_CORE = /* wgsl */ `
struct P { L: u32, nB: u32, bS: u32, lS: u32, P: u32, pad0: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> XZ: array<f32>;      // [P][1024]: x_fw, z_fw, x_bw, z_bw
@group(0) @binding(2) var<storage, read> S: array<f32>;
@group(0) @binding(3) var<storage, read> WX: array<f32>;      // x_proj [2][256][36]
@group(0) @binding(4) var<storage, read_write> Y: array<f32>; // [P][512]: y_fw, y_bw

const DIR = 6656u;
const CH = 16u;
var<workgroup> su: array<f32, 4096>;   // [CH][256] conv + SiLU output
var<workgroup> sx: array<f32, 576>;    // [CH][36] x_proj output: dt(4), B(16), C(16)

fn posOf(b: u32, l: u32, dir: u32) -> u32 {
  var lo = l;
  if (dir == 1u) { lo = p.L - 1u - l; }
  return b * p.bS + lo * p.lS;
}

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) d: u32) {
  let dir = wid.x / p.nB;
  let b = wid.x % p.nB;
  let sb = dir * DIR;
  var a: array<f32, 16>;
  var h: array<f32, 16>;
  // A pre-scaled by log2(e) so the decay is one exp2
  for (var n = 0u; n < 16u; n++) { a[n] = S[sb + d * 16u + n] * 1.4426950408889634; h[n] = 0.0; }
  let wdt = vec4f(S[sb + 4096u + d * 4u], S[sb + 4096u + d * 4u + 1u], S[sb + 4096u + d * 4u + 2u], S[sb + 4096u + d * 4u + 3u]);
  let bdt = S[sb + 5120u + d];
  let dskip = S[sb + 5376u + d];
  let cw = vec4f(S[sb + 5632u + d * 4u], S[sb + 5632u + d * 4u + 1u], S[sb + 5632u + d * 4u + 2u], S[sb + 5632u + d * 4u + 3u]);
  let cb = S[2u * DIR + dir * 256u + d];
  let xcol = dir * 512u + d;
  let wx = dir * 9216u;
  // Sliding window of the last three conv inputs (in scan order)
  var x1 = 0.0;
  var x2 = 0.0;
  var x3 = 0.0;

  for (var l0 = 0u; l0 < p.L; l0 += CH) {
    let steps = min(CH, p.L - l0);
    workgroupBarrier();
    for (var s = 0u; s < steps; s++) {
      let x0 = XZ[posOf(b, l0 + s, dir) * 1024u + xcol];
      let c = cb + cw.x * x3 + cw.y * x2 + cw.z * x1 + cw.w * x0;
      su[s * 256u + d] = c / (1.0 + exp(-c));
      x3 = x2; x2 = x1; x1 = x0;
    }
    workgroupBarrier();
    // x_proj for the chunk: 36 outputs per step, steps*36 dot products of length 256
    for (var o = d; o < steps * 36u; o += 256u) {
      let s = o / 36u;
      let j = o % 36u;
      var acc = 0.0;
      for (var k = 0u; k < 256u; k++) { acc += su[s * 256u + k] * WX[wx + k * 36u + j]; }
      sx[o] = acc;
    }
    workgroupBarrier();
    for (var s = 0u; s < steps; s++) {
      let pos = posOf(b, l0 + s, dir);
      let o = s * 36u;
      let raw = dot(wdt, vec4f(sx[o], sx[o + 1u], sx[o + 2u], sx[o + 3u])) + bdt;
      var dt = raw;
      if (raw <= 20.0) { dt = log(1.0 + exp(raw)); }
      let u = su[s * 256u + d];
      let du = dt * u;
      var acc = 0.0;
      for (var n = 0u; n < 16u; n++) {
        h[n] = exp2(dt * a[n]) * h[n] + du * sx[o + 4u + n];
        acc += h[n] * sx[o + 20u + n];
      }
      let z = XZ[pos * 1024u + xcol + 256u];
      Y[pos * 512u + dir * 256u + d] = (acc + u * dskip) * (z / (1.0 + exp(-z)));
    }
  }
}
`;

// Strided copy of 64 channels per position (latent -> DenseBlock input slot), batched over z
export const COPY = /* wgsl */ `
struct P { P: u32, srcStride: u32, srcOff: u32, dstStride: u32, dstOff: u32, dstBatch: u32, gridX: u32, pad: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let gid = (wid.y * p.gridX + wid.x) * 256u + lid;
  if (gid >= p.P * 64u) { return; }
  let pos = gid / 64u;
  let c = gid % 64u;
  dst[wid.z * p.dstBatch + pos * p.dstStride + p.dstOff + c] = src[pos * p.srcStride + p.srcOff + c];
}
`;

// Output heads: 1x1 conv to magnitude, and to (real, imag) -> atan2 phase. Writes [F][T], cropped.
export const HEAD = /* wgsl */ `
struct P { F: u32, T: u32, Fo: u32, gridX: u32, batchStride: u32, pad0: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;       // [2][To][Fo][64]: mag branch, phase branch
@group(0) @binding(2) var<storage, read> Wh: array<f32>;      // mag w[64], b, real w[64], b, imag w[64], b
@group(0) @binding(3) var<storage, read_write> mag: array<f32>;
@group(0) @binding(4) var<storage, read_write> pha: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let gid = (wid.y * p.gridX + wid.x) * 256u + lid;
  if (gid >= p.F * p.T) { return; }
  let f = gid / p.T;
  let t = gid % p.T;
  let xm = (t * p.Fo + f) * 64u;
  let xp = p.batchStride + xm;
  var m = Wh[64u];
  var re = Wh[129u];
  var im = Wh[194u];
  for (var c = 0u; c < 64u; c++) {
    m += Wh[c] * X[xm + c];
    let v = X[xp + c];
    re += Wh[65u + c] * v;
    im += Wh[130u + c] * v;
  }
  mag[gid] = m;
  pha[gid] = atan2(im, re);
}
`;
