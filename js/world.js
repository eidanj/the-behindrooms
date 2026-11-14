// ─────────────────────────────────────────────────────────────
//  World: infinite chunked Backrooms maze.
//
//  • Each chunk (8×8 cells, 24 m) is generated deterministically from
//    (seed, chunkX, chunkZ) with a BSP room split. Layouts are cached, so
//    neighbouring chunks can look at each other (walls between two rooms
//    get each room's own wallpaper on its own side).
//  • Rooms come in types: normal, sunken (ramp down), pit (holes in the
//    floor), Christmas (pitch dark + a tree), cubicles, flooded, pillar
//    halls, and — in their own biome — the Poolrooms.
//  • Every cell has a floor height, so the map goes up and down. Vents run
//    above the ceiling and can be crawled through.
//  • Walls/floors/ceilings get baked per-vertex light (day + night) so
//    rooms have soft light pools and dark corners without extra lights.
//  • Only a small pool of real PointLights exists; they are re-assigned
//    every frame to the most important lights near the player.
// ─────────────────────────────────────────────────────────────

import * as THREE from '../lib/three.module.min.js';
import { CELL, CHUNK_CELLS as N, CHUNK_SIZE as CS, WALL_H, WALL_T as T, DOOR_GAP, DOOR_H, NIGHT_LIGHTS, DRAWER_LOOT, VENT } from './config.js';
import { hash32, mulberry32, shuffle, range, weighted, hashFloat, smoothstep } from './rng.js';
import { GeoBuilder } from './geo.js';
import { STYLES } from './textures.js';
import * as Models from './models.js';

const ck = (cx, cz) => cx + ',' + cz;
const nk = (x, z) => (x + 0x8000) * 0x10000 + (z + 0x8000);
export const cellKey = (x, z) => x + ',' + z;
const HG = DOOR_GAP / 2;
const tmpColor = new THREE.Color();
const tmpMat = new THREE.Matrix4();
const tmpV = new THREE.Vector3();

// floor heights
export const SUNK = -1.5, PIT = -3.5, BASIN = -1.1, FLOOD_W = 0.12, POOL_W = -0.15;
// cell kinds
const K_FLAT = 0, K_RAMP = 1, K_HOLE = 2, K_BASIN = 3;
// edge codes
const E_NONE = 0, E_WALL = 1, E_DOOR = 2, E_SDOOR = 3;
const ECODE = { wall: E_WALL, door: E_DOOR, sdoor: E_SDOOR };

const BAKE_R = 9, BAKE_R2 = BAKE_R * BAKE_R;

// texture scale per surface material (1 / metres per repeat)
const UVS = {
  carpetOffice: 0.4, floorConcrete: 0.5, floorWood: 0.5, carpetGray: 0.5, carpetRed: 0.45,
  floorChecker: 1 / 1.2, floorPool: 1 / 1.8, floorPoolBasin: 1 / 1.8,
  wallOffice: 1 / 3, wallConcrete: 1 / 3, wallDamask: 1 / 2, wallCubicle: 1 / 3, wallRed: 1 / 2.4,
  wallGreenTile: 1 / 1.5, wallPool: 1 / 1.8, ceiling: 1 / 1.2, ceilingPool: 1 / 3, ductSurf: 1,
};

function flicker(t, seed, amt) {
  const rate = 6 + amt * 22;
  const k = Math.floor(t * rate + seed * 31.7);
  const h = hashFloat(k, seed);
  if (h < amt * 0.5) return h < amt * 0.22 ? 0 : 0.3;
  const k2 = Math.floor(t * 1.3 + seed * 7.1);
  if (hashFloat(k2, seed + 3) < amt * 0.18) return 0.05;
  return 1 - 0.15 * amt * hashFloat(k + 1, seed);
}

// height of a ramp at (fx, fz) inside its cell (0..3). dir: side that is HIGH (0 −z, 1 +z, 2 −x, 3 +x)
function rampH(dir, fx, fz) {
  const t = dir === 0 ? fz / CELL : dir === 1 ? 1 - fz / CELL : dir === 2 ? fx / CELL : 1 - fx / CELL;
  return SUNK * Math.min(1, Math.max(0, t));
}
const RAMP_N = [[0, 1, 0.5], [0, 1, -0.5], [0.5, 1, 0], [-0.5, 1, 0]].map((v) => { const l = Math.hypot(...v); return v.map((x) => x / l); });

// ── geometry builder with bake attributes ────────────────────
class SurfBuilder {
  constructor(matKey) {
    this.key = matKey;
    this.p = []; this.n = []; this.uv = []; this.amb = []; this.i = []; this.c = 0;
  }
  grid(nu, nv, P, Nrm, UV, amb = 1, skip = null) {
    const base = this.c;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const q = P(i / nu, j / nv);
      this.p.push(q[0], q[1], q[2]);
      this.n.push(Nrm[0], Nrm[1], Nrm[2]);
      const t = UV(q[0], q[1], q[2]);
      this.uv.push(t[0], t[1]);
      this.amb.push(typeof amb === 'function' ? amb(q) : amb);
      this.c++;
    }
    const a = P(0, 0), b = P(1, 0), d = P(0, 1);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const flip = cx * Nrm[0] + cy * Nrm[1] + cz * Nrm[2] < 0;
    const W = nu + 1;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      if (skip && skip(i, j)) continue;
      const k = base + j * W + i;
      if (!flip) this.i.push(k, k + 1, k + W + 1, k, k + W + 1, k + W);
      else this.i.push(k, k + W + 1, k + 1, k, k + W, k + W + 1);
    }
  }
  get empty() { return this.i.length === 0; }
  build(day, night) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('bakeDay', new THREE.Float32BufferAttribute(day, 3));
    g.setAttribute('bakeNight', new THREE.Float32BufferAttribute(night, 3));
    g.setAttribute('bakeAmb', new THREE.Float32BufferAttribute(this.amb, 1));
    g.setIndex(this.c > 65000 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export class World {
  constructor(game, opts) {
    this.game = game;
    this.scene = game.scene;
    this.M = game.mats;
    this.seed = opts.seed >>> 0;
    this.diff = opts.difficulty;
    this.tutorial = !!opts.tutorial;
    this.menu = !!opts.menu;
    this.loadRadius = opts.loadRadius ?? 2;
    this.lightRange = opts.lightRange ?? 40;

    this.chunks = new Map();
    this.chunkN = new Map();
    this.layCache = new Map();
    this.borderCache = new Map();
    this.boxHash = new Map();
    this.blockEdges = new Set();
    this.cellInfo = new Map();
    this.globalInter = new Set();
    this.beds = new Set();
    this.animated = new Set();
    this.ladders = new Set();
    this.waterMeshes = new Set();
    this.trees = new Set();
    this.vents = new Map();
    this.state = { looted: new Set(), taken: new Set(), unlocked: new Set(), squashed: new Set(), vents: new Map(), grates: new Set() };
    this.queue = [];
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.frustum = new THREE.Frustum();
    this._pm = new THREE.Matrix4();
    this._near = [];
    this._cand = [];
    this.pool = [];
    this.envLight = 1;
    this.flickerNear = 0;
    this.onChunkLoaded = null;
    this.onChunkUnloaded = null;
    this.isNight = () => false;
    this.portal = null;
    this.campfire = null;
    this.spawn = new THREE.Vector3(12, 0, 15.5);
    this.campCenter = new THREE.Vector3(12, 0, 12);
    this._pcx = null;
  }

  setPool(lights) { this.pool = lights; }

  // ── chunk streaming ─────────────────────────────────────────
  update(dt, playerPos, camera, time) {
    const pcx = Math.floor(playerPos.x / CS), pcz = Math.floor(playerPos.z / CS);
    if (pcx !== this._pcx || pcz !== this._pcz || this._dirty) {
      this._pcx = pcx; this._pcz = pcz; this._dirty = false;
      const R = this.loadRadius;
      const want = [];
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        if (!this.chunks.has(ck(pcx + dx, pcz + dz))) want.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
      }
      want.sort((a, b) => a[2] - b[2]);
      this.queue = want;
      for (const c of [...this.chunks.values()]) {
        if (Math.abs(c.cx - pcx) > R + 1 || Math.abs(c.cz - pcz) > R + 1) this.unloadChunk(c);
      }
    }
    let budget = 1;
    if (this.queue.length && this.queue[0][2] <= 2) budget = 2;
    while (budget-- > 0 && this.queue.length) {
      const [cx, cz] = this.queue.shift();
      if (!this.chunks.has(ck(cx, cz))) this.loadChunk(cx, cz);
    }
    if (camera) {
      camera.updateMatrixWorld();
      this._pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this._pm);
      const px = playerPos.x, pz = playerPos.z;
      for (const c of this.chunks.values()) {
        c.group.visible = this.frustum.intersectsBox(c.bbox);
        const b = c.bbox, dx = Math.max(b.min.x - px, 0, px - b.max.x), dz = Math.max(b.min.z - pz, 0, pz - b.max.z);
        c.props.visible = dx * dx + dz * dz < 28 * 28;
      }
    }
    for (const a of this.animated) if (a.update(dt)) this.animated.delete(a);
    if (this.campfire) {
      const f = this.campfire.flames;
      f.children.forEach((m, i) => {
        m.scale.y = (1 - i * 0.22) * (0.85 + 0.25 * Math.sin(time * (9 + i * 3) + i));
        m.rotation.y += dt * (1 + i);
      });
    }
    if (this.portal) this.portal.uniforms.uTime.value = time;
    // water ripples
    const wt = this.M.tex.water;
    if (wt) { wt.offset.x = time * 0.013; wt.offset.y = time * 0.021; }
    // Christmas lights twinkle
    for (const tr of this.trees) {
      tr.bulbs.forEach((b, i) => { b.material = hashFloat(Math.floor(time * 1.3 + i * 0.37), i) < 0.85 ? this.M.bulbRed : this.M.bulbDim; });
    }
  }

  loadAllAround(pos) {
    this._dirty = true;
    this._pcx = null;
    this.update(0, pos, null, 0);
    while (this.queue.length) {
      const [cx, cz] = this.queue.shift();
      if (!this.chunks.has(ck(cx, cz))) this.loadChunk(cx, cz);
    }
  }

  // ── biomes ──────────────────────────────────────────────────
  _vnoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const h = (a, b) => hash32(this.seed, a, b, 555) / 4294967296;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = h(ix, iz), b = h(ix + 1, iz), c = h(ix, iz + 1), d = h(ix + 1, iz + 1);
    return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
  }

  biome(cx, cz) {
    if (this.menu || this.tutorial) return 'office';
    if (Math.max(Math.abs(cx), Math.abs(cz)) <= 3) return 'office';
    return this._vnoise(cx / 5.5 + 100, cz / 5.5 - 40) > 0.69 ? 'pool' : 'office';
  }

  // ── layout generation ───────────────────────────────────────
  borderLine(cx, cz, axis) {
    const key = axis + cx + ',' + cz;
    let m = this.borderCache.get(key);
    if (m) return m;
    const r = mulberry32(hash32(this.seed, cx, cz, axis === 'h' ? 11 : 13));
    const campLine = (cx === 0 && cz === 0) || (axis === 'h' && cx === 0 && cz === 1) || (axis === 'v' && cx === 1 && cz === 0);
    let count = 2 + Math.floor(r() * 3);
    if (campLine) count = Math.max(count, 3);
    const poolish = this.biome(cx, cz) === 'pool' || this.biome(axis === 'h' ? cx : cx - 1, axis === 'h' ? cz - 1 : cz) === 'pool';
    if (poolish) count += 2;
    m = new Map();
    for (const i of shuffle(range(N), r).slice(0, count)) m.set(i, campLine || poolish ? 'open' : r() < 0.5 ? 'door' : 'open');
    if (this.borderCache.size > 5000) this.borderCache.clear();
    this.borderCache.set(key, m);
    return m;
  }

  _bsp(rng, x, z, w, h, depth, leaves, edges, pool) {
    const area = w * h;
    const stop = pool
      ? (w <= 2 && h <= 2) || depth >= 4 || (area <= 20 && rng() < 0.45) || (area <= 30 && rng() < 0.2)
      : (w <= 2 && h <= 2) || depth >= 6 || (area <= 9 && rng() < 0.55) || (area <= 16 && rng() < 0.2);
    if (stop) { leaves.push({ x, z, w, h }); return; }
    let vertical;
    if (w >= 3 && h >= 3) vertical = w > h ? true : h > w ? false : rng() < 0.5;
    else if (w >= 3) vertical = true;
    else if (h >= 3) vertical = false;
    else { leaves.push({ x, z, w, h }); return; }
    const len = vertical ? w : h;
    let s;
    if (len >= 4) s = 2 + Math.floor(rng() * (len - 3));
    else s = rng() < 0.5 ? 1 : 2;
    if (len >= 4 && rng() < 0.12) s = rng() < 0.5 ? 1 : len - 1;
    const span = vertical ? h : w;
    const openPlan = depth >= 2 && rng() < (pool ? 0.3 : 0.1);
    const opens = new Map();
    if (!openPlan) {
      const count = Math.min(span, 1 + (rng() < 0.5 ? 1 : 0) + (span >= 5 && rng() < 0.35 ? 1 : 0) + (pool ? 1 : 0));
      for (const i of shuffle(range(span), rng).slice(0, count)) opens.set(i, pool || rng() >= 0.55 ? 'open' : 'door');
    }
    for (let i = 0; i < span; i++) {
      const type = openPlan ? 'open' : opens.get(i) || 'wall';
      if (type === 'open') continue;
      edges.set(vertical ? `v:${x + s}:${z + i}` : `h:${x + i}:${z + s}`, type);
    }
    if (vertical) {
      this._bsp(rng, x, z, s, h, depth + 1, leaves, edges, pool);
      this._bsp(rng, x + s, z, w - s, h, depth + 1, leaves, edges, pool);
    } else {
      this._bsp(rng, x, z, w, s, depth + 1, leaves, edges, pool);
      this._bsp(rng, x, z + s, w, h - s, depth + 1, leaves, edges, pool);
    }
  }

  _connected(leaves, edges) {
    const blocked = new Uint8Array(N * N);
    for (const l of leaves) if (l.safe) for (let x = l.x; x < l.x + l.w; x++) for (let z = l.z; z < l.z + l.h; z++) blocked[z * N + x] = 1;
    let start = -1, total = 0;
    for (let i = 0; i < N * N; i++) if (!blocked[i]) { total++; if (start < 0) start = i; }
    const seen = new Uint8Array(N * N);
    const q = [start];
    seen[start] = 1;
    let count = 0;
    const isWall = (k) => { const t = edges.get(k); return t === 'wall' || t === 'sdoor'; };
    const visit = (j) => { if (!seen[j] && !blocked[j]) { seen[j] = 1; q.push(j); } };
    while (q.length) {
      const i = q.pop();
      count++;
      const x = i % N, z = (i / N) | 0;
      if (x + 1 < N && !isWall(`v:${x + 1}:${z}`)) visit(i + 1);
      if (x > 0 && !isWall(`v:${x}:${z}`)) visit(i - 1);
      if (z + 1 < N && !isWall(`h:${x}:${z + 1}`)) visit(i + N);
      if (z > 0 && !isWall(`h:${x}:${z}`)) visit(i - N);
    }
    return count === total;
  }

  _edgeType(L, axis, lx, lz) {
    if (axis === 'h' && lz === N) {
      const m = this.borderLine(L.cx, L.cz + 1, 'h');
      return m.has(lx) ? (m.get(lx) === 'open' ? 'none' : 'door') : 'wall';
    }
    if (axis === 'v' && lx === N) {
      const m = this.borderLine(L.cx + 1, L.cz, 'v');
      return m.has(lz) ? (m.get(lz) === 'open' ? 'none' : 'door') : 'wall';
    }
    return L.edges.get(`${axis}:${lx}:${lz}`) || 'none';
  }

  _layout(cx, cz) {
    const key = nk(cx, cz);
    const cached = this.layCache.get(key);
    if (cached) return cached;
    const L = this._genLayout(cx, cz);
    if (this.layCache.size > 160) {
      // drop the oldest entries that aren't loaded chunks
      for (const k of this.layCache.keys()) { if (!this.chunkN.has(k)) this.layCache.delete(k); if (this.layCache.size < 120) break; }
    }
    this.layCache.set(key, L);
    return L;
  }

  _genLayout(cx, cz) {
    const rng = mulberry32(hash32(this.seed, cx, cz, 7));
    const edges = new Map();
    const leaves = [];
    const camp = cx === 0 && cz === 0;
    const biome = camp ? 'office' : this.biome(cx, cz);
    const pool = biome === 'pool';
    const campNeighbour = cx === 0 && cz === 1;   // the camp's vent comes out here
    const special = !camp && !campNeighbour && !this.tutorial;
    if (camp) leaves.push({ x: 0, z: 0, w: N, h: N, camp: true });
    else this._bsp(rng, 0, 0, N, N, 0, leaves, edges, pool);

    const south = this.borderLine(cx, cz, 'h'), west = this.borderLine(cx, cz, 'v');
    for (let i = 0; i < N; i++) {
      const s = south.get(i); if (s !== 'open') edges.set(`h:${i}:0`, s || 'wall');
      const w = west.get(i); if (w !== 'open') edges.set(`v:0:${i}`, w || 'wall');
    }

    // Saferoom: a small room sealed except for one locked door.
    if (!camp && !this.menu && !pool && !campNeighbour && rng() < this.diff.saferoomChance) {
      const cands = leaves.filter((l) => l.w >= 2 && l.h >= 2 && l.w <= 3 && l.h <= 3 && l.x >= 1 && l.z >= 1 && l.x + l.w <= N - 1 && l.z + l.h <= N - 1);
      if (cands.length) {
        const S = cands[Math.floor(rng() * cands.length)];
        const backup = new Map(edges);
        const bnd = [];
        for (let i = 0; i < S.w; i++) {
          bnd.push({ k: `h:${S.x + i}:${S.z}`, axis: 'h', lx: S.x + i, lz: S.z, side: 1 });
          bnd.push({ k: `h:${S.x + i}:${S.z + S.h}`, axis: 'h', lx: S.x + i, lz: S.z + S.h, side: -1 });
        }
        for (let j = 0; j < S.h; j++) {
          bnd.push({ k: `v:${S.x}:${S.z + j}`, axis: 'v', lx: S.x, lz: S.z + j, side: 1 });
          bnd.push({ k: `v:${S.x + S.w}:${S.z + j}`, axis: 'v', lx: S.x + S.w, lz: S.z + j, side: -1 });
        }
        for (const b of bnd) edges.set(b.k, 'wall');
        const door = bnd[Math.floor(rng() * bnd.length)];
        edges.set(door.k, 'sdoor');
        S.safe = true; S.door = door;
        if (!this._connected(leaves, edges)) {
          edges.clear();
          for (const [k, v] of backup) edges.set(k, v);
          S.safe = false; S.door = null;
        }
      }
    }

    // Free-standing partial walls inside bigger rooms.
    const halfs = [];
    for (const l of leaves) {
      if (l.camp || l.safe || l.w < 3 || l.h < 3 || pool || rng() > 0.35) continue;
      const k = rng() < 0.5
        ? `v:${l.x + 1 + Math.floor(rng() * (l.w - 1))}:${l.z + Math.floor(rng() * l.h)}`
        : `h:${l.x + Math.floor(rng() * l.w)}:${l.z + 1 + Math.floor(rng() * (l.h - 1))}`;
      if (!edges.has(k)) { edges.set(k, 'wall'); halfs.push(k); }
    }
    if (halfs.length && !this._connected(leaves, edges)) for (const k of halfs) edges.delete(k);

    const grid = new Int16Array(N * N);
    leaves.forEach((l, idx) => {
      l.idx = idx;
      for (let x = l.x; x < l.x + l.w; x++) for (let z = l.z; z < l.z + l.h; z++) grid[z * N + x] = idx;
    });

    const L = {
      cx, cz, camp, biome, edges, leaves, grid,
      h: new Float32Array(N * N), kind: new Uint8Array(N * N), rdir: new Int8Array(N * N).fill(-1),
      water: new Float32Array(N * N).fill(NaN),
      eh: new Uint8Array(N * N), ev: new Uint8Array(N * N),
      pillars: [], lights: [], ladders: [], extraLights: [], vent: null, xmas: null,
    };
    for (const [k, v] of edges) {
      const [a, x, z] = k.split(':');
      const code = ECODE[v] || 0;
      if (a === 'h') L.eh[+z * N + +x] = code; else L.ev[+z * N + +x] = code;
    }

    // ── room types + styles ──
    const safeDoorCells = new Set();
    for (const l of leaves) if (l.safe && l.door) {
      const d = l.door;
      // the cell on the far side of the saferoom door
      if (d.axis === 'h') safeDoorCells.add(d.lx + ',' + (d.lz + (d.side > 0 ? -1 : 0)));
      else safeDoorCells.add((d.lx + (d.side > 0 ? -1 : 0)) + ',' + d.lz);
    }
    let xmasUsed = false;
    for (const l of leaves) {
      l.type = 'normal';
      l.style = pool ? 'pool' : 'office';
      if (l.camp) continue;
      if (l.safe) continue;
      const area = l.w * l.h;
      const touchesSafe = [...safeDoorCells].some((s) => { const [x, z] = s.split(',').map(Number); return x >= l.x && x < l.x + l.w && z >= l.z && z < l.z + l.h; });
      if (pool) {
        if (l.w >= 3 && l.h >= 3 && rng() < 0.85) l.type = 'pool';
        continue;
      }
      if (!special) { this._randomStyle(l, rng); continue; }
      const r = rng();
      if (area >= 4 && !xmasUsed && r < 0.016) { l.type = 'xmas'; l.style = 'xmas'; xmasUsed = true; }
      else if (area >= 9 && l.w >= 3 && l.h >= 3 && r < 0.11) { l.type = 'pit'; l.style = 'concrete'; }
      else if (area >= 2 && area <= 16 && !touchesSafe && r < 0.21) { l.type = 'sunken'; l.style = rng() < 0.5 ? 'tile' : 'concrete'; }
      else if (area >= 6 && r < 0.28) { l.type = 'cubicle'; l.style = 'cubicle'; }
      else if (area >= 2 && r < 0.325) { l.type = 'flooded'; l.style = rng() < 0.5 ? 'tile' : 'office'; }
      else if (area >= 9 && r < 0.385) { l.type = 'pillars'; l.style = rng() < 0.5 ? 'red' : 'office'; }
      else this._randomStyle(l, rng);
    }

    // ── per-cell heights ──
    for (const l of leaves) {
      const cells = [];
      for (let x = l.x; x < l.x + l.w; x++) for (let z = l.z; z < l.z + l.h; z++) cells.push([x, z]);
      if (l.type === 'sunken') {
        // entry: a doorway/opening on the room's edge; the inside cell becomes a ramp
        const entries = [];
        for (let x = l.x; x < l.x + l.w; x++) {
          if (this._edgeType(L, 'h', x, l.z) !== 'wall' && this._edgeType(L, 'h', x, l.z) !== 'sdoor' && l.h >= 2) entries.push({ x, z: l.z, dir: 0 });
          if (this._edgeType(L, 'h', x, l.z + l.h) !== 'wall' && this._edgeType(L, 'h', x, l.z + l.h) !== 'sdoor' && l.h >= 2) entries.push({ x, z: l.z + l.h - 1, dir: 1 });
        }
        for (let z = l.z; z < l.z + l.h; z++) {
          if (this._edgeType(L, 'v', l.x, z) !== 'wall' && this._edgeType(L, 'v', l.x, z) !== 'sdoor' && l.w >= 2) entries.push({ x: l.x, z, dir: 2 });
          if (this._edgeType(L, 'v', l.x + l.w, z) !== 'wall' && this._edgeType(L, 'v', l.x + l.w, z) !== 'sdoor' && l.w >= 2) entries.push({ x: l.x + l.w - 1, z, dir: 3 });
        }
        if (!entries.length) { l.type = 'normal'; this._randomStyle(l, rng); }
        else {
          const e = entries[Math.floor(rng() * entries.length)];
          for (const [x, z] of cells) L.h[z * N + x] = SUNK;
          const i = e.z * N + e.x;
          L.kind[i] = K_RAMP; L.rdir[i] = e.dir;
          l.ramp = e;
        }
      } else if (l.type === 'pit') {
        const holes = [];
        for (let x = l.x + 1; x < l.x + l.w - 1; x++) for (let z = l.z + 1; z < l.z + l.h - 1; z++) if (rng() < 0.62) holes.push([x, z]);
        if (!holes.length) holes.push([l.x + 1 + Math.floor(rng() * (l.w - 2)), l.z + 1 + Math.floor(rng() * (l.h - 2))]);
        for (const [x, z] of holes) { L.h[z * N + x] = PIT; L.kind[z * N + x] = K_HOLE; }
        this._addPoolLadders(L, holes, rng, 'pit', PIT);
        l.holes = holes;
      } else if (l.type === 'pool') {
        const x0 = l.x + 1, x1 = l.x + l.w - 1, z0 = l.z + 1, z1 = l.z + l.h - 1;
        let bx0 = x0, bx1 = x1, bz0 = z0, bz1 = z1;
        if (rng() < 0.4 && x1 - x0 > 1) { if (rng() < 0.5) bx0++; else bx1--; }
        if (rng() < 0.4 && z1 - z0 > 1) { if (rng() < 0.5) bz0++; else bz1--; }
        const basin = [];
        for (let x = bx0; x < bx1; x++) for (let z = bz0; z < bz1; z++) { basin.push([x, z]); L.h[z * N + x] = BASIN; L.kind[z * N + x] = K_BASIN; L.water[z * N + x] = POOL_W; }
        l.basin = { x0: bx0, x1: bx1, z0: bz0, z1: bz1 };
        this._addPoolLadders(L, basin, rng, 'pool', BASIN);
      } else if (l.type === 'flooded') {
        for (const [x, z] of cells) L.water[z * N + x] = FLOOD_W;
      } else if (l.type === 'xmas') {
        const inner = cells.filter(([x, z]) => x > l.x && x < l.x + l.w - 1 && z > l.z && z < l.z + l.h - 1);
        const c = (inner.length ? inner : cells)[Math.floor(rng() * (inner.length || cells.length))];
        L.xmas = { lx: c[0], lz: c[1], x: c[0] * CELL + 1.5 + (rng() - 0.5) * 0.6, z: c[1] * CELL + 1.5 + (rng() - 0.5) * 0.6 };
        L.extraLights.push({ x: L.xmas.x, y: 1.6, z: L.xmas.z, day: 0.9, night: 0.9, col: [1, 0.12, 0.07], kind: 'tree' });
      }
    }

    // pillars
    for (const l of leaves) {
      if (l.safe || l.camp || l.w < 3 || l.h < 3) continue;
      if (l.type === 'pit' || l.type === 'xmas' || l.type === 'sunken') continue;
      const chance = l.type === 'pillars' ? 0.85 : l.type === 'pool' ? 0.25 : pool ? 0.35 : 0.22;
      for (let vx = l.x + 1; vx < l.x + l.w; vx++) for (let vz = l.z + 1; vz < l.z + l.h; vz++) {
        if (l.basin && vx >= l.basin.x0 && vx <= l.basin.x1 && vz >= l.basin.z0 && vz <= l.basin.z1) continue;
        if (rng() < chance) L.pillars.push([vx, vz, l.idx]);
      }
    }

    // ── vents (crawlable ducts above the ceiling) ──
    if (camp) {
      L.vent = this._campVent();
    } else if (!this.menu && !this.tutorial && !campNeighbour && rng() < (this.diff.ventChance ?? 0.28)) {
      L.vent = this._genVent(L, rng);
    }
    const holes = new Set();
    if (L.vent) for (const g of L.vent.grates) if (g.gx >= cx * N && g.gx < cx * N + N && g.gz >= cz * N && g.gz < cz * N + N) holes.add((g.gz - cz * N) * N + (g.gx - cx * N));
    if (campNeighbour) for (const g of this._campVent().grates) if (g.gz >= N) holes.add((g.gz - N) * N + g.gx);
    L.grateCells = holes;

    // ── lights ──
    for (const l of leaves) {
      const cells = [];
      for (let x = l.x; x < l.x + l.w; x++) for (let z = l.z; z < l.z + l.h; z++) cells.push([x, z]);
      const dark = !l.camp && rng() < NIGHT_LIGHTS.darkRoomChance;
      const k = dark ? 0 : Math.min(cells.length, 1 + (rng() < NIGHT_LIGHTS.extraLightChance ? 1 : 0) + (rng() < 0.06 ? 1 : 0));
      const nightSet = new Set(shuffle(cells.slice(), rng).slice(0, k).map((c) => c[0] + ',' + c[1]));
      for (const c of cells) {
        const r = rng();
        if (holes.has(c[1] * N + c[0])) continue;
        let day = l.camp || this.menu ? 'ok' : r < 0.04 ? 'dead' : r < 0.1 ? 'flicker' : 'ok';
        let nightOn = nightSet.has(c[0] + ',' + c[1]);
        if (l.type === 'xmas') { day = 'dead'; nightOn = false; }
        L.lights.push({ lx: c[0], lz: c[1], room: l.idx, day, nightOn, pool: l.style === 'pool' });
      }
    }
    if (camp) {
      for (const [x, z] of [[8, 8.6], [16, 8.6], [7.6, 16.6], [16.6, 16.2], [12, 21.2], [21.5, 9.5]]) L.extraLights.push({ x, y: 0.75, z, day: 1.2, night: 1.2, col: [1, 0.66, 0.38], kind: 'lantern' });
      L.extraLights.push({ x: 12, y: 0.7, z: 12.4, day: 1.6, night: 1.6, col: [1, 0.55, 0.25], kind: 'fire' });
    }
    return L;
  }

  _randomStyle(l, rng) {
    const r = rng();
    l.style = r < 0.06 ? 'red' : r < 0.12 ? 'tile' : r < 0.17 ? 'concrete' : r < 0.21 ? 'cubicle' : 'office';
  }

  // ladders out of pits / pools: one per connected group of sunken cells
  _addPoolLadders(L, cells, rng, kind, depth) {
    const set = new Set(cells.map(([x, z]) => x + ',' + z));
    const seen = new Set();
    for (const [sx, sz] of cells) {
      if (seen.has(sx + ',' + sz)) continue;
      const comp = [];
      const st = [[sx, sz]];
      seen.add(sx + ',' + sz);
      while (st.length) {
        const [x, z] = st.pop();
        comp.push([x, z]);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = (x + dx) + ',' + (z + dz);
          if (set.has(k) && !seen.has(k)) { seen.add(k); st.push([x + dx, z + dz]); }
        }
      }
      const opts = [];
      for (const [x, z] of comp) for (const [dx, dz, side] of [[1, 0, 3], [-1, 0, 2], [0, 1, 1], [0, -1, 0]]) {
        if (!set.has((x + dx) + ',' + (z + dz))) opts.push({ lx: x, lz: z, side });
      }
      const n = kind === 'pool' && comp.length > 3 ? 2 : 1;
      for (const o of shuffle(opts, rng).slice(0, n)) L.ladders.push({ ...o, kind, depth, t: 0.3 + rng() * 0.4 });
    }
  }

  // ── vents ───────────────────────────────────────────────────
  _ventFromCells(id, cells, grates) {
    const tiles = new Set();
    for (let i = 0; i < cells.length; i++) {
      const [gx, gz] = cells[i];
      tiles.add(nk(gx * 3 + 1, gz * 3 + 1));
      if (i + 1 < cells.length) {
        const [hx, hz] = cells[i + 1];
        for (let s = 1; s < 3; s++) tiles.add(nk(gx * 3 + 1 + (hx - gx) * s, gz * 3 + 1 + (hz - gz) * s));
      }
    }
    return { id, cells, tiles, grates };
  }

  _campVent() {
    const cells = [[1, 7], [1, 8], [1, 9], [1, 10], [2, 10], [3, 10], [4, 10]];
    return this._ventFromCells('vent:camp', cells, [
      { gx: 1, gz: 7, ladder: true }, { gx: 1, gz: 10, ladder: false }, { gx: 4, gz: 10, ladder: false },
    ]);
  }

  _genVent(L, rng) {
    const ok = (x, z) => {
      const i = z * N + x;
      const leaf = L.leaves[L.grid[i]];
      return !leaf.safe && L.kind[i] === K_FLAT && L.h[i] === 0 && leaf.type !== 'xmas';
    };
    const starts = [];
    for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) if (ok(x, z)) starts.push([x, z]);
    if (!starts.length) return null;
    const s = starts[Math.floor(rng() * starts.length)];
    const path = [s];
    const seen = new Set([s[0] + ',' + s[1]]);
    const want = 6 + Math.floor(rng() * 6);
    let dir = Math.floor(rng() * 4);
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (path.length < want) {
      const [x, z] = path[path.length - 1];
      if (rng() < 0.35) dir = Math.floor(rng() * 4);
      let moved = false;
      for (let t = 0; t < 4; t++) {
        const d = D[(dir + t) % 4];
        const nx = x + d[0], nz = z + d[1];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N || seen.has(nx + ',' + nz)) continue;
        // don't run alongside our own duct (keeps it a clean line)
        let touches = 0;
        for (const e of D) if (seen.has((nx + e[0]) + ',' + (nz + e[1]))) touches++;
        if (touches > 1) continue;
        path.push([nx, nz]); seen.add(nx + ',' + nz); dir = (dir + t) % 4; moved = true; break;
      }
      if (!moved) break;
    }
    if (path.length < 4) return null;
    const ox = L.cx * N, oz = L.cz * N;
    const grates = [{ gx: ox + s[0], gz: oz + s[1], ladder: true }];
    let end = path.length - 1;
    while (end > 2 && !ok(...path[end])) end--;
    if (end <= 2) return null;
    grates.push({ gx: ox + path[end][0], gz: oz + path[end][1], ladder: false });
    const mids = path.slice(2, end - 1).filter((c) => ok(...c));
    if (mids.length && rng() < 0.6) { const m = mids[Math.floor(rng() * mids.length)]; grates.push({ gx: ox + m[0], gz: oz + m[1], ladder: false }); }
    return this._ventFromCells(`vent:${L.cx},${L.cz}`, path.slice(0, end + 1).map(([x, z]) => [ox + x, oz + z]), grates);
  }

  // ── global cell / edge lookups (use cached layouts) ─────────
  _cellAt(gx, gz) {
    const cx = Math.floor(gx / N), cz = Math.floor(gz / N);
    const L = this._layout(cx, cz);
    const i = (gz - cz * N) * N + (gx - cx * N);
    return { L, i, leaf: L.leaves[L.grid[i]] };
  }

  _hAt(c, fx, fz) { return c.L.kind[c.i] === K_RAMP ? rampH(c.L.rdir[c.i], fx, fz) : c.L.h[c.i]; }

  _edgeG(axis, gx, gz) {
    const cx = Math.floor(gx / N), cz = Math.floor(gz / N);
    const L = this._layout(cx, cz);
    const i = (gz - cz * N) * N + (gx - cx * N);
    return axis === 'h' ? L.eh[i] : L.ev[i];
  }

  // 2D light visibility from (ax,az) to (bx,bz): walls block, door gaps let light through.
  _vis(ax, az, bx, bz) {
    let gx = Math.floor(ax / CELL), gz = Math.floor(az / CELL);
    const tx = Math.floor(bx / CELL), tz = Math.floor(bz / CELL);
    if (gx === tx && gz === tz) return 1;
    const dx = bx - ax, dz = bz - az;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx), adz = Math.abs(dz);
    const tdx = adx > 1e-9 ? CELL / adx : Infinity, tdz = adz > 1e-9 ? CELL / adz : Infinity;
    let tmx = adx > 1e-9 ? (sx > 0 ? (gx + 1) * CELL - ax : ax - gx * CELL) / adx : Infinity;
    let tmz = adz > 1e-9 ? (sz > 0 ? (gz + 1) * CELL - az : az - gz * CELL) / adz : Infinity;
    let v = 1;
    for (let guard = 0; guard < 12 && (gx !== tx || gz !== tz); guard++) {
      if (tmx < tmz) {
        const ex = sx > 0 ? gx + 1 : gx;
        const e = this._edgeG('v', ex, gz);
        if (e === E_WALL || e === E_SDOOR) return 0;
        if (e === E_DOOR) { const along = az + dz * tmx - gz * CELL; if (Math.abs(along - 1.5) > HG) return 0; v *= 0.85; }
        gx += sx; tmx += tdx;
      } else {
        const ez = sz > 0 ? gz + 1 : gz;
        const e = this._edgeG('h', gx, ez);
        if (e === E_WALL || e === E_SDOOR) return 0;
        if (e === E_DOOR) { const along = ax + dx * tmz - gx * CELL; if (Math.abs(along - 1.5) > HG) return 0; v *= 0.85; }
        gz += sz; tmz += tdz;
      }
    }
    return v;
  }

  // ── runtime terrain queries ─────────────────────────────────
  _rt(x, z) {
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    const cx = Math.floor(gx / N), cz = Math.floor(gz / N);
    const c = this.chunkN.get(nk(cx, cz));
    if (!c) return null;
    this._rti = (gz - cz * N) * N + (gx - cx * N);
    this._rtx = x - gx * CELL; this._rtz = z - gz * CELL;
    return c.layout;
  }

  floorAt(x, z) {
    const L = this._rt(x, z);
    if (!L) return 0;
    const i = this._rti;
    return L.kind[i] === K_RAMP ? rampH(L.rdir[i], this._rtx, this._rtz) : L.h[i];
  }

  waterAt(x, z) {
    const L = this._rt(x, z);
    return L ? L.water[this._rti] : NaN;
  }

  holeAt(x, z) {
    const L = this._rt(x, z);
    return !!L && L.kind[this._rti] === K_HOLE;
  }

  kindAt(x, z) {
    const L = this._rt(x, z);
    return L ? L.kind[this._rti] : 0;
  }

  // what's underfoot (for footstep sounds)
  surfaceAt(x, z) {
    const L = this._rt(x, z);
    if (!L) return 'carpet';
    const i = this._rti;
    if (!Number.isNaN(L.water[i])) return 'water';
    if (L.kind[i] === K_HOLE) return 'concrete';
    const st = L.leaves[L.grid[i]].style;
    return st === 'office' || st === 'cubicle' || st === 'red' ? 'carpet' : st === 'xmas' ? 'wood' : st === 'concrete' ? 'concrete' : 'tile';
  }

  styleAt(x, z) {
    const L = this._rt(x, z);
    return L ? L.leaves[L.grid[this._rti]].style : 'office';
  }

  // highest floor under a circle (centre + 4 points)
  floorMax(x, z, r) {
    let m = this.floorAt(x, z);
    const a = this.floorAt(x + r, z), b = this.floorAt(x - r, z), c = this.floorAt(x, z + r), d = this.floorAt(x, z - r);
    if (a > m) m = a; if (b > m) m = b; if (c > m) m = c; if (d > m) m = d;
    return m;
  }

  // ── building a chunk ────────────────────────────────────────
  loadChunk(cx, cz) {
    const L = this._layout(cx, cz);
    const ox = cx * CS, oz = cz * CS;
    let minH = 0;
    for (let i = 0; i < N * N; i++) if (L.h[i] < minH) minH = L.h[i];
    const chunk = {
      cx, cz, key: ck(cx, cz), nkey: nk(cx, cz),
      group: new THREE.Group(),
      props: new THREE.Group(),
      boxes: [], blockKeys: [], cellKeys: [], lights: [], inter: [], rooms: [], beds: [], dispose: [], ladders: [], water: [], trees: [],
      bbox: new THREE.Box3(new THREE.Vector3(ox, minH - 0.2, oz), new THREE.Vector3(ox + CS, WALL_H + 1.1, oz + CS)),
      lightsDirty: true,
      layout: L,
      sb: new Map(),
    };

    for (const l of L.leaves) {
      const room = {
        id: `${cx},${cz}:${l.idx}`, chunk,
        x0: ox + l.x * CELL, z0: oz + l.z * CELL, x1: ox + (l.x + l.w) * CELL, z1: oz + (l.z + l.h) * CELL,
        safe: !!l.safe, camp: !!l.camp, cells: [], type: l.type, style: l.style, leaf: l,
      };
      room.cx = (room.x0 + room.x1) / 2; room.cz = (room.z0 + room.z1) / 2;
      for (let x = l.x; x < l.x + l.w; x++) for (let z = l.z; z < l.z + l.h; z++) room.cells.push([cx * N + x, cz * N + z]);
      chunk.rooms.push(room);
    }
    for (let lx = 0; lx < N; lx++) for (let lz = 0; lz < N; lz++) {
      const k = cellKey(cx * N + lx, cz * N + lz);
      this.cellInfo.set(k, chunk.rooms[L.grid[lz * N + lx]]);
      chunk.cellKeys.push(k);
    }

    chunk.group.add(chunk.props);
    this.chunks.set(chunk.key, chunk);
    this.chunkN.set(chunk.nkey, chunk);
    this._buildStructure(chunk, L, ox, oz);
    this._buildVent(chunk, L);
    this._bakeAndAdd(chunk, L, ox, oz);
    this._buildLights(chunk, L, ox, oz);
    this._buildProps(chunk, L);

    for (const b of chunk.boxes) this._addBox(b);
    this.root.add(chunk.group);
    if (this.onChunkLoaded) this.onChunkLoaded(chunk);
    return chunk;
  }

  _sb(chunk, key) {
    let b = chunk.sb.get(key);
    if (!b) { b = new SurfBuilder(key); chunk.sb.set(key, b); }
    return b;
  }

  _wallMat(c) {
    return STYLES[c.leaf.style]?.wall || 'wallOffice';
  }
  _lowMat(c) {
    const k = c.L.kind[c.i];
    if (k === K_HOLE) return 'wallConcrete';
    if (k === K_BASIN) return 'floorPoolBasin';
    return this._wallMat(c);
  }
  _amb(c) {
    const k = c.L.kind[c.i];
    if (c.leaf.type === 'xmas') return 0.05;
    if (k === K_HOLE) return 0.45;
    if (c.leaf.style === 'pool') return 1.15;
    return 1;
  }

  _buildStructure(chunk, L, ox, oz) {
    const M = this.M;
    const tb = new GeoBuilder(1, 1);
    const boxes = chunk.boxes;
    const addBox = (x0, x1, z0, z1, y0, y1) => boxes.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: y1, bottom: y0, on: true, chunk });

    // ── floors ──
    for (let lx = 0; lx < N; lx++) for (let lz = 0; lz < N; lz++) {
      const i = lz * N + lx;
      const leaf = L.leaves[L.grid[i]];
      const kind = L.kind[i];
      const key = kind === K_HOLE ? 'floorConcrete' : kind === K_BASIN ? 'floorPoolBasin' : (STYLES[leaf.style]?.floor || 'carpetOffice');
      const s = UVS[key];
      const x0 = ox + lx * CELL, z0 = oz + lz * CELL;
      const c = { L, i, leaf };
      const nrm = kind === K_RAMP ? RAMP_N[L.rdir[i]] : [0, 1, 0];
      const amb = this._amb(c);
      this._sb(chunk, key).grid(2, 2, (u, v) => [x0 + u * CELL, this._hAt(c, u * CELL, v * CELL), z0 + v * CELL], nrm, (x, y, z) => [x * s, z * s], amb);
    }

    // ── ceiling (1 m tiles, holes for vent grates) ──
    {
      const key = L.biome === 'pool' ? 'ceilingPool' : 'ceiling';
      const s = UVS[key];
      const holes = new Set();
      for (const ci of L.grateCells) { const lx = ci % N, lz = (ci / N) | 0; holes.add((lz * 3 + 1) * CS + lx * 3 + 1); }
      const so = key === 'ceiling' ? 0.25 : 0;
      const ambAt = (q) => {
        let m = 2;
        for (const [ex, ez] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
          const gx = Math.floor((q[0] + ex) / CELL) - chunk.cx * N, gz = Math.floor((q[2] + ez) / CELL) - chunk.cz * N;
          if (gx < 0 || gz < 0 || gx >= N || gz >= N) continue;
          const lf = L.leaves[L.grid[gz * N + gx]];
          const a = lf.type === 'xmas' ? 0.05 : lf.style === 'pool' ? 1.1 : 1;
          if (a < m) m = a;
        }
        return m > 1.5 ? 1 : m;
      };
      this._sb(chunk, key).grid(CS, CS, (u, v) => [ox + u * CS, WALL_H, oz + v * CS], [0, -1, 0], (x, y, z) => [x * s + so, z * s + so], ambAt, (iu, iv) => holes.has(iv * CS + iu));
    }

    // ── walls, door frames, drops between floor heights ──
    const segs = (axis, li) => {
      // li: line index inside chunk (0..N-1); returns per-segment info along it
      const out = [];
      for (let s = -1; s <= N; s++) {
        const gx = axis === 'h' ? chunk.cx * N + s : chunk.cx * N + li;
        const gz = axis === 'h' ? chunk.cz * N + li : chunk.cz * N + s;
        out.push(this._edgeG(axis, gx, gz));
      }
      return out;
    };
    for (const axis of ['h', 'v']) {
      for (let li = 0; li < N; li++) {
        const types = segs(axis, li); // index s+1
        const line = axis === 'h' ? oz + li * CELL : ox + li * CELL;
        for (let s = 0; s < N; s++) {
          const t = types[s + 1];
          const gx = axis === 'h' ? chunk.cx * N + s : chunk.cx * N + li;
          const gz = axis === 'h' ? chunk.cz * N + li : chunk.cz * N + s;
          const A = axis === 'h' ? this._cellAt(gx, gz - 1) : this._cellAt(gx - 1, gz);
          const B = this._cellAt(gx, gz);
          const a0 = (axis === 'h' ? gx : gz) * CELL;
          // floor profile along the edge at its two ends, each side
          const pA = axis === 'h' ? [this._hAt(A, 0, CELL), this._hAt(A, CELL, CELL)] : [this._hAt(A, CELL, 0), this._hAt(A, CELL, CELL)];
          const pB = axis === 'h' ? [this._hAt(B, 0, 0), this._hAt(B, CELL, 0)] : [this._hAt(B, 0, 0), this._hAt(B, 0, CELL)];
          const minF = Math.min(pA[0], pA[1], pB[0], pB[1]);
          if (t === E_WALL || t === E_DOOR || t === E_SDOOR) {
            const prevSolid = types[s] !== E_NONE, nextSolid = types[s + 2] !== E_NONE;
            const e0 = prevSolid ? 0 : T / 2, e1 = nextSolid ? 0 : T / 2;
            const pieces = t === E_WALL ? [[-e0, CELL + e1]] : [[-e0, 1.5 - HG], [1.5 + HG, CELL + e1]];
            for (const [p0, p1] of pieces) {
              this._wallFace(chunk, axis, line - T / 2, -1, a0 + p0, a0 + p1, Math.min(pA[0], pA[1]), WALL_H, this._wallMat(A), this._amb(A));
              this._wallFace(chunk, axis, line + T / 2, 1, a0 + p0, a0 + p1, Math.min(pB[0], pB[1]), WALL_H, this._wallMat(B), this._amb(B));
              if (axis === 'h') addBox(a0 + p0, a0 + p1, line - T / 2, line + T / 2, minF, WALL_H);
              else addBox(line - T / 2, line + T / 2, a0 + p0, a0 + p1, minF, WALL_H);
            }
            if (!prevSolid) this._capFace(chunk, axis, line, a0 - T / 2, -1, minF, this._wallMat(A), this._amb(A));
            if (!nextSolid) this._capFace(chunk, axis, line, a0 + CELL + T / 2, 1, minF, this._wallMat(B), this._amb(B));
            if (t !== E_WALL) {
              const m0 = a0 + 1.5 - HG, m1 = a0 + 1.5 + HG;
              const hi = Math.max(pA[0], pA[1], pB[0], pB[1]);
              // lintel
              this._wallFace(chunk, axis, line - T / 2, -1, m0, m1, DOOR_H, WALL_H, this._wallMat(A), this._amb(A));
              this._wallFace(chunk, axis, line + T / 2, 1, m0, m1, DOOR_H, WALL_H, this._wallMat(B), this._amb(B));
              this._lintelUnder(chunk, axis, line, m0, m1, this._wallMat(A), this._amb(A));
              // jambs
              this._jamb(chunk, axis, line, m0, 1, minF, this._wallMat(A), this._amb(A));
              this._jamb(chunk, axis, line, m1, -1, minF, this._wallMat(B), this._amb(B));
              // sill where the floors differ
              this._stepFaces(chunk, axis, line, a0, m0 - a0, m1 - a0, A, B, pA, pB);
              // wood trim
              const y0 = hi;
              if (axis === 'h') {
                const tz0 = line - T / 2 - 0.03, tz1 = line + T / 2 + 0.03;
                tb.box(m0 - 0.07, m0 + 0.02, y0, DOOR_H + 0.07, tz0, tz1, 'nx px nz pz');
                tb.box(m1 - 0.02, m1 + 0.07, y0, DOOR_H + 0.07, tz0, tz1, 'nx px nz pz');
                tb.box(m0 - 0.07, m1 + 0.07, DOOR_H - 0.02, DOOR_H + 0.07, tz0, tz1, 'nz pz ny');
              } else {
                const tx0 = line - T / 2 - 0.03, tx1 = line + T / 2 + 0.03;
                tb.box(tx0, tx1, y0, DOOR_H + 0.07, m0 - 0.07, m0 + 0.02, 'nx px nz pz');
                tb.box(tx0, tx1, y0, DOOR_H + 0.07, m1 - 0.02, m1 + 0.07, 'nx px nz pz');
                tb.box(tx0, tx1, DOOR_H - 0.02, DOOR_H + 0.07, m0 - 0.07, m1 + 0.07, 'nx px ny');
              }
              if (t === E_SDOOR) this._saferoomDoor(chunk, axis, a0 + 1.5, line, { lx: axis === 'h' ? s : li, lz: axis === 'h' ? li : s }, hi);
            }
            const bk = `${axis}:${gx}:${gz}`;
            if (t === E_WALL || t === E_SDOOR) chunk.blockKeys.push(bk);
          } else {
            this._stepFaces(chunk, axis, line, a0, 0, CELL, A, B, pA, pB);
          }
        }
      }
    }
    for (const k of chunk.blockKeys) this.blockEdges.add(k);

    // pillars
    for (const [vx, vz, li] of L.pillars) {
      const x = ox + vx * CELL, z = oz + vz * CELL;
      const leaf = L.leaves[li];
      const c = { L, i: L.grid.indexOf(li), leaf };
      const mat = STYLES[leaf.style]?.wall || 'wallOffice';
      const f = 0;
      const amb = this._amb({ L, i: (vz - 1) * N + (vx - 1) < 0 ? 0 : Math.min(N * N - 1, vz * N + vx), leaf });
      this._wallFace(chunk, 'h', z - 0.25, -1, x - 0.25, x + 0.25, f, WALL_H, mat, amb);
      this._wallFace(chunk, 'h', z + 0.25, 1, x - 0.25, x + 0.25, f, WALL_H, mat, amb);
      this._wallFace(chunk, 'v', x - 0.25, -1, z - 0.25, z + 0.25, f, WALL_H, mat, amb);
      this._wallFace(chunk, 'v', x + 0.25, 1, z - 0.25, z + 0.25, f, WALL_H, mat, amb);
      addBox(x - 0.25, x + 0.25, z - 0.25, z + 0.25, 0, WALL_H);
    }

    // ladders out of pits & pools
    for (const ld of L.ladders) this._buildLadder(chunk, L, ld, ox, oz);

    // water surfaces
    this._buildWater(chunk, L, ox, oz);

    if (!tb.empty) {
      const g = tb.build();
      const m = new THREE.Mesh(g, M.trim);
      m.castShadow = true; m.receiveShadow = true;
      chunk.group.add(m);
      chunk.dispose.push(g);
    }
  }

  // A flat wall face on plane `plane` (z for 'h', x for 'v'), facing `dir` (±1),
  // spanning `a0..a1` along the line and y0..y1.
  _wallFace(chunk, axis, plane, dir, a0, a1, y0, y1, mat, amb) {
    if (a1 - a0 < 0.01 || y1 - y0 < 0.01) return;
    const s = UVS[mat] || 1 / 3;
    const nu = Math.max(1, Math.round((a1 - a0) / 1.5));
    const nv = Math.max(1, Math.round((y1 - y0) / 1.25));
    const nrm = axis === 'h' ? [0, 0, dir] : [dir, 0, 0];
    const vs = mat === 'wallOffice' ? 1 / 3 : s;
    const P = axis === 'h' ? (u, v) => [a0 + (a1 - a0) * u, y0 + (y1 - y0) * v, plane] : (u, v) => [plane, y0 + (y1 - y0) * v, a0 + (a1 - a0) * u];
    const UV = axis === 'h' ? (x, y) => [x * s, (y - y0) * vs] : (x, y, z) => [z * s, (y - y0) * vs];
    this._sb(chunk, mat).grid(nu, nv, P, nrm, UV, amb);
  }

  // end cap of a wall run (perpendicular to the line)
  _capFace(chunk, axis, line, at, dir, y0, mat, amb) {
    const s = UVS[mat] || 1 / 3;
    const nrm = axis === 'h' ? [dir, 0, 0] : [0, 0, dir];
    const P = axis === 'h' ? (u, v) => [at, y0 + (WALL_H - y0) * v, line - T / 2 + T * u] : (u, v) => [line - T / 2 + T * u, y0 + (WALL_H - y0) * v, at];
    this._sb(chunk, mat).grid(1, 2, P, nrm, (x, y, z) => [(axis === 'h' ? z : x) * s, (y - y0) * s], amb);
  }

  _lintelUnder(chunk, axis, line, m0, m1, mat, amb) {
    const s = UVS[mat] || 1 / 3;
    const P = axis === 'h' ? (u, v) => [m0 + (m1 - m0) * u, DOOR_H, line - T / 2 + T * v] : (u, v) => [line - T / 2 + T * v, DOOR_H, m0 + (m1 - m0) * u];
    this._sb(chunk, mat).grid(1, 1, P, [0, -1, 0], (x, y, z) => [x * s, z * s], amb);
  }

  _jamb(chunk, axis, line, at, dir, y0, mat, amb) {
    const s = UVS[mat] || 1 / 3;
    const nrm = axis === 'h' ? [dir, 0, 0] : [0, 0, dir];
    const P = axis === 'h' ? (u, v) => [at, y0 + (DOOR_H - y0) * v, line - T / 2 + T * u] : (u, v) => [line - T / 2 + T * u, y0 + (DOOR_H - y0) * v, at];
    this._sb(chunk, mat).grid(1, 2, P, nrm, (x, y, z) => [(axis === 'h' ? z : x) * s, (y - y0) * s], amb);
  }

  // vertical faces where two floors meet at different heights (pits, ramps, sunken rooms, pools)
  _stepFaces(chunk, axis, line, a0, s0, s1, A, B, pA, pB) {
    const at = (p, u) => p[0] + (p[1] - p[0]) * (u / CELL);
    const a = [at(pA, s0), at(pA, s1)], b = [at(pB, s0), at(pB, s1)];
    let low, high, lowC, dir;
    if (a[0] >= b[0] - 1e-4 && a[1] >= b[1] - 1e-4) { high = a; low = b; lowC = B; dir = 1; }
    else if (b[0] >= a[0] - 1e-4 && b[1] >= a[1] - 1e-4) { high = b; low = a; lowC = A; dir = -1; }
    else return;
    if (high[0] - low[0] + high[1] - low[1] < 0.02) return;
    const mat = this._lowMat(lowC);
    const s = UVS[mat] || 1 / 3;
    const u0 = a0 + s0, u1 = a0 + s1;
    const yb = Math.min(low[0], low[1]);
    const P = axis === 'h'
      ? (u, v) => { const lo = low[0] + (low[1] - low[0]) * u, hi = high[0] + (high[1] - high[0]) * u; return [u0 + (u1 - u0) * u, lo + (hi - lo) * v, line]; }
      : (u, v) => { const lo = low[0] + (low[1] - low[0]) * u, hi = high[0] + (high[1] - high[0]) * u; return [line, lo + (hi - lo) * v, u0 + (u1 - u0) * u]; };
    const nrm = axis === 'h' ? [0, 0, dir] : [dir, 0, 0];
    const nv = Math.max(1, Math.round((Math.max(high[0], high[1]) - yb) / 1.2));
    this._sb(chunk, mat).grid(2, nv, P, nrm, axis === 'h' ? (x, y) => [x * s, (y - yb) * s] : (x, y, z) => [z * s, (y - yb) * s], this._amb(lowC));
    // a lip so the edge reads clearly
  }

  _buildLadder(chunk, L, ld, ox, oz) {
    const M = this.M;
    const x0 = ox + ld.lx * CELL, z0 = oz + ld.lz * CELL;
    // side: 0 −z, 1 +z, 2 −x, 3 +x (the wall the ladder is fixed to, inside the hole cell)
    const t = ld.t * CELL;
    let px, pz, rot, nx = 0, nz = 0;
    if (ld.side === 0) { px = x0 + t; pz = z0; rot = 0; nz = -1; }
    else if (ld.side === 1) { px = x0 + t; pz = z0 + CELL; rot = Math.PI; nz = 1; }
    else if (ld.side === 2) { px = x0; pz = z0 + t; rot = Math.PI / 2; nx = -1; }
    else { px = x0 + CELL; pz = z0 + t; rot = -Math.PI / 2; nx = 1; }
    const depth = -ld.depth;
    let mesh;
    if (ld.kind === 'pool') {
      mesh = Models.poolLadder(M, depth);
      mesh.position.set(px, 0, pz);
      mesh.rotation.y = rot;
    } else {
      mesh = Models.ladder(M, depth + 0.9, 0.5, M.rusty);
      mesh.position.set(px - nx * 0.06, ld.depth, pz - nz * 0.06);
      mesh.rotation.y = rot;
    }
    chunk.props.add(mesh);
    // climbing zone: in front of the ladder, inside the hole
    const hw = 0.42, dd = 0.75;
    const zone = {
      minX: nx ? (nx > 0 ? px - dd : px) : px - hw, maxX: nx ? (nx > 0 ? px : px + dd) : px + hw,
      minZ: nz ? (nz > 0 ? pz - dd : pz) : pz - hw, maxZ: nz ? (nz > 0 ? pz : pz + dd) : pz + hw,
      y0: ld.depth - 0.1, y1: 0.05, nx, nz, chunk, pool: ld.kind === 'pool',
    };
    chunk.ladders.push(zone);
    this.ladders.add(zone);
  }

  _buildWater(chunk, L, ox, oz) {
    const M = this.M;
    for (const l of L.leaves) {
      if (l.type === 'flooded') {
        const g = new THREE.PlaneGeometry(l.w * CELL - T, l.h * CELL - T);
        g.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(g, M.murk);
        m.position.set(ox + (l.x + l.w / 2) * CELL, FLOOD_W, oz + (l.z + l.h / 2) * CELL);
        m.renderOrder = 2;
        chunk.group.add(m);
        chunk.dispose.push(g);
      } else if (l.basin) {
        const b = l.basin;
        const g = new THREE.PlaneGeometry((b.x1 - b.x0) * CELL, (b.z1 - b.z0) * CELL);
        g.rotateX(-Math.PI / 2);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (b.x1 - b.x0) * 0.7, uv.getY(i) * (b.z1 - b.z0) * 0.7);
        const m = new THREE.Mesh(g, M.water);
        m.position.set(ox + (b.x0 + b.x1) / 2 * CELL, POOL_W, oz + (b.z0 + b.z1) / 2 * CELL);
        m.renderOrder = 2;
        chunk.group.add(m);
        chunk.dispose.push(g);
      }
    }
  }

  // ── vents ───────────────────────────────────────────────────
  _buildVent(chunk, L) {
    const V = L.vent;
    if (!V) return;
    const M = this.M;
    const st = this.state.vents.get(V.id) || { dur: VENT.durability, broken: false, time: 0 };
    this.state.vents.set(V.id, st);
    const vent = { id: V.id, st, tiles: V.tiles, chunk, grates: [] };
    this.vents.set(V.id, vent);
    chunk.vent = vent;
    const has = (tx, tz) => V.tiles.has(nk(tx, tz));
    const grateTiles = new Set(V.grates.map((g) => nk(g.gx * 3 + 1, g.gz * 3 + 1)));
    const b = this._sb(chunk, 'ductSurf');
    const y0 = VENT.floorY, y1 = 3.96;
    for (const key of V.tiles) {
      const tx = Math.floor(key / 0x10000) - 0x8000, tz = (key % 0x10000) - 0x8000;
      chunk.bbox.expandByPoint(tmpV.set(tx - 0.2, 0, tz - 0.2)).expandByPoint(tmpV.set(tx + 1.2, 4.1, tz + 1.2));
    }
    const s = 1;
    for (const key of V.tiles) {
      const tx = Math.floor(key / 0x10000) - 0x8000, tz = (key % 0x10000) - 0x8000;
      if (!grateTiles.has(key)) b.grid(1, 1, (u, v) => [tx + u, y0, tz + v], [0, 1, 0], (x, y, z) => [x * s, z * s], 0.22);
      b.grid(1, 1, (u, v) => [tx + u, y1, tz + v], [0, -1, 0], (x, y, z) => [x * s, z * s], 0.22);
      if (!has(tx, tz - 1)) { b.grid(1, 1, (u, v) => [tx + u, y0 + (y1 - y0) * v, tz], [0, 0, 1], (x, y) => [x, y], 0.22); chunk.boxes.push({ minX: tx, maxX: tx + 1, minZ: tz - 0.1, maxZ: tz, top: 4, bottom: 3.0, on: true, chunk }); }
      if (!has(tx, tz + 1)) { b.grid(1, 1, (u, v) => [tx + u, y0 + (y1 - y0) * v, tz + 1], [0, 0, -1], (x, y) => [x, y], 0.22); chunk.boxes.push({ minX: tx, maxX: tx + 1, minZ: tz + 1, maxZ: tz + 1.1, top: 4, bottom: 3.0, on: true, chunk }); }
      if (!has(tx - 1, tz)) { b.grid(1, 1, (u, v) => [tx, y0 + (y1 - y0) * v, tz + u], [1, 0, 0], (x, y, z) => [z, y], 0.22); chunk.boxes.push({ minX: tx - 0.1, maxX: tx, minZ: tz, maxZ: tz + 1, top: 4, bottom: 3.0, on: true, chunk }); }
      if (!has(tx + 1, tz)) { b.grid(1, 1, (u, v) => [tx + 1, y0 + (y1 - y0) * v, tz + u], [-1, 0, 0], (x, y, z) => [z, y], 0.22); chunk.boxes.push({ minX: tx + 1, maxX: tx + 1.1, minZ: tz, maxZ: tz + 1, top: 4, bottom: 3.0, on: true, chunk }); }
    }
    // grates, ladder
    for (const g of V.grates) {
      const x = g.gx * CELL + 1.5, z = g.gz * CELL + 1.5;
      const gid = `${V.id}:g${g.gx},${g.gz}`;
      const opened = this.state.grates.has(gid);
      const gm = Models.grate(M);
      gm.position.set(x, WALL_H + 0.02, z);
      if (!opened) chunk.props.add(gm);
      const grate = { id: gid, x, z, ladder: g.ladder, mesh: gm, opened, vent };
      vent.grates.push(grate);
      if (g.ladder) {
        const ld = Models.ladder(M, WALL_H + 0.05, 0.5, M.metal);
        ld.position.set(x, 0, z - 0.42);
        chunk.props.add(ld);
        chunk.boxes.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.47, maxZ: z - 0.38, top: WALL_H, bottom: 0, on: true, chunk });
        chunk.inter.push({ kind: 'ventLadder', id: gid, pos: new THREE.Vector3(x, 1.5, z - 0.3), r: 0.55, chunk, grate, vent });
      }
      chunk.inter.push({ kind: 'ventExit', id: gid + ':x', pos: new THREE.Vector3(x, VENT.floorY + 0.05, z), r: 0.5, chunk, grate, vent, inVent: true });
    }
    if (st.broken) this._ventDebris(chunk, vent, st.bx, st.bz);
  }

  _ventDebris(chunk, vent, x, z) {
    if (x === undefined) { const g = vent.grates[0]; x = g.x; z = g.z; }
    const d = Models.ductDebris(this.M);
    d.position.set(x, this.floorAt(x, z), z);
    (this.chunks.get(ck(Math.floor(x / CS), Math.floor(z / CS)))?.props || chunk.props).add(d);
  }

  breakVent(vent, x, z) {
    vent.st.broken = true;
    vent.st.bx = x; vent.st.bz = z;
    this._ventDebris(vent.chunk, vent, x, z);
  }

  ventAt(x, z) {
    const k = nk(Math.floor(x), Math.floor(z));
    for (const v of this.vents.values()) if (v.tiles.has(k)) return v;
    return null;
  }

  // ── bake light into every surface vertex, then make meshes ───
  _bakeAndAdd(chunk, L, ox, oz) {
    const M = this.M;
    // gather lights from this chunk and its neighbours
    const lights = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const LL = this._layout(L.cx + dx, L.cz + dz);
      const bx = (L.cx + dx) * CS, bz = (L.cz + dz) * CS;
      for (const l of LL.lights) {
        const x = bx + l.lx * CELL + 1.5, z = bz + l.lz * CELL + 1.2;
        if (x < ox - BAKE_R || x > ox + CS + BAKE_R || z < oz - BAKE_R || z > oz + CS + BAKE_R) continue;
        const day = l.day === 'dead' ? 0 : l.day === 'flicker' ? 0.7 : 1;
        const night = l.nightOn ? 1 : 0;
        if (!day && !night) continue;
        lights.push({ x, y: WALL_H - 0.2, z, day, night, r: l.pool ? 0.9 : 1, g: l.pool ? 0.97 : 0.94, b: l.pool ? 1 : 0.8 });
      }
      for (const e of LL.extraLights) {
        const x = bx + e.x, z = bz + e.z;
        if (x < ox - BAKE_R || x > ox + CS + BAKE_R || z < oz - BAKE_R || z > oz + CS + BAKE_R) continue;
        lights.push({ x, y: e.y, z, day: e.day, night: e.night, r: e.col[0], g: e.col[1], b: e.col[2] });
      }
    }
    for (const [key, sb] of chunk.sb) {
      if (sb.empty) continue;
      const n = sb.c;
      const day = new Float32Array(n * 3), night = new Float32Array(n * 3);
      if (key !== 'ductSurf') {
        const P = sb.p, Nn = sb.n;
        for (let v = 0; v < n; v++) {
          const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
          const nx = Nn[v * 3], ny = Nn[v * 3 + 1], nz = Nn[v * 3 + 2];
          const sx = x + nx * 0.06, sz = z + nz * 0.06;
          let dr = 0, dg = 0, db = 0, nr = 0, ng = 0, nb = 0;
          for (let i = 0; i < lights.length; i++) {
            const Lt = lights[i];
            const lx = Lt.x - x, ly = Lt.y - y, lz = Lt.z - z;
            const d2 = lx * lx + ly * ly + lz * lz;
            if (d2 > BAKE_R2) continue;
            const d = Math.sqrt(d2) || 0.01;
            const ndl = (nx * lx + ny * ly + nz * lz) / d;
            if (ndl < -0.2) continue;
            const w = ny < -0.5 ? 0.08 + 0.92 * Math.max(0, ndl) : 0.25 + 0.75 * Math.max(0, ndl);
            const q = 1 - d2 / BAKE_R2;
            const fall = (q * q) / (1 + d2 * 0.11);
            const vis = this._vis(Lt.x, Lt.z, sx, sz);
            if (vis <= 0) continue;
            const c = w * fall * vis;
            if (Lt.day) { const k = c * Lt.day; dr += k * Lt.r; dg += k * Lt.g; db += k * Lt.b; }
            if (Lt.night) { const k = c * Lt.night; nr += k * Lt.r; ng += k * Lt.g; nb += k * Lt.b; }
          }
          // soft contact shadow where walls meet the floor
          let ao = 1;
          if (ny === 0) ao = 0.7 + 0.3 * smoothstep(0, 0.9, y - this.floorAt(sx, sz));
          day[v * 3] = dr * ao; day[v * 3 + 1] = dg * ao; day[v * 3 + 2] = db * ao;
          night[v * 3] = nr * ao; night[v * 3 + 1] = ng * ao; night[v * 3 + 2] = nb * ao;
        }
      }
      const g = sb.build(day, night);
      const mesh = new THREE.Mesh(g, M[key]);
      mesh.receiveShadow = true;
      mesh.castShadow = key.startsWith('wall');
      chunk.group.add(mesh);
      chunk.dispose.push(g);
    }
    chunk.sb = null;
  }

  _saferoomDoor(chunk, axis, mid, line, edge, y0 = 0) {
    const id = `${chunk.cx},${chunk.cz}:door${edge.lx},${edge.lz}${axis}`;
    const leaf = chunk.layout.leaves.find((l) => l.safe);
    const side = leaf && leaf.door ? leaf.door.side : 1;
    const { pivot, leds } = Models.saferoomDoor(this.M, DOOR_GAP);
    const unlocked = this.state.unlocked.has(id);
    let base, sgn;
    if (axis === 'h') { pivot.position.set(mid - HG, y0, line); base = 0; sgn = -side; }
    else { pivot.position.set(line, y0, mid - HG); base = -Math.PI / 2; sgn = side; }
    const open = base + sgn * 1.45;
    pivot.rotation.y = unlocked ? open : base;
    chunk.props.add(pivot);
    const box = axis === 'h'
      ? { minX: mid - HG, maxX: mid + HG, minZ: line - 0.06, maxZ: line + 0.06, top: WALL_H, bottom: y0, on: !unlocked, chunk }
      : { minX: line - 0.06, maxX: line + 0.06, minZ: mid - HG, maxZ: mid + HG, top: WALL_H, bottom: y0, on: !unlocked, chunk };
    chunk.boxes.push(box);
    if (unlocked) for (const l of leds) l.material = this.M.ledGreen;
    const pos = axis === 'h' ? new THREE.Vector3(mid, 1.2, line) : new THREE.Vector3(line, 1.2, mid);
    const door = {
      kind: 'sdoor', id, pos, r: 0.9, unlocked, pivot, leds, box, chunkKey: chunk.key,
      outside: axis === 'h' ? { x: mid, z: line - side * 1.5 } : { x: line - side * 1.5, z: mid },
      unlock: () => {
        door.unlocked = true;
        this.state.unlocked.add(id);
        box.on = false;
        for (const l of leds) l.material = this.M.ledGreen;
        let t = 0;
        this.animated.add({ update: (dt) => { t = Math.min(1, t + dt * 1.2); pivot.rotation.y = base + sgn * 1.45 * (1 - Math.pow(1 - t, 3)); return t >= 1; } });
      },
    };
    chunk.inter.push(door);
  }

  _buildLights(chunk, L, ox, oz) {
    const M = this.M;
    const count = L.lights.length;
    if (count) {
      const panels = new THREE.InstancedMesh(Models.sharedGeo.panel(), M.panel, count);
      panels.castShadow = false;
      panels.receiveShadow = false;
      L.lights.forEach((l, i) => {
        const x = ox + l.lx * CELL + 1.5, z = oz + l.lz * CELL + 1.2;
        tmpMat.makeTranslation(x, WALL_H - 0.016, z);
        panels.setMatrixAt(i, tmpMat);
        panels.setColorAt(i, tmpColor.setRGB(1, 1, 1));
        chunk.lights.push({
          kind: 'panel', x, y: WALL_H - 0.25, z, inst: i, day: l.day, nightOn: l.nightOn,
          seed: hash32(this.seed, chunk.cx, chunk.cz, i) / 4294967296 * 100, b: -1,
          color: l.pool ? 0xeaf4ff : 0xfff1cf, intensity: l.pool ? 8.5 : 7.5, range: l.pool ? 12 : 10.5, weight: 1,
        });
      });
      panels.instanceMatrix.needsUpdate = true;
      panels.computeBoundingSphere();
      chunk.group.add(panels);
      chunk.panels = panels;
      chunk.dispose.push(panels);
    }
    for (const e of L.extraLights) {
      if (e.kind === 'tree') chunk.lights.push({ kind: 'tree', x: ox + e.x, y: 1.5, z: oz + e.z, seed: 3.3, b: -1, color: 0xff2a14, intensity: 3.2, range: 7.5, weight: 2.5 });
    }
  }

  // ── props ───────────────────────────────────────────────────
  _lootTable() {
    const m = this.diff.lootMult ?? 1;
    const t = [];
    let sum = 0;
    for (const k in DRAWER_LOOT) { const w = DRAWER_LOOT[k] * m; t.push([k, w]); sum += w; }
    t.push([null, Math.max(0, 100 - sum)]);
    return t;
  }

  // Candidate spots against walls inside a room (for cabinets/boxes).
  _wallSlots(L, l, rng) {
    const ox = L.cx * CS, oz = L.cz * CS;
    const slots = [];
    const flat = (x, z) => { const i = z * N + x; return L.kind[i] === K_FLAT; };
    for (let i = 0; i < l.w; i++) {
      const x = l.x + i;
      const j = (rng() - 0.5) * 1.2;
      if (this._edgeType(L, 'h', x, l.z) === 'wall' && flat(x, l.z)) slots.push({ x: ox + x * CELL + 1.5 + j, z: oz + l.z * CELL + T / 2, rot: 0, cell: [x, l.z] });
      if (this._edgeType(L, 'h', x, l.z + l.h) === 'wall' && flat(x, l.z + l.h - 1)) slots.push({ x: ox + x * CELL + 1.5 + j, z: oz + (l.z + l.h) * CELL - T / 2, rot: Math.PI, cell: [x, l.z + l.h - 1] });
    }
    for (let i = 0; i < l.h; i++) {
      const z = l.z + i;
      const j = (rng() - 0.5) * 1.2;
      if (this._edgeType(L, 'v', l.x, z) === 'wall' && flat(l.x, z)) slots.push({ x: ox + l.x * CELL + T / 2, z: oz + z * CELL + 1.5 + j, rot: Math.PI / 2, cell: [l.x, z] });
      if (this._edgeType(L, 'v', l.x + l.w, z) === 'wall' && flat(l.x + l.w - 1, z)) slots.push({ x: ox + (l.x + l.w) * CELL - T / 2, z: oz + z * CELL + 1.5 + j, rot: -Math.PI / 2, cell: [l.x + l.w - 1, z] });
    }
    return shuffle(slots, rng);
  }

  _props(L) {
    const rng = mulberry32(hash32(this.seed, L.cx, L.cz, 99));
    const ox = L.cx * CS, oz = L.cz * CS;
    const d = this.diff;
    const props = [];
    const loot = this._lootTable();
    const rich = [['battery', 24], ['drink', 20], ['food', 20], ['key', 7], ['weapon', 8], ['wood', 8], ['metal', 8], ['medkit', 3], ['cloth', 4], ['tape', 4]];
    let ci = 0, ii = 0;
    const hOf = (x, z) => this.floorAt(x, z);
    const randPos = (l, m = 0.7) => ({
      x: ox + l.x * CELL + m + rng() * (l.w * CELL - m * 2),
      z: oz + l.z * CELL + m + rng() * (l.h * CELL - m * 2),
    });
    const cabVariant = () => weighted(rng, [['std', 40], ['rusty', 20], ['double', 12], ['sunk', 12], ['desk', 10], ['tall', 6]]);
    if (L.camp) {
      props.push({ type: 'cabinet', variant: 'std', x: 21.8 - 0.1, z: 12, rot: -Math.PI / 2, loot: ['food', null, null], id: 'camp:c0' });
      if (this.tutorial) {
        props.push({ type: 'rock', x: 13.6, z: 13.6, id: 'camp:k0' });
        props.push({ type: 'pickup', item: 'fruit', x: 10.4, z: 13.6, id: 'camp:b0' });
      }
      return props;
    }
    if (this.menu) return props;
    const foot = [];
    const fits = (x0, x1, z0, z1) => !foot.some((f) => x1 > f[0] && x0 < f[1] && z1 > f[2] && z0 < f[3]);
    for (const l of L.leaves) {
      const slots = this._wallSlots(L, l, rng);
      let bedCell = null;
      if (l.safe) {
        l.bed = rng() < 0.15;
        if (l.bed) {
          const dx = l.door.axis === 'v' ? l.door.lx : l.door.lx + 0.5;
          const dz = l.door.axis === 'h' ? l.door.lz : l.door.lz + 0.5;
          let best = null, bd = -1;
          for (let x = l.x; x < l.x + l.w; x++) for (let z = l.z; z < l.z + l.h; z++) {
            const dd = (x + 0.5 - dx) ** 2 + (z + 0.5 - dz) ** 2;
            if (dd > bd) { bd = dd; best = [x, z]; }
          }
          bedCell = best;
          const bx = ox + best[0] * CELL + 1.5, bz = oz + best[1] * CELL + 1.5;
          props.push({ type: 'bed', x: bx, z: bz, id: `${L.cx},${L.cz}:bed${l.idx}` });
          foot.push([bx - 1.05, bx + 1.05, bz - 0.55, bz + 0.55]);
        }
      }
      const free = slots.filter((s) => !bedCell || s.cell[0] !== bedCell[0] || s.cell[1] !== bedCell[1]);
      let nCab = 0;
      const cc = (d.cabinetChance ?? 0.255) * (l.style === 'pool' ? 0.5 : 1);
      if (l.safe) nCab = l.bed ? 1 : 2;
      else if (l.type !== 'xmas') {
        if (rng() < cc) nCab++;
        if (l.w * l.h >= 6 && rng() < cc * 0.35) nCab++;
      }
      for (let i = 0; i < nCab && free.length; i++) {
        const s = free.shift();
        const variant = l.safe ? 'std' : cabVariant();
        const n = variant === 'double' ? 6 : variant === 'tall' ? 4 : variant === 'desk' || variant === 'sunk' ? 2 : 3;
        const lootList = [];
        for (let k = 0; k < n; k++) lootList.push(l.safe && k < 2 ? weighted(rng, rich) : weighted(rng, loot));
        const p = { type: 'cabinet', variant, x: s.x, z: s.z, rot: s.rot, loot: lootList, id: `${L.cx},${L.cz}:c${ci++}`, stuck: variant === 'rusty' ? lootList.map(() => rng() < 0.3) : null, tilt: (rng() - 0.5) };
        const w = variant === 'double' ? 1.0 : variant === 'desk' ? 0.9 : 0.5;
        const side = Math.abs(Math.sin(s.rot)) > 0.5;
        const hx = side ? 0.35 : w / 2 + 0.05, hz = side ? w / 2 + 0.05 : 0.35;
        const sx = s.x + Math.sin(s.rot) * 0.32, sz = s.z + Math.cos(s.rot) * 0.32;
        if (!fits(sx - hx, sx + hx, sz - hz, sz + hz)) continue;
        foot.push([sx - hx, sx + hx, sz - hz, sz + hz]);
        props.push(p);
      }
      if (!l.safe && rng() < 0.14 && free.length) {
        const s = free.shift();
        const sz = 0.45 + rng() * 0.2;
        const px = s.x + Math.sin(s.rot) * (sz / 2 + 0.02), pz = s.z + Math.cos(s.rot) * (sz / 2 + 0.02);
        if (fits(px - sz / 2, px + sz / 2, pz - sz / 2, pz + sz / 2)) { foot.push([px - sz / 2, px + sz / 2, pz - sz / 2, pz + sz / 2]); props.push({ type: 'box', x: px, z: pz, rot: s.rot + (rng() - 0.5) * 0.4, s: sz }); }
      }
      // rocks to throw
      const rockChance = (l.safe ? 0.6 : 0.3) * (d.lootMult ?? 1);
      if (rng() < rockChance) {
        const n = 1 + (rng() < 0.4 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const p = randPos(l);
          if (this._kindLocal(L, p.x, p.z) !== K_FLAT && this._kindLocal(L, p.x, p.z) !== K_RAMP) continue;
          props.push({ type: 'rock', x: p.x, z: p.z, id: `${L.cx},${L.cz}:k${ii++}` });
        }
      }
      // room-type extras
      if (l.type === 'xmas' && L.xmas) {
        props.push({ type: 'xmas', x: ox + L.xmas.x, z: oz + L.xmas.z });
        foot.push([ox + L.xmas.x - 1, ox + L.xmas.x + 1, oz + L.xmas.z - 1, oz + L.xmas.z + 1]);
        const ng = 1 + Math.floor(rng() * 3);
        for (let g = 0; g < ng; g++) {
          const a = rng() * Math.PI * 2, r = 0.95 + rng() * 0.3;
          props.push({ type: 'gift', x: ox + L.xmas.x + Math.cos(a) * r, z: oz + L.xmas.z + Math.sin(a) * r, rot: rng() * 3, s: 0.28 + rng() * 0.14, color: g % 3, loot: weighted(rng, rich), id: `${L.cx},${L.cz}:gift${g}` });
        }
      }
      if (l.type === 'cubicle') this._cubicles(L, l, rng, props, foot);
      if (l.type === 'pit' && l.holes && rng() < 0.35) {
        const [hx, hz] = l.holes[Math.floor(rng() * l.holes.length)];
        props.push({ type: 'lootbox', x: ox + hx * CELL + 0.8 + rng() * 1.4, z: oz + hz * CELL + 0.8 + rng() * 1.4, loot: weighted(rng, rich), id: `${L.cx},${L.cz}:pl${ii++}` });
      }
      // things that noclipped in from somewhere else (1 in 75 rooms)
      if (!l.safe && l.type !== 'xmas' && rng() < 1 / 75) this._noclip(L, l, rng, props, foot);
    }
    return props;
  }

  _kindLocal(L, x, z) {
    const gx = Math.floor(x / CELL) - L.cx * N, gz = Math.floor(z / CELL) - L.cz * N;
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) return -1;
    return L.kind[gz * N + gx];
  }

  _cubicles(L, l, rng, props, foot) {
    const ox = L.cx * CS, oz = L.cz * CS;
    for (let x = l.x; x < l.x + l.w; x++) for (let z = l.z; z < l.z + l.h; z++) {
      if (rng() < 0.35) continue;
      const cx = ox + x * CELL, cz = oz + z * CELL;
      const fx = rng() < 0.5, fz = rng() < 0.5;
      const px = cx + (fx ? 2.45 : 0.55), pz = cz + (fz ? 2.45 : 0.55);
      // L-shaped partition with a desk tucked in its corner
      const len = 1.5;
      const ax0 = fx ? px - len : px, ax1 = fx ? px : px + len;
      const az0 = fz ? pz - len : pz, az1 = fz ? pz : pz + len;
      if (!foot.length || true) {
        props.push({ type: 'partition', x: (ax0 + ax1) / 2, z: pz, len, rot: 0 });
        props.push({ type: 'partition', x: px, z: (az0 + az1) / 2, len, rot: Math.PI / 2 });
        foot.push([ax0, ax1, pz - 0.04, pz + 0.04], [px - 0.04, px + 0.04, az0, az1]);
        if (rng() < 0.8) {
          const dx = px + (fx ? -0.7 : 0.7), dz = pz + (fz ? -0.38 : 0.38);
          props.push({ type: 'desk', x: dx, z: dz, rot: fz ? 0 : Math.PI });
          foot.push([dx - 0.66, dx + 0.66, dz - 0.34, dz + 0.34]);
        }
      }
    }
  }

  _noclip(L, l, rng, props, foot) {
    const ox = L.cx * CS, oz = L.cz * CS;
    const types = Object.keys(Models.NOCLIP);
    const pick = () => weighted(rng, types.map((t) => [t, Models.NOCLIP[t].weight]));
    const n = 1 + Math.floor(rng() * 5);
    const same = rng() < 0.65 ? pick() : null;
    for (let k = 0; k < n; k++) {
      let type = same || pick();
      const def = Models.NOCLIP[type];
      if (type === 'car' && Math.min(l.w, l.h) < 2) type = 'cone';
      const D = Models.NOCLIP[type];
      for (let tries = 0; tries < 8; tries++) {
        const m = Math.max(D.L, D.W) / 2 + 0.45;
        if (l.w * CELL < m * 2 + 0.2 || l.h * CELL < m * 2 + 0.2) break;
        const x = ox + l.x * CELL + m + rng() * (l.w * CELL - m * 2);
        const z = oz + l.z * CELL + m + rng() * (l.h * CELL - m * 2);
        if (this._kindLocal(L, x, z) !== K_FLAT) continue;
        const yaw = rng() * Math.PI * 2;
        const sink = D.H * (0.12 + rng() * 0.4);
        const tilt = type === 'stopsign' ? 0.45 : type === 'car' ? 0.32 : 0.28;
        const rx = (rng() - 0.5) * tilt * 2, rz = (rng() - 0.5) * tilt * 2;
        // hitboxes: split long things into segments so the boxes hug the shape
        const segs = Math.max(1, Math.ceil(D.L / 1.1));
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const hb = [];
        for (let i = 0; i < segs; i++) {
          const lx = -D.L / 2 + (i + 0.5) * (D.L / segs);
          const cxs = x + lx * c, czs = z - lx * s;
          const a = D.L / segs / 2, b = D.W / 2;
          const hx = Math.abs(c) * a + Math.abs(s) * b, hz = Math.abs(s) * a + Math.abs(c) * b;
          hb.push([cxs - hx, cxs + hx, czs - hz, czs + hz]);
        }
        if (hb.some((f) => !fits2(foot, f))) continue;
        for (const f of hb) foot.push(f);
        props.push({ type: 'noclip', kind: type, x, z, yaw, sink, rx, rz, boxes: hb, h: Math.max(0.3, D.H - sink) });
        break;
      }
    }
    function fits2(list, f) { return !list.some((g) => f[1] > g[0] && f[0] < g[1] && f[3] > g[2] && f[2] < g[3]); }
  }

  _buildProps(chunk, L) {
    const M = this.M;
    const props = this._props(L);
    for (const p of props) {
      const fy = this.floorAt(p.x, p.z);
      if (p.type === 'cabinet') this._addCabinet(chunk, p, fy);
      else if (p.type === 'rock') {
        if (this.state.taken.has(p.id)) continue;
        const mesh = Models.rock(M, hash32(p.id.length, Math.floor(p.x * 10)));
        mesh.position.set(p.x, fy + 0.045, p.z);
        mesh.rotation.y = (p.x * 7.3) % 6.28;
        chunk.props.add(mesh);
        chunk.inter.push({ kind: 'pickup', item: 'rock', id: p.id, pos: new THREE.Vector3(p.x, fy + 0.1, p.z), r: 0.45, mesh, chunk });
      } else if (p.type === 'pickup') {
        if (this.state.taken.has(p.id)) continue;
        const mesh = p.item === 'fruit' ? Models.bananaFruit(M) : Models.rock(M, 0);
        mesh.position.set(p.x, fy + 0.03, p.z);
        mesh.rotation.y = 0.6;
        chunk.props.add(mesh);
        chunk.inter.push({ kind: 'pickup', item: p.item, id: p.id, pos: new THREE.Vector3(p.x, fy + 0.1, p.z), r: 0.45, mesh, chunk });
      } else if (p.type === 'lootbox') {
        if (this.state.taken.has(p.id)) continue;
        const mesh = Models.cardboardBox(M, 0.32);
        mesh.position.set(p.x, fy + 0.13, p.z);
        mesh.rotation.y = p.x;
        chunk.props.add(mesh);
        chunk.inter.push({ kind: 'lootbox', loot: p.loot, id: p.id, pos: new THREE.Vector3(p.x, fy + 0.2, p.z), r: 0.45, mesh, chunk });
      } else if (p.type === 'bed') this._addBed(chunk, p);
      else if (p.type === 'box') {
        const m = Models.cardboardBox(M, p.s);
        m.position.set(p.x, fy + p.s * 0.4, p.z);
        m.rotation.y = p.rot;
        chunk.props.add(m);
        const h = p.s * 0.5;
        chunk.boxes.push({ minX: p.x - h, maxX: p.x + h, minZ: p.z - h, maxZ: p.z + h, top: fy + p.s * 0.8, bottom: fy, on: true, chunk });
      } else if (p.type === 'xmas') {
        const t = Models.xmasTree(M);
        t.group.position.set(p.x, fy, p.z);
        chunk.props.add(t.group);
        this.trees.add(t);
        chunk.trees.push(t);
        chunk.boxes.push({ minX: p.x - 0.55, maxX: p.x + 0.55, minZ: p.z - 0.55, maxZ: p.z + 0.55, top: fy + 2.6, bottom: fy, on: true, chunk });
        chunk.musicBox = { x: p.x, y: fy + 1, z: p.z };
      } else if (p.type === 'gift') {
        if (this.state.looted.has(p.id)) continue;
        const mats = [M.red, M.tentA, M.blanket];
        const g = Models.gift(M, p.s, mats[p.color]);
        g.position.set(p.x, fy, p.z);
        g.rotation.y = p.rot;
        chunk.props.add(g);
        chunk.inter.push({ kind: 'gift', id: p.id, loot: p.loot, pos: new THREE.Vector3(p.x, fy + p.s * 0.5, p.z), r: 0.4, mesh: g, chunk });
      } else if (p.type === 'partition') {
        const m = Models.partition(M, p.len);
        m.position.set(p.x, fy, p.z);
        m.rotation.y = p.rot;
        chunk.props.add(m);
        const hx = p.rot ? 0.04 : p.len / 2, hz = p.rot ? p.len / 2 : 0.04;
        chunk.boxes.push({ minX: p.x - hx, maxX: p.x + hx, minZ: p.z - hz, maxZ: p.z + hz, top: fy + 1.4, bottom: fy, on: true, chunk });
      } else if (p.type === 'desk') {
        const m = Models.desk(M);
        m.position.set(p.x, fy, p.z);
        m.rotation.y = p.rot;
        chunk.props.add(m);
        chunk.boxes.push({ minX: p.x - 0.65, maxX: p.x + 0.65, minZ: p.z - 0.33, maxZ: p.z + 0.33, top: fy + 0.78, bottom: fy, on: true, chunk });
      } else if (p.type === 'noclip') {
        const D = Models.NOCLIP[p.kind];
        const m = D.make(M);
        m.position.set(p.x, fy - p.sink, p.z);
        m.rotation.set(p.rx, p.yaw, p.rz, 'YXZ');
        chunk.props.add(m);
        for (const b of p.boxes) chunk.boxes.push({ minX: b[0], maxX: b[1], minZ: b[2], maxZ: b[3], top: fy + p.h, bottom: fy - 0.1, on: true, chunk });
      }
    }
    if (L.camp) this._buildCamp(chunk);
  }

  _addCabinet(chunk, p, fy) {
    const M = this.M;
    const V = {
      std: { cols: 1, rows: 3, w: 0.5, h: 1.05, d: 0.6, mat: M.metal },
      rusty: { cols: 1, rows: 3, w: 0.5, h: 1.05, d: 0.6, mat: M.rusty },
      double: { cols: 2, rows: 3, w: 1.0, h: 1.05, d: 0.6, mat: M.metal },
      sunk: { cols: 1, rows: 4, w: 0.5, h: 1.35, d: 0.6, mat: M.rusty },
      desk: { cols: 2, rows: 1, w: 0.9, h: 0.74, d: 0.55, mat: M.wood, wood: true },
      tall: { cols: 1, rows: 4, w: 0.5, h: 1.35, d: 0.6, mat: M.metal },
    }[p.variant || 'std'];
    const cab = Models.cabinetV(M, V);
    const g = cab.group;
    const back = V.d / 2 + 0.01;
    const px = p.x + Math.sin(p.rot) * back, pz = p.z + Math.cos(p.rot) * back;
    const sink = p.variant === 'sunk' ? 0.62 + p.tilt * 0.1 : 0;
    g.position.set(px, fy - sink, pz);
    g.rotation.y = p.rot;
    if (p.variant === 'sunk') { g.rotation.z = p.tilt * 0.22; g.rotation.x = -0.06; }
    chunk.props.add(g);
    const side = Math.abs(Math.sin(p.rot)) > 0.5;
    const hw = side ? V.d / 2 : V.w / 2, hd = side ? V.w / 2 : V.d / 2;
    chunk.boxes.push({ minX: px - hw, maxX: px + hw, minZ: pz - hd, maxZ: pz + hd, top: fy + V.h - sink, bottom: fy, on: true, chunk });
    g.updateMatrixWorld(true);
    const lootIdx = [];
    cab.drawers.forEach((dr, i) => {
      const wp = new THREE.Vector3(dr.x, dr.y, V.d / 2 + 0.03).applyMatrix4(g.matrixWorld);
      if (wp.y < fy + 0.1) return; // buried under the floor
      lootIdx.push(i);
    });
    // drawers that are buried don't get loot; hand their loot to visible ones
    const lootList = p.loot.slice();
    let li = 0;
    for (const i of lootIdx) {
      const dr = cab.drawers[i];
      const id = `${p.id}:d${i}`;
      const loot = lootList[li++] ?? null;
      const looted = this.state.looted.has(id);
      if (looted) dr.group.position.z = dr.slide;
      const wp = new THREE.Vector3(dr.x, dr.y, V.d / 2 + 0.03).applyMatrix4(g.matrixWorld);
      const it = {
        kind: 'drawer', id, loot, looted, rusty: p.variant === 'rusty', stuck: !!(p.stuck && p.stuck[i]),
        pos: wp, r: Math.min(0.2, (V.h / V.rows) * 0.55), chunk,
        open: () => {
          it.looted = true;
          this.state.looted.add(id);
          let t = 0;
          this.animated.add({ update: (dt) => { t = Math.min(1, t + dt * (it.rusty ? 1.8 : 3.2)); dr.group.position.z = dr.slide * (1 - Math.pow(1 - t, 3)); return t >= 1; } });
        },
        jiggle: () => {
          it.stuck = false;
          let t = 0;
          this.animated.add({ update: (dt) => { t += dt; dr.group.position.z = Math.abs(Math.sin(t * 40)) * 0.025 * (1 - t / 0.5); if (t >= 0.5) { dr.group.position.z = 0; return true; } return false; } });
        },
      };
      chunk.inter.push(it);
    }
  }

  _addBed(chunk, p) {
    const M = this.M;
    const b = Models.bed(M);
    b.group.position.set(p.x, 0, p.z);
    const sideways = !!p.rot;
    if (sideways) b.group.rotation.y = Math.PI / 2;
    chunk.props.add(b.group);
    const hx = sideways ? 0.5 : 1.0, hz = sideways ? 1.0 : 0.5;
    const box = { minX: p.x - hx, maxX: p.x + hx, minZ: p.z - hz, maxZ: p.z + hz, top: 0.57, bottom: 0, on: true, chunk, bed: true };
    chunk.boxes.push(box);
    const bed = {
      kind: 'bed', id: p.id, pos: new THREE.Vector3(p.x, 0.6, p.z), r: 1.0, chunk, model: b, box, sideways,
      squashed: this.state.squashed.has(p.id), trapped: false, hits: 0, awake: 0, shake: 0,
      setTrapped: (v) => {
        bed.trapped = v && !bed.squashed;
        b.trap.visible = bed.trapped;
        b.bulge.scale.set(0.62, 0.13, 0.33);
        b.limb.rotation.set(0, 0, 0);
        bed.hits = 0; bed.awake = 0;
      },
    };
    bed.setTrapped(this.isNight() && Math.random() < this.diff.trapChance);
    chunk.inter.push(bed);
    chunk.beds.push(bed);
    this.beds.add(bed);
    return bed;
  }

  spawnTestBed(x, z, rot) {
    const chunk = this.chunks.get(ck(Math.floor(x / CS), Math.floor(z / CS)));
    if (!chunk) return null;
    this._testBeds = (this._testBeds || 0) + 1;
    const bed = this._addBed(chunk, { x, z, rot, id: `test:bed${this._testBeds}` });
    this._addBox(bed.box);
    bed.setTrapped(true);
    return bed;
  }

  rectFree(minX, maxX, minZ, maxZ) {
    for (const [x, z] of [[minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ], [(minX + maxX) / 2, (minZ + maxZ) / 2]]) {
      if (!this.roomAt(x, z) || this.floorAt(x, z) !== 0 || this.kindAt(x, z) !== K_FLAT || !Number.isNaN(this.waterAt(x, z))) return false;
    }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const list = this.boxesNear(cx, cz, Math.max(maxX - minX, maxZ - minZ));
    for (const b of list) {
      if (!b.on || b.bottom > 2) continue;
      if (maxX > b.minX && minX < b.maxX && maxZ > b.minZ && minZ < b.maxZ) return false;
    }
    return true;
  }

  _buildCamp(chunk) {
    const M = this.M;
    const g = chunk.group;
    const portal = Models.portal(M);
    portal.group.position.set(12, 0, 4.2);
    g.add(portal.group);
    this.portal = portal;
    chunk.dispose.push(portal.group.children[2].material);
    chunk.boxes.push({ minX: 10.65, maxX: 11.0, minZ: 3.95, maxZ: 4.45, top: 3, bottom: 0, on: true, chunk });
    chunk.boxes.push({ minX: 13.0, maxX: 13.35, minZ: 3.95, maxZ: 4.45, top: 3, bottom: 0, on: true, chunk });
    chunk.inter.push({ kind: 'portal', id: 'portal', pos: new THREE.Vector3(12, 1.4, 4.2), r: 1.1, chunk });
    const tents = [[4.6, 6.2, 0.6, M.tentA], [19.4, 6.0, -0.6, M.tentB], [4.6, 18.6, Math.PI - 0.5, M.tentB], [19.4, 18.6, Math.PI + 0.5, M.tentA]];
    for (const [x, z, r, mat] of tents) {
      const t = Models.tent(M, mat);
      t.position.set(x, 0, z);
      t.rotation.y = r;
      g.add(t);
      chunk.boxes.push({ minX: x - 1.15, maxX: x + 1.15, minZ: z - 1.15, maxZ: z + 1.15, top: 1.5, bottom: 0, on: true, chunk });
    }
    const lan = [[8, 8.6], [16, 8.6], [7.6, 16.6], [16.6, 16.2], [12, 21.2], [21.5, 9.5]];
    for (const [x, z] of lan) {
      const l = Models.lantern(M);
      l.group.position.set(x, 0, z);
      g.add(l.group);
      chunk.boxes.push({ minX: x - 0.27, maxX: x + 0.27, minZ: z - 0.27, maxZ: z + 0.27, top: 0.8, bottom: 0, on: true, chunk });
      chunk.lights.push({ kind: 'lantern', x, y: 0.75, z, seed: x * 3.1 + z, b: -1, color: 0xffa860, intensity: 6, range: 12, weight: 3 });
    }
    const fire = Models.campfire(M);
    fire.group.position.set(12, 0, 12.4);
    g.add(fire.group);
    this.campfire = fire;
    chunk.boxes.push({ minX: 11.4, maxX: 12.6, minZ: 11.8, maxZ: 13.0, top: 0.75, bottom: 0, on: true, chunk });
    chunk.lights.push({ kind: 'fire', x: 12, y: 0.7, z: 12.4, seed: 5.5, b: -1, color: 0xff8a3a, intensity: 7, range: 11, weight: 4 });

    // crafting table (faces the fire)
    const wb = Models.workbench(M);
    wb.position.set(16.4, 0, 12.4);
    wb.rotation.y = -Math.PI / 2;
    g.add(wb);
    chunk.boxes.push({ minX: 15.95, maxX: 16.85, minZ: 11.6, maxZ: 13.2, top: 0.95, bottom: 0, on: true, chunk });
    chunk.inter.push({ kind: 'craft', id: 'craft', pos: new THREE.Vector3(16.0, 1.0, 12.4), r: 0.85, chunk });
    // storage chest
    const ch = Models.chest(M);
    ch.group.position.set(7.7, 0, 12.4);
    ch.group.rotation.y = Math.PI / 2;
    g.add(ch.group);
    this.campChest = ch;
    chunk.boxes.push({ minX: 7.4, maxX: 8.0, minZ: 11.9, maxZ: 12.9, top: 0.62, bottom: 0, on: true, chunk });
    chunk.inter.push({ kind: 'chest', id: 'chest', pos: new THREE.Vector3(8.0, 0.5, 12.4), r: 0.6, chunk });
  }

  unloadChunk(c) {
    this.root.remove(c.group);
    for (const d of c.dispose) d.dispose();
    for (const b of c.boxes) this._removeBox(b);
    for (const k of c.blockKeys) this.blockEdges.delete(k);
    for (const k of c.cellKeys) if (this.cellInfo.get(k)?.chunk === c) this.cellInfo.delete(k);
    for (const b of c.beds) this.beds.delete(b);
    for (const l of c.ladders) this.ladders.delete(l);
    for (const t of c.trees) this.trees.delete(t);
    if (c.vent) this.vents.delete(c.vent.id);
    if (c.layout.camp) { this.portal = null; this.campfire = null; this.campChest = null; }
    this.chunks.delete(c.key);
    this.chunkN.delete(c.nkey);
    if (this.onChunkUnloaded) this.onChunkUnloaded(c);
  }

  dispose() {
    for (const c of [...this.chunks.values()]) this.unloadChunk(c);
    this.scene.remove(this.root);
    for (const it of this.globalInter) if (it.mesh) this.scene.remove(it.mesh);
    this.globalInter.clear();
  }

  // ── collision ───────────────────────────────────────────────
  _addBox(b) {
    const x0 = Math.floor(b.minX / CELL), x1 = Math.floor(b.maxX / CELL);
    const z0 = Math.floor(b.minZ / CELL), z1 = Math.floor(b.maxZ / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = cellKey(x, z);
      let arr = this.boxHash.get(k);
      if (!arr) { arr = []; this.boxHash.set(k, arr); }
      arr.push(b);
    }
  }

  addBox(b) { this._addBox(b); }

  _removeBox(b) {
    const x0 = Math.floor(b.minX / CELL), x1 = Math.floor(b.maxX / CELL);
    const z0 = Math.floor(b.minZ / CELL), z1 = Math.floor(b.maxZ / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = cellKey(x, z);
      const arr = this.boxHash.get(k);
      if (!arr) continue;
      const i = arr.indexOf(b);
      if (i >= 0) arr.splice(i, 1);
      if (!arr.length) this.boxHash.delete(k);
    }
  }

  boxesNear(x, z, r) {
    const out = this._near;
    out.length = 0;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const arr = this.boxHash.get(cellKey(cx, cz));
      if (arr) for (let i = 0; i < arr.length; i++) out.push(arr[i]);
    }
    return out;
  }

  // Push a circle (x/z) out of all solid boxes taller than feetY+step.
  collide(pos, r, feetY, step = 0.3, entity = false, height = 1.7) {
    for (let iter = 0; iter < 2; iter++) {
      const list = this.boxesNear(pos.x, pos.z, r + 0.05);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b.on || b.top <= feetY + step || b.bottom > feetY + height) continue;
        const cx = pos.x < b.minX ? b.minX : pos.x > b.maxX ? b.maxX : pos.x;
        const cz = pos.z < b.minZ ? b.minZ : pos.z > b.maxZ ? b.maxZ : pos.z;
        const dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2), push = (r - d) / d;
          pos.x += dx * push; pos.z += dz * push;
        } else {
          const l = pos.x - b.minX, rr = b.maxX - pos.x, t = pos.z - b.minZ, bb = b.maxZ - pos.z;
          const m = Math.min(l, rr, t, bb);
          if (m === l) pos.x = b.minX - r; else if (m === rr) pos.x = b.maxX + r;
          else if (m === t) pos.z = b.minZ - r; else pos.z = b.maxZ + r;
        }
      }
    }
    if (entity) return;
    if (!this.cellInfo.has(cellKey(Math.floor(pos.x / CELL), Math.floor(pos.z / CELL)))) return false;
    return true;
  }

  // Ground height under a circle: the terrain plus any box top you're standing on.
  groundAt(x, z, r, feetY) {
    const rr = r * 0.7;
    let g = -Infinity;
    const pts = [[x, z], [x + rr, z], [x - rr, z], [x, z + rr], [x, z - rr]];
    for (const [px, pz] of pts) {
      const f = this.floorAt(px, pz);
      if (f <= feetY + 0.37 && f > g) g = f;
    }
    if (g === -Infinity) g = this.floorAt(x, z);
    const list = this.boxesNear(x, z, r);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b.on || b.top > feetY + 0.31 || b.top < g) continue;
      if (x + rr > b.minX && x - rr < b.maxX && z + rr > b.minZ && z - rr < b.maxZ && b.top > g) g = b.top;
    }
    return g;
  }

  // Is moving to (x,z) blocked by a ledge that's too high to step onto?
  terrainBlocked(x, z, r, feetY, step) {
    return this.floorMax(x, z, r * 0.85) > feetY + step;
  }

  ladderAt(x, z, feetY) {
    for (const l of this.ladders) if (x > l.minX && x < l.maxX && z > l.minZ && z < l.maxZ && feetY > l.y0 && feetY < l.y1 + 0.4) return l;
    return null;
  }

  bedUnder(x, z) {
    for (const bed of this.beds) {
      const b = bed.box;
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return bed;
    }
    return null;
  }

  // Exact segment-vs-box test over the cells the segment passes through (+ terrain).
  lineOfSight(ax, ay, az, bx, by, bz, endMargin = 0) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return true;
    const tEnd = (len - endMargin) / len;
    if (tEnd <= 0) return true;
    const stamp = (this._losStamp = (this._losStamp || 0) + 1);
    const steps = Math.ceil((len * tEnd) / 0.5);
    let lastKey = '';
    for (let i = 0; i <= steps; i++) {
      const t = Math.min(tEnd, (i * 0.5) / len);
      const sx = ax + dx * t, sz = az + dz * t;
      if (ay + dy * t < this.floorAt(sx, sz) - 0.05) return false;
      const k = cellKey(Math.floor(sx / CELL), Math.floor(sz / CELL));
      if (k === lastKey) continue;
      lastKey = k;
      const arr = this.boxHash.get(k);
      if (!arr) { if (!this.cellInfo.has(k)) return false; continue; }
      for (let j = 0; j < arr.length; j++) {
        const b = arr[j];
        if (!b.on || b._ls === stamp) continue;
        b._ls = stamp;
        let t0 = 0, t1 = tEnd;
        if (Math.abs(dx) < 1e-9) { if (ax < b.minX || ax > b.maxX) continue; }
        else {
          let ta = (b.minX - ax) / dx, tb = (b.maxX - ax) / dx;
          if (ta > tb) { const q = ta; ta = tb; tb = q; }
          if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
          if (t0 > t1) continue;
        }
        if (Math.abs(dz) < 1e-9) { if (az < b.minZ || az > b.maxZ) continue; }
        else {
          let ta = (b.minZ - az) / dz, tb = (b.maxZ - az) / dz;
          if (ta > tb) { const q = ta; ta = tb; tb = q; }
          if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
          if (t0 > t1) continue;
        }
        const y0 = ay + dy * t0, y1 = ay + dy * t1;
        if (Math.min(y0, y1) <= b.top && Math.max(y0, y1) >= b.bottom) return false;
      }
    }
    return true;
  }

  // Can a monster of radius r travel straight from a to b? (walls, ledges, holes)
  walkClear(ax, az, bx, bz, r) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    let lastH = this.floorAt(ax, az);
    for (let s = 0; s <= len; s += 0.3) {
      const t = len > 0 ? s / len : 0;
      const x = ax + dx * t, z = az + dz * t;
      if (this.isForbidden(x, z)) return false;
      const h = this.entFloor(x, z);
      if (h - lastH > 0.8 || lastH - h > 1.7) return false;
      lastH = h;
      const list = this.boxesNear(x, z, r);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b.on || b.top < h + 1 || b.bottom > h + 2) continue;
        if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return false;
      }
    }
    return true;
  }

  // floor height as monsters treat it (they wade through pools)
  entFloor(x, z) {
    const L = this._rt(x, z);
    if (!L) return 0;
    const i = this._rti;
    if (L.kind[i] === K_BASIN) return 0;
    return L.kind[i] === K_RAMP ? rampH(L.rdir[i], this._rtx, this._rtz) : L.h[i];
  }

  roomAt(x, z) { return this.cellInfo.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))); }
  isCamp(x, z) { const r = this.roomAt(x, z); return !!(r && r.camp); }
  isSafe(x, z) { const r = this.roomAt(x, z); return !!(r && (r.camp || r.safe)); }
  isForbidden(x, z) { const r = this.roomAt(x, z); return !r || r.camp || r.safe || this.holeAt(x, z); }

  _cellH(gx, gz) {
    const c = this.chunkN.get(nk(Math.floor(gx / N), Math.floor(gz / N)));
    if (!c) return 0;
    const L = c.layout, i = (gz - c.cz * N) * N + (gx - c.cx * N);
    if (L.kind[i] === K_BASIN) return 0;
    return L.kind[i] === K_RAMP ? SUNK / 2 : L.h[i];
  }

  // BFS on the cell grid for entities (avoids camp, saferooms, holes, ledges).
  findPath(sx, sz, tx, tz, maxNodes = 900, allowCamp = false) {
    const s0 = Math.floor(sx / CELL), s1 = Math.floor(sz / CELL);
    const t0 = Math.floor(tx / CELL), t1 = Math.floor(tz / CELL);
    if (s0 === t0 && s1 === t1) return [{ x: tx, z: tz }];
    const tk = cellKey(t0, t1);
    const tr = this.cellInfo.get(tk);
    if (!tr || tr.safe || (tr.camp && !allowCamp)) return null;
    const prev = new Map();
    const startK = cellKey(s0, s1);
    prev.set(startK, null);
    const q = [[s0, s1]];
    let head = 0, found = false;
    while (head < q.length && prev.size < maxNodes) {
      const [x, z] = q[head++];
      const k = cellKey(x, z);
      if (k === tk) { found = true; break; }
      const h0 = this._cellH(x, z);
      const nb = [
        [x + 1, z, `v:${x + 1}:${z}`], [x - 1, z, `v:${x}:${z}`],
        [x, z + 1, `h:${x}:${z + 1}`], [x, z - 1, `h:${x}:${z}`],
      ];
      for (const [nx, nz, ek] of nb) {
        const nkk = cellKey(nx, nz);
        if (prev.has(nkk) || this.blockEdges.has(ek)) continue;
        const r = this.cellInfo.get(nkk);
        if (!r || r.safe || (r.camp && !allowCamp)) continue;
        if (this.holeAt(nx * CELL + 1.5, nz * CELL + 1.5)) continue;
        const h1 = this._cellH(nx, nz);
        if (h1 - h0 > 0.8 || h0 - h1 > 1.7) continue;
        prev.set(nkk, k);
        q.push([nx, nz]);
      }
    }
    if (!found) return null;
    const path = [];
    let k = tk;
    while (k && k !== startK) {
      const [x, z] = k.split(',').map(Number);
      path.push({ x: x * CELL + CELL / 2, z: z * CELL + CELL / 2 });
      k = prev.get(k);
    }
    path.reverse();
    if (path.length) path[path.length - 1] = { x: tx, z: tz };
    return path;
  }

  // ── interaction ─────────────────────────────────────────────
  findInteractable(origin, dir, maxDist = 2.6, inVent = false) {
    let best = null, bestD = Infinity;
    const check = (it) => {
      if (it.disabled) return;
      if (!!it.inVent !== inVent) return;
      const vx = it.pos.x - origin.x, vy = it.pos.y - origin.y, vz = it.pos.z - origin.z;
      const t = vx * dir.x + vy * dir.y + vz * dir.z;
      if (t < 0 || t > maxDist + it.r) return;
      const px = vx - dir.x * t, py = vy - dir.y * t, pz = vz - dir.z * t;
      const perp2 = px * px + py * py + pz * pz;
      const rr = it.r + t * 0.06;
      if (perp2 > rr * rr) return;
      const score = t + Math.sqrt(perp2) * 1.5 / Math.max(0.3, it.r / 0.45);
      if (score < bestD && this.lineOfSight(origin.x, origin.y, origin.z, it.pos.x, it.pos.y, it.pos.z, 0.55)) { best = it; bestD = score; }
    };
    const pcx = Math.floor(origin.x / CS), pcz = Math.floor(origin.z / CS);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const c = this.chunks.get(ck(pcx + dx, pcz + dz));
      if (c) for (const it of c.inter) check(it);
    }
    for (const it of this.globalInter) check(it);
    return best;
  }

  removePickup(it) {
    it.disabled = true;
    if (it.onRemove) it.onRemove();
    if (it.id) this.state.taken.add(it.id);
    if (it.chunk) {
      it.mesh.parent?.remove(it.mesh);
      const i = it.chunk.inter.indexOf(it);
      if (i >= 0) it.chunk.inter.splice(i, 1);
    } else {
      this.scene.remove(it.mesh);
      this.globalInter.delete(it);
    }
  }

  addDynamicPickup(item, mesh, x, y, z) {
    const it = { kind: 'pickup', item, pos: new THREE.Vector3(x, y + 0.08, z), r: 0.45, mesh, chunk: null };
    this.globalInter.add(it);
    return it;
  }

  setBedTraps(night) {
    for (const b of this.beds) b.setTrapped(night && Math.random() < this.diff.trapChance);
  }

  // Find the nearest room of a type (test tool). Returns a world position.
  findRoomOfType(type, fromX, fromZ, maxR = 9) {
    const pcx = Math.floor(fromX / CS), pcz = Math.floor(fromZ / CS);
    for (let r = 0; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = pcx + dx, cz = pcz + dz;
        if (type === 'pool' && this.biome(cx, cz) !== 'pool') continue;
        const L = this._layout(cx, cz);
        for (const l of L.leaves) {
          if (l.type !== type) continue;
          // stand on a flat, dry cell of the room (or next to the ramp)
          let best = null;
          for (let x = l.x; x < l.x + l.w && !best; x++) for (let z = l.z; z < l.z + l.h && !best; z++) {
            const i = z * N + x;
            if (L.kind[i] === K_FLAT) best = [x, z];
          }
          if (l.ramp) {
            const e = l.ramp;
            const o = [[0, -1], [0, 1], [-1, 0], [1, 0]][e.dir];
            best = [e.x + o[0], e.z + o[1]];
          }
          if (!best) continue;
          return { x: cx * CS + best[0] * CELL + 1.5, z: cz * CS + best[1] * CELL + 1.5 };
        }
      }
    }
    return null;
  }

  // ── lighting ────────────────────────────────────────────────
  _lightValue(L, f, time, ents) {
    if (L.kind === 'lantern') return 0.94 + 0.06 * Math.sin(time * 2.3 + L.seed * 10);
    if (L.kind === 'fire') return 0.78 + 0.22 * hashFloat(Math.floor(time * 14), L.seed);
    if (L.kind === 'tree') return 0.75 + 0.25 * hashFloat(Math.floor(time * 1.3), 7);
    let v = f.day * (L.day === 'dead' ? 0 : 1) + f.night * (L.nightOn ? NIGHT_LIGHTS.level * (this.diff.nightLight ?? 1) : 0);
    if (v <= 0.001) return 0;
    let amt = 0;
    if (L.day === 'flicker' && f.day > 0.5) amt = 0.45;
    if (f.chaos > amt) amt = f.chaos;
    if (ents) {
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        const dx = e.x - L.x, dz = e.z - L.z, d2 = dx * dx + dz * dz;
        if (d2 < 81) { const a = 0.35 + 0.6 * (1 - Math.sqrt(d2) / 9); if (a > amt) amt = a; }
      }
    }
    if (amt > 0) { v *= flicker(time, L.seed, amt); L.amt = amt; } else L.amt = 0;
    return v;
  }

  updateLights(time, f, ents, playerPos) {
    const pcx = Math.floor(playerPos.x / CS), pcz = Math.floor(playerPos.z / CS);
    const lf = this._lastF;
    const global = !lf || f.chaos > 0 || lf.chaos > 0 || Math.abs(f.day - lf.day) > 1e-3 || Math.abs(f.night - lf.night) > 1e-3 || Math.abs(f.ambient - lf.ambient) > 1e-3;
    this._lastF = { day: f.day, night: f.night, chaos: f.chaos, ambient: f.ambient };
    const off = 0.03 + 0.32 * Math.min(1, f.ambient);
    const range = this.lightRange;
    const range2 = range * range;
    const cand = this._cand;
    cand.length = 0;
    let flickNear = 0, flickSum = 0, flickN = 0;
    for (const c of this.chunks.values()) {
      const cd = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      const near = cd <= 1;
      if (near || global || c.lightsDirty) {
        const force = c.lightsDirty || global;
        c.lightsDirty = false;
        let changed = false;
        for (let i = 0; i < c.lights.length; i++) {
          const L = c.lights[i];
          const b = this._lightValue(L, f, time, near ? ents : null);
          if (near && L.kind === 'panel' && L.day !== 'dead') { flickSum += b; flickN++; }
          if (force || Math.abs(b - L.b) > 0.01) {
            L.b = b;
            if (L.inst !== undefined && c.panels) {
              tmpColor.setRGB(off + (1 - off) * b, off + (0.97 - off) * b, off * 0.94 + (0.84 - off * 0.94) * b);
              c.panels.setColorAt(L.inst, tmpColor);
              changed = true;
            }
          }
        }
        if (changed) c.panels.instanceColor.needsUpdate = true;
      }
      if (cd > 2) continue;
      for (let i = 0; i < c.lights.length; i++) {
        const L = c.lights[i];
        if (L.b <= 0.03) continue;
        const dx = L.x - playerPos.x, dz = L.z - playerPos.z, d2 = dx * dx + dz * dz;
        if (d2 >= range2) continue;
        L.d2 = d2;
        L.score = (L.b * L.weight) / (d2 + 6);
        cand.push(L);
        if (L.amt > 0.3 && d2 < 64 && L.amt > flickNear) flickNear = L.amt;
      }
    }
    this.flickerNear = flickNear;
    // the baked light follows the average flicker near you during the power failure
    this.bakeFlicker = flickN && f.chaos > 0 ? flickSum / flickN / Math.max(0.05, f.day) : 1;
    cand.sort((a, b) => b.score - a.score);
    let env = f.ambient * 0.85;
    for (let i = 0; i < this.pool.length; i++) {
      const P = this.pool[i], L = cand[i];
      if (L) {
        const fade = Math.min(1, (range - Math.sqrt(L.d2)) / 7);
        P.position.set(L.x, L.y, L.z);
        P.color.setHex(L.color);
        P.intensity = L.b * L.intensity * fade;
        P.distance = L.kind === 'panel' && f.day < 0.5 ? L.range * NIGHT_LIGHTS.rangeMult : L.range;
        env += (L.b * L.intensity * fade * 0.09) / (1 + L.d2 * 0.18);
      } else P.intensity = 0;
    }
    this.envLight = env;
  }

  *rooms() {
    for (const c of this.chunks.values()) for (const r of c.rooms) yield r;
  }
}
