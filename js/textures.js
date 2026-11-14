// Procedural textures (no image files) + shared materials.
//
// World surfaces (walls, floors, ceilings) use a patched Lambert shader that adds:
//   • baked light — two per-vertex light colours (day + night) mixed by
//     uniforms, so every room gets soft light pools without real lights
//   • a large-scale, world-space "macro" layer that varies tone and adds
//     mold/water stains, so the textures don't visibly repeat

import * as THREE from '../lib/three.module.min.js';
import { mulberry32, smoothstep, clamp } from './rng.js';

// ── noise helpers ────────────────────────────────────────────
function noiseLayer(S, grid, rng) {
  const lat = new Float32Array(grid * grid);
  for (let i = 0; i < lat.length; i++) lat[i] = rng();
  const out = new Float32Array(S * S);
  const cell = S / grid;
  for (let y = 0; y < S; y++) {
    const gy = y / cell, y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
    const r0 = (y0 % grid) * grid, r1 = ((y0 + 1) % grid) * grid;
    for (let x = 0; x < S; x++) {
      const gx = x / cell, x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
      const c0 = x0 % grid, c1 = (x0 + 1) % grid;
      const a = lat[r0 + c0], b = lat[r0 + c1], c = lat[r1 + c0], d = lat[r1 + c1];
      const top = a + (b - a) * sx, bot = c + (d - c) * sx;
      out[y * S + x] = top + (bot - top) * sy;
    }
  }
  return out;
}

function fbm(S, seed, grids, falloff = 0.55) {
  const rng = mulberry32(seed);
  const out = new Float32Array(S * S);
  let amp = 1, total = 0;
  for (const g of grids) {
    const l = noiseLayer(S, g, rng);
    for (let i = 0; i < out.length; i++) out[i] += l[i] * amp;
    total += amp;
    amp *= falloff;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function white(S, seed) {
  const r = mulberry32(seed), o = new Float32Array(S * S);
  for (let i = 0; i < o.length; i++) o[i] = r();
  return o;
}

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function pixels(w, h, fn) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  fn(img.data, w, h);
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

const mix = (a, b, t) => a + (b - a) * t;
const put = (d, i, r, g, b) => { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; };
const grey = (d, i, v) => { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = clamp(v, 0, 255); d[i * 4 + 3] = 255; };

// ── carpets ──────────────────────────────────────────────────
// Loop-pile carpet: fine fibre noise + tiny tufts + gentle tonal waves.
function carpet(seed, base, S = 1024, opts = {}) {
  const n = fbm(S, seed, [4, 8, 16], 0.6);
  const tuft = fbm(S, seed + 1, [128, 256], 0.7);
  const fib = white(S, seed + 2);
  const wear = fbm(S, seed + 3, [2, 4, 8], 0.5);
  const color = pixels(S, S, (d) => {
    for (let i = 0; i < S * S; i++) {
      const loop = (tuft[i] - 0.5) * 0.28 + (fib[i] - 0.5) * 0.2;
      let v = 0.9 + (n[i] - 0.5) * (opts.tone ?? 0.16) + loop;
      v -= smoothstep(0.55, 0.8, wear[i]) * (opts.wear ?? 0.07);
      put(d, i, base[0] * v, base[1] * v, base[2] * v);
    }
  });
  const bump = pixels(S, S, (d) => {
    for (let i = 0; i < S * S; i++) grey(d, i, 128 + (tuft[i] - 0.5) * 210 + (fib[i] - 0.5) * 90);
  });
  return { map: tex(color), bump: tex(bump, false) };
}

// ── wallpapers ───────────────────────────────────────────────
// Office wallpaper: fine vertical chevron weave, paper grain, roll seams,
// baseboard at the bottom (canvas y = 0 is the top of the wall).
function officeWall() {
  const S = 1024;
  const n = fbm(S, 21, [4, 8, 16, 32]);
  const grain = white(S, 22);
  const fib = fbm(S, 23, [64, 128, 256], 0.7);
  const pat = new Float32Array(S * S);
  const base = [206, 192, 128];
  const color = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      // chevron stripes every ~5.5 cm
      const sx = x % 18, sy = (y + Math.abs(sx - 9) * 1.3) % 14;
      let p = (sy < 2 ? -0.045 : 0) + (sx === 0 ? -0.03 : 0);
      // wide soft bands
      p += Math.floor(x / 54) % 2 ? 0.018 : -0.01;
      // roll seams every 0.53 m (≈181 px)
      const seam = x % 181;
      if (seam < 2) p -= 0.08; else if (seam < 4) p += 0.03;
      pat[i] = p;
      let v = 0.93 + p + (n[i] - 0.5) * 0.08 + (grain[i] - 0.5) * 0.035 + (fib[i] - 0.5) * 0.06;
      const fy = y / S;
      if (fy > 0.82 && fy < 0.952) v *= 1 - ((fy - 0.82) / 0.132) * 0.14; // scuffs near the floor
      if (fy < 0.02) v *= 0.9;
      let r = base[0] * v, g = base[1] * v, b = base[2] * v;
      if (fy >= 0.952) { // baseboard
        const bb = 0.88 + (n[i] - 0.5) * 0.08 + (grain[i] - 0.5) * 0.03;
        r = 118 * bb; g = 96 * bb; b = 64 * bb;
        if (fy < 0.957) { r *= 1.3; g *= 1.3; b *= 1.25; }
      }
      put(d, i, r, g, b);
    }
  });
  const bump = pixels(S, S, (d) => {
    for (let i = 0; i < S * S; i++) grey(d, i, 128 + pat[i] * 700 + (fib[i] - 0.5) * 60);
  });
  return { map: tex(color), bump: tex(bump, false) };
}

function damask(seed, base, accent) {
  const S = 512;
  const n = fbm(S, seed, [4, 8, 16]);
  const grain = white(S, seed + 1);
  const pat = new Float32Array(S * S);
  const color = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      // ornament: repeated diamond medallions with curls
      const cx = ((x % 128) - 64) / 64, cy = ((y % 170) - 85) / 85;
      const ox = (((x + 64) % 128) - 64) / 64, oy = (((y + 85) % 170) - 85) / 85;
      const m1 = Math.abs(cx) + Math.abs(cy), m2 = Math.abs(ox) + Math.abs(oy);
      const ring = Math.abs(Math.sin(m1 * 7)) < 0.18 && m1 < 0.85 ? 1 : 0;
      const curl = Math.abs(Math.sin(Math.atan2(cy, cx) * 4 + m1 * 6)) < 0.12 && m1 < 0.6 ? 1 : 0;
      const dot = m2 < 0.18 ? 1 : 0;
      const p = Math.max(ring, curl, dot);
      pat[i] = p;
      const v = 0.9 + (n[i] - 0.5) * 0.14 + (grain[i] - 0.5) * 0.05;
      const c = p ? accent : base;
      put(d, i, c[0] * v, c[1] * v, c[2] * v);
    }
  });
  const bump = pixels(S, S, (d) => { for (let i = 0; i < S * S; i++) grey(d, i, 128 + pat[i] * 40 + (grain[i] - 0.5) * 20); });
  return { map: tex(color), bump: tex(bump, false) };
}

function stripedWall(seed, a, b, stripe = 32) {
  const S = 512;
  const n = fbm(S, seed, [4, 8, 16, 32]);
  const grain = white(S, seed + 1);
  const color = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const c = Math.floor(x / stripe) % 2 ? a : b;
      const v = 0.9 + (n[i] - 0.5) * 0.16 + (grain[i] - 0.5) * 0.05 - (x % stripe < 2 ? 0.05 : 0);
      put(d, i, c[0] * v, c[1] * v, c[2] * v);
    }
  });
  const bump = pixels(S, S, (d) => { for (let i = 0; i < S * S; i++) grey(d, i, 128 + (grain[i] - 0.5) * 30 + (n[i] - 0.5) * 30); });
  return { map: tex(color), bump: tex(bump, false) };
}

function paintedWall(seed, base) {
  const S = 512;
  const n = fbm(S, seed, [4, 8, 16, 32, 64]);
  const orange = fbm(S, seed + 1, [96, 192], 0.7); // orange-peel paint texture
  const color = pixels(S, S, (d) => {
    for (let i = 0; i < S * S; i++) {
      const v = 0.92 + (n[i] - 0.5) * 0.1 + (orange[i] - 0.5) * 0.06;
      put(d, i, base[0] * v, base[1] * v, base[2] * v);
    }
  });
  const bump = pixels(S, S, (d) => { for (let i = 0; i < S * S; i++) grey(d, i, 128 + (orange[i] - 0.5) * 120); });
  return { map: tex(color), bump: tex(bump, false) };
}

// ── hard surfaces ────────────────────────────────────────────
function concrete(seed, base, S = 512, wall = false) {
  const n = fbm(S, seed, [4, 8, 16, 32, 64]);
  const pits = white(S, seed + 1);
  const blot = fbm(S, seed + 2, [3, 6, 12], 0.5);
  const color = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let v = 0.86 + (n[i] - 0.5) * 0.32 - smoothstep(0.6, 0.8, blot[i]) * 0.12;
      if (pits[i] < 0.012) v -= 0.25;
      if (wall) {
        if (y % 256 < 2) v -= 0.12;               // formwork joints
        const hx = x % 256, hy = y % 256;          // tie holes
        if ((hx - 64) ** 2 + (hy - 128) ** 2 < 25 || (hx - 192) ** 2 + (hy - 128) ** 2 < 25) v -= 0.3;
      } else if (x % 256 < 2 || y % 256 < 2) v -= 0.1; // saw cuts
      put(d, i, base[0] * v, base[1] * v, base[2] * v);
    }
  });
  const bump = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let v = 128 + (n[i] - 0.5) * 120 + (pits[i] < 0.012 ? -80 : 0);
      if (wall ? y % 256 < 2 : (x % 256 < 2 || y % 256 < 2)) v -= 60;
      grey(d, i, v);
    }
  });
  return { map: tex(color), bump: tex(bump, false) };
}

function woodFloor(seed) {
  const S = 512;
  const n = fbm(S, seed, [4, 8, 16]);
  const grain = fbm(S, seed + 1, [8, 64, 128], 0.7);
  const rng = mulberry32(seed + 2);
  const plankTone = Array.from({ length: 64 }, () => 0.8 + rng() * 0.3);
  const plankOff = Array.from({ length: 64 }, () => Math.floor(rng() * 512));
  const pw = 51; // ~20 cm planks
  const color = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const p = Math.floor(x / pw), yy = (y + plankOff[p % 64]) % 512;
      const g = Math.sin(x * 0.35 + grain[i] * 18) * 0.5 + 0.5;
      let v = plankTone[p % 64] * (0.82 + g * 0.16 + (n[i] - 0.5) * 0.1);
      if (x % pw < 2 || yy < 2) v *= 0.55;
      put(d, i, 82 * v, 52 * v, 32 * v);
    }
  });
  const bump = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const p = Math.floor(x / pw), yy = (y + plankOff[p % 64]) % 512;
      grey(d, i, x % pw < 2 || yy < 2 ? 40 : 128 + (grain[i] - 0.5) * 60);
    }
  });
  return { map: tex(color), bump: tex(bump, false) };
}

// Square tiles with grout. tiles = tiles per texture side.
function tiles(seed, S, count, base, grout, opts = {}) {
  const n = fbm(S, seed, [4, 8, 16]);
  const grain = white(S, seed + 1);
  const rng = mulberry32(seed + 2);
  const cell = S / count;
  const tone = Array.from({ length: count * count }, () => 0.94 + rng() * 0.08);
  const accent = Array.from({ length: count * count }, () => rng() < (opts.accentChance || 0));
  const gw = opts.grout || Math.max(2, Math.round(cell * 0.07));
  const color = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const tx = Math.floor(x / cell), ty = Math.floor(y / cell), ti = ty * count + tx;
      const lx = x % cell, ly = y % cell;
      const isG = lx < gw || ly < gw;
      let c;
      if (isG) c = grout;
      else if (opts.checker) c = (tx + ty) % 2 ? opts.checker : base;
      else c = accent[ti] ? opts.accent : base;
      let v = isG ? 0.9 + (n[i] - 0.5) * 0.2 : tone[ti] + (n[i] - 0.5) * 0.06 + (grain[i] - 0.5) * 0.025;
      // soft highlight on each tile (slightly domed glaze)
      if (!isG) v += (1 - Math.hypot(lx / cell - 0.5, ly / cell - 0.5) * 1.6) * 0.03;
      put(d, i, c[0] * v, c[1] * v, c[2] * v);
    }
  });
  const bump = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const lx = x % cell, ly = y % cell;
      grey(d, i, lx < gw || ly < gw ? 30 : 150 + (grain[i] - 0.5) * 8);
    }
  });
  return { map: tex(color), bump: tex(bump, false) };
}

function ceiling() {
  const S = 512, T = 256;
  const n = fbm(S, 31, [8, 16, 32]);
  const n2 = fbm(S, 32, [8, 16, 32, 64], 0.6);
  const rng = mulberry32(33);
  const stains = [];
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
    if (rng() < 0.45) stains.push({ cx: tx * T + 40 + rng() * 176, cy: ty * T + 40 + rng() * 176, r: 30 + rng() * 70 });
  }
  const pit = new Float32Array(S * S);
  const color = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const tx = x % T, ty = y % T;
      let v = 0.9 + (n[i] - 0.5) * 0.08;
      const p = rng() < 0.09 ? -(0.06 + rng() * 0.1) : 0;
      pit[i] = p;
      v += p;
      let r = 214 * v, g = 209 * v, b = 190 * v;
      for (const s of stains) {
        const dd = Math.hypot(x - s.cx, y - s.cy) / s.r + (n2[i] - 0.5) * 0.55;
        if (dd < 1.05) {
          const k = (1 - Math.min(dd, 1)) * 0.3;
          r = mix(r, 192, k); g = mix(g, 170, k); b = mix(b, 120, k);
          const ring = Math.exp(-Math.pow((dd - 0.95) / 0.05, 2));
          r = mix(r, 150, ring * 0.55); g = mix(g, 118, ring * 0.55); b = mix(b, 72, ring * 0.55);
        }
      }
      if (tx < 5 || ty < 5) {
        const tb = 0.96 + (n[i] - 0.5) * 0.05;
        r = 186 * tb; g = 182 * tb; b = 172 * tb;
        if (tx === 4 || ty === 4) { r *= 0.82; g *= 0.82; b *= 0.82; }
      } else if (tx < 8 || ty < 8) { r *= 0.93; g *= 0.93; b *= 0.93; }
      put(d, i, r, g, b);
    }
  });
  const bump = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const tx = x % T, ty = y % T;
      grey(d, i, tx < 5 || ty < 5 ? 90 : 150 + pit[i] * 600);
    }
  });
  return { map: tex(color), bump: tex(bump, false) };
}

function panel() {
  const W = 256, H = 128;
  const c = pixels(W, H, (d) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = 255;
      if (x % 6 === 0 || y % 6 === 0) v = 238;
      let r = v, g = v * 0.985, b = v * 0.93;
      if (x < 7 || y < 7 || x > W - 8 || y > H - 8) { r = 160; g = 158; b = 150; }
      put(d, i, r, g, b);
    }
  });
  return tex(c);
}

function metal(seed, base, rust = 0) {
  const S = 256;
  const n = fbm(S, seed, [4, 8, 16, 32]);
  const rn = fbm(S, seed + 7, [4, 8, 16, 32, 64], 0.6);
  const rng = mulberry32(seed + 1);
  const cols = new Float32Array(S);
  for (let x = 0; x < S; x++) cols[x] = rng();
  const c = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const v = 0.92 + (n[i] - 0.5) * 0.18 + (cols[x] - 0.5) * 0.05 + (rng() - 0.5) * 0.03;
      let r = base[0] * v, g = base[1] * v, b = base[2] * v;
      const rr = smoothstep(0.72 - rust * 0.3, 0.84 - rust * 0.3, rn[i]) * (0.4 + rust * 0.6);
      r = mix(r, 120 * (0.8 + rn[i] * 0.4), rr); g = mix(g, 68, rr); b = mix(b, 36, rr);
      put(d, i, r, g, b);
    }
    for (let k = 0; k < 40; k++) {
      const x = rng() * S, y = rng() * S, a = rng() * Math.PI, len = 10 + rng() * 40;
      for (let t = 0; t < len; t++) {
        const px = Math.floor(x + Math.cos(a) * t) & (S - 1), py = Math.floor(y + Math.sin(a) * t) & (S - 1);
        const i = (py * S + px) * 4;
        d[i] = Math.min(255, d[i] * 1.18); d[i + 1] = Math.min(255, d[i + 1] * 1.18); d[i + 2] = Math.min(255, d[i + 2] * 1.18);
      }
    }
  });
  return tex(c);
}

function wood() {
  const S = 256;
  const n = fbm(S, 51, [4, 8, 16]);
  const rng = mulberry32(52);
  const c = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const g0 = Math.sin((x * 0.11 + n[i] * 9) * 1.0) * 0.5 + 0.5;
      const v = 0.75 + g0 * 0.2 + (rng() - 0.5) * 0.05;
      put(d, i, 112 * v, 74 * v, 42 * v);
    }
  });
  return tex(c);
}

function fabric(seed, base) {
  const S = 256;
  const n = fbm(S, seed, [4, 8, 16, 32]);
  const rng = mulberry32(seed + 3);
  const c = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const w = ((x % 4 < 2) !== (y % 4 < 2)) ? 0.06 : -0.03;
      const dirt = smoothstep(0.62, 0.8, n[i]) * 0.25;
      const v = 0.88 + w + (n[i] - 0.5) * 0.18 + (rng() - 0.5) * 0.05 - dirt;
      put(d, i, base[0] * v, base[1] * v, base[2] * v);
    }
  });
  return tex(c);
}

function mattress() {
  const S = 256;
  const n = fbm(S, 61, [4, 8, 16]);
  const c = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let r = 226, g = 222, b = 210;
      if (x % 32 < 5) { r = 96; g = 112; b = 156; } else if (x % 32 === 7) { r = 160; g = 168; b = 190; }
      const v = 0.92 + (n[i] - 0.5) * 0.15;
      const st = smoothstep(0.66, 0.78, n[i]) * 0.3;
      put(d, i, mix(r * v, 170, st), mix(g * v, 150, st), mix(b * v, 100, st));
    }
  });
  return tex(c);
}

function skin() {
  const S = 256;
  const n = fbm(S, 71, [4, 8, 16, 32]);
  const v2 = fbm(S, 72, [4, 8, 16], 0.6);
  const c = pixels(S, S, (d) => {
    for (let i = 0; i < S * S; i++) {
      const vein = Math.abs(Math.sin(v2[i] * 34)) < 0.08 ? 0.62 : 1;
      const v = (0.82 + (n[i] - 0.5) * 0.4) * vein;
      const bruise = smoothstep(0.62, 0.8, n[i]) * 0.25;
      put(d, i, (176 - bruise * 60) * v, (178 - bruise * 80) * v, (168 - bruise * 30) * v);
    }
  });
  return tex(c);
}

function stone(seed = 81, base = [112, 108, 102], S = 256) {
  const n = fbm(S, seed, [4, 8, 16, 32]);
  const sp = white(S, seed + 1);
  const c = pixels(S, S, (d) => {
    for (let i = 0; i < S * S; i++) {
      let v = 0.75 + (n[i] - 0.5) * 0.35;
      if (sp[i] < 0.03) v += 0.12; else if (sp[i] > 0.97) v -= 0.15;
      put(d, i, base[0] * v, base[1] * v, base[2] * v);
    }
  });
  return tex(c);
}

function canLabel() {
  const c = makeCanvas(128, 64), g = c.getContext('2d');
  g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, 128, 64);
  g.strokeStyle = '#59ff3a'; g.lineWidth = 7; g.beginPath();
  for (let x = 0; x <= 128; x += 16) g.lineTo(x, x % 32 === 0 ? 18 : 46);
  g.stroke();
  return tex(c);
}

function bottleLabel() {
  const c = makeCanvas(128, 64), g = c.getContext('2d');
  g.fillStyle = '#e9e4d2'; g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#7a5a2e'; g.font = 'bold 15px monospace'; g.fillText('ALMOND', 10, 28); g.fillText('WATER', 14, 48);
  return tex(c);
}

function cardboard() {
  const S = 128;
  const n = fbm(S, 91, [4, 8, 16]);
  const c = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const v = 0.85 + (n[i] - 0.5) * 0.2 + (y % 6 < 1 ? -0.04 : 0);
      put(d, i, 168 * v, 128 * v, 82 * v);
    }
  });
  return tex(c);
}

function signTex(text, bg, fg, w = 256, h = 256, shape = 'oct') {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, w, h);
  g.fillStyle = bg;
  if (shape === 'oct') {
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i / 8) * Math.PI * 2; g.lineTo(w / 2 + Math.cos(a) * w * 0.48, h / 2 + Math.sin(a) * h * 0.48); }
    g.fill();
    g.strokeStyle = fg; g.lineWidth = 8; g.stroke();
  } else { g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16); }
  g.fillStyle = fg; g.font = `bold ${Math.round(h * 0.26)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  return tex(c);
}

// Tileable RGB macro noise used by the surface shader (tone + stains).
function macro() {
  const S = 512;
  const a = fbm(S, 401, [2, 4, 8, 16], 0.55);
  const b = fbm(S, 402, [3, 6, 12, 24], 0.6);
  const c = fbm(S, 403, [4, 8, 16, 32, 64], 0.6);
  const cv = pixels(S, S, (d) => { for (let i = 0; i < S * S; i++) put(d, i, a[i] * 255, b[i] * 255, c[i] * 255); });
  const t = tex(cv, false);
  t.anisotropy = 1;
  return t;
}

function waterNormal() {
  const S = 256;
  const h = fbm(S, 501, [8, 16, 32], 0.6);
  const c = pixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const dx = h[y * S + ((x + 1) % S)] - h[y * S + ((x + S - 1) % S)];
      const dy = h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x];
      put(d, i, 128 + dx * 900, 128 + dy * 900, 255);
    }
  });
  return tex(c, false);
}

// ── surface shader patch ─────────────────────────────────────
export const SURF = {
  uBakeDay: { value: 1 },
  uBakeNight: { value: 0 },
  uBakeScale: { value: 1 },
  uMacro: { value: null },
};


function patchSurface(mat, o = {}) {
  const u = {
    uMacroAmt: { value: o.macro ?? 0.22 },
    uMacroScale: { value: o.macroScale ?? 1 / 11 },
    uStainAmt: { value: o.stain ?? 0 },
    uStainColor: { value: new THREE.Color(...(o.stainColor || [0.42, 0.45, 0.28])) },
    uWall: { value: o.wall ? 1 : 0 },
  };
  mat.userData.surf = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, SURF, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 bakeDay;\nattribute vec3 bakeNight;\nattribute float bakeAmb;\nvarying vec3 vBakeDay;\nvarying vec3 vBakeNight;\nvarying float vBakeAmb;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBakeDay = bakeDay; vBakeNight = bakeNight; vBakeAmb = bakeAmb;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uBakeDay; uniform float uBakeNight; uniform float uBakeScale;
uniform sampler2D uMacro; uniform float uMacroAmt; uniform float uMacroScale;
uniform float uStainAmt; uniform vec3 uStainColor; uniform float uWall;
varying vec3 vBakeDay; varying vec3 vBakeNight; varying float vBakeAmb; varying vec3 vWPos;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec2 muv = uWall > 0.5 ? vec2(vWPos.x + vWPos.z * 0.73, vWPos.y * 1.3) : vWPos.xz;
  muv *= uMacroScale;
  vec3 m1 = texture2D(uMacro, muv).rgb;
  vec3 m2 = texture2D(uMacro, muv * 0.29 + vec2(0.37, 0.71)).rgb;
  diffuseColor.rgb *= mix(1.0 - uMacroAmt, 1.0 + uMacroAmt * 0.45, m1.r * 0.65 + m2.b * 0.35);
  float sv = m2.g * 0.7 + m1.b * 0.42;
  float stain = smoothstep(0.6, 0.76, sv);
  float edge = smoothstep(0.57, 0.6, sv) - smoothstep(0.6, 0.64, sv);
  float streak = 0.0;
  if (uWall > 0.5) {
    float col = texture2D(uMacro, vec2(muv.x * 2.7, 0.13)).g;
    streak = smoothstep(0.6, 0.78, col) * smoothstep(0.4, 2.9, vWPos.y - floor(vWPos.y / 3.0) * 0.0);
  }
  float s = max(stain, streak * 0.8) * uStainAmt;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uStainColor, s);
  diffuseColor.rgb *= 1.0 - edge * uStainAmt * 0.22;
}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= vBakeAmb;
reflectedLight.indirectDiffuse += (vBakeDay * uBakeDay + vBakeNight * uBakeNight) * uBakeScale * diffuseColor.rgb;`);
  };
  mat.customProgramCacheKey = () => 'surf-v4';
  return mat;
}

// ── public API ───────────────────────────────────────────────
let cache = null;

const L = (o) => new THREE.MeshLambertMaterial(o);

// Room styles → which wall / floor material they use.
export const STYLES = {
  office:   { wall: 'wallOffice',  floor: 'carpetOffice', name: 'office' },
  concrete: { wall: 'wallConcrete', floor: 'floorConcrete' },
  xmas:     { wall: 'wallDamask',   floor: 'floorWood' },
  cubicle:  { wall: 'wallCubicle',  floor: 'carpetGray' },
  red:      { wall: 'wallRed',      floor: 'carpetRed' },
  tile:     { wall: 'wallGreenTile', floor: 'floorChecker' },
  pool:     { wall: 'wallPool',     floor: 'floorPool', ceiling: 'ceilingPool' },
};

export function buildMaterials(anisotropy = 8) {
  if (cache) return cache;
  const lazy = {};
  const m = { tex: {} };
  SURF.uMacro.value = macro();
  const def = (name, make) => {
    Object.defineProperty(m, name, {
      get() { if (!lazy[name]) lazy[name] = make(); return lazy[name]; },
      enumerable: true,
    });
  };
  const surf = (t, opts, extra = {}) => {
    const mat = L({ map: t.map, bumpMap: t.bump, bumpScale: opts.bump ?? 1.5, ...extra });
    if (anisotropy && t.map) t.map.anisotropy = anisotropy;
    return patchSurface(mat, opts);
  };

  // world surfaces (baked + macro)
  def('carpetOffice', () => surf(carpet(11, [172, 150, 84]), { bump: 2.4, macro: 0.24, stain: 0.85, stainColor: [0.42, 0.44, 0.24], macroScale: 1 / 13 }));
  def('wallOffice', () => surf(officeWall(), { bump: 1.2, macro: 0.12, stain: 0.45, stainColor: [0.72, 0.62, 0.42], wall: true, macroScale: 1 / 9 }));
  def('ceiling', () => surf(ceiling(), { bump: 1.0, macro: 0.08, stain: 0.0 }));
  def('wallConcrete', () => surf(concrete(111, [150, 148, 142], 512, true), { bump: 2.0, macro: 0.25, stain: 0.55, stainColor: [0.55, 0.52, 0.45], wall: true }));
  def('floorConcrete', () => surf(concrete(112, [132, 130, 126]), { bump: 2.0, macro: 0.25, stain: 0.6, stainColor: [0.5, 0.48, 0.42] }));
  def('wallDamask', () => surf(damask(121, [34, 58, 40], [58, 86, 56]), { bump: 1.0, macro: 0.15, stain: 0.3, stainColor: [0.6, 0.55, 0.45], wall: true }));
  def('floorWood', () => surf(woodFloor(122), { bump: 1.6, macro: 0.18, stain: 0.2, stainColor: [0.7, 0.6, 0.5] }));
  def('wallCubicle', () => surf(paintedWall(131, [156, 166, 172]), { bump: 1.0, macro: 0.12, stain: 0.3, stainColor: [0.7, 0.68, 0.6], wall: true }));
  def('carpetGray', () => surf(carpet(132, [96, 102, 110], 512, { tone: 0.12 }), { bump: 2.2, macro: 0.18, stain: 0.35, stainColor: [0.6, 0.58, 0.5] }));
  def('wallRed', () => surf(stripedWall(141, [128, 22, 20], [104, 16, 16], 40), { bump: 1.0, macro: 0.15, stain: 0.35, stainColor: [0.45, 0.3, 0.3], wall: true }));
  def('carpetRed', () => surf(carpet(142, [92, 18, 20], 512), { bump: 2.2, macro: 0.2, stain: 0.3, stainColor: [0.5, 0.4, 0.35] }));
  def('wallGreenTile', () => surf(tiles(151, 512, 8, [96, 132, 104], [70, 72, 64]), { bump: 1.6, macro: 0.18, stain: 0.5, stainColor: [0.55, 0.5, 0.36], wall: true }));
  def('floorChecker', () => surf(tiles(152, 512, 4, [210, 206, 194], [60, 60, 56], { checker: [38, 38, 40] }), { bump: 1.4, macro: 0.2, stain: 0.45, stainColor: [0.5, 0.48, 0.38] }));
  def('wallPool', () => surf(tiles(161, 512, 12, [232, 236, 232], [168, 176, 176]), { bump: 1.2, macro: 0.06, stain: 0.15, stainColor: [0.85, 0.88, 0.8], wall: true }, { }));
  def('floorPool', () => surf(tiles(162, 512, 24, [226, 234, 236], [170, 182, 186], { accent: [120, 178, 206], accentChance: 0.05 }), { bump: 1.2, macro: 0.06, stain: 0.12, stainColor: [0.8, 0.85, 0.8] }));
  def('floorPoolBasin', () => surf(tiles(163, 512, 24, [130, 190, 214], [96, 150, 172], { accent: [70, 130, 170], accentChance: 0.08 }), { bump: 1.2, macro: 0.08 }));
  def('ceilingPool', () => surf(tiles(164, 512, 12, [226, 230, 226], [176, 182, 180]), { bump: 1.0, macro: 0.05 }));
  def('trim', () => L({ map: m.tex.wood }));
  def('ductSurf', () => surf({ map: m.tex.duct, bump: null }, { bump: 0, macro: 0.12, stain: 0.35, stainColor: [0.45, 0.4, 0.34] }, { color: 0x9a9c9c }));

  m.tex.wood = wood();
  m.tex.panel = panel();
  m.tex.metal = metal(41, [146, 144, 132]);
  m.tex.rusty = metal(43, [128, 118, 104], 0.8);
  m.tex.door = metal(45, [92, 102, 84]);
  m.tex.duct = metal(47, [150, 154, 156], 0.1);
  m.tex.tentA = fabric(101, [78, 104, 70]);
  m.tex.tentB = fabric(102, [176, 98, 46]);
  m.tex.blanket = fabric(103, [86, 98, 128]);
  m.tex.couch = fabric(104, [110, 74, 58]);
  m.tex.partition = fabric(105, [96, 104, 118]);
  m.tex.mattress = mattress();
  m.tex.skin = skin();
  m.tex.stone = stone();
  m.tex.rock = stone(85, [118, 112, 104], 128);
  m.tex.can = canLabel();
  m.tex.bottle = bottleLabel();
  m.tex.cardboard = cardboard();
  m.tex.water = waterNormal();
  m.tex.stop = signTex('STOP', '#b81d18', '#f4f1ea');

  Object.assign(m, {
    panel: new THREE.MeshBasicMaterial({ map: m.tex.panel, fog: true }),
    metal: L({ map: m.tex.metal }),
    rusty: L({ map: m.tex.rusty }),
    metalDark: L({ color: 0x3e3d3a }),
    handle: new THREE.MeshPhongMaterial({ color: 0xb8b4a8, shininess: 80 }),
    door: L({ map: m.tex.door }),
    duct: L({ map: m.tex.duct, side: THREE.DoubleSide }),
    wood: L({ map: m.tex.wood }),
    tentA: L({ map: m.tex.tentA, side: THREE.DoubleSide }),
    tentB: L({ map: m.tex.tentB, side: THREE.DoubleSide }),
    blanket: L({ map: m.tex.blanket }),
    couch: L({ map: m.tex.couch }),
    partition: L({ map: m.tex.partition }),
    mattress: L({ map: m.tex.mattress }),
    pillow: L({ color: 0xd8d4c8 }),
    skin: L({ map: m.tex.skin }),
    mouth: new THREE.MeshBasicMaterial({ color: 0x050303 }),
    teeth: L({ color: 0xcfc6a8 }),
    stone: L({ map: m.tex.stone }),
    rock: L({ map: m.tex.rock, color: 0xc4bcb0, flatShading: true }),
    banana: L({ color: 0xe6c43e }),
    bananaDark: L({ color: 0x5a4320 }),
    brass: new THREE.MeshPhongMaterial({ color: 0xc8a24a, shininess: 90, specular: 0x665533 }),
    red: L({ color: 0xa82020 }),
    cardboard: L({ map: m.tex.cardboard }),
    lanternGlass: new THREE.MeshBasicMaterial({ color: 0xffc070 }),
    fire: new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    ledRed: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
    ledGreen: new THREE.MeshBasicMaterial({ color: 0x33ff55 }),
    black: new THREE.MeshBasicMaterial({ color: 0x000000 }),
    water: new THREE.MeshPhongMaterial({ color: 0x8fd0e4, transparent: true, opacity: 0.55, shininess: 140, specular: 0xffffff, normalMap: m.tex.water, normalScale: new THREE.Vector2(0.35, 0.35), depthWrite: false }),
    murk: new THREE.MeshPhongMaterial({ color: 0x3e3a22, transparent: true, opacity: 0.62, shininess: 70, specular: 0x555544, normalMap: m.tex.water, normalScale: new THREE.Vector2(0.3, 0.3), depthWrite: false }),
    paintCar: new THREE.MeshPhongMaterial({ color: 0x6b1e1e, shininess: 60, specular: 0x555555 }),
    glassDark: new THREE.MeshPhongMaterial({ color: 0x1a2228, shininess: 100, specular: 0x888888 }),
    rubber: L({ color: 0x1a1a1a }),
    chrome: new THREE.MeshPhongMaterial({ color: 0xc8c8cc, shininess: 120, specular: 0xffffff }),
    signStop: new THREE.MeshLambertMaterial({ map: m.tex.stop, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }),
    orange: L({ color: 0xe0601a }),
    white: L({ color: 0xe8e6e0 }),
    plastic: new THREE.MeshPhongMaterial({ color: 0xefeeea, shininess: 70, specular: 0x666666 }),
    pine: L({ color: 0x1f4a2a }),
    bulbRed: new THREE.MeshBasicMaterial({ color: 0xff2a20 }),
    bulbDim: new THREE.MeshBasicMaterial({ color: 0x3a0a08 }),
    screen: new THREE.MeshBasicMaterial({ color: 0x0b1210 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    smilerBody: new THREE.MeshBasicMaterial({ color: 0x050505 }),
    mannequin: new THREE.MeshPhongMaterial({ color: 0xe4ddd2, shininess: 30, specular: 0x333333 }),
    bruteSkin: L({ map: m.tex.skin, color: 0xa56a58 }),
    crawlerSkin: L({ map: m.tex.skin, color: 0x6a6a62 }),
    houndSkin: L({ map: m.tex.skin, color: 0xd8c8b8 }),
  });
  cache = m;
  return m;
}

// Lazy materials are generated the first time they're used. Warm them up
// ahead of time (one per call) so walking into a new room style never hitches.
export const LAZY_KEYS = ['carpetOffice', 'wallOffice', 'ceiling', 'wallConcrete', 'floorConcrete', 'wallDamask', 'floorWood', 'wallCubicle', 'carpetGray',
  'wallRed', 'carpetRed', 'wallGreenTile', 'floorChecker', 'wallPool', 'floorPool', 'floorPoolBasin', 'ceilingPool', 'trim', 'ductSurf'];
export function warmOne(m, renderer, i) {
  const k = LAZY_KEYS[i];
  if (!k) return false;
  const mat = m[k];
  if (renderer && renderer.initTexture) {
    if (mat.map) renderer.initTexture(mat.map);
    if (mat.bumpMap) renderer.initTexture(mat.bumpMap);
  }
  return true;
}

export function setAnisotropy(m, a) {
  for (const k of ['carpetOffice', 'wallOffice', 'ceiling']) {
    const t = m[k].map;
    if (t) { t.anisotropy = a; t.needsUpdate = true; }
  }
}
