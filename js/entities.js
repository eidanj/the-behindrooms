// ─────────────────────────────────────────────────────────────
//  Entities: tall, skinny, blind creatures that hunt by sound.
//   Day   – very rare (1/50 per room); slowly, passively follow you.
//   Night – common; with line-of-sight they sprint 5–10% faster than
//           your walk speed. Break LOS for 20 s to escape (+1 ★).
//  Far-away entities idle (no AI, no animation) to save CPU.
// ─────────────────────────────────────────────────────────────

import * as THREE from '../lib/three.module.min.js';
import { ENTITY, HEARING, FT, PLAYER, CHASE_ESCAPE_SECONDS, CELL } from './config.js';
import { lerp, shuffle } from './rng.js';
import * as Models from './models.js';

const NAMES = ['The Hollow', 'The Breather', 'The Long Man', 'The Listener', 'The Thin One', 'The Stalker', 'The Tall Guest', 'The Quiet Father'];
const tmp = new THREE.Vector3();

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

class Entity {
  constructor(mgr, x, z, day) {
    this.mgr = mgr;
    const g = mgr.game;
    this.model = Models.creature(g.mats);
    this.root = this.model.root;
    // per-entity skin material so hits can flash red on just this monster
    this.skinMat = g.mats.skin.clone();
    this.root.traverse((o) => { if (o.isMesh && o.material === g.mats.skin) o.material = this.skinMat; });
    this.maxHp = mgr.diff.entityHp || 120;
    this.hp = this.maxHp;
    this.flash = 0;
    this.stagger = 0; this.staggerMax = 1; this.kbx = 0; this.kbz = 0;
    this.killed = false; this.killT = 0;
    this.enraged = false;
    this.root.position.set(x, 0, z);
    this.pos = this.root.position;
    this.yaw = Math.random() * Math.PI * 2;
    this.name = NAMES[Math.floor(Math.random() * NAMES.length)];
    this.acuity = mgr.diff.id === 'hard' ? 0.35 + Math.random() * 0.65 : Math.random();
    this.chaseMult = lerp(ENTITY.chaseSpeedMin, ENTITY.chaseSpeedMax, Math.random());
    const s = 0.94 + Math.random() * 0.12;
    this.root.scale.set(s, s, s);
    this.mode = 'wander';
    this.dayBorn = day;
    this.noticed = false;
    this.chasing = false;
    this.lostTimer = 0;
    this.lastKnown = new THREE.Vector3(x, 0, z);
    this.reachedLast = false;
    this.heard = null;
    this.ignoreUntil = 0;
    this.path = null; this.pathKey = ''; this.repath = 0; this.forcePath = 0;
    this.stun = 0; this.stunMax = 1;
    this.walkPhase = Math.random() * 6;
    this.speed = 0;
    this.los = false; this.losTimer = Math.random() * 0.2; this.directClear = true;
    this.wanderTarget = null; this.idle = Math.random() * 2;
    this.blocked = 0;
    this.breather = null;
    this.dying = false; this.dead = false;
    this.twitch = 0; this.twitchT = 1 + Math.random() * 3;
    this.dist = 99;
    this.lastSin = 0;
  }

  hear(x, z) {
    if (this.mode === 'chase') return;
    this.heard = { x, z };
    this.noticed = true;
  }

  // returns true if this hit killed it
  takeHit(dmg, fromX, fromZ, stagger, kb) {
    if (this.killed) return false;
    this.hp -= dmg;
    this.flash = 0.3;
    this.noticed = true;
    if (this.hp <= 0) { this.die(); return true; }
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, d = Math.hypot(dx, dz) || 1;
    const v = kb / (stagger * 0.6);
    this.kbx = (dx / d) * v; this.kbz = (dz / d) * v;
    this.stagger = Math.max(this.stagger, stagger); this.staggerMax = this.stagger;
    this.path = null;
    return false;
  }

  die() {
    this.killed = true;
    this.killT = 0;
    this.chasing = false;
    this.mode = 'dead';
    this.stagger = 0;
    this.stun = 0;
    this.mgr.game.audio.monsterDeath(this.pos);
  }

  trip(seconds) {
    if (this.stun > 0) return;
    this.stun = seconds; this.stunMax = seconds;
    this.path = null;
    this.mgr.game.audio.fallThud(this.pos);
  }

  update(dt, ctx) {
    const P = ctx.player, W = ctx.world, A = ctx.audio;
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    this.dist = dist;

    if (this.flash > 0) { this.flash -= dt; this.skinMat.emissive.setRGB(Math.max(0, this.flash) * 2.2, 0, 0); }

    // breathing audio (only for nearby entities)
    if (dist < 30 && !this.breather && !this.dying && !this.killed) this.breather = A.createBreather(this.pos);
    else if ((dist > 34 || this.dying || this.killed) && this.breather) { A.releaseBreather(this.breather); this.breather = null; }

    if (this.killed) {
      this.killT += dt;
      const m = this.model, k = Math.min(1, this.killT / 0.45);
      m.body.rotation.x = -Math.PI / 2 * k * k;
      m.body.position.y = 0.12 * k;
      m.arms[0].sh.rotation.x = lerp(m.arms[0].sh.rotation.x, -2.6, Math.min(1, dt * 6));
      m.arms[1].sh.rotation.x = lerp(m.arms[1].sh.rotation.x, -2.9, Math.min(1, dt * 6));
      m.head.rotation.z = lerp(m.head.rotation.z, 0.6, Math.min(1, dt * 4));
      if (this.killT > 4) { this.pos.y -= dt * 0.6; if (this.pos.y < -0.8) this.dead = true; }
      return;
    }
    if (this.breather) {
      A.moveBreather(this.breather, this.pos.x, 2.2, this.pos.z);
      this.breather.rate = this.mode === 'chase' ? 1.9 : this.mode === 'search' ? 1.45 : 1;
      this.breather.intensity = this.mode === 'chase' ? 1.3 : 0.9;
    }

    if (this.dying) {
      this.pos.y -= dt * 1.4;
      this.model.body.rotation.z += dt * 0.6;
      if (this.pos.y < -2.9) this.dead = true;
      return;
    }

    // idle when far away (performance)
    if (dist > 44 && !this.chasing) return;

    if (this.stun > 0) {
      this.stun -= dt;
      this._animStun();
      return;
    }

    // staggered by a hit: knocked back, can't attack
    if (this.stagger > 0) {
      this.stagger -= dt;
      const k = Math.max(0, this.stagger / this.staggerMax);
      tmp.set(this.pos.x + this.kbx * k * dt, 0, this.pos.z + this.kbz * k * dt);
      W.collide(tmp, 0.33, 0, 0.3, true);
      if (!W.isForbidden(tmp.x, tmp.z)) { this.pos.x = tmp.x; this.pos.z = tmp.z; }
      const m = this.model;
      m.spine.rotation.x = lerp(m.spine.rotation.x, -0.35, Math.min(1, dt * 14));
      m.head.rotation.x = lerp(m.head.rotation.x, 0.5, Math.min(1, dt * 14));
      m.arms[0].sh.rotation.x = lerp(m.arms[0].sh.rotation.x, -1.6, Math.min(1, dt * 12));
      m.arms[1].sh.rotation.x = lerp(m.arms[1].sh.rotation.x, -1.3, Math.min(1, dt * 12));
      this.yaw = lerpAngle(this.yaw, Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z), Math.min(1, dt * 6));
      this.root.rotation.y = this.yaw;
      this.speed = 0;
      return;
    }

    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.12 + Math.random() * 0.08;
      this.los = dist < 32 && W.lineOfSight(this.pos.x, 2.25, this.pos.z, P.pos.x, P.pos.y + 1.5, P.pos.z);
    }

    const safe = P.inSafe;
    let target = null, speed = 0, direct = false, face = null;
    const diff = this.mgr.diff;

    if (ctx.night || this.enraged) {
      const range = (P.flashlightOn || !ctx.night ? ENTITY.sightRangeLit : ENTITY.sightRangeDark) * diff.sightMult;
      const sees = this.los && dist < range && !safe && !P.dead && ctx.huntable;
      const chaseSpeed = PLAYER.walkSpeed * this.chaseMult * diff.entitySpeedMult;
      if (sees) {
        if (!this.chasing) { this.chasing = true; ctx.onChaseStart(this); }
        this.lostTimer = 0;
        this.mode = 'chase';
        this.lastKnown.set(P.pos.x, 0, P.pos.z);
        this.reachedLast = false;
        target = this.lastKnown; speed = chaseSpeed; direct = true;
      } else if (this.chasing) {
        this.lostTimer += dt;
        if (this.lostTimer >= CHASE_ESCAPE_SECONDS) {
          this.chasing = false;
          this.mode = 'wander';
          this.ignoreUntil = ctx.time + 25;
          this.heard = null;
          ctx.onEscape(this);
        } else {
          this.mode = 'search';
          if (!this.reachedLast) { target = this.lastKnown; speed = chaseSpeed * 0.92; }
          else if (this.heard) { target = this.heard; speed = ENTITY.investigateSpeed * 1.3; }
          else this._wander(dt, W, 1.2);
        }
      } else if (this.heard && ctx.time > this.ignoreUntil) {
        this.mode = 'investigate';
        target = this.heard; speed = ENTITY.investigateSpeed;
      } else {
        this.mode = 'wander';
        this._wander(dt, W, ENTITY.wanderSpeed);
      }
      if (!P.dead && !safe && dist < ENTITY.killRange && this.los && ctx.huntable && P.pos.y < 1.2) ctx.onCatch(this);
    } else {
      if (!this.noticed && (dist < 14 || this.heard)) this.noticed = true;
      if (this.noticed && dist < 50) {
        this.mode = 'follow';
        if (dist > 5 && !safe) { target = P.pos; speed = ENTITY.followSpeed * diff.entitySpeedMult; }
        else face = P.pos;
        this.heard = null;
      } else {
        this.mode = 'wander';
        this._wander(dt, W, ENTITY.wanderSpeed * 0.8);
      }
    }

    if (target) {
      const arrived = this._moveTo(target, speed, dt, W, direct);
      if (arrived) {
        if (this.mode === 'search') { if (!this.reachedLast) this.reachedLast = true; else this.heard = null; }
        if (this.mode === 'investigate') { this.heard = null; this.idle = 1.5 + Math.random() * 2; }
      }
    } else if (!this.wanderTarget) {
      this.speed *= 0.8;
    }
    if (face) {
      this.yaw = lerpAngle(this.yaw, Math.atan2(face.x - this.pos.x, face.z - this.pos.z), Math.min(1, dt * 3));
      this.speed *= 0.85;
    }

    // keep entities from overlapping each other
    for (const o of this.mgr.list) {
      if (o === this || o.dying || o.killed) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z, d2 = ox * ox + oz * oz;
      if (d2 < 0.64 && d2 > 1e-6) { const d = Math.sqrt(d2), p = (0.8 - d) * 0.5 / d; this.pos.x += ox * p; this.pos.z += oz * p; }
    }

    this._animate(dt, ctx);
  }

  _wander(dt, W, speed) {
    if (this.idle > 0) { this.idle -= dt; this.speed *= 0.8; return; }
    if (!this.wanderTarget) {
      const cx = Math.floor(this.pos.x / CELL), cz = Math.floor(this.pos.z / CELL);
      for (let i = 0; i < 6; i++) {
        const tx = cx + Math.floor(Math.random() * 9) - 4, tz = cz + Math.floor(Math.random() * 9) - 4;
        const x = tx * CELL + 1.5, z = tz * CELL + 1.5;
        if (!W.isForbidden(x, z)) { this.wanderTarget = new THREE.Vector3(x, 0, z); break; }
      }
      this.path = null;
      if (!this.wanderTarget) { this.idle = 1; return; }
    }
    if (this._moveTo(this.wanderTarget, speed, dt, W, false) || this.blocked > 2) {
      this.wanderTarget = null;
      this.idle = 1 + Math.random() * 3.5;
      this.blocked = 0;
    }
  }

  _moveTo(target, speed, dt, W, direct) {
    let sx = target.x, sz = target.z;
    if (this.forcePath > 0) this.forcePath -= dt;
    const usePath = !direct || this.forcePath > 0;
    if (usePath) {
      const key = Math.floor(target.x / CELL) + ',' + Math.floor(target.z / CELL);
      this.repath -= dt;
      if (!this.path || this.repath <= 0 || this.pathKey !== key) {
        this.path = W.findPath(this.pos.x, this.pos.z, target.x, target.z);
        this.pathKey = key;
        this.repath = 0.6 + Math.random() * 0.3;
      }
      if (!this.path || !this.path.length) { this.speed *= 0.8; this.blocked += dt; return Math.hypot(target.x - this.pos.x, target.z - this.pos.z) < 1.2; }
      let pulls = 0;
      while (this.path.length > 1 && pulls < 2 && W.walkClear(this.pos.x, this.pos.z, this.path[1].x, this.path[1].z, 0.28)) { this.path.shift(); pulls++; }
      const wp = this.path[0];
      if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.45 && this.path.length > 1) this.path.shift();
      sx = this.path[0].x; sz = this.path[0].z;
    }
    const dx = sx - this.pos.x, dz = sz - this.pos.z;
    const d = Math.hypot(dx, dz);
    const toTarget = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
    if (d < 0.05) { this.speed = 0; return toTarget < 0.6; }
    const step = Math.min(d, speed * dt);
    tmp.set(this.pos.x + (dx / d) * step, 0, this.pos.z + (dz / d) * step);
    W.collide(tmp, 0.33, 0, 0.3, true);
    if (W.isForbidden(tmp.x, tmp.z)) tmp.set(this.pos.x, 0, this.pos.z);
    const moved = Math.hypot(tmp.x - this.pos.x, tmp.z - this.pos.z);
    this.blocked = moved < step * 0.3 ? this.blocked + dt : Math.max(0, this.blocked - dt * 0.5);
    // stuck while steering straight at the target → fall back to the cell path for a bit
    if (!usePath && this.blocked > 0.3) { this.forcePath = 1.6; this.blocked = 0; this.path = null; }
    this.pos.x = tmp.x; this.pos.z = tmp.z;
    this.speed = dt > 0 ? moved / dt : 0;
    this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), Math.min(1, dt * 7));
    return toTarget < 0.6;
  }

  _animate(dt, ctx) {
    const m = this.model;
    const sp = this.speed;
    const chase = this.mode === 'chase' || (this.mode === 'search' && sp > 2);
    this.walkPhase += dt * (1.0 + sp * 1.75);
    const amp = Math.min(1, sp / 1.1);
    const s = Math.sin(this.walkPhase), c = Math.cos(this.walkPhase);
    m.legs[0].hip.rotation.x = s * 0.55 * amp;
    m.legs[1].hip.rotation.x = -s * 0.55 * amp;
    m.legs[0].knee.rotation.x = Math.max(0, c) * 0.95 * amp;
    m.legs[1].knee.rotation.x = Math.max(0, -c) * 0.95 * amp;
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const a = m.arms[i];
      a.sh.rotation.x = (chase ? -1.0 : -0.06) + (i ? s : -s) * (chase ? 0.5 : 0.3) * amp;
      a.sh.rotation.z = side * (chase ? 0.25 : 0.07);
      a.el.rotation.x = chase ? -0.55 + Math.sin(this.walkPhase * 2 + i) * 0.2 : -0.12;
    }
    m.spine.rotation.x = lerp(m.spine.rotation.x, chase ? 0.5 : 0.2, Math.min(1, dt * 4));
    m.pelvis.position.y = 1.25 + Math.abs(c) * 0.035 * amp - (chase ? 0.08 : 0);
    // twitchy head
    this.twitchT -= dt;
    if (this.twitchT <= 0) { this.twitch = (Math.random() - 0.5) * 1.2; this.twitchT = 0.6 + Math.random() * 3; }
    m.head.rotation.z = lerp(m.head.rotation.z, this.twitch * 0.5, Math.min(1, dt * 18));
    m.head.rotation.x = lerp(m.head.rotation.x, chase ? -0.35 : -0.1, Math.min(1, dt * 5));
    this.root.rotation.y = this.yaw;
    m.body.rotation.x = lerp(m.body.rotation.x, 0, Math.min(1, dt * 6));
    // footsteps
    if (sp > 1.2 && this.dist < 26 && Math.sign(s) !== Math.sign(this.lastSin)) ctx.audio.entityStep(this.pos, chase);
    this.lastSin = s;
  }

  _animStun() {
    const m = this.model;
    const t = 1 - this.stun / this.stunMax; // 0 → 1
    const down = t < 0.12 ? t / 0.12 : t > 0.82 ? 1 - (t - 0.82) / 0.18 : 1;
    m.body.rotation.x = -Math.PI / 2 * down;
    m.body.position.y = 0.12 * down;
    m.arms[0].sh.rotation.x = -1.4 * down; m.arms[1].sh.rotation.x = -1.2 * down;
  }

  dispose(scene, audio) {
    scene.remove(this.root);
    this.skinMat.dispose();
    if (this.breather) { audio.releaseBreather(this.breather); this.breather = null; }
  }
}

export class EntityManager {
  constructor(game, diff) {
    this.game = game;
    this.diff = diff;
    this.list = [];
    this.enabled = true;
    this.nearest = null;
    this.nearestDist = Infinity;
    this.topUp = 15;
    this.positions = [];
  }

  get count() { return this.list.filter((e) => !e.dying && !e.killed).length; }

  spawn(x, z, day) {
    const e = new Entity(this, x, z, day);
    this.game.scene.add(e.root);
    this.list.push(e);
    return e;
  }

  _roomSpawnPoint(room, minDist) {
    const P = this.game.player;
    const c = room.cells[Math.floor(Math.random() * room.cells.length)];
    const x = c[0] * CELL + 1.5 + (Math.random() - 0.5), z = c[1] * CELL + 1.5 + (Math.random() - 0.5);
    if (Math.hypot(x - P.pos.x, z - P.pos.z) < minDist) return null;
    if (this.game.world.lineOfSight(x, 2.2, z, P.pos.x, P.pos.y + 1.6, P.pos.z)) return null;
    return { x, z };
  }

  cap(night) { return night ? this.diff.nightCap : this.diff.dayCap; }

  // called when a new chunk streams in
  onChunk(chunk, night) {
    if (!this.enabled) return;
    for (const room of chunk.rooms) {
      if (room.camp || room.safe) continue;
      if (this.count >= this.cap(night)) return;
      if (Math.random() < (night ? this.diff.nightRoomChance : this.diff.dayRoomChance)) {
        const p = this._roomSpawnPoint(room, night ? 20 : 26);
        if (p) this.spawn(p.x, p.z, !night);
      }
    }
  }

  populate(night, minDist = 22) {
    if (!this.enabled) return;
    const rooms = shuffle([...this.game.world.rooms()].filter((r) => !r.camp && !r.safe), Math.random);
    const chance = night ? this.diff.nightRoomChance : this.diff.dayRoomChance;
    const target = night ? Math.ceil(this.cap(true) * 0.7) : this.cap(false);
    for (const r of rooms) {
      if (this.count >= target) break;
      if (Math.random() < (night ? Math.max(chance, 0.2) : chance)) {
        const p = this._roomSpawnPoint(r, minDist);
        if (p) this.spawn(p.x, p.z, !night);
      }
    }
  }

  dawn(ctx) {
    for (const e of this.list) {
      if (e.killed) continue;
      if (e.chasing) { e.chasing = false; ctx.onEscape(e); }
      if (e.dist < 16 && e.los) e.dying = true;
      else e.dead = true;
    }
  }

  noise(x, z, kind) {
    for (const e of this.list) {
      if (e.stun > 0 || e.dying || e.killed) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      let r;
      if (kind === 'walk') r = lerp(HEARING.walk[0], HEARING.walk[1], e.acuity) * FT;
      else if (kind === 'sprint') r = lerp(HEARING.sprint[0], HEARING.sprint[1], e.acuity) * FT;
      else r = (HEARING[kind] || 10) * FT;
      if (d <= r) e.hear(x, z);
    }
  }

  hitTest(x, y, z, r = 0.45) {
    for (const e of this.list) {
      if (e.dying || e.stun > 0 || e.killed) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (d < r && y > 0.2 && y < 2.6) return e;
    }
    return null;
  }

  update(dt, ctx) {
    const W = this.game.world;
    this.nearest = null;
    this.nearestDist = Infinity;
    this.positions.length = 0;
    for (const e of this.list) {
      e.update(dt, ctx);
      if (!e.dead && !W.roomAt(e.pos.x, e.pos.z)) e.dead = true; // chunk unloaded
      if (!e.dead && !e.dying && !e.killed) {
        this.positions.push(e.pos);
        if (e.dist < this.nearestDist) { this.nearestDist = e.dist; this.nearest = e; }
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.dead) { e.dispose(this.game.scene, this.game.audio); this.list.splice(i, 1); }
    }
    if (ctx.night && this.enabled && ctx.huntable) {
      this.topUp -= dt;
      if (this.topUp <= 0) {
        this.topUp = 12 + Math.random() * 8;
        if (this.count < this.cap(true)) {
          const rooms = [...W.rooms()].filter((r) => !r.camp && !r.safe);
          for (let k = 0; k < 6 && rooms.length; k++) {
            const r = rooms[Math.floor(Math.random() * rooms.length)];
            const p = this._roomSpawnPoint(r, 25);
            if (p) { this.spawn(p.x, p.z, false); break; }
          }
        }
      }
    }
  }

  chaseInfo() {
    let n = 0, minLeft = Infinity, seen = false;
    for (const e of this.list) {
      if (!e.chasing) continue;
      n++;
      if (e.mode === 'chase') seen = true;
      minLeft = Math.min(minLeft, CHASE_ESCAPE_SECONDS - e.lostTimer);
    }
    return { n, minLeft, seen };
  }

  clear() {
    for (const e of this.list) e.dispose(this.game.scene, this.game.audio);
    this.list.length = 0;
  }
}
