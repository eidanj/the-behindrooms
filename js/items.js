// Items, inventory and throwables (rocks + banana peels).

import * as THREE from '../lib/three.module.min.js';
import { ENTITY } from './config.js';
import * as Models from './models.js';

export const ITEMS = {
  flashlight: { name: 'Flashlight', cat: 'flashlight' },
  battery: { name: 'Battery', cat: 'battery' },
  bread: { name: 'Bread', cat: 'food', hunger: [4, 8], desc: '+4–8 Hunger' },
  granola: { name: 'Granola Bar', cat: 'food', hunger: [5, 9], energy: [0, 1], desc: '+5–9 Hunger' },
  cookie: { name: 'Cookie', cat: 'food', hunger: [3, 6], energy: [0, 2], speedPerm: 0.005, desc: '+3–6 Hunger, +0–2 Energy, permanent +0.5% speed' },
  coffee: { name: 'Coffee', cat: 'drink', hunger: [5, 5], energy: [2, 2], boost: { mult: 0.15, dur: 30, crash: -0.1, crashDur: 10 }, desc: '+5 Hunger, +2 Energy, +15% speed 30s' },
  energy: { name: 'Energy Drink', cat: 'drink', hunger: [2, 4], energy: [4, 4], boost: { mult: 0.2, dur: 45, crash: -0.15, crashDur: 10 }, desc: '+2–4 Hunger, +4 Energy, +20% speed 45s' },
  almond: { name: 'Almond Water', cat: 'drink', hunger: [3, 3], energy: [1, 1], sanity: 8, desc: '+3 Hunger, +1 Energy, +8 Sanity' },
  rock: { name: 'Rock', cat: 'rock' },
  banana: { name: 'Banana Peel', cat: 'banana' },
  key: { name: 'Saferoom Key', cat: 'key' },
};

// Sub-type odds inside each loot pool (from the design doc; the remaining
// share is filled by the Granola Bar and Almond Water).
export const FOOD_TABLE = [['bread', 60], ['granola', 35], ['cookie', 5]];
export const DRINK_TABLE = [['coffee', 20], ['energy', 15], ['almond', 65]];

// Melee: fists are always available; weapons come from drawers and break after `dur` hits.
//  dmg = damage per hit (monsters have ~120 HP on Normal), cd = seconds between attacks,
//  range = reach in m, stagger = how long a hit stuns, kb = knockback in m.
export const WEAPONS = {
  fists:   { name: 'Fists',        dmg: 10, cd: 0.5,  range: 1.7, windup: 0.11, stagger: 0.45, kb: 1.5, fist: true },
  pipe:    { name: 'Lead Pipe',    dmg: 24, cd: 0.62, range: 2.0, windup: 0.2,  stagger: 0.55, kb: 1.9, dur: 25 },
  crowbar: { name: 'Crowbar',      dmg: 27, cd: 0.6,  range: 2.0, windup: 0.19, stagger: 0.55, kb: 1.9, dur: 30 },
  bat:     { name: 'Baseball Bat', dmg: 32, cd: 0.72, range: 2.2, windup: 0.22, stagger: 0.7,  kb: 2.6, dur: 20 },
  axe:     { name: 'Fire Axe',     dmg: 48, cd: 0.95, range: 2.2, windup: 0.3,  stagger: 0.8,  kb: 2.2, dur: 14 },
};
export const WEAPON_TABLE = [['pipe', 40], ['crowbar', 30], ['bat', 22], ['axe', 8]];

export const SLOTS = ['flashlight', 'food', 'drink', 'rock', 'banana', 'key', 'melee'];
export const SUBTYPES = { food: ['bread', 'granola', 'cookie'], drink: ['coffee', 'energy', 'almond'] };

export class Inventory {
  constructor() {
    this.counts = { battery: 1, bread: 0, granola: 0, cookie: 0, coffee: 0, energy: 0, almond: 0, rock: 0, banana: 0, key: 0 };
    this.slot = 0;
    this.sub = { food: 'bread', drink: 'almond' };
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
    const cat = ITEMS[item].cat;
    if (SUBTYPES[cat] && !this.counts[item]) {
      const next = SUBTYPES[cat].find((s) => this.counts[s] > 0);
      if (next) this.sub[cat] = next;
    }
    return true;
  }

  catCount(cat) {
    if (cat === 'melee') return this.weapons.length;
    if (SUBTYPES[cat]) return SUBTYPES[cat].reduce((a, s) => a + this.counts[s], 0);
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
  }

  throw(type, origin, dir, strength = 1) {
    const M = this.game.mats;
    const mesh = type === 'rock' ? Models.rock(M, Math.floor(Math.random() * 3)) : Models.bananaPeel(M);
    mesh.position.copy(origin);
    this.game.scene.add(mesh);
    const speed = (type === 'rock' ? 12 : 8) * strength;
    const vel = dir.clone().multiplyScalar(speed);
    vel.y += type === 'rock' ? 1.8 : 2.2;
    this.list.push({ type, mesh, vel, hitFloor: false, life: 0, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0), lastHit: null });
  }

  placePeel(x, z) {
    const M = this.game.mats;
    const mesh = Models.bananaPeel(M);
    mesh.position.set(x, 0.01, z);
    mesh.rotation.y = Math.random() * 6.28;
    this.game.scene.add(mesh);
    const it = this.game.world.addDynamicPickup('banana', mesh, x, 0, z);
    const peel = { mesh, x, z, it };
    it.onRemove = () => { const i = this.peels.indexOf(peel); if (i >= 0) this.peels.splice(i, 1); };
    this.peels.push(peel);
    this.game.audio.squelch(mesh.position);
    this.game.entities.noise(x, z, 'peel');
  }

  update(dt) {
    const W = this.game.world, E = this.game.entities, A = this.game.audio;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const m = p.mesh;
      p.life += dt;
      // substep so fast rocks can't tunnel through thin walls
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
            if (b.top < 1.2 && m.position.y > b.top - 0.15 && p.vel.y < 0) { m.position.y = b.top + 0.06; p.vel.y *= -0.3; p.vel.x *= 0.6; p.vel.z *= 0.6; }
            else if (px <= b.minX - 0.05 || px >= b.maxX + 0.05) { p.vel.x *= -0.35; m.position.x = px; p.vel.z *= 0.7; }
            else { p.vel.z *= -0.35; m.position.z = pz; p.vel.x *= 0.7; }
            if (p.type === 'rock' && b !== p.lastHit && p.vel.length() > 2) { A.rockHit(m.position, 0.8); E.noise(m.position.x, m.position.z, 'rock'); }
            p.lastHit = b;
          }
        }
      }
      m.rotation.x += p.spin.x * dt; m.rotation.y += p.spin.y * dt;
      if (m.position.y > 2.92) { m.position.y = 2.92; p.vel.y = -Math.abs(p.vel.y) * 0.3; }
      // entity hits
      const e = p.vel.length() > 3 ? E.hitTest(m.position.x, m.position.y, m.position.z, 0.5) : null;
      if (e) {
        e.trip(p.type === 'rock' ? ENTITY.tripSeconds : ENTITY.slipSeconds);
        this.game.onEntityTripped(e, p.type);
        p.vel.multiplyScalar(-0.2);
        if (p.type === 'rock') A.rockHit(m.position, 1);
      }
      // floor
      const ground = p.type === 'rock' ? 0.05 : 0.01;
      if (m.position.y <= ground) {
        m.position.y = ground;
        if (!p.hitFloor) {
          p.hitFloor = true;
          if (p.type === 'rock') { A.rockHit(m.position, 1); E.noise(m.position.x, m.position.z, 'rock'); }
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
        } else {
          m.position.y = 0.05; m.rotation.x = 0; m.rotation.z = 0;
          W.addDynamicPickup('rock', m, m.position.x, 0, m.position.z);
        }
      }
    }
    // banana peels trip running entities
    for (let i = this.peels.length - 1; i >= 0; i--) {
      const pl = this.peels[i];
      for (const e of E.list) {
        if (e.stun > 0 || e.dying || e.speed < 1.9) continue;
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

  placePeelSilent(x, z) {
    const M = this.game.mats;
    const mesh = Models.bananaPeel(M);
    mesh.position.set(x, 0.01, z);
    mesh.rotation.y = Math.random() * 6.28;
    this.game.scene.add(mesh);
    const it = this.game.world.addDynamicPickup('banana', mesh, x, 0, z);
    const peel = { mesh, x, z, it };
    it.onRemove = () => { const i = this.peels.indexOf(peel); if (i >= 0) this.peels.splice(i, 1); };
    this.peels.push(peel);
  }

  clear() {
    for (const p of this.list) this.game.scene.remove(p.mesh);
    this.list.length = 0;
    this.peels.length = 0;
  }
}
