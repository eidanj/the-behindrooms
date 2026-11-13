// ─────────────────────────────────────────────────────────────
//  World: infinite chunked Backrooms maze.
//
//  • Each chunk (8×8 cells, 24 m) is generated deterministically from
//    (seed, chunkX, chunkZ) with a BSP room split, so unloading and
//    reloading a chunk rebuilds the exact same rooms.
//  • A chunk owns its south (z) and west (x) border walls; door gaps on
//    those borders come from a pure hash, so neighbours always agree.
//  • Walls/floor/ceiling of a chunk are merged into a few meshes.
//  • Chunks outside the load radius are disposed; chunks outside the
//    camera frustum are hidden (chunk-level frustum culling).
//  • Only a small pool of real PointLights exists; they are re-assigned
//    every frame to the most important ceiling lights near the player.
// ─────────────────────────────────────────────────────────────

import * as THREE from '../lib/three.module.min.js';
import { CELL, CHUNK_CELLS as N, CHUNK_SIZE as CS, WALL_H, WALL_T as T, DOOR_GAP, DOOR_H, NIGHT_LIGHTS } from './config.js';
import { hash32, mulberry32, shuffle, range, weighted, hashFloat } from './rng.js';
import { GeoBuilder } from './geo.js';
import * as Models from './models.js';

const ck = (cx, cz) => cx + ',' + cz;
export const cellKey = (x, z) => x + ',' + z;
const HG = DOOR_GAP / 2;
const tmpColor = new THREE.Color();
const tmpMat = new THREE.Matrix4();

function flicker(t, seed, amt) {
  const rate = 6 + amt * 22;
  const k = Math.floor(t * rate + seed * 31.7);
  const h = hashFloat(k, seed);
  if (h < amt * 0.5) return h < amt * 0.22 ? 0 : 0.3;
  const k2 = Math.floor(t * 1.3 + seed * 7.1);
  if (hashFloat(k2, seed + 3) < amt * 0.18) return 0.05;
  return 1 - 0.15 * amt * hashFloat(k + 1, seed);
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
    this.lightRange = opts.lightRange ?? 30;

    this.chunks = new Map();
    this.borderCache = new Map();
    this.boxHash = new Map();
    this.blockEdges = new Set();
    this.cellInfo = new Map();
    this.globalInter = new Set();
    this.beds = new Set();
    this.animated = new Set();
    this.state = { looted: new Set(), taken: new Set(), unlocked: new Set(), squashed: new Set() };
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
    // Build at most one chunk per frame (two if the player's neighbours are missing).
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
        // props (cabinets, beds, rocks…) only render when the chunk is within ~26 m — they're fogged out beyond that
        const b = c.bbox, dx = Math.max(b.min.x - px, 0, px - b.max.x), dz = Math.max(b.min.z - pz, 0, pz - b.max.z);
        c.props.visible = dx * dx + dz * dz < 26 * 26;
      }
    }
    // animations: drawers, doors
    for (const a of this.animated) {
      if (a.update(dt)) this.animated.delete(a);
    }
    if (this.campfire) {
      const f = this.campfire.flames;
      f.children.forEach((m, i) => {
        m.scale.y = (1 - i * 0.22) * (0.85 + 0.25 * Math.sin(time * (9 + i * 3) + i));
        m.rotation.y += dt * (1 + i);
      });
    }
    if (this.portal) this.portal.uniforms.uTime.value = time;
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

  // ── layout generation ───────────────────────────────────────
  borderLine(cx, cz, axis) {
    const key = axis + cx + ',' + cz;
    let m = this.borderCache.get(key);
    if (m) return m;
    const r = mulberry32(hash32(this.seed, cx, cz, axis === 'h' ? 11 : 13));
    const campLine = (cx === 0 && cz === 0) || (axis === 'h' && cx === 0 && cz === 1) || (axis === 'v' && cx === 1 && cz === 0);
    let count = 2 + Math.floor(r() * 3);
    if (campLine) count = Math.max(count, 3);
    m = new Map();
    for (const i of shuffle(range(N), r).slice(0, count)) m.set(i, campLine ? 'open' : r() < 0.5 ? 'door' : 'open');
    if (this.borderCache.size > 5000) this.borderCache.clear();
    this.borderCache.set(key, m);
    return m;
  }

  _bsp(rng, x, z, w, h, depth, leaves, edges) {
    const area = w * h;
    const stop = (w <= 2 && h <= 2) || depth >= 6 || (area <= 9 && rng() < 0.55) || (area <= 16 && rng() < 0.2);
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
    if (len >= 4 && rng() < 0.12) s = rng() < 0.5 ? 1 : len - 1; // occasional 1-cell corridor
    const span = vertical ? h : w;
    const openPlan = depth >= 2 && rng() < 0.1;
    const opens = new Map();
    if (!openPlan) {
      const count = Math.min(span, 1 + (rng() < 0.5 ? 1 : 0) + (span >= 5 && rng() < 0.35 ? 1 : 0));
      for (const i of shuffle(range(span), rng).slice(0, count)) opens.set(i, rng() < 0.55 ? 'door' : 'open');
    }
    for (let i = 0; i < span; i++) {
      const type = openPlan ? 'open' : opens.get(i) || 'wall';
      if (type === 'open') continue;
      edges.set(vertical ? `v:${x + s}:${z + i}` : `h:${x + i}:${z + s}`, type);
    }
    if (vertical) {
      this._bsp(rng, x, z, s, h, depth + 1, leaves, edges);
      this._bsp(rng, x + s, z, w - s, h, depth + 1, leaves, edges);
    } else {
      this._bsp(rng, x, z, w, s, depth + 1, leaves, edges);
      this._bsp(rng, x, z + s, w, h - s, depth + 1, leaves, edges);
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
    const rng = mulberry32(hash32(this.seed, cx, cz, 7));
    const edges = new Map();
    const leaves = [];
    const camp = cx === 0 && cz === 0;
    if (camp) leaves.push({ x: 0, z: 0, w: N, h: N, camp: true });
    else this._bsp(rng, 0, 0, N, N, 0, leaves, edges);

    const south = this.borderLine(cx, cz, 'h'), west = this.borderLine(cx, cz, 'v');
    for (let i = 0; i < N; i++) {
      const s = south.get(i); if (s !== 'open') edges.set(`h:${i}:0`, s || 'wall');
      const w = west.get(i); if (w !== 'open') edges.set(`v:0:${i}`, w || 'wall');
    }

    // Saferoom: a small room sealed except for one locked door.
    if (!camp && !this.menu && rng() < this.diff.saferoomChance) {
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
      if (l.camp || l.safe || l.w < 3 || l.h < 3 || rng() > 0.35) continue;
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

    const pillars = [];
    for (const l of leaves) {
      if (l.safe || l.camp || l.w < 3 || l.h < 3) continue;
      for (let vx = l.x + 1; vx < l.x + l.w; vx++) for (let vz = l.z + 1; vz < l.z + l.h; vz++) {
        if (rng() < 0.22) pillars.push([vx, vz]);
      }
    }

    const lights = [];
    for (const l of leaves) {
      const cells = [];
      for (let x = l.x; x < l.x + l.w; x++) for (let z = l.z; z < l.z + l.h; z++) cells.push([x, z]);
      // night: many rooms go completely dark, the rest keep 1 (rarely 2–3) dim lights
      const dark = !l.camp && rng() < NIGHT_LIGHTS.darkRoomChance;
      const k = dark ? 0 : Math.min(cells.length, 1 + (rng() < NIGHT_LIGHTS.extraLightChance ? 1 : 0) + (rng() < 0.06 ? 1 : 0));
      const nightSet = new Set(shuffle(cells.slice(), rng).slice(0, k).map((c) => c[0] + ',' + c[1]));
      for (const c of cells) {
        const r = rng();
        lights.push({
          lx: c[0], lz: c[1], room: l.idx,
          day: l.camp || this.menu ? 'ok' : r < 0.04 ? 'dead' : r < 0.1 ? 'flicker' : 'ok',
          nightOn: nightSet.has(c[0] + ',' + c[1]),
        });
      }
    }
    return { cx, cz, camp, edges, leaves, grid, pillars, lights };
  }

  // Candidate spots against walls inside a room (for cabinets/boxes).
  _wallSlots(L, l, rng) {
    const ox = L.cx * CS, oz = L.cz * CS;
    const off = T / 2 + 0.31;
    const slots = [];
    for (let i = 0; i < l.w; i++) {
      const x = l.x + i;
      const j = (rng() - 0.5) * 1.2;
      if (this._edgeType(L, 'h', x, l.z) === 'wall') slots.push({ x: ox + x * CELL + 1.5 + j, z: oz + l.z * CELL + off, rot: 0, cell: [x, l.z] });
      if (this._edgeType(L, 'h', x, l.z + l.h) === 'wall') slots.push({ x: ox + x * CELL + 1.5 + j, z: oz + (l.z + l.h) * CELL - off, rot: Math.PI, cell: [x, l.z + l.h - 1] });
    }
    for (let i = 0; i < l.h; i++) {
      const z = l.z + i;
      const j = (rng() - 0.5) * 1.2;
      if (this._edgeType(L, 'v', l.x, z) === 'wall') slots.push({ x: ox + l.x * CELL + off, z: oz + z * CELL + 1.5 + j, rot: Math.PI / 2, cell: [l.x, z] });
      if (this._edgeType(L, 'v', l.x + l.w, z) === 'wall') slots.push({ x: ox + (l.x + l.w) * CELL - off, z: oz + z * CELL + 1.5 + j, rot: -Math.PI / 2, cell: [l.x + l.w - 1, z] });
    }
    return shuffle(slots, rng);
  }

  _props(L) {
    const rng = mulberry32(hash32(this.seed, L.cx, L.cz, 99));
    const ox = L.cx * CS, oz = L.cz * CS;
    const d = this.diff;
    const props = [];
    const lootSum = d.loot.battery + d.loot.drink + d.loot.food + d.loot.key + d.loot.weapon;
    const loot = [['battery', d.loot.battery], ['drink', d.loot.drink], ['food', d.loot.food], ['key', d.loot.key], ['weapon', d.loot.weapon], [null, Math.max(0, 100 - lootSum)]];
    const rich = [['battery', 30], ['drink', 27], ['food', 25], ['key', 8], ['weapon', 10]];
    let ci = 0, ii = 0;
    const randPos = (l) => ({
      x: ox + l.x * CELL + 0.7 + rng() * (l.w * CELL - 1.4),
      z: oz + l.z * CELL + 0.7 + rng() * (l.h * CELL - 1.4),
    });
    if (L.camp) {
      props.push({ type: 'cabinet', x: 21.8, z: 12, rot: -Math.PI / 2, loot: 'food', id: 'camp:c0' });
      if (this.tutorial) {
        props.push({ type: 'rock', x: 13.6, z: 13.6, id: 'camp:k0' });
        props.push({ type: 'banana', x: 10.4, z: 13.6, id: 'camp:b0' });
      }
      return props;
    }
    if (this.menu) return props;
    for (const l of L.leaves) {
      const slots = this._wallSlots(L, l, rng);
      let bedCell = null;
      if (l.safe) {
        l.bed = rng() < 0.15;
        if (l.bed) {
          // farthest cell from the door
          const dx = l.door.axis === 'v' ? l.door.lx : l.door.lx + 0.5;
          const dz = l.door.axis === 'h' ? l.door.lz : l.door.lz + 0.5;
          let best = null, bd = -1;
          for (let x = l.x; x < l.x + l.w; x++) for (let z = l.z; z < l.z + l.h; z++) {
            const dd = (x + 0.5 - dx) ** 2 + (z + 0.5 - dz) ** 2;
            if (dd > bd) { bd = dd; best = [x, z]; }
          }
          bedCell = best;
          props.push({ type: 'bed', x: ox + best[0] * CELL + 1.5, z: oz + best[1] * CELL + 1.5, id: `${L.cx},${L.cz}:bed${l.idx}` });
        }
      }
      const free = slots.filter((s) => !bedCell || s.cell[0] !== bedCell[0] || s.cell[1] !== bedCell[1]);
      let nCab = 0;
      if (l.safe) nCab = l.bed ? 1 : 2;
      else {
        if (rng() < d.drawerChance) nCab++;
        if (l.w * l.h >= 6 && rng() < d.drawerChance * 0.35) nCab++;
      }
      for (let i = 0; i < nCab && free.length; i++) {
        const s = free.shift();
        props.push({ type: 'cabinet', x: s.x, z: s.z, rot: s.rot, loot: weighted(rng, l.safe ? rich : loot), id: `${L.cx},${L.cz}:c${ci++}` });
      }
      if (!l.safe && rng() < 0.14 && free.length) {
        const s = free.shift();
        props.push({ type: 'box', x: s.x, z: s.z, rot: s.rot + (rng() - 0.5) * 0.4, s: 0.45 + rng() * 0.2 });
      }
      const rockChance = (l.safe ? 0.6 : 0.3) * d.floorItemMult;
      if (rng() < rockChance) {
        const n = 1 + (rng() < 0.4 ? 1 : 0);
        for (let i = 0; i < n; i++) { const p = randPos(l); props.push({ type: 'rock', x: p.x, z: p.z, id: `${L.cx},${L.cz}:k${ii++}` }); }
      }
      if (rng() < 0.12 * d.floorItemMult) {
        const p = randPos(l);
        if (!bedCell) props.push({ type: 'banana', x: p.x, z: p.z, id: `${L.cx},${L.cz}:b${ii++}` });
      }
    }
    return props;
  }

  // ── building a chunk ────────────────────────────────────────
  loadChunk(cx, cz) {
    const L = this._layout(cx, cz);
    const ox = cx * CS, oz = cz * CS;
    const chunk = {
      cx, cz, key: ck(cx, cz),
      group: new THREE.Group(),
      props: new THREE.Group(),
      boxes: [], blockKeys: [], cellKeys: [], lights: [], inter: [], rooms: [], beds: [], dispose: [],
      bbox: new THREE.Box3(new THREE.Vector3(ox, -0.2, oz), new THREE.Vector3(ox + CS, WALL_H + 0.2, oz + CS)),
      lightsDirty: true,
      layout: L,
    };

    // rooms (world space)
    for (const l of L.leaves) {
      const room = {
        id: `${cx},${cz}:${l.idx}`, chunk,
        x0: ox + l.x * CELL, z0: oz + l.z * CELL, x1: ox + (l.x + l.w) * CELL, z1: oz + (l.z + l.h) * CELL,
        safe: !!l.safe, camp: !!l.camp, cells: [],
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
    this._buildStructure(chunk, L, ox, oz);
    this._buildLights(chunk, L, ox, oz);
    this._buildProps(chunk, L);

    for (const b of chunk.boxes) this._addBox(b);
    this.root.add(chunk.group);
    this.chunks.set(chunk.key, chunk);
    if (this.onChunkLoaded) this.onChunkLoaded(chunk);
    return chunk;
  }

  _buildStructure(chunk, L, ox, oz) {
    const M = this.M;
    const fb = new GeoBuilder(0.5, 0.5);
    fb.box(ox, ox + CS, -0.1, 0, oz, oz + CS, 'py');
    const cb = new GeoBuilder(1 / 1.2, 1 / 1.2, 0.3 / 1.2, 0.3 / 1.2);
    cb.box(ox, ox + CS, WALL_H, WALL_H + 0.1, oz, oz + CS, 'ny');
    const wb = new GeoBuilder(1 / 3, 1 / 3);
    const tb = new GeoBuilder(1, 1);
    const addWallBox = (x0, x1, z0, z1, y0 = 0, y1 = WALL_H, faces, collide = true) => {
      wb.box(x0, x1, y0, y1, z0, z1, faces);
      if (collide) chunk.boxes.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: y1, bottom: y0, on: true, chunk });
    };
    const doorFrame = (axis, a, line, isSafe, edge) => {
      // a = start coordinate along the line, line = fixed coordinate
      const mid = a + CELL / 2;
      if (axis === 'h') {
        addWallBox(a - T / 2, mid - HG, line - T / 2, line + T / 2);
        addWallBox(mid + HG, a + CELL + T / 2, line - T / 2, line + T / 2);
        wb.box(mid - HG, mid + HG, DOOR_H, WALL_H, line - T / 2, line + T / 2, 'nz pz ny');
        const tz0 = line - T / 2 - 0.03, tz1 = line + T / 2 + 0.03;
        tb.box(mid - HG - 0.07, mid - HG + 0.02, 0, DOOR_H + 0.07, tz0, tz1, 'nx px nz pz');
        tb.box(mid + HG - 0.02, mid + HG + 0.07, 0, DOOR_H + 0.07, tz0, tz1, 'nx px nz pz');
        tb.box(mid - HG - 0.07, mid + HG + 0.07, DOOR_H - 0.02, DOOR_H + 0.07, tz0, tz1, 'nz pz ny');
      } else {
        addWallBox(line - T / 2, line + T / 2, a - T / 2, mid - HG);
        addWallBox(line - T / 2, line + T / 2, mid + HG, a + CELL + T / 2);
        wb.box(line - T / 2, line + T / 2, DOOR_H, WALL_H, mid - HG, mid + HG, 'nx px ny');
        const tx0 = line - T / 2 - 0.03, tx1 = line + T / 2 + 0.03;
        tb.box(tx0, tx1, 0, DOOR_H + 0.07, mid - HG - 0.07, mid - HG + 0.02, 'nx px nz pz');
        tb.box(tx0, tx1, 0, DOOR_H + 0.07, mid + HG - 0.02, mid + HG + 0.07, 'nx px nz pz');
        tb.box(tx0, tx1, DOOR_H - 0.02, DOOR_H + 0.07, mid - HG - 0.07, mid + HG + 0.07, 'nx px ny');
      }
      if (isSafe) this._saferoomDoor(chunk, axis, mid, line, edge);
    };

    // horizontal lines (constant z)
    for (let lz = 0; lz < N; lz++) {
      const line = oz + lz * CELL;
      let run = -1;
      for (let lx = 0; lx <= N; lx++) {
        const t = lx < N ? L.edges.get(`h:${lx}:${lz}`) : undefined;
        if (t === 'wall') { if (run < 0) run = lx; }
        else {
          if (run >= 0) { addWallBox(ox + run * CELL - T / 2, ox + lx * CELL + T / 2, line - T / 2, line + T / 2); run = -1; }
          if (t === 'door' || t === 'sdoor') doorFrame('h', ox + lx * CELL, line, t === 'sdoor', { lx, lz });
        }
        if (t === 'wall' || t === 'sdoor') chunk.blockKeys.push(`h:${L.cx * N + lx}:${L.cz * N + lz}`);
      }
    }
    // vertical lines (constant x)
    for (let lx = 0; lx < N; lx++) {
      const line = ox + lx * CELL;
      let run = -1;
      for (let lz = 0; lz <= N; lz++) {
        const t = lz < N ? L.edges.get(`v:${lx}:${lz}`) : undefined;
        if (t === 'wall') { if (run < 0) run = lz; }
        else {
          if (run >= 0) { addWallBox(line - T / 2, line + T / 2, oz + run * CELL - T / 2, oz + lz * CELL + T / 2); run = -1; }
          if (t === 'door' || t === 'sdoor') doorFrame('v', oz + lz * CELL, line, t === 'sdoor', { lx, lz });
        }
        if (t === 'wall' || t === 'sdoor') chunk.blockKeys.push(`v:${L.cx * N + lx}:${L.cz * N + lz}`);
      }
    }
    for (const k of chunk.blockKeys) this.blockEdges.add(k);

    // pillars
    for (const [vx, vz] of L.pillars) {
      const x = ox + vx * CELL, z = oz + vz * CELL;
      addWallBox(x - 0.25, x + 0.25, z - 0.25, z + 0.25);
    }

    const add = (builder, mat) => {
      if (builder.empty) return null;
      const g = builder.build();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      m.castShadow = mat === M.wall || mat === M.trim;
      chunk.group.add(m);
      chunk.dispose.push(g);
      return m;
    };
    add(fb, M.floor).castShadow = false;
    add(cb, M.ceiling).castShadow = false;
    add(wb, M.wall);
    add(tb, M.trim);
  }

  _saferoomDoor(chunk, axis, mid, line, edge) {
    const id = `${chunk.cx},${chunk.cz}:door${edge.lx},${edge.lz}${axis}`;
    const leaf = chunk.layout.leaves.find((l) => l.safe);
    const side = leaf && leaf.door ? leaf.door.side : 1;
    const { pivot, leds } = Models.saferoomDoor(this.M, DOOR_GAP);
    const unlocked = this.state.unlocked.has(id);
    let base, sgn;
    // swing the door into the saferoom
    if (axis === 'h') { pivot.position.set(mid - HG, 0, line); base = 0; sgn = -side; }
    else { pivot.position.set(line, 0, mid - HG); base = -Math.PI / 2; sgn = side; }
    const open = base + sgn * 1.45;
    pivot.rotation.y = unlocked ? open : base;
    chunk.props.add(pivot);
    const box = axis === 'h'
      ? { minX: mid - HG, maxX: mid + HG, minZ: line - 0.06, maxZ: line + 0.06, top: WALL_H, bottom: 0, on: !unlocked, chunk }
      : { minX: line - 0.06, maxX: line + 0.06, minZ: mid - HG, maxZ: mid + HG, top: WALL_H, bottom: 0, on: !unlocked, chunk };
    chunk.boxes.push(box);
    if (unlocked) for (const l of leds) l.material = this.M.ledGreen;
    const pos = axis === 'h' ? new THREE.Vector3(mid, 1.2, line) : new THREE.Vector3(line, 1.2, mid);
    const door = {
      kind: 'sdoor', id, pos, r: 0.9, unlocked, pivot, leds, box, chunkKey: chunk.key,
      // the walkable spot just outside the door (used by the saferoom guide)
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
        color: 0xfff1cf, intensity: 7.5, range: 10.5, weight: 1,
      });
    });
    panels.instanceMatrix.needsUpdate = true;
    panels.computeBoundingSphere();
    chunk.group.add(panels);
    chunk.panels = panels;
    chunk.dispose.push(panels);
  }

  _buildProps(chunk, L) {
    const M = this.M;
    const props = this._props(L);
    for (const p of props) {
      if (p.type === 'cabinet') this._addCabinet(chunk, p);
      else if (p.type === 'rock' || p.type === 'banana') {
        if (this.state.taken.has(p.id)) continue;
        const mesh = p.type === 'rock' ? Models.rock(M, hash32(p.id.length, Math.floor(p.x * 10))) : Models.bananaPeel(M);
        mesh.position.set(p.x, p.type === 'rock' ? 0.05 : 0.01, p.z);
        mesh.rotation.y = (p.x * 7.3) % 6.28;
        chunk.props.add(mesh);
        const it = { kind: 'pickup', item: p.type, id: p.id, pos: new THREE.Vector3(p.x, 0.1, p.z), r: 0.45, mesh, chunk };
        chunk.inter.push(it);
      } else if (p.type === 'bed') this._addBed(chunk, p);
      else if (p.type === 'box') {
        const m = Models.cardboardBox(M, p.s);
        m.position.set(p.x, p.s * 0.4, p.z);
        m.rotation.y = p.rot;
        chunk.props.add(m);
        const h = p.s * 0.5;
        chunk.boxes.push({ minX: p.x - h, maxX: p.x + h, minZ: p.z - h, maxZ: p.z + h, top: p.s * 0.8, bottom: 0, on: true, chunk });
      }
    }
    if (L.camp) this._buildCamp(chunk);
  }

  _addCabinet(chunk, p) {
    const M = this.M;
    const { group, drawer } = Models.cabinet(M);
    group.position.set(p.x, 0, p.z);
    group.rotation.y = p.rot;
    chunk.props.add(group);
    const sideways = Math.abs(Math.sin(p.rot)) > 0.5;
    const hw = sideways ? 0.3 : 0.25, hd = sideways ? 0.25 : 0.3;
    chunk.boxes.push({ minX: p.x - hw, maxX: p.x + hw, minZ: p.z - hd, maxZ: p.z + hd, top: 1.05, bottom: 0, on: true, chunk });
    const looted = this.state.looted.has(p.id);
    if (looted) drawer.position.z = 0.4;
    const fx = Math.sin(p.rot), fz = Math.cos(p.rot);
    const it = {
      kind: 'drawer', id: p.id, loot: p.loot, looted,
      pos: new THREE.Vector3(p.x + fx * 0.32, 0.85, p.z + fz * 0.32), r: 0.42, chunk,
      open: () => {
        it.looted = true;
        this.state.looted.add(p.id);
        let t = 0;
        this.animated.add({ update: (dt) => { t = Math.min(1, t + dt * 3.2); drawer.position.z = 0.4 * (1 - Math.pow(1 - t, 3)); return t >= 1; } });
      },
    };
    chunk.inter.push(it);
  }

  _addBed(chunk, p) {
    const M = this.M;
    const b = Models.bed(M);
    b.group.position.set(p.x, 0, p.z);
    chunk.props.add(b.group);
    const box = { minX: p.x - 1.0, maxX: p.x + 1.0, minZ: p.z - 0.5, maxZ: p.z + 0.5, top: 0.57, bottom: 0, on: true, chunk, bed: true };
    chunk.boxes.push(box);
    const bed = {
      kind: 'bed', id: p.id, pos: new THREE.Vector3(p.x, 0.6, p.z), r: 1.0, chunk, model: b, box,
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
  }

  _buildCamp(chunk) {
    const M = this.M;
    const g = chunk.group;
    // portal
    const portal = Models.portal(M);
    portal.group.position.set(12, 0, 4.2);
    g.add(portal.group);
    this.portal = portal;
    chunk.dispose.push(portal.group.children[2].material);
    chunk.boxes.push({ minX: 10.65, maxX: 11.0, minZ: 3.95, maxZ: 4.45, top: 3, bottom: 0, on: true, chunk });
    chunk.boxes.push({ minX: 13.0, maxX: 13.35, minZ: 3.95, maxZ: 4.45, top: 3, bottom: 0, on: true, chunk });
    chunk.inter.push({ kind: 'portal', id: 'portal', pos: new THREE.Vector3(12, 1.4, 4.2), r: 1.1, chunk });
    // tents
    const tents = [[4.6, 6.2, 0.6, M.tentA], [19.4, 6.0, -0.6, M.tentB], [4.6, 18.6, Math.PI - 0.5, M.tentB], [19.4, 18.6, Math.PI + 0.5, M.tentA]];
    for (const [x, z, r, mat] of tents) {
      const t = Models.tent(M, mat);
      t.position.set(x, 0, z);
      t.rotation.y = r;
      g.add(t);
      chunk.boxes.push({ minX: x - 1.15, maxX: x + 1.15, minZ: z - 1.15, maxZ: z + 1.15, top: 1.5, bottom: 0, on: true, chunk });
    }
    // lanterns
    const lan = [[8, 8.6], [16, 8.6], [7.6, 16.6], [16.6, 16.2], [12, 21.2], [21.5, 9.5]];
    for (const [x, z] of lan) {
      const l = Models.lantern(M);
      l.group.position.set(x, 0, z);
      g.add(l.group);
      chunk.boxes.push({ minX: x - 0.27, maxX: x + 0.27, minZ: z - 0.27, maxZ: z + 0.27, top: 0.8, bottom: 0, on: true, chunk });
      chunk.lights.push({ kind: 'lantern', x, y: 0.75, z, seed: x * 3.1 + z, b: -1, color: 0xffa860, intensity: 6, range: 12, weight: 3 });
    }
    // campfire
    const fire = Models.campfire(M);
    fire.group.position.set(12, 0, 12.4);
    g.add(fire.group);
    this.campfire = fire;
    chunk.boxes.push({ minX: 11.4, maxX: 12.6, minZ: 11.8, maxZ: 13.0, top: 0.75, bottom: 0, on: true, chunk });
    chunk.lights.push({ kind: 'fire', x: 12, y: 0.7, z: 12.4, seed: 5.5, b: -1, color: 0xff8a3a, intensity: 7, range: 11, weight: 4 });
  }

  unloadChunk(c) {
    this.root.remove(c.group);
    for (const d of c.dispose) d.dispose();
    for (const b of c.boxes) this._removeBox(b);
    for (const k of c.blockKeys) this.blockEdges.delete(k);
    for (const k of c.cellKeys) if (this.cellInfo.get(k)?.chunk === c) this.cellInfo.delete(k);
    for (const b of c.beds) this.beds.delete(b);
    if (c.layout.camp) { this.portal = null; this.campfire = null; }
    this.chunks.delete(c.key);
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
  collide(pos, r, feetY, step = 0.3, entity = false) {
    for (let iter = 0; iter < 2; iter++) {
      const list = this.boxesNear(pos.x, pos.z, r + 0.05);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b.on || b.top <= feetY + step || b.bottom > feetY + 1.7) continue;
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
    // never let the player walk into an unloaded cell
    if (!this.cellInfo.has(cellKey(Math.floor(pos.x / CELL), Math.floor(pos.z / CELL)))) return false;
    return true;
  }

  groundAt(x, z, r, feetY) {
    let g = 0;
    const list = this.boxesNear(x, z, r);
    const rr = r * 0.7;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b.on || b.top > feetY + 0.31) continue;
      if (x + rr > b.minX && x - rr < b.maxX && z + rr > b.minZ && z - rr < b.maxZ && b.top > g) g = b.top;
    }
    return g;
  }

  bedUnder(x, z) {
    for (const bed of this.beds) {
      const b = bed.box;
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return bed;
    }
    return null;
  }

  // Exact segment-vs-box test over the cells the segment passes through.
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
      const k = cellKey(Math.floor((ax + dx * t) / CELL), Math.floor((az + dz * t) / CELL));
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

  // Can a circle of radius r travel straight from a to b?
  walkClear(ax, az, bx, bz, r) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    for (let s = 0; s <= len; s += 0.3) {
      const t = len > 0 ? s / len : 0;
      const x = ax + dx * t, z = az + dz * t;
      if (this.isForbidden(x, z)) return false;
      const list = this.boxesNear(x, z, r);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b.on || b.top < 1) continue;
        if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return false;
      }
    }
    return true;
  }

  roomAt(x, z) { return this.cellInfo.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))); }
  isCamp(x, z) { const r = this.roomAt(x, z); return !!(r && r.camp); }
  isSafe(x, z) { const r = this.roomAt(x, z); return !!(r && (r.camp || r.safe)); }
  isForbidden(x, z) { const r = this.roomAt(x, z); return !r || r.camp || r.safe; }

  // BFS on the cell grid for entities (avoids camp + saferooms).
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
      const nb = [
        [x + 1, z, `v:${x + 1}:${z}`], [x - 1, z, `v:${x}:${z}`],
        [x, z + 1, `h:${x}:${z + 1}`], [x, z - 1, `h:${x}:${z}`],
      ];
      for (const [nx, nz, ek] of nb) {
        const nk = cellKey(nx, nz);
        if (prev.has(nk) || this.blockEdges.has(ek)) continue;
        const r = this.cellInfo.get(nk);
        if (!r || r.safe || (r.camp && !allowCamp)) continue;
        prev.set(nk, k);
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
  findInteractable(origin, dir, maxDist = 2.6) {
    let best = null, bestD = Infinity;
    const check = (it) => {
      if (it.disabled) return;
      const vx = it.pos.x - origin.x, vy = it.pos.y - origin.y, vz = it.pos.z - origin.z;
      const t = vx * dir.x + vy * dir.y + vz * dir.z;
      if (t < 0 || t > maxDist + it.r) return;
      const px = vx - dir.x * t, py = vy - dir.y * t, pz = vz - dir.z * t;
      const perp2 = px * px + py * py + pz * pz;
      const rr = it.r + t * 0.06;
      if (perp2 > rr * rr) return;
      const score = t + Math.sqrt(perp2) * 1.5;
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

  // ── lighting ────────────────────────────────────────────────
  _lightValue(L, f, time, ents) {
    if (L.kind === 'lantern') return 0.94 + 0.06 * Math.sin(time * 2.3 + L.seed * 10);
    if (L.kind === 'fire') return 0.78 + 0.22 * hashFloat(Math.floor(time * 14), L.seed);
    let v = f.day * (L.day === 'dead' ? 0 : 1) + f.night * (L.nightOn ? NIGHT_LIGHTS.level : 0);
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
    const range = this.lightRange;      // how far away real lights get switched on
    const range2 = range * range;
    const cand = this._cand;
    cand.length = 0;
    let flickNear = 0;
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
          if (force || Math.abs(b - L.b) > 0.01) {
            L.b = b;
            if (L.inst !== undefined) {
              tmpColor.setRGB(off + (1 - off) * b, off + (0.97 - off) * b, off * 0.94 + (0.84 - off * 0.94) * b);
              c.panels.setColorAt(L.inst, tmpColor);
              changed = true;
            }
          }
        }
        if (changed) c.panels.instanceColor.needsUpdate = true;
      }
      // candidates for the real point-light pool
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
    cand.sort((a, b) => b.score - a.score);
    let env = f.ambient * 0.85;
    for (let i = 0; i < this.pool.length; i++) {
      const P = this.pool[i], L = cand[i];
      if (L) {
        // fade lights in over the last 6 m of range so they don't pop on
        const fade = Math.min(1, (range - Math.sqrt(L.d2)) / 6);
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
