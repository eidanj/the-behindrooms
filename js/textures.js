// Procedural textures (no image files needed) + shared materials.
// Every texture is drawn into a <canvas> with tileable value-noise.

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

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function fromPixels(w, h, fn) {
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
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

const mix = (a, b, t) => a + (b - a) * t;

// ── individual textures ──────────────────────────────────────
function carpet() {
  const S = 512;
  const n = fbm(S, 11, [4, 8, 16, 32, 64]);
  const st = fbm(S, 12, [2, 4, 8, 16], 0.5);
  const sp = fbm(S, 13, [16, 32, 64, 128], 0.7);
  const rng = mulberry32(14);
  const fib = new Float32Array(S * S);
  for (let i = 0; i < fib.length; i++) fib[i] = rng();
  const color = fromPixels(S, S, (d) => {
    for (let i = 0; i < S * S; i++) {
      const f = fib[i];
      let v = 0.86 + (n[i] - 0.5) * 0.4 + (f - 0.5) * 0.16;
      let r = 176 * v, g = 152 * v, b = 82 * v;
      const s = smoothstep(0.55, 0.7, st[i]);
      r = mix(r, 86, s * 0.6); g = mix(g, 84, s * 0.52); b = mix(b, 46, s * 0.45);
      const ring = Math.exp(-Math.pow((st[i] - 0.555) / 0.012, 2));
      r *= 1 - ring * 0.2; g *= 1 - ring * 0.2; b *= 1 - ring * 0.22;
      const spec = smoothstep(0.7, 0.76, sp[i]);
      r = mix(r, 64, spec * 0.55); g = mix(g, 66, spec * 0.5); b = mix(b, 40, spec * 0.5);
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    }
  });
  const bump = fromPixels(S, S, (d) => {
    for (let i = 0; i < S * S; i++) {
      const v = 128 + (fib[i] - 0.5) * 150 + (n[i] - 0.5) * 50;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
  });
  return { map: tex(color), bump: tex(bump, false) };
}

function wallpaper() {
  const S = 512;
  const n = fbm(S, 21, [4, 8, 16, 32]);
  const st = fbm(S, 22, [2, 4, 8], 0.5);
  const cn = fbm(S, 23, [8, 16, 32, 64], 0.6); // row 0 used as 1-D column noise
  const cl = fbm(S, 24, [4, 8, 16], 0.5);
  const rng = mulberry32(25);
  const base = [204, 190, 126];
  const pat = new Float32Array(S * S);
  const color = fromPixels(S, S, (d) => {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const band = Math.floor(x / 32) % 2;
        let p = band * 0.035;
        const xm = x % 32;
        if (xm < 2) p -= 0.06;
        if (band === 0) {
          const cx = Math.floor(x / 64) * 64 + 16, cy = Math.floor(y / 40) * 40 + 20;
          const dd = Math.abs(x - cx) + Math.abs(y - cy);
          if (dd < 7) p -= 0.06 * (1 - dd / 7);
        } else {
          if ((y % 20) < 1 && (x % 32) > 12 && (x % 32) < 20) p -= 0.03;
        }
        pat[i] = p;
        let v = 0.93 + p + (n[i] - 0.5) * 0.14 + (rng() - 0.5) * 0.045;
        let r = base[0] * v, g = base[1] * v, b = base[2] * v;
        // damp streaks running down from the ceiling
        const col = cn[x];
        const len = (0.15 + cl[x] * 0.75) * S;
        const strength = smoothstep(0.52, 0.68, col);
        if (y < len && strength > 0) {
          const k = (1 - y / len) * strength * 0.55;
          r = mix(r, 148, k); g = mix(g, 126, k); b = mix(b, 74, k);
          const edge = Math.exp(-Math.pow((y - len) / 5, 2)) * strength;
          r *= 1 - edge * 0.12; g *= 1 - edge * 0.12; b *= 1 - edge * 0.14;
        }
        // blotchy damp patches
        const s = smoothstep(0.6, 0.72, st[i]);
        r = mix(r, 160, s * 0.35); g = mix(g, 140, s * 0.35); b = mix(b, 86, s * 0.4);
        // grime toward the floor
        const fy = y / S;
        if (fy > 0.8 && fy < 0.955) {
          const k = (fy - 0.8) / 0.155;
          r *= 1 - k * 0.16; g *= 1 - k * 0.17; b *= 1 - k * 0.15;
        }
        if (fy < 0.025) { r *= 0.88; g *= 0.88; b *= 0.88; }
        // baseboard
        if (fy >= 0.955) {
          const bb = 0.9 + (n[i] - 0.5) * 0.1;
          r = 122 * bb; g = 98 * bb; b = 64 * bb;
          if (fy < 0.96) { r *= 1.25; g *= 1.25; b *= 1.2; }
        }
        d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
      }
    }
  });
  const bump = fromPixels(S, S, (d) => {
    for (let i = 0; i < S * S; i++) {
      const v = 128 + pat[i] * 900 + (n[i] - 0.5) * 30;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = clamp(v, 0, 255); d[i * 4 + 3] = 255;
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
  const color = fromPixels(S, S, (d) => {
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
      } else if (tx < 8 || ty < 8) {
        r *= 0.93; g *= 0.93; b *= 0.93;
      }
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    }
  });
  const bump = fromPixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const tx = x % T, ty = y % T;
      let v = 150 + pit[i] * 600;
      if (tx < 5 || ty < 5) v = 90;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
  });
  return { map: tex(color), bump: tex(bump, false) };
}

function panel() {
  const W = 256, H = 128;
  const c = fromPixels(W, H, (d) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let v = 255;
      if (x % 6 === 0 || y % 6 === 0) v = 238;
      let r = v, g = v * 0.985, b = v * 0.93;
      if (x < 7 || y < 7 || x > W - 8 || y > H - 8) { r = 160; g = 158; b = 150; }
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  });
  return tex(c);
}

function metal(seed = 41, base = [150, 148, 136]) {
  const S = 256;
  const n = fbm(S, seed, [4, 8, 16, 32]);
  const rng = mulberry32(seed + 1);
  const cols = new Float32Array(S);
  for (let x = 0; x < S; x++) cols[x] = rng();
  const c = fromPixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let v = 0.92 + (n[i] - 0.5) * 0.18 + (cols[x] - 0.5) * 0.05 + (rng() - 0.5) * 0.03;
      let r = base[0] * v, g = base[1] * v, b = base[2] * v;
      const rust = smoothstep(0.7, 0.8, n[i]);
      r = mix(r, 120, rust * 0.5); g = mix(g, 80, rust * 0.5); b = mix(b, 50, rust * 0.5);
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    }
    // scratches
    for (let k = 0; k < 40; k++) {
      let x = rng() * S, y = rng() * S; const a = rng() * Math.PI, len = 10 + rng() * 40;
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
  const c = fromPixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const g0 = Math.sin((x * 0.11 + n[i] * 9) * 1.0) * 0.5 + 0.5;
      const v = 0.75 + g0 * 0.2 + (rng() - 0.5) * 0.05;
      d[i * 4] = 112 * v; d[i * 4 + 1] = 74 * v; d[i * 4 + 2] = 42 * v; d[i * 4 + 3] = 255;
    }
  });
  return tex(c);
}

function fabric(seed, base) {
  const S = 256;
  const n = fbm(S, seed, [4, 8, 16, 32]);
  const rng = mulberry32(seed + 3);
  const c = fromPixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const w = ((x % 4 < 2) !== (y % 4 < 2)) ? 0.06 : -0.03;
      const dirt = smoothstep(0.62, 0.8, n[i]) * 0.25;
      const v = 0.88 + w + (n[i] - 0.5) * 0.18 + (rng() - 0.5) * 0.05 - dirt;
      d[i * 4] = base[0] * v; d[i * 4 + 1] = base[1] * v; d[i * 4 + 2] = base[2] * v; d[i * 4 + 3] = 255;
    }
  });
  return tex(c);
}

function mattress() {
  const S = 256;
  const n = fbm(S, 61, [4, 8, 16]);
  const c = fromPixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let r = 226, g = 222, b = 210;
      if (x % 32 < 5) { r = 96; g = 112; b = 156; }
      else if (x % 32 === 7) { r = 160; g = 168; b = 190; }
      const v = 0.92 + (n[i] - 0.5) * 0.15;
      const st = smoothstep(0.66, 0.78, n[i]) * 0.3;
      d[i * 4] = mix(r * v, 170, st); d[i * 4 + 1] = mix(g * v, 150, st); d[i * 4 + 2] = mix(b * v, 100, st); d[i * 4 + 3] = 255;
    }
  });
  return tex(c);
}

function skin() {
  const S = 256;
  const n = fbm(S, 71, [4, 8, 16, 32]);
  const v2 = fbm(S, 72, [4, 8, 16], 0.6);
  const c = fromPixels(S, S, (d) => {
    for (let i = 0; i < S * S; i++) {
      const vein = Math.abs(Math.sin(v2[i] * 34)) < 0.08 ? 0.62 : 1;
      const v = (0.82 + (n[i] - 0.5) * 0.4) * vein;
      const bruise = smoothstep(0.62, 0.8, n[i]) * 0.25;
      d[i * 4] = (176 - bruise * 60) * v; d[i * 4 + 1] = (178 - bruise * 80) * v; d[i * 4 + 2] = (168 - bruise * 30) * v; d[i * 4 + 3] = 255;
    }
  });
  return tex(c);
}

function stone() {
  const S = 256;
  const n = fbm(S, 81, [4, 8, 16, 32, 64]);
  const c = fromPixels(S, S, (d) => {
    for (let i = 0; i < S * S; i++) {
      const v = 0.6 + n[i] * 0.55;
      d[i * 4] = 112 * v; d[i * 4 + 1] = 108 * v; d[i * 4 + 2] = 102 * v; d[i * 4 + 3] = 255;
    }
  });
  return tex(c);
}

function canLabel() {
  const W = 128, H = 64;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#59ff3a'; g.lineWidth = 7;
  g.beginPath();
  for (let x = 0; x <= W; x += 16) g.lineTo(x, x % 32 === 0 ? 18 : 46);
  g.stroke();
  return tex(c);
}

function bottleLabel() {
  const W = 128, H = 64;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#e9e4d2'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#7a5a2e'; g.font = 'bold 15px monospace'; g.fillText('ALMOND', 10, 28); g.fillText('WATER', 14, 48);
  return tex(c);
}

function cardboard() {
  const S = 128;
  const n = fbm(S, 91, [4, 8, 16]);
  const c = fromPixels(S, S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const v = 0.85 + (n[i] - 0.5) * 0.2 + (y % 6 < 1 ? -0.04 : 0);
      d[i * 4] = 168 * v; d[i * 4 + 1] = 128 * v; d[i * 4 + 2] = 82 * v; d[i * 4 + 3] = 255;
    }
  });
  return tex(c);
}

// ── public API ───────────────────────────────────────────────
let cache = null;

export function buildMaterials(anisotropy = 4) {
  if (cache) return cache;
  const t = {
    carpet: carpet(),
    wall: wallpaper(),
    ceil: ceiling(),
    panel: panel(),
    metal: metal(41, [146, 144, 132]),
    door: metal(45, [92, 102, 84]),
    wood: wood(),
    tentA: fabric(101, [78, 104, 70]),
    tentB: fabric(102, [176, 98, 46]),
    blanket: fabric(103, [86, 98, 128]),
    mattress: mattress(),
    skin: skin(),
    stone: stone(),
    can: canLabel(),
    bottle: bottleLabel(),
    cardboard: cardboard(),
  };
  const L = (o) => new THREE.MeshLambertMaterial(o);
  const m = {
    tex: t,
    floor: L({ map: t.carpet.map, bumpMap: t.carpet.bump, bumpScale: 2.2 }),
    wall: L({ map: t.wall.map, bumpMap: t.wall.bump, bumpScale: 1.4 }),
    ceiling: L({ map: t.ceil.map, bumpMap: t.ceil.bump, bumpScale: 1.0 }),
    trim: L({ map: t.wood }),
    panel: new THREE.MeshBasicMaterial({ map: t.panel, fog: true }),
    metal: L({ map: t.metal }),
    metalDark: L({ color: 0x3e3d3a }),
    handle: new THREE.MeshPhongMaterial({ color: 0xb8b4a8, shininess: 80 }),
    door: L({ map: t.door }),
    wood: L({ map: t.wood }),
    tentA: L({ map: t.tentA, side: THREE.DoubleSide }),
    tentB: L({ map: t.tentB, side: THREE.DoubleSide }),
    blanket: L({ map: t.blanket }),
    mattress: L({ map: t.mattress }),
    pillow: L({ color: 0xd8d4c8 }),
    skin: L({ map: t.skin }),
    mouth: new THREE.MeshBasicMaterial({ color: 0x050303 }),
    teeth: L({ color: 0xcfc6a8 }),
    stone: L({ map: t.stone }),
    rock: L({ map: t.stone, color: 0xb0aaa0 }),
    banana: L({ color: 0xe6c43e }),
    bananaDark: L({ color: 0x5a4320 }),
    brass: new THREE.MeshPhongMaterial({ color: 0xc8a24a, shininess: 90, specular: 0x665533 }),
    red: L({ color: 0xa82020 }),
    cardboard: L({ map: t.cardboard }),
    lanternGlass: new THREE.MeshBasicMaterial({ color: 0xffc070 }),
    fire: new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    ledRed: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
    ledGreen: new THREE.MeshBasicMaterial({ color: 0x33ff55 }),
    black: new THREE.MeshBasicMaterial({ color: 0x000000 }),
  };
  setAnisotropy(m, anisotropy);
  cache = m;
  return m;
}

export function setAnisotropy(m, a) {
  for (const k of ['floor', 'wall', 'ceiling']) {
    if (m[k].map) { m[k].map.anisotropy = a; m[k].map.needsUpdate = true; }
  }
}

export function allLitMaterials(m) {
  return Object.values(m).filter((v) => v && v.isMaterial);
}
