// Items, inventory and throwables (rocks, noisemakers + banana peels).

import * as THREE from '../lib/three.module.min.js';
import { ENTITY } from './config.js';
import * as Models from './models.js';

export const ITEMS = {
  flashlight: { name: 'Flashlight', cat: 'flashlight' },
  battery: { name: 'Battery', cat: 'battery' },
  bread: { name: 'Bread', cat: 'food', hunger: [4, 8], desc: '+4–8 Hunger' },
  granola: { name: 'Granola Bar', cat: 'food', hunger: [5, 9], energy: [0, 1], desc: '+5–9 Hunger' },
  cookie: { name: 'Cookie', cat: 'food', hunger: [3, 6], energy: [0, 2], speedPerm: 0.005, desc: '+3–6 Hunger, +0–2 Energy, permanent +0.5% speed' },
  fruit: { name: 'Banana', cat: 'food', hunger: [6, 10], energy: [1, 1], peel: true, desc: '+6–10 Hunger, +1 Energy — leaves a peel' },
  coffee: { name: 'Coffee', cat: 'drink', hunger: [5, 5], energy: [2, 2], boost: { mult: 0.15, dur: 30, crash: -0.1, crashDur: 10 }, desc: '+5 Hunger, +2 Energy, +15% speed 30s' },
  energy: { name: 'Energy Drink', cat: 'drink', hunger: [2, 4], energy: [4, 4], boost: { mult: 0.2, dur: 45, crash: -0.15, crashDur: 10 }, desc: '+2–4 Hunger, +4 Energy, +20% speed 45s' },
  almond: { name: 'Almond Water', cat: 'drink', hunger: [3, 3], energy: [1, 1], sanity: 8, desc: '+3 Hunger, +1 Energy, +8 Sanity' },
  rock: { name: 'Rock', cat: 'rock' },
  noisemaker: { name: 'Noisemaker', cat: 'rock', desc: 'Throw it: rings loudly and lures monsters' },
  banana: { name: 'Banana Peel', cat: 'banana' },
  key: { name: 'Saferoom Key', cat: 'key' },
  bandage: { name: 'Bandage', cat: 'med', heal: 35, desc: 'Heals 35 HP' },
  medkit: { name: 'First Aid Kit', cat: 'med', heal: 70, desc: 'Heals 70 HP' },
  // crafting materials (no hotbar slot — see the crafting table at camp)
  wood: { name: 'Wood Scraps', cat: 'mat' },
  metal: { name: 'Metal Scraps', cat: 'mat' },
  cloth: { name: 'Cloth', cat: 'mat' },
  tape: { name: 'Duct Tape', cat: 'mat' },
};
export const MATERIALS = ['wood', 'metal', 'cloth', 'tape'];
// things the camp chest can hold
export const STORABLE = ['bread', 'granola', 'cookie', 'fruit', 'coffee', 'energy', 'almond', 'battery', 'bandage', 'medkit', 'key', 'rock', 'noisemaker', 'banana', 'wood', 'metal', 'cloth', 'tape'];

// Sub-type odds inside each loot pool (from the design doc; the remaining
// share is filled by the Granola Bar and Almond Water).
export const FOOD_TABLE = [['bread', 45], ['granola', 27], ['fruit', 23], ['cookie', 5]];
export const DRINK_TABLE = [['coffee', 20], ['energy', 15], ['almond', 65]];

// Melee: fists are always available; weapons come from drawers and break after `dur` hits.
//  dmg = damage per hit (monsters have ~120 HP on Normal), cd = seconds between attacks,
//  range = reach in m, stagger = how long a hit stuns, kb = knockback in m.
export const WEAPONS = {
  fists:     { name: 'Fists',        dmg: 10, cd: 0.5,  range: 1.7, windup: 0.11, stagger: 0.45, kb: 1.5, fist: true },
  club:      { name: 'Wooden Club',  dmg: 18, cd: 0.6,  range: 1.9, windup: 0.18, stagger: 0.55, kb: 2.0, dur: 18 },
  pipe:      { name: 'Lead Pipe',    dmg: 24, cd: 0.62, range: 2.0, windup: 0.2,  stagger: 0.55, kb: 1.9, dur: 25 },
  crowbar:   { name: 'Crowbar',      dmg: 27, cd: 0.6,  range: 2.0, windup: 0.19, stagger: 0.55, kb: 1.9, dur: 30 },
  bat:       { name: 'Baseball Bat', dmg: 32, cd: 0.72, range: 2.2, windup: 0.22, stagger: 0.7,  kb: 2.6, dur: 20 },
  spikedbat: { name: 'Spiked Bat',   dmg: 40, cd: 0.78, range: 2.2, windup: 0.24, stagger: 0.75, kb: 2.6, dur: 24 },
  axe:       { name: 'Fire Axe',     dmg: 48, cd: 0.95, range: 2.2, windup: 0.3,  stagger: 0.8,  kb: 2.2, dur: 14 },
};
export const WEAPON_TABLE = [['club', 18], ['pipe', 33], ['crowbar', 25], ['bat', 17], ['axe', 7]];

export const SLOTS = ['flashlight', 'food', 'drink', 'rock', 'banana', 'key', 'melee', 'med'];
export const SUBTYPES = { food: ['bread', 'granola', 'cookie', 'fruit'], drink: ['coffee', 'energy', 'almond'], rock: ['rock', 'noisemaker'], med: ['bandage', 'medkit'] };

export class Inventory {
  constructor() {
    this.counts = { battery: 1, bread: 0, granola: 0, cookie: 0, fruit: 0, coffee: 0, energy: 0, almond: 0, rock: 0, noisemaker: 0, banana: 0, key: 0, bandage: 0, medkit: 0, wood: 0, metal: 0, cloth: 0, tape: 0 };
    this.slot = 0;
    this.sub = { food: 'bread', drink: 'almond', rock: 'rock', med: 'bandage' };
    this.weapons = [];   // [{ type, dur }]
    this.equipped = -1;  // -1 = fists
  }

  addWeapon(type) {
    this.weapons.push({ type, dur: WEAPONS[type].dur });
    if (this.equipped < 0) this.equipped = this.weapons.length - 1;
  }

  weapon() { return this.equipped >= 0 ? this.weapons[this.equipped] : null; }

  // the equipped weapon broke: fall back to the next weapon, or fists
  breakWeapon() {
    if (this.equipped < 0) return;
    this.weapons.splice(this.equipped, 1);
    this.equipped = this.weapons.length ? 0 : -1;
  }

  add(item, n = 1) {
    this.counts[item] = (this.counts[item] || 0) + n;
    const it = ITEMS[item];
    if (it && SUBTYPES[it.cat] && !this.counts[this.sub[it.cat]]) this.sub[it.cat] = item;
  }

  take(item) {
    if (!this.counts[item]) return false;
    this.counts[item]--;
    const cat = ITEMS[item]?.cat;
    if (SUBTYPES[cat] && !this.counts[item]) {
      const next = SUBTYPES[cat].find((s) => this.counts[s] > 0);
      if (next) this.sub[cat] = next;
    }
    return true;
  }

  catCount(cat) {
    if (cat === 'melee') return this.weapons.length;
    if (SUBTYPES[cat]) return SUBTYPES[cat].reduce((a, s) => a + (this.counts[s] || 0), 0);
    if (cat === 'flashlight') return 1;
    return this.counts[cat] || 0;
  }

  held() {
    const cat = SLOTS[this.slot];
    if (cat === 'flashlight') return 'flashlight';
    if (cat === 'melee') return this.equipped >= 0 ? this.weapons[this.equipped].type : 'fists';
    if (SUBTYPES[cat]) {
      if (this.counts[this.sub[cat]] > 0) return this.sub[cat];
      const any = SUBTYPES[cat].find((s) => this.counts[s] > 0);
      return any || null;
    }
    return this.counts[cat] > 0 ? cat : null;
  }

  select(i) {
    if (i === this.slot) {
      const cat = SLOTS[i];
      if (cat === 'melee' && this.weapons.length) {
        this.equipped = this.equipped + 1 >= this.weapons.length ? -1 : this.equipped + 1;
        return 'cycled';
      }
      if (SUBTYPES[cat]) {
        const subs = SUBTYPES[cat].filter((s) => this.counts[s] > 0);
        if (subs.length > 1) {
          const idx = subs.indexOf(this.sub[cat]);
          this.sub[cat] = subs[(idx + 1) % subs.length];
          return 'cycled';
        }
      }
      return false;
    }
    this.slot = i;
    return true;
  }
}

const GRAV = 12;

export class Throwables {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.peels = [];
    this.ringing = [];
  }

  throw(type, origin, dir, strength = 1) {
    const M = this.game.mats;
    const mesh = type === 'rock' ? Models.rock(M, Math.floor(Math.random() * 3)) : type === 'noisemaker' ? Models.noisemaker(M) : Models.bananaPeel(M);
    mesh.position.copy(origin);
    this.game.scene.add(mesh);
    const speed = (type === 'banana' ? 8 : 12) * strength;
    const vel = dir.clone().multiplyScalar(speed);
    vel.y += type === 'banana' ? 2.2 : 1.8;
    this.list.push({ type, mesh, vel, hitFloor: false, life: 0, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0), lastHit: null });
  }

  _peelAt(x, z, loud) {
    const M = this.game.mats;
    const W = this.game.world;
    const y = W.floorAt(x, z);
    const mesh = Models.bananaPeel(M);
    mesh.position.set(x, y + 0.01, z);
    mesh.rotation.y = Math.random() * 6.28;
    this.game.scene.add(mesh);
    const it = W.addDynamicPickup('banana', mesh, x, y, z);
    const peel = { mesh, x, z, it };
    it.onRemove = () => { const i = this.peels.indexOf(peel); if (i >= 0) this.peels.splice(i, 1); };
    this.peels.push(peel);
    if (loud) { this.game.audio.squelch(mesh.position); this.game.entities.noise(x, z, 'peel'); }
  }

  placePeel(x, z) { this._peelAt(x, z, true); }
  placePeelSilent(x, z) { this._peelAt(x, z, false); }

  update(dt) {
    const W = this.game.world, E = this.game.entities, A = this.game.audio;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const m = p.mesh;
      p.life += dt;
      const sub = Math.max(1, Math.ceil((p.vel.length() * dt) / 0.08));
      const h = dt / sub;
      for (let k = 0; k < sub; k++) {
        p.vel.y -= GRAV * h;
        const px = m.position.x, pz = m.position.z;
        m.position.addScaledVector(p.vel, h);
        const list = W.boxesNear(m.position.x, m.position.z, 0.1);
        for (const b of list) {
          if (!b.on || m.position.y > b.top || m.position.y < b.bottom) continue;
          if (m.position.x > b.minX - 0.05 && m.position.x < b.maxX + 0.05 && m.position.z > b.minZ - 0.05 && m.position.z < b.maxZ + 0.05) {
            if (b.top - b.bottom < 1.4 && m.position.y > b.top - 0.15 && p.vel.y < 0) { m.position.y = b.top + 0.06; p.vel.y *= -0.3; p.vel.x *= 0.6; p.vel.z *= 0.6; }
            else if (px <= b.minX - 0.05 || px >= b.maxX + 0.05) { p.vel.x *= -0.35; m.position.x = px; p.vel.z *= 0.7; }
            else { p.vel.z *= -0.35; m.position.z = pz; p.vel.x *= 0.7; }
            if (p.type !== 'banana' && b !== p.lastHit && p.vel.length() > 2) { A.rockHit(m.position, 0.8); E.noise(m.position.x, m.position.z, 'rock'); }
            p.lastHit = b;
          }
        }
        // ledges (thrown into a wall of a higher floor)
        const f = W.floorAt(m.position.x, m.position.z);
        if (m.position.y < f - 0.05 && W.floorAt(px, pz) < f - 0.05) { m.position.x = px; m.position.z = pz; p.vel.x *= -0.35; p.vel.z *= -0.35; }
      }
      m.rotation.x += p.spin.x * dt; m.rotation.y += p.spin.y * dt;
      if (m.position.y > 2.92) { m.position.y = 2.92; p.vel.y = -Math.abs(p.vel.y) * 0.3; }
      const e = p.vel.length() > 3 ? E.hitTest(m.position.x, m.position.y, m.position.z, 0.5) : null;
      if (e) {
        e.trip(p.type === 'banana' ? ENTITY.slipSeconds : ENTITY.tripSeconds);
        this.game.onEntityTripped(e, p.type);
        p.vel.multiplyScalar(-0.2);
        if (p.type !== 'banana') A.rockHit(m.position, 1);
      }
      const floor = W.floorAt(m.position.x, m.position.z);
      const water = W.waterAt(m.position.x, m.position.z);
      const ground = floor + (p.type === 'banana' ? 0.01 : 0.05);
      if (!p.splashed && !Number.isNaN(water) && m.position.y < water) { p.splashed = true; A.splash(false); p.vel.multiplyScalar(0.4); }
      if (m.position.y <= ground) {
        m.position.y = ground;
        if (!p.hitFloor) {
          p.hitFloor = true;
          if (p.type === 'rock') { A.rockHit(m.position, 1); E.noise(m.position.x, m.position.z, 'rock'); }
          else if (p.type === 'noisemaker') { this._ring(m); }
          else A.squelch(m.position);
        }
        if (p.type === 'banana') { p.vel.set(0, 0, 0); }
        else if (Math.abs(p.vel.y) > 1.4) { p.vel.y = -p.vel.y * 0.32; p.vel.x *= 0.6; p.vel.z *= 0.6; if (Math.abs(p.vel.y) > 1.2) A.rockHit(m.position, 0.4); }
        else { p.vel.y = 0; p.vel.x *= Math.max(0, 1 - dt * 8); p.vel.z *= Math.max(0, 1 - dt * 8); }
      }
      const settled = m.position.y <= ground + 0.001 && Math.hypot(p.vel.x, p.vel.z) < 0.15;
      if (settled || p.life > 6) {
        this.list.splice(i, 1);
        if (p.type === 'banana') {
          this.game.scene.remove(m);
          this.placePeelSilent(m.position.x, m.position.z);
        } else if (p.type === 'noisemaker') {
          if (!p.hitFloor) this._ring(m);
        } else {
          m.position.y = ground; m.rotation.x = 0; m.rotation.z = 0;
          W.addDynamicPickup('rock', m, m.position.x, floor, m.position.z);
        }
      }
    }
    // noisemakers ring for 4 s, then fall apart
    for (let i = this.ringing.length - 1; i >= 0; i--) {
      const r = this.ringing[i];
      r.t += dt;
      r.mesh.rotation.z = Math.sin(r.t * 60) * 0.08;
      r.pulse -= dt;
      if (r.pulse <= 0) { r.pulse = 0.8; E.noise(r.mesh.position.x, r.mesh.position.z, 'noisemaker'); }
      if (r.t > 4.2) { this.game.scene.remove(r.mesh); this.ringing.splice(i, 1); }
    }
    for (let i = this.peels.length - 1; i >= 0; i--) {
      const pl = this.peels[i];
      for (const e of E.list) {
        if (e.stun > 0 || e.dying || e.killed || e.speed < 1.9) continue;
        if (Math.hypot(e.pos.x - pl.x, e.pos.z - pl.z) < 0.6) {
          e.trip(ENTITY.slipSeconds);
          A.squelch(pl.mesh.position);
          this.game.onEntityTripped(e, 'banana');
          W.removePickup(pl.it);
          this.peels.splice(i, 1);
          break;
        }
      }
    }
  }

  _ring(m) {
    this.game.audio.noisemaker(m.position);
    this.ringing.push({ mesh: m, t: 0, pulse: 0 });
    this.game.entities.noise(m.position.x, m.position.z, 'noisemaker');
  }

  clear() {
    for (const p of this.list) this.game.scene.remove(p.mesh);
    for (const r of this.ringing) this.game.scene.remove(r.mesh);
    this.list.length = 0;
    this.peels.length = 0;
    this.ringing.length = 0;
  }
}
