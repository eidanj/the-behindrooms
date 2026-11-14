// Player: movement (ledges, ladders, water, crouching, vent crawling),
// head-bob, jumping, health + survival stats, flashlight and held-item actions.

import * as THREE from '../lib/three.module.min.js';
import { PLAYER, FLASHLIGHT, ENTITY, VENT } from './config.js';
import { ITEMS, Inventory, SLOTS, WEAPONS } from './items.js';
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
    this.health = PLAYER.maxHealth;
    this.hurtT = 99;
    this.dead = false;
    this.flashlightOn = false;
    this.flashBright = 1;
    this.flashCut = 0;
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
    this.fallFrom = spawn.y;
    this.crouching = false;
    this.crouchMeter = 1;
    this.crouchLock = false;
    this.mode = 'walk';       // walk | vent | anim
    this.vent = null;
    this.ventT = 0;
    this.wading = false;
    this.onLadder = false;
    this.starveT = 0;
  }

  get feetY() { return this.pos.y; }
  get eyeY() { return this.pos.y + this.eye; }
  get inVent() { return this.mode === 'vent'; }

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

  // amount of damage, the thing that caused it (for the death screen)
  damage(amount, cause, from) {
    const g = this.game;
    if (this.dead || amount <= 0) return;
    this.health -= amount;
    this.hurtT = 0;
    g.onPlayerHurt(amount, from);
    if (this.health <= 0) { this.health = 0; g.die(cause, from && from.def ? { entity: from } : {}); }
  }

  heal(n) { this.health = Math.min(PLAYER.maxHealth, this.health + n); }

  _look(input) {
    const S = this.game.settings;
    const sens = 0.0022 * S.sensitivity;
    this.yaw -= input.dx * sens;
    this.pitch -= input.dy * sens * (S.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.5, 1.5);
    if (input.dx || input.dy) this.game.tutEvent('look', Math.abs(input.dx) + Math.abs(input.dy));
  }

  _moveInput(input) {
    let f = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
    let r = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
    if (input.moveX || input.moveY) { f = -input.moveY; r = input.moveX; }
    const len = Math.hypot(f, r);
    if (len > 1) { f /= len; r /= len; }
    return { f, r, len: Math.min(1, len) };
  }

  update(dt, input, ctx) {
    const g = this.game, W = g.world;
    if (this.dead) return;
    this.hurtT += dt;
    if (this.flashCut > 0) this.flashCut -= dt;
    if (this.mode === 'anim') { this._stats(dt, ctx); return; }
    this._look(input);
    if (this.mode === 'vent') { this._updateVent(dt, input, ctx); this._stats(dt, ctx); this._actions(dt, input, ctx); return; }

    const { f, r, len } = this._moveInput(input);

    // ── crouch (hold C, or press C if "toggle crouch" is on) ──
    const S = g.settings;
    let wantCrouch = S.crouchToggle ? this._crouchToggled : input.down('KeyC');
    if (input.pressed('KeyC') && S.crouchToggle) wantCrouch = this._crouchToggled = !this._crouchToggled;
    if (input.touchCrouch !== undefined) wantCrouch = wantCrouch || input.touchCrouch;
    if (this.crouchLock) { wantCrouch = false; if (input.touchCrouch) input.touchCrouch = false; }
    if (wantCrouch && !this.crouching && this.crouchMeter > 0.05) { this.crouching = true; g.tutEvent('crouch'); }
    else if (!wantCrouch && this.crouching) this.crouching = false;
    if (this.crouching) {
      this.crouchMeter -= dt / PLAYER.crouchMax;
      if (this.crouchMeter <= 0) {
        this.crouchMeter = 0; this.crouching = false; this.crouchLock = true; this._crouchToggled = false;
        g.toast("Your legs give out — you can't crouch for a while", 'bad');
      }
    } else {
      this.crouchMeter = Math.min(1, this.crouchMeter + dt / PLAYER.crouchRecharge);
      if (this.crouchLock && this.crouchMeter >= 1) { this.crouchLock = false; g.toast('You can crouch again'); }
    }
    const eyeT = this.crouching ? PLAYER.crouchEye : PLAYER.eyeHeight;
    this.eye += (eyeT - this.eye) * Math.min(1, dt * 9);

    // ── move ──
    const wantSprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const canSprint = this.hunger >= PLAYER.sprintHungerMin && this.energy > 0 && f > 0.1 && !this.crouching;
    if (wantSprint && !canSprint && len > 0 && !this._sprintWarned && !this.crouching) {
      this._sprintWarned = true;
      g.toast(this.hunger < PLAYER.sprintHungerMin ? 'Too hungry to sprint — eat something' : 'Too exhausted to sprint — rest or drink something', 'bad');
      setTimeout(() => (this._sprintWarned = false), 6000);
    }
    this.sprinting = wantSprint && canSprint && len > 0;
    const water = W.waterAt(this.pos.x, this.pos.z);
    this.wading = !Number.isNaN(water) && water > this.pos.y + 0.05;
    let speed = PLAYER.walkSpeed * this.speedMult();
    if (this.sprinting) speed *= PLAYER.sprintMult;
    if (this.crouching) speed *= PLAYER.crouchMult;
    if (this.wading) speed *= PLAYER.waterSpeed;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const tx = (-sy * f + cy * r) * speed, tz = (-cy * f - sy * r) * speed;
    const accel = this.onGround || this.onLadder ? 14 : 3;
    this.vel.x += (tx - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (tz - this.vel.z) * Math.min(1, dt * accel);
    const ox = this.pos.x, oz = this.pos.z;
    const step = PLAYER.stepHeight;
    const R = PLAYER.radius;
    // ledges: try the full move, then each axis alone (so you slide along edges)
    let nx = ox + this.vel.x * dt, nz = oz + this.vel.z * dt;
    if (W.terrainBlocked(nx, nz, R, this.pos.y, step)) {
      if (!W.terrainBlocked(nx, oz, R, this.pos.y, step)) nz = oz;
      else if (!W.terrainBlocked(ox, nz, R, this.pos.y, step)) nx = ox;
      else { nx = ox; nz = oz; }
    }
    this.pos.x = nx; this.pos.z = nz;
    W.collide(this.pos, R, this.pos.y, step);
    if (!W.roomAt(this.pos.x, this.pos.z) || W.terrainBlocked(this.pos.x, this.pos.z, R * 0.8, this.pos.y, step + 0.05)) { this.pos.x = ox; this.pos.z = oz; }
    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
    const hs = dt > 0 ? moved / dt : 0;
    this.moving = hs > 0.4 && len > 0;
    if (this.moving) g.tutEvent('walk', moved);
    if (this.sprinting && this.moving) g.tutEvent('sprint', dt);

    // ── ladders (pits + pools): push into the ladder or hold Space to climb ──
    const lad = W.ladderAt(this.pos.x, this.pos.z, this.pos.y);
    this.onLadder = false;
    if (lad) {
      const into = (tx * lad.nx + tz * lad.nz) / Math.max(0.01, speed);
      if (into > 0.3 || input.down('Space') || input.touchJumpHeld) {
        this.vy = 2.6;
        this.onGround = false;
        this.onLadder = true;
        this.fallFrom = this.pos.y;
        if ((this._climbT = (this._climbT || 0) + dt) > 0.32) { this._climbT = 0; g.audio.clank(); }
      } else if (this.vy < -1.2) this.vy = -1.2;
    }

    // ── jump / gravity ──
    if (input.pressed('Space') && this.onGround && !this.crouching) {
      this.vy = PLAYER.jumpVelocity * (this.wading ? 0.6 : 1);
      this.onGround = false;
      this.fallFrom = this.pos.y;
      g.tutEvent('jump');
    }
    if (!this.onLadder) this.vy -= PLAYER.gravity * dt;
    this.pos.y += this.vy * dt;
    const ground = W.groundAt(this.pos.x, this.pos.z, R, this.pos.y);
    if (this.pos.y <= ground) {
      if (!this.onGround) {
        const sp = -this.vy;
        const drop = Math.max(this.fallFrom, this.pos.y) - ground;
        this.pos.y = ground;
        this.vy = 0;
        this.onGround = true;
        this.fallFrom = ground;
        if (sp > 2.5) { this.landKick = Math.min(0.1, sp * 0.012); g.onPlayerLand(sp, ground, drop, this.wading || !Number.isNaN(W.waterAt(this.pos.x, this.pos.z))); }
      } else { this.pos.y = ground; this.vy = 0; this.fallFrom = ground; }
    } else if (this.onGround && this.pos.y - ground < 0.33 && this.vy <= 0) {
      this.pos.y = ground; this.vy = 0; this.fallFrom = ground;
    } else {
      if (this.onGround) this.fallFrom = this.pos.y;
      this.onGround = false;
      this.fallFrom = Math.max(this.fallFrom, this.pos.y);
    }
    this.landKick *= Math.max(0, 1 - dt * 8);

    // ── head bob ──
    const bobTarget = this.moving && this.onGround ? (this.sprinting ? 1.5 : this.crouching ? 0.6 : 1) : 0;
    this.bobAmt += (bobTarget - this.bobAmt) * Math.min(1, dt * 6);
    if (this.moving && this.onGround) {
      const sps = (this.sprinting ? 2.55 : this.crouching ? 1.3 : 1.85) * Math.min(1.25, Math.max(0.7, this.speedMult()));
      const prev = this.bobPhase;
      this.bobPhase += dt * sps * Math.PI;
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) this._footstep();
    }

    this._stats(dt, ctx);
    this._actions(dt, input, ctx);
  }

  _footstep() {
    const g = this.game;
    const surf = g.world.surfaceAt(this.pos.x, this.pos.z);
    g.audio.footstep(this.sprinting, this.wading ? 'water' : surf, this.crouching);
    // crouching = silent: monsters can't hear you
    if (this.crouching) return;
    g.entities.noise(this.pos.x, this.pos.z, this.sprinting || this.wading ? 'sprint' : 'walk');
  }

  // ── vents ─────────────────────────────────────────────────
  enterVent(vent, x, z) {
    this.mode = 'vent';
    this.vent = vent;
    this.ventT = 0;
    this.crouching = false;
    this.pos.set(x, VENT.floorY, z);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.eye = 0.42;
    this.onGround = true;
  }

  _updateVent(dt, input, ctx) {
    const g = this.game, W = g.world, V = this.vent;
    const { f, r, len } = this._moveInput(input);
    const sprint = (input.down('ShiftLeft') || input.down('ShiftRight')) && f > 0.1;
    const speed = (sprint ? VENT.crawlSprint : VENT.crawlSpeed) * (len > 0 ? 1 : 0);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const tx = (-sy * f + cy * r) * speed, tz = (-cy * f - sy * r) * speed;
    this.vel.x += (tx - this.vel.x) * Math.min(1, dt * 10);
    this.vel.z += (tz - this.vel.z) * Math.min(1, dt * 10);
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    W.collide(this.pos, 0.3, VENT.floorY, 0.1, true, 0.8);
    if (!W.ventAt(this.pos.x, this.pos.z)) { this.pos.x = ox; this.pos.z = oz; }
    this.pos.y = VENT.floorY;
    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
    this.moving = moved / Math.max(dt, 1e-4) > 0.3;
    this.sprinting = sprint && this.moving;
    this.eye += (0.42 - this.eye) * Math.min(1, dt * 8);
    // durability: drops while crawling (faster when hurrying), slowly recovers when still
    const st = V.st;
    if (this.moving) st.dur -= dt * (this.sprinting ? VENT.drainSprint : VENT.drainMove);
    else st.dur = Math.min(VENT.durability, st.dur + dt * VENT.regen);
    this.ventT += dt;
    if (this.moving) {
      const prev = this.bobPhase;
      this.bobPhase += dt * (this.sprinting ? 2.4 : 1.6) * Math.PI;
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) {
        g.audio.ventThump(this.sprinting);
        if (this.sprinting) g.entities.noise(this.pos.x, this.pos.z, 'peel');
        if (st.dur < 45 && Math.random() < 0.3) g.audio.ventCreak(1 - st.dur / 45);
      }
    }
    this.bobAmt += ((this.moving ? 1 : 0) - this.bobAmt) * Math.min(1, dt * 6);
    if (st.dur <= 0 || this.ventT >= VENT.maxTime) g.ventCollapse(st.dur <= 0 ? 'worn' : 'time');
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

    // health: slowly regenerates a while after you were last hurt (faster at camp)
    if (this.hurtT > PLAYER.regenDelay && this.health < PLAYER.maxHealth && this.hunger > 0) {
      this.heal(dt * PLAYER.regenRate * (this.inCamp ? 6 : 1));
    }
    if (this.hunger <= 0 && !ctx.tutorial) {
      this.starveT += dt;
      if (this.starveT > 4) { this.starveT = 0; this.damage(1, 'Starvation'); }
    } else this.starveT = 0;

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
    const NS = SLOTS.length;
    for (let i = 0; i < NS; i++) {
      if (input.pressed('Digit' + (i + 1)) || input.pressed('Numpad' + (i + 1))) this.select(i);
    }
    if (input.wheel) this.select((this.inv.slot + Math.sign(input.wheel) + NS) % NS);
    if (input.pressed('KeyF') && this.mode === 'walk') this.melee();
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
    if (res === 'cycled') {
      const h = this.inv.held();
      this.game.toast(`Holding: ${(WEAPONS[h] || ITEMS[h]).name}`);
    }
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

  melee() {
    const g = this.game;
    if (this.mode !== 'walk') return;
    const mi = SLOTS.indexOf('melee');
    if (this.inv.slot !== mi) {
      if (g.hands.busy || g.combat.cooldown > 0) return;
      this.inv.slot = mi;
      g.hands.snapTo(this.inv.held());
    }
    g.combat.attack();
  }

  // Left click: use what you're holding. The flashlight toggles, food/drink/meds
  // are used, rocks/peels/noisemakers are thrown; otherwise punch.
  useHeld() {
    const g = this.game;
    if (this.cooldown > 0 || g.hands.busy) return;
    const held = this.inv.held();
    if (held === 'flashlight') { this.toggleFlashlight(); this.cooldown = 0.2; return; }
    const d = held && ITEMS[held];
    const throwable = held === 'rock' || held === 'banana' || held === 'noisemaker';
    const usable = d && (d.cat === 'food' || d.cat === 'drink' || d.cat === 'med' || throwable);
    if (!usable) { if (this.mode === 'walk') this.melee(); return; }
    if (d.cat === 'med') {
      if (this.health >= PLAYER.maxHealth - 0.5) { g.toast('You are not hurt'); return; }
      g.hands.play('eat');
      this.cooldown = 1.2;
      g.audio.heal();
      this.pending = { t: 0.8, fn: () => { if (!this.inv.take(held)) return; this.heal(d.heal); g.toast(`${d.name}: +${d.heal} Health`, 'good'); } };
    } else if (d.cat === 'food' || d.cat === 'drink') {
      g.hands.play(d.cat === 'food' ? 'eat' : 'drink');
      this.cooldown = 1.05;
      this.pending = { t: 0.5, fn: () => this.consume(held) };
      if (d.cat === 'food') g.audio.eat(); else g.audio.drink();
      g.entities.noise(this.pos.x, this.pos.z, 'eat');
    } else if (throwable) {
      if (this.mode === 'vent') { g.toast('No room to throw in here'); return; }
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
          g.tutEvent(held === 'banana' ? 'peel' : 'rock');
        },
      };
    }
  }

  altUse() {
    const g = this.game;
    if (this.cooldown > 0 || this.mode !== 'walk') return;
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
    if (d.peel) { this.inv.add('banana'); msg += ' · kept the peel (slot 5)'; }
    g.toast(msg, 'good');
    g.tutEvent('ate', item);
  }
}
