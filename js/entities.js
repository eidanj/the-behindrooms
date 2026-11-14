// ─────────────────────────────────────────────────────────────
//  Entities: blind things that hunt by sound.
//   Day   – very rare (1/50 per room); slowly, passively follow you.
//   Night – common; with line-of-sight they chase you and attack.
//           Each type hits for its own damage with its own cooldown, so
//           you can fight back. Break LOS for 20 s to escape (+1 ★).
//  Types (see ENTITY_TYPES in config.js):
//   hollow    – the tall, eyeless original
//   crawler   – low, six-legged, fast, fragile
//   brute     – huge, slow, hits like a truck
//   hound     – four-legged, very fast
//   smiler    – night only; a shadow with a grin. Hates your flashlight.
//   mannequin – can't move while you're looking at it. Very fast when you aren't.
//  Far-away entities idle (no AI, no animation) to save CPU.
// ─────────────────────────────────────────────────────────────

import * as THREE from '../lib/three.module.min.js';
import { ENTITY, ENTITY_TYPES, HEARING, FT, PLAYER, CHASE_ESCAPE_SECONDS, CELL } from './config.js';
import { lerp, shuffle, weighted } from './rng.js';
import * as Models from './models.js';

const tmp = new THREE.Vector3();

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
const ease = (x, t) => Math.min(1, x * t);

class Entity {
  constructor(mgr, x, z, day, type) {
    this.mgr = mgr;
    const g = mgr.game;
    const M = g.mats;
    this.type = type;
    this.def = ENTITY_TYPES[type];
    const base = { hollow: M.skin, crawler: M.crawlerSkin, brute: M.bruteSkin, hound: M.houndSkin, smiler: M.smilerBody, mannequin: M.mannequin }[type] || M.skin;
    this.skinMat = base.clone();
    this.baseColor = this.skinMat.color.clone();
    this.model = Models.monster(M, type, this.skinMat);
    this.root = this.model.root;
    this.maxHp = (mgr.diff.entityHp || 120) * this.def.hp;
    this.hp = this.maxHp;
    this.flash = 0;
    this.stagger = 0; this.staggerMax = 1; this.kbx = 0; this.kbz = 0;
    this.killed = false; this.killT = 0;
    this.enraged = false;
    const W = g.world;
    this.y = W ? W.entFloor(x, z) : 0;
    this.root.position.set(x, this.y, z);
    this.pos = this.root.position;
    this.yaw = Math.random() * Math.PI * 2;
    this.name = this.def.name;
    this.acuity = mgr.diff.id === 'hard' ? 0.35 + Math.random() * 0.65 : Math.random();
    this.speedMult = this.def.speed * (0.97 + Math.random() * 0.06);
    const s = type === 'brute' ? 1.12 : 0.94 + Math.random() * 0.12;
    this.root.scale.set(s, s, s);
    this.scale = s;
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
    this.los = false; this.losTimer = Math.random() * 0.2;
    this.wanderTarget = null; this.idle = Math.random() * 2;
    this.blocked = 0;
    this.breather = null;
    this.dying = false; this.dead = false;
    this.twitch = 0; this.twitchT = 1 + Math.random() * 3;
    this.dist = 99;
    this.lastSin = 0;
    this.atk = null; this.atkCd = 0;
    this.watched = false; this.frozenT = 0;
    this.lit = false; this.fleeT = 0;
    this.clawCd = 3 + Math.random() * 3;
    this.claw = 0;
  }

  get headY() { return this.y + this.def.head * this.scale; }

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
    const res = this.type === 'brute' ? 0.45 : 1;
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, d = Math.hypot(dx, dz) || 1;
    const v = (kb * res) / (stagger * 0.6);
    this.kbx = (dx / d) * v; this.kbz = (dz / d) * v;
    this.stagger = Math.max(this.stagger, stagger * res); this.staggerMax = this.stagger;
    this.atk = null;
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
    this.atk = null;
    this.mgr.game.audio.monsterDeath(this.pos, this.def.voice);
  }

  trip(seconds) {
    if (this.stun > 0) return;
    this.stun = seconds; this.stunMax = seconds;
    this.path = null;
    this.atk = null;
    this.mgr.game.audio.fallThud(this.pos);
  }

  _setFlash(v) {
    const m = this.skinMat;
    if (m.emissive) m.emissive.setRGB(v * 2.2, 0, 0);
    else m.color.copy(this.baseColor).lerp(tmpRed, Math.min(1, v * 2.5));
  }

  _ground(dt, W) {
    const f = W.entFloor(this.pos.x, this.pos.z);
    if (f >= this.y) this.y = Math.min(f, this.y + dt * 6 + (f - this.y) * Math.min(1, dt * 10));
    else this.y = Math.max(f, this.y - dt * 7);
    this.pos.y = this.y;
  }

  update(dt, ctx) {
    const P = ctx.player, W = ctx.world, A = ctx.audio;
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    this.dist = dist;
    if (this.atkCd > 0) this.atkCd -= dt;
    if (this.clawCd > 0) this.clawCd -= dt;

    if (this.flash > 0) { this.flash -= dt; this._setFlash(Math.max(0, this.flash)); }

    // voice (only for nearby entities)
    if (dist < 30 && !this.breather && !this.dying && !this.killed) this.breather = A.createBreather(this.pos, this.def.voice);
    else if ((dist > 34 || this.dying || this.killed) && this.breather) { A.releaseBreather(this.breather); this.breather = null; }

    if (this.killed) { this._animDeath(dt); return; }
    if (this.breather) {
      A.moveBreather(this.breather, this.pos.x, this.headY - 0.2, this.pos.z);
      this.breather.rate = this.mode === 'chase' ? 1.9 : this.mode === 'search' || this.mode === 'flee' ? 1.45 : 1;
      this.breather.intensity = this.type === 'mannequin' ? (this.speed > 0.4 ? 1 : 0.02) : this.mode === 'chase' ? 1.3 : 0.9;
    }

    if (this.dying) {
      this.pos.y -= dt * 1.4;
      this.model.body.rotation.z += dt * 0.6;
      if (this.pos.y < this.y - 2.9) this.dead = true;
      return;
    }

    if (dist > 44 && !this.chasing) return;

    if (this.stun > 0) {
      this.stun -= dt;
      this._animStun();
      return;
    }

    // mannequins freeze completely while you're looking at them
    if (this.def.statue && this.watched && !P.dead) {
      this.speed = 0;
      this.frozenT += dt;
      this.atk = null;
      return;
    }
    this.frozenT = 0;

    if (this.stagger > 0) {
      this.stagger -= dt;
      const k = Math.max(0, this.stagger / this.staggerMax);
      tmp.set(this.pos.x + this.kbx * k * dt, 0, this.pos.z + this.kbz * k * dt);
      W.collide(tmp, this.def.radius, this.y, 0.4, true);
      if (!W.isForbidden(tmp.x, tmp.z) && W.entFloor(tmp.x, tmp.z) - this.y < 0.8) { this.pos.x = tmp.x; this.pos.z = tmp.z; }
      this._ground(dt, W);
      this._animStagger(dt, P);
      this.speed = 0;
      return;
    }

    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.12 + Math.random() * 0.08;
      this.los = dist < 32 && !P.inVent && W.lineOfSight(this.pos.x, this.headY, this.pos.z, P.pos.x, P.eyeY - 0.1, P.pos.z);
    }

    const safe = P.inSafe;
    let target = null, speed = 0, direct = false, face = null;
    const diff = this.mgr.diff;
    const chaseSpeed = PLAYER.walkSpeed * this.speedMult * diff.entitySpeedMult;

    // the Smiler can't stand your flashlight
    if (this.def.fleesLight) {
      if (this.lit) {
        this.fleeT = 2.5;
        this.hp -= dt * 30 * Math.max(0.3, 1 - dist / 16);
        this.flash = Math.max(this.flash, 0.12);
        if (this.hp <= 0) { this.die(); ctx.onEntityKilled?.(this); return; }
      }
      if (this.fleeT > 0) {
        this.fleeT -= dt;
        this.mode = 'flee';
        const d = dist || 1;
        target = tmpFlee.set(this.pos.x - (dx / d) * 6, 0, this.pos.z - (dz / d) * 6);
        speed = chaseSpeed * 1.1; direct = true;
        this._moveTo(target, speed, dt, W, true);
        this._ground(dt, W);
        this._animate(dt, ctx);
        return;
      }
    }

    if (ctx.night || this.enraged) {
      const range = (P.flashlightOn || !ctx.night ? ENTITY.sightRangeLit : ENTITY.sightRangeDark) * diff.sightMult;
      const sees = this.los && dist < range && !safe && !P.dead && ctx.huntable;
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
        target = this.heard; speed = ENTITY.investigateSpeed * (this.def.statue ? 1.8 : 1);
      } else {
        this.mode = 'wander';
        this._wander(dt, W, ENTITY.wanderSpeed);
      }
      // attacks
      const reach = this.def.reach * this.scale + PLAYER.radius;
      const dy = Math.abs(P.feetY - this.y);
      if (this.atk) {
        this.atk.t += dt;
        speed *= 0.35;
        if (!this.atk.hit && this.atk.t >= this.atk.wind) {
          this.atk.hit = true;
          if (!P.dead && !safe && dist < reach + 0.45 && dy < 1.4 && !P.inVent && ctx.huntable) ctx.onHit(this, this.def.dmg * (diff.entityDmgMult ?? 1));
        }
        if (this.atk.t >= this.atk.dur) this.atk = null;
      } else if (this.atkCd <= 0 && !P.dead && !safe && dist < reach && this.los && dy < 1.2 && ctx.huntable) {
        this.atk = { t: 0, wind: this.type === 'brute' ? 0.38 : 0.2, dur: this.type === 'brute' ? 0.75 : 0.45, hit: false };
        this.atkCd = this.def.cd;
        A.monsterAttack(this.pos, this.def.voice);
      }
      // you're hiding in a vent above it: sometimes it claws at the duct
      if (P.inVent && (this.mode === 'search' || this.mode === 'investigate') && dist < 2.6 && this.clawCd <= 0) {
        this.clawCd = 4 + Math.random() * 5;
        if (Math.random() < 0.55) { this.claw = 0.9; ctx.onClawVent(this); }
      }
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
      this.yaw = lerpAngle(this.yaw, Math.atan2(face.x - this.pos.x, face.z - this.pos.z), ease(dt, 3));
      this.speed *= 0.85;
    }
    if (this.atk) this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), ease(dt, 10));

    for (const o of this.mgr.list) {
      if (o === this || o.dying || o.killed) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z, d2 = ox * ox + oz * oz;
      const rr = this.def.radius + o.def.radius + 0.1;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2), p = (rr - d) * 0.5 / d; this.pos.x += ox * p; this.pos.z += oz * p; }
    }

    this._ground(dt, W);
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
    const r = this.def.radius;
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
      while (this.path.length > 1 && pulls < 2 && W.walkClear(this.pos.x, this.pos.z, this.path[1].x, this.path[1].z, Math.min(0.3, r))) { this.path.shift(); pulls++; }
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
    W.collide(tmp, Math.min(0.36, r), this.y, 0.4, true, this.def.head);
    const nf = W.entFloor(tmp.x, tmp.z);
    if (W.isForbidden(tmp.x, tmp.z) || nf - this.y > 0.85 || this.y - nf > 1.75) tmp.set(this.pos.x, 0, this.pos.z);
    const moved = Math.hypot(tmp.x - this.pos.x, tmp.z - this.pos.z);
    this.blocked = moved < step * 0.3 ? this.blocked + dt : Math.max(0, this.blocked - dt * 0.5);
    if (!usePath && this.blocked > 0.3) { this.forcePath = 1.6; this.blocked = 0; this.path = null; }
    this.pos.x = tmp.x; this.pos.z = tmp.z;
    this.speed = dt > 0 ? moved / dt : 0;
    this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), ease(dt, this.mode === 'flee' ? 5 : 7));
    return toTarget < 0.6;
  }

  // ── animation ─────────────────────────────────────────────
  _animate(dt, ctx) {
    const m = this.model;
    const sp = this.speed;
    const chase = this.mode === 'chase' || (this.mode === 'search' && sp > 2) || this.mode === 'flee';
    this.walkPhase += dt * (1.0 + sp * 1.75) * (this.type === 'crawler' ? 1.6 : this.type === 'hound' ? 1.25 : this.type === 'brute' ? 0.75 : 1);
    const amp = Math.min(1, sp / 1.1);
    const s = Math.sin(this.walkPhase), c = Math.cos(this.walkPhase);
    const atk = this.atk ? Math.min(1, this.atk.t / this.atk.wind) * (this.atk.t > this.atk.wind ? Math.max(0, 1 - (this.atk.t - this.atk.wind) / 0.2) : 1) : 0;
    const claw = this.claw > 0 ? (this.claw -= dt, Math.sin(Math.min(1, this.claw / 0.9) * Math.PI)) : 0;
    this.root.rotation.y = this.yaw;
    if (m.rig === 'humanoid') {
      const smiler = this.type === 'smiler', brute = this.type === 'brute', manq = this.type === 'mannequin';
      const legA = smiler ? 0.12 : brute ? 0.4 : 0.55;
      const ph = manq ? Math.round(this.walkPhase * 3) / 3 : this.walkPhase; // jerky
      const ss = Math.sin(ph), cc = Math.cos(ph);
      m.legs[0].hip.rotation.x = smiler ? Math.sin(this.walkPhase * 0.7) * 0.15 : ss * legA * amp;
      m.legs[1].hip.rotation.x = smiler ? Math.sin(this.walkPhase * 0.7 + 1) * 0.15 : -ss * legA * amp;
      m.legs[0].knee.rotation.x = smiler ? 0.3 : Math.max(0, cc) * 0.95 * amp;
      m.legs[1].knee.rotation.x = smiler ? 0.35 : Math.max(0, -cc) * 0.95 * amp;
      for (let i = 0; i < 2; i++) {
        const side = i ? 1 : -1;
        const a = m.arms[i];
        let sh = (chase ? -1.0 : -0.06) + (i ? ss : -ss) * (chase ? 0.5 : 0.3) * amp;
        if (brute) sh = -0.25 + (i ? ss : -ss) * 0.45 * amp;
        sh -= atk * (i ? 2.1 : 1.6) + claw * 2.8;
        a.sh.rotation.x = lerp(a.sh.rotation.x, sh, ease(dt, 18));
        a.sh.rotation.z = side * (chase ? 0.25 : brute ? 0.3 : 0.07);
        a.el.rotation.x = chase ? -0.55 + Math.sin(this.walkPhase * 2 + i) * 0.2 : -0.12;
      }
      m.spine.rotation.x = lerp(m.spine.rotation.x, (chase ? 0.5 : 0.2) * (brute ? 0.7 : 1) + atk * 0.35 - claw * 0.3, ease(dt, 6));
      m.pelvis.position.y = m.hipY + (smiler ? 0.18 + Math.sin(this.walkPhase * 0.8) * 0.06 : Math.abs(c) * 0.035 * amp - (chase ? 0.08 : 0));
      this.twitchT -= dt;
      if (this.twitchT <= 0) { this.twitch = (Math.random() - 0.5) * 1.2; this.twitchT = 0.6 + Math.random() * 3; }
      m.head.rotation.z = lerp(m.head.rotation.z, this.twitch * (manq ? 0.9 : 0.5), ease(dt, manq ? 40 : 18));
      m.head.rotation.x = lerp(m.head.rotation.x, chase ? -0.35 : -0.1, ease(dt, 5));
      m.body.rotation.x = lerp(m.body.rotation.x, 0, ease(dt, 6));
      m.body.position.y = lerp(m.body.position.y, 0, ease(dt, 6));
    } else if (m.rig === 'crawler') {
      for (const L of m.legs) {
        const grp = (L.row + (L.side > 0 ? 1 : 0)) % 2;
        const p = this.walkPhase * 1.4 + grp * Math.PI;
        L.hip.rotation.y = Math.sin(p) * 0.45 * amp;
        L.hip.rotation.z = -L.side * (0.9 - Math.max(0, Math.cos(p)) * 0.35 * amp);
      }
      m.body.position.y = 0.45 + Math.abs(Math.sin(this.walkPhase * 1.4)) * 0.04 * amp + atk * 0.35 + claw * 0.5;
      m.body.rotation.x = lerp(m.body.rotation.x, -atk * 0.8 - claw * 0.9, ease(dt, 12));
      this.twitchT -= dt;
      if (this.twitchT <= 0) { this.twitch = (Math.random() - 0.5) * 1.4; this.twitchT = 0.3 + Math.random() * 1.5; }
      m.head.rotation.y = lerp(m.head.rotation.y, this.twitch * 0.6, ease(dt, 25));
      m.body.rotation.z = lerp(m.body.rotation.z, 0, ease(dt, 6));
    } else if (m.rig === 'hound') {
      const run = Math.min(1, sp / 2.5);
      for (const L of m.legs) {
        const p = this.walkPhase * 1.2 + (L.front ? 0 : Math.PI) + (L.side > 0 ? Math.PI * (run > 0.5 ? 0.15 : 1) : 0);
        L.hip.rotation.x = Math.sin(p) * (0.45 + run * 0.35) * amp;
        L.knee.rotation.x = (L.front ? -1 : 1) * Math.max(0, Math.cos(p)) * 0.7 * amp;
      }
      m.body.position.y = 0.72 + Math.abs(Math.sin(this.walkPhase * 1.2)) * 0.05 * amp - atk * 0.1;
      m.body.rotation.x = lerp(m.body.rotation.x, Math.sin(this.walkPhase * 1.2) * 0.05 * run - atk * 0.25 - claw * 0.7, ease(dt, 10));
      m.body.position.z = atk * 0.35;
      m.jaw.rotation.x = lerp(m.jaw.rotation.x, chase ? 0.35 + atk * 0.5 : 0.08, ease(dt, 10));
      m.tail.rotation.x = Math.sin(this.walkPhase * 2.4) * 0.2;
      m.head.rotation.x = lerp(m.head.rotation.x, chase ? 0.2 : -0.1, ease(dt, 6));
      m.body.rotation.z = lerp(m.body.rotation.z, 0, ease(dt, 6));
    }
    // footsteps
    if (sp > 1.2 && this.dist < 26 && Math.sign(s) !== Math.sign(this.lastSin) && this.type !== 'smiler') ctx.audio.entityStep(this.pos, chase || this.type === 'brute', this.type);
    this.lastSin = s;
  }

  _animStagger(dt, P) {
    const m = this.model;
    this.yaw = lerpAngle(this.yaw, Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z), ease(dt, 6));
    this.root.rotation.y = this.yaw;
    if (m.rig === 'humanoid') {
      m.spine.rotation.x = lerp(m.spine.rotation.x, -0.35, ease(dt, 14));
      m.head.rotation.x = lerp(m.head.rotation.x, 0.5, ease(dt, 14));
      m.arms[0].sh.rotation.x = lerp(m.arms[0].sh.rotation.x, -1.6, ease(dt, 12));
      m.arms[1].sh.rotation.x = lerp(m.arms[1].sh.rotation.x, -1.3, ease(dt, 12));
    } else {
      m.body.rotation.x = lerp(m.body.rotation.x, 0.45, ease(dt, 14));
    }
  }

  _animStun() {
    const m = this.model;
    const t = 1 - this.stun / this.stunMax;
    const down = t < 0.12 ? t / 0.12 : t > 0.82 ? 1 - (t - 0.82) / 0.18 : 1;
    if (m.rig === 'humanoid') {
      m.body.rotation.x = -Math.PI / 2 * down;
      m.body.position.y = 0.12 * down;
      m.arms[0].sh.rotation.x = -1.4 * down; m.arms[1].sh.rotation.x = -1.2 * down;
    } else {
      m.body.rotation.z = Math.PI * 0.9 * down;
      m.body.position.y = (m.rig === 'hound' ? 0.72 : 0.45) * (1 - down * 0.6);
      for (const L of m.legs) L.hip.rotation.x = Math.sin(t * 40 + L.side) * 0.5 * down;
    }
  }

  _animDeath(dt) {
    this.killT += dt;
    const m = this.model, k = Math.min(1, this.killT / 0.45);
    if (m.rig === 'humanoid') {
      m.body.rotation.x = -Math.PI / 2 * k * k;
      m.body.position.y = 0.12 * k;
      m.arms[0].sh.rotation.x = lerp(m.arms[0].sh.rotation.x, -2.6, ease(dt, 6));
      m.arms[1].sh.rotation.x = lerp(m.arms[1].sh.rotation.x, -2.9, ease(dt, 6));
      m.head.rotation.z = lerp(m.head.rotation.z, 0.6, ease(dt, 4));
    } else {
      m.body.rotation.z = Math.PI * k * k * (m.rig === 'hound' ? 0.5 : 1);
      m.body.position.y = lerp(m.body.position.y, m.rig === 'hound' ? 0.25 : 0.15, ease(dt, 5));
      for (const L of m.legs) { L.hip.rotation.x = lerp(L.hip.rotation.x, 0.6, ease(dt, 3)); if (L.knee) L.knee.rotation.x = lerp(L.knee.rotation.x, m.rig === 'crawler' ? L.side * 2.8 : 1.2, ease(dt, 3)); }
    }
    if (this.type === 'smiler' && this.model.extra.glow) for (const g of this.model.extra.glow) g.visible = this.killT < 1.2 ? Math.random() < 0.6 : false;
    if (this.killT > 4) { this.pos.y -= dt * 0.6; if (this.pos.y < this.y - 0.8) this.dead = true; }
  }

  dispose(scene, audio) {
    scene.remove(this.root);
    this.skinMat.dispose();
    if (this.breather) { audio.releaseBreather(this.breather); this.breather = null; }
  }
}
const tmpRed = new THREE.Color(0xff2a1a);
const tmpFlee = new THREE.Vector3();

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

  pickType(day) {
    if (day) return 'hollow';
    const opts = Object.entries(ENTITY_TYPES).filter(([, d]) => !d.nightOnly || !day).map(([k, d]) => [k, d.weight]);
    return weighted(Math.random, opts);
  }

  spawn(x, z, day, type) {
    const e = new Entity(this, x, z, day, type || this.pickType(day));
    this.game.scene.add(e.root);
    this.list.push(e);
    return e;
  }

  _roomSpawnPoint(room, minDist) {
    const P = this.game.player;
    const W = this.game.world;
    const c = room.cells[Math.floor(Math.random() * room.cells.length)];
    const x = c[0] * CELL + 1.5 + (Math.random() - 0.5), z = c[1] * CELL + 1.5 + (Math.random() - 0.5);
    if (W.isForbidden(x, z)) return null;
    if (Math.hypot(x - P.pos.x, z - P.pos.z) < minDist) return null;
    if (W.lineOfSight(x, W.entFloor(x, z) + 2.2, z, P.pos.x, P.eyeY, P.pos.z)) return null;
    return { x, z };
  }

  cap(night) { return night ? this.diff.nightCap : this.diff.dayCap; }

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
      if (d < r + e.def.radius - 0.3 && y > e.y + 0.1 && y < e.headY + 0.35) return e;
    }
    return null;
  }

  update(dt, ctx) {
    const W = this.game.world;
    this.nearest = null;
    this.nearestDist = Infinity;
    this.positions.length = 0;
    const cam = ctx.cam;
    for (const e of this.list) {
      // is the player looking at it? (mannequins freeze, smilers burn)
      if (cam && !e.killed && !e.dying && (e.def.statue || e.def.fleesLight) && e.dist < 40) {
        const vx = e.pos.x - cam.pos.x, vy = e.headY - 0.6 - cam.pos.y, vz = e.pos.z - cam.pos.z;
        const d = Math.hypot(vx, vy, vz) || 1;
        const dot = (vx * cam.dir.x + vy * cam.dir.y + vz * cam.dir.z) / d;
        const visible = (e._visT = (e._visT || 0) - dt) <= 0 ? (e._visT = 0.1, e._vis = W.lineOfSight(cam.pos.x, cam.pos.y, cam.pos.z, e.pos.x, e.headY - 0.5, e.pos.z)) : e._vis;
        const lit = ctx.ambient > 0.3 || d < 3.5 || (ctx.flashlightOn && d < 15 && dot > 0.9);
        e.watched = !!(e.def.statue && visible && dot > cam.fovCos && lit && !ctx.playerDead);
        e.lit = !!(e.def.fleesLight && visible && ctx.flashlightOn && dot > 0.94 && d < 14);
      } else { e.watched = false; e.lit = false; }
      e.update(dt, ctx);
      if (!e.dead && !W.roomAt(e.pos.x, e.pos.z)) e.dead = true;
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
