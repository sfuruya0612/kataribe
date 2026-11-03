// Vendored from geronimi73/re-use-demo at commit 0d54dca074597b111a8e8c78f6067a6fa0231f75.
// MIT License. See resources/licenses/reuse-webgpu-engine-LICENSE.txt.

// STFT / iSTFT that match torch.stft / torch.istft (center, reflect pad, periodic Hann). No dependencies.

// ---------------------------------------------------------------- fft

// In-place radix-2 complex FFT, n a power of two. sign -1 forward, +1 inverse (unscaled).
function fft2(re, im, sign) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// Complex DFT of any length n via Bluestein's chirp-z trick on a power-of-two FFT
class Bluestein {
  constructor(n) {
    this.n = n;
    let m = 1;
    while (m < 2 * n - 1) m <<= 1;
    this.m = m;
    this.cr = new Float64Array(n);   // chirp exp(-i*pi*k^2/n)
    this.ci = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const a = (Math.PI * ((k * k) % (2 * n))) / n;
      this.cr[k] = Math.cos(a);
      this.ci[k] = -Math.sin(a);
    }
    // FFT of the conjugate chirp, wrapped around for negative indices
    this.br = new Float64Array(m);
    this.bi = new Float64Array(m);
    for (let k = 0; k < n; k++) {
      this.br[k] = this.cr[k]; this.bi[k] = -this.ci[k];
      if (k > 0) { this.br[m - k] = this.cr[k]; this.bi[m - k] = -this.ci[k]; }
    }
    fft2(this.br, this.bi, -1);
    this.ar = new Float64Array(m);
    this.ai = new Float64Array(m);
  }

  // Forward DFT of (xr, xi), written into (outR, outI)
  forward(xr, xi, outR, outI) {
    const { n, m, cr, ci, br, bi, ar, ai } = this;
    ar.fill(0); ai.fill(0);
    for (let k = 0; k < n; k++) {
      ar[k] = xr[k] * cr[k] - xi[k] * ci[k];
      ai[k] = xr[k] * ci[k] + xi[k] * cr[k];
    }
    fft2(ar, ai, -1);
    for (let k = 0; k < m; k++) {
      const r = ar[k] * br[k] - ai[k] * bi[k];
      ai[k] = ar[k] * bi[k] + ai[k] * br[k];
      ar[k] = r;
    }
    fft2(ar, ai, 1);
    for (let k = 0; k < n; k++) {
      const r = ar[k] / m, i = ai[k] / m;
      outR[k] = r * cr[k] - i * ci[k];
      outI[k] = r * ci[k] + i * cr[k];
    }
  }
}

// ---------------------------------------------------------------- stft

const makeEven = (v) => { v = Math.round(v); return v % 2 === 0 ? v : v + 1; };

// FFT size and hop grow with the sample rate, so every rate sees 5 ms hops
export function stftParams(sr) {
  return { nFft: makeEven(Math.floor((320 * sr) / 8000)), hop: makeEven(Math.floor((40 * sr) / 8000)) };
}

export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

// Centered, reflect-padded STFT -> { re, im } as [F, T] row-major, plus F and T
export function stft(x, nFft, hop) {
  const half = nFft / 2, N = x.length;
  const padded = new Float64Array(N + nFft);
  for (let i = 0; i < padded.length; i++) {
    let j = i - half;
    if (j < 0) j = -j;
    if (j >= N) j = 2 * (N - 1) - j;
    padded[i] = x[j];
  }
  const T = 1 + Math.floor(N / hop), F = half + 1;
  const win = hann(nFft), dft = new Bluestein(nFft);
  const fr = new Float64Array(nFft), fi = new Float64Array(nFft);
  const or = new Float64Array(nFft), oi = new Float64Array(nFft);
  const re = new Float32Array(F * T), im = new Float32Array(F * T);
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < nFft; i++) fr[i] = padded[t * hop + i] * win[i];
    fi.fill(0);
    dft.forward(fr, fi, or, oi);
    // DC and Nyquist are real for real input
    oi[0] = 0; oi[half] = 0;
    // Snap values near zero to +0
    for (let f = 0; f < F; f++) {
      re[f * T + t] = Math.abs(or[f]) < 1e-10 ? 0 : or[f];
      im[f * T + t] = Math.abs(oi[f]) < 1e-10 ? 0 : oi[f];
    }
  }
  return { re, im, F, T };
}

// Inverse of stft(): onesided spectrum [F, T] -> waveform of length hop * (T - 1)
export function istft(re, im, F, T, nFft, hop) {
  const win = hann(nFft), dft = new Bluestein(nFft);
  const size = nFft + hop * (T - 1);
  const out = new Float64Array(size), norm = new Float64Array(size);
  const xr = new Float64Array(nFft), xi = new Float64Array(nFft);
  const yr = new Float64Array(nFft), yi = new Float64Array(nFft);
  for (let t = 0; t < T; t++) {
    // Rebuild the full Hermitian spectrum; irfft ignores the imaginary part of DC and Nyquist
    for (let f = 0; f < F; f++) { xr[f] = re[f * T + t]; xi[f] = im[f * T + t]; }
    xi[0] = 0; xi[F - 1] = 0;
    for (let f = F; f < nFft; f++) { xr[f] = xr[nFft - f]; xi[f] = -xi[nFft - f]; }
    // Inverse DFT as conj(DFT(conj(x))); only the real part is needed
    for (let f = 0; f < nFft; f++) xi[f] = -xi[f];
    dft.forward(xr, xi, yr, yi);
    for (let i = 0; i < nFft; i++) {
      out[t * hop + i] += (yr[i] / nFft) * win[i];
      norm[t * hop + i] += win[i] * win[i];
    }
  }
  const half = nFft / 2, n = size - 2 * half;
  const wav = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = norm[i + half];
    wav[i] = out[i + half] / (w > 1e-11 ? w : 1);
  }
  return wav;
}
