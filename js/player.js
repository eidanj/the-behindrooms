// Player: movement, head-bob, jumping, survival stats, flashlight and
// held-item actions.

import * as THREE from '../lib/three.module.min.js';
import { PLAYER, FLASHLIGHT, ENTITY } from './config.js';
import { ITEMS, Inventory, SLOTS } from './items.js';
import { clamp } from './rng.js';

const tmp = new THREE.Vector3();
const rnd = (r) => (Array.isArray(r) ? r[0] + Math.round(Math.random() * (r[1] - r[0])) : r || 0);

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.inv = new Inventory();
    this.battery = FLASHLIGHT.batterySeconds;
    this.cookieBonus = 0;
    this.reset(new THREE.Vector3(), false);
  }

  reset(spawn, keepInventory) {
    this.pos.copy(spawn);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.onGround = true;
    this.yaw = 0;
    this.pitch = 0;
    this.sanity = 100;
    this.hunger = 100;
    this.energy = PLAYER.maxEnergy;
    this.stars = keepInventory ? this.stars : 0;
    this.dead = false;
    this.flashlightOn = false;
    this.flashBright = 1;
    if (!keepInventory) {
      this.inv = new Inventory();
      this.inv.counts.battery = FLASHLIGHT.startBatteries;
      this.battery = FLASHLIGHT.batterySeconds;
      this.cookieBonus = 0;
      this.stars = 0;
    }
    this.boost = null;
    this.crash = null;
    this.bobPhase = 0;
    this.bobAmt = 0;
    this.sprinting = false;
    this.moving = false;
    this.inSafe = true;
    this.inCamp = true;
    this.pending = null;
    this.cooldown = 0;
    this.eye = PLAYER.eyeHeight;
    this.restT = 0;
    this.landKick = 0;
    this.airTime = 0;
  }

  get feetY() { return this.pos.y; }

  speedMult() {
    let m = 1 + this.cookieBonus;
    if (this.boost) m += this.boost.mult;
    if (this.crash) m += this.crash.mult;
    if (this.energy <= 0) m *= 0.85;
    if (this.hunger <= 0) m *= 0.9;
    return m;
  }

  lookDir(out) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  update(dt, input, ctx) {
    const g = this.game, W = g.world, S = g.settings;
    if (this.dead) return;

    // ── look ──
    const sens = 0.0022 * S.sensitivity;
    this.yaw -= input.dx * sens;
    this.pitch -= input.dy * sens * (S.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.5, 1.5);
    if (input.dx || input.dy) g.tutEvent('look', Math.abs(input.dx) + Math.abs(input.dy));

    // ── move ──
    let f = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
    let r = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
    const len = Math.hypot(f, r);
    if (len > 0) { f /= len; r /= len; }
    const wantSprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const canSprint = this.hunger >= PLAYER.sprintHungerMin && this.energy > 0 && f > 0.1;
    if (wantSprint && !canSprint && len > 0 && !this._sprintWarned) {
      this._sprintWarned = true;
      g.toast(this.hunger < PLAYER.sprintHungerMin ? "Too hungry to sprint — eat something" : "Too exhausted to sprint — rest or drink something", 'bad');
      setTimeout(() => (this._sprintWarned = false), 6000);
    }
    this.sprinting = wantSprint && canSprint && len > 0;
    let speed = PLAYER.walkSpeed * this.speedMult();
    if (this.sprinting) speed *= PLAYER.sprintMult;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const tx = (-sy * f + cy * r) * speed, tz = (-cy * f - sy * r) * speed;
    const accel = this.onGround ? 14 : 3;
    this.vel.x += (tx - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (tz - this.vel.z) * Math.min(1, dt * accel);
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    W.collide(this.pos, PLAYER.radius, this.pos.y, PLAYER.stepHeight);
    if (!W.roomAt(this.pos.x, this.pos.z)) { this.pos.x = ox; this.pos.z = oz; }
    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
    const hs = dt > 0 ? moved / dt : 0;
    this.moving = hs > 0.5 && len > 0;
    if (this.moving) g.tutEvent('walk', moved);
    if (this.sprinting && this.moving) g.tutEvent('sprint', dt);

    // ── jump / gravity ──
    if (input.pressed('Space') && this.onGround) {
      this.vy = PLAYER.jumpVelocity;
      this.onGround = false;
      g.tutEvent('jump');
    }
    this.vy -= PLAYER.gravity * dt;
    this.pos.y += this.vy * dt;
    const ground = W.groundAt(this.pos.x, this.pos.z, PLAYER.radius, this.pos.y);
    if (this.pos.y <= ground) {
      if (!this.onGround) {
        const sp = -this.vy;
        this.pos.y = ground;
        this.vy = 0;
        this.onGround = true;
        if (sp > 2.5) { this.landKick = Math.min(0.08, sp * 0.012); g.onPlayerLand(sp, ground); }
      } else { this.pos.y = ground; this.vy = 0; }
    } else if (this.onGround && this.pos.y - ground < 0.33 && this.vy <= 0) {
      this.pos.y = ground; this.vy = 0;
    } else this.onGround = false;
    this.landKick *= Math.max(0, 1 - dt * 8);

    // ── head bob ──
    const bobTarget = this.moving && this.onGround ? (this.sprinting ? 1.5 : 1) : 0;
    this.bobAmt += (bobTarget - this.bobAmt) * Math.min(1, dt * 6);
    if (this.moving && this.onGround) {
      const sps = (this.sprinting ? 2.55 : 1.85) * Math.min(1.25, Math.max(0.7, this.speedMult()));
      const prev = this.bobPhase;
      this.bobPhase += dt * sps * Math.PI;
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) this._footstep();
    }

    this._stats(dt, ctx);
    this._actions(dt, input, ctx);
  }

  _footstep() {
    const g = this.game;
    g.audio.footstep(this.sprinting);
    g.entities.noise(this.pos.x, this.pos.z, this.sprinting ? 'sprint' : 'walk');
  }

  _stats(dt, ctx) {
    const g = this.game;
    const dm = ctx.diff.statDrainMult * (ctx.tutorial ? 0 : 1);
    const tiredMult = this.sanity < 50 ? 1.5 : 1;
    if (this.moving) {
      this.hunger -= (dt * (this.sprinting ? 3 : 1)) / 10 * dm;
      this.energy -= (dt * (this.sprinting ? 4 : 1)) / 60 * dm * tiredMult;
      this.restT = 0;
    } else {
      this.restT += dt;
      if (this.restT > 3) this.energy += dt / 20;
    }
    this.hunger = clamp(this.hunger, 0, 100);
    this.energy = clamp(this.energy, 0, PLAYER.maxEnergy);

    const near = ctx.nearestDist < ENTITY.nearRadius;
    let drain = 0;
    if (!this.inCamp) drain += ctx.night ? 1 / 30 : 1 / 120;
    if (near) drain += 1 / 5;
    if (this.hunger < 35) drain += 1 / 15;
    if (this.hunger <= 0) drain += 1 / 10;
    drain *= dm;
    let regen = 0;
    if (this.hunger >= 35 && !near) regen += 1 / 30;
    if (this.inCamp && !near) regen += 1 / 6;
    this.sanity = clamp(this.sanity + (regen - drain) * dt, 0, 100);
    if (this.sanity <= 0 && !ctx.tutorial) { g.die('Insanity'); return; }

    if (this.boost) {
      this.boost.t -= dt;
      if (this.boost.t <= 0) {
        this.crash = { mult: this.boost.crash, t: this.boost.crashDur };
        this.boost = null;
        g.toast('The caffeine wears off… you crash.', 'bad');
      }
    }
    if (this.crash) { this.crash.t -= dt; if (this.crash.t <= 0) this.crash = null; }

    if (this.flashlightOn) {
      this.battery -= dt;
      if (this.battery <= 0) {
        this.battery = 0;
        this.flashlightOn = false;
        g.audio.click();
        g.toast(this.inv.counts.battery > 0 ? 'Battery dead — press <kbd>R</kbd> to replace it' : 'Battery dead — find batteries in drawers', 'bad', 4500);
      }
    }
  }

  _actions(dt, input, ctx) {
    const g = this.game;
    for (let i = 0; i < 6; i++) {
      if (input.pressed('Digit' + (i + 1)) || input.pressed('Numpad' + (i + 1))) this.select(i);
    }
    if (input.wheel) this.select((this.inv.slot + Math.sign(input.wheel) + 6) % 6);
    if (input.pressed('KeyL')) this.toggleFlashlight();
    if (input.pressed('KeyR')) this.replaceBattery();
    if (input.pressed('KeyE')) g.interact();
    if (this.pending) { this.pending.t -= dt; if (this.pending.t <= 0) { const fn = this.pending.fn; this.pending = null; fn(); } }
    if (this.cooldown > 0) this.cooldown -= dt;
    if (input.mousePressed(0)) this.useHeld();
    if (input.mousePressed(2)) this.altUse();
  }

  select(i) {
    const res = this.inv.select(i);
    if (res) this.game.audio.click();
    if (res === 'cycled') this.game.toast(`Holding: ${ITEMS[this.inv.held()].name}`);
  }

  toggleFlashlight() {
    const g = this.game;
    if (!this.flashlightOn && this.battery <= 0) {
      g.audio.click();
      g.toast(this.inv.counts.battery > 0 ? 'No charge — press <kbd>R</kbd> to replace the battery' : 'No charge — find batteries in drawers', 'bad');
      return;
    }
    this.flashlightOn = !this.flashlightOn;
    g.audio.click();
    if (SLOTS[this.inv.slot] === 'flashlight') g.hands.play('click');
    g.tutEvent('flash');
  }

  replaceBattery() {
    const g = this.game;
    if (this.battery >= FLASHLIGHT.batterySeconds - 1) { g.toast('Battery is already full'); return; }
    if (!this.inv.take('battery')) { g.audio.denied(); g.toast('No spare batteries', 'bad'); return; }
    this.battery = FLASHLIGHT.batterySeconds;
    g.audio.battery();
    g.toast(`Fresh battery in · ${this.inv.counts.battery} spare`, 'good');
  }

  useHeld() {
    const g = this.game;
    if (this.cooldown > 0 || g.hands.busy) return;
    const cat = SLOTS[this.inv.slot];
    const held = this.inv.held();
    if (cat === 'flashlight') { this.toggleFlashlight(); return; }
    if (!held) {
      g.toast({ food: 'No food — search filing cabinets', drink: 'No drinks — search filing cabinets', rock: 'No rocks — look on the floor', banana: 'No banana peels — look on the floor', key: 'No keys — search filing cabinets' }[cat]);
      return;
    }
    const d = ITEMS[held];
    if (d.cat === 'food' || d.cat === 'drink') {
      g.hands.play(d.cat === 'food' ? 'eat' : 'drink');
      this.cooldown = 1.05;
      this.pending = { t: 0.5, fn: () => this.consume(held) };
      if (d.cat === 'food') g.audio.eat(); else g.audio.drink();
      g.entities.noise(this.pos.x, this.pos.z, 'peel');
    } else if (held === 'rock' || held === 'banana') {
      g.hands.play('throw');
      this.cooldown = 0.6;
      this.pending = {
        t: 0.24,
        fn: () => {
          if (!this.inv.take(held)) return;
          const cam = g.camera;
          const dir = cam.getWorldDirection(tmp).clone();
          const origin = cam.position.clone().addScaledVector(dir, 0.45);
          origin.y -= 0.12;
          g.throwables.throw(held, origin, dir);
          g.audio.whoosh();
          g.tutEvent(held === 'rock' ? 'rock' : 'peel');
        },
      };
    } else if (held === 'key') {
      g.toast('Look at a locked saferoom door and press <kbd>E</kbd> to use a key');
    }
  }

  altUse() {
    const g = this.game;
    if (this.cooldown > 0) return;
    if (this.inv.held() === 'banana') {
      if (!this.inv.take('banana')) return;
      g.hands.play('use');
      this.cooldown = 0.5;
      const x = this.pos.x - Math.sin(this.yaw) * 0.6, z = this.pos.z - Math.cos(this.yaw) * 0.6;
      g.throwables.placePeel(x, z);
      g.tutEvent('peel');
    }
  }

  consume(item) {
    const g = this.game;
    if (!this.inv.take(item)) return;
    const d = ITEMS[item];
    const h = rnd(d.hunger), e = rnd(d.energy);
    this.hunger = Math.min(100, this.hunger + h);
    this.energy = Math.min(PLAYER.maxEnergy, this.energy + e);
    let msg = `${d.name}: +${h} Hunger`;
    if (e) msg += `, +${e} Energy`;
    if (d.sanity) { this.sanity = Math.min(100, this.sanity + d.sanity); msg += `, +${d.sanity} Sanity`; }
    if (d.speedPerm) {
      if (this.cookieBonus < 0.05 - 1e-6) { this.cookieBonus = Math.min(0.05, this.cookieBonus + d.speedPerm); msg += `, permanent speed +${(this.cookieBonus * 100).toFixed(1)}%`; }
      else msg += ' (speed bonus maxed)';
    }
    if (d.boost) { this.boost = { ...d.boost, t: d.boost.dur, item }; this.crash = null; msg += `, +${Math.round(d.boost.mult * 100)}% speed for ${d.boost.dur}s`; }
    g.toast(msg, 'good');
    g.tutEvent('ate');
  }
}
