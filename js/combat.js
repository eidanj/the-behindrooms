// Melee combat: punch with fists or swing weapons found in drawers.
//  • A hit staggers + knocks the monster back, so you can keep it off you.
//  • Monsters that are already down (tripped / slipped) take double damage.
//  • Weapons break after a number of hits.
//  • Killing a monster awards +1 ★. Hitting a daytime monster enrages it.

import * as THREE from '../lib/three.module.min.js';
import { WEAPONS } from './items.js';

const MAX_P = 90;
const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();

export class Combat {
  constructor(game) {
    this.game = game;
    this.cooldown = 0;
    this.pending = null;
    this.targetT = 0;
    this.target = null;
    this.parts = [];
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.035, 0.035), new THREE.MeshBasicMaterial({ color: 0x2c0507 }), MAX_P);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    game.scene.add(this.mesh);
    this.targetEl = document.getElementById('target');
    this.targetName = this.targetEl.querySelector('.tn');
    this.targetBar = this.targetEl.querySelector('.bar > div');
  }

  currentWeapon() {
    const inv = this.game.player.inv;
    const w = inv.weapon();
    return { def: WEAPONS[w ? w.type : 'fists'], item: w };
  }

  attack() {
    const g = this.game, P = g.player;
    if (P.dead || this.cooldown > 0 || g.hands.busy) return;
    const { def } = this.currentWeapon();
    this.cooldown = def.cd;
    g.hands.play(def.fist ? 'punch' : 'swing');
    g.audio.swing(!def.fist);
    g.tutEvent('attack');
    this.pending = { t: def.windup };
  }

  _resolve() {
    const g = this.game, P = g.player, E = g.entities, W = g.world, A = g.audio;
    const { def, item } = this.currentWeapon();
    const cam = g.camera;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    let best = null, bd = Infinity;
    for (const e of E.list) {
      if (e.killed || e.dying) continue;
      const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > def.range + 0.35) continue;
      if (d > 0.7 && (dx * fx + dz * fz) / d < 0.72) continue; // must be roughly in front of you
      if (!W.lineOfSight(cam.position.x, cam.position.y, cam.position.z, e.pos.x, 1.4, e.pos.z, 0.3)) continue;
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) return; // whiff
    const downed = best.stun > 0;
    const dmg = Math.round(def.dmg * (downed ? 2 : 1) * (0.9 + Math.random() * 0.2));
    const killed = best.takeHit(dmg, P.pos.x, P.pos.z, def.stagger, def.kb);
    // gore + sound
    const hx = best.pos.x - (best.pos.x - P.pos.x) / Math.max(bd, 0.01) * 0.25;
    const hz = best.pos.z - (best.pos.z - P.pos.z) / Math.max(bd, 0.01) * 0.25;
    this.burst(hx, 1.45, hz, best.pos.x - P.pos.x, best.pos.z - P.pos.z, def.fist ? 8 : 14);
    A.hitFlesh(best.pos, !def.fist);
    g.landKick(def.fist ? 0.015 : 0.03);
    E.noise(P.pos.x, P.pos.z, 'fight');
    this.target = best;
    this.targetT = 3;
    if (downed) g.toast(`Hit while it's down: ${dmg} damage`, 'good', 1500);

    if (item) {
      item.dur--;
      if (item.dur <= 0) {
        P.inv.breakWeapon();
        A.weaponBreak();
        g.toast(`Your ${def.name} broke!`, 'bad', 3000);
      }
    }
    if (killed) {
      g.onEntityKilled(best);
    } else {
      A.monsterHurt(best.pos);
      if (!g.cycle.isNight && !best.enraged) {
        best.enraged = true;
        g.toast(`${best.name} is enraged — it will hunt you now!`, 'bad', 3500);
      }
    }
  }

  burst(x, y, z, dx, dz, n) {
    const d = Math.hypot(dx, dz) || 1;
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= MAX_P) this.parts.shift();
      this.parts.push({
        x, y: y + (Math.random() - 0.5) * 0.3, z,
        vx: (dx / d) * (1 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.6,
        vy: 0.5 + Math.random() * 2.2,
        vz: (dz / d) * (1 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.6,
        life: 0.9 + Math.random() * 0.8, s: 0.6 + Math.random() * 0.9,
      });
    }
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.pending) { this.pending.t -= dt; if (this.pending.t <= 0) { this.pending = null; this._resolve(); } }

    // particles
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      if (p.y > 0.02) {
        p.vy -= 12 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y <= 0.02) { p.y = 0.02; p.vx = p.vz = p.vy = 0; }
      }
      const s = p.s * Math.min(1, p.life * 2);
      tmpM.makeScale(s, p.y <= 0.02 ? 0.2 : s, s);
      tmpM.setPosition(tmpV.set(p.x, p.y, p.z));
      this.mesh.setMatrixAt(n++, tmpM);
    }
    this.mesh.count = n;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;

    // target health bar
    if (this.targetT > 0) {
      this.targetT -= dt;
      const e = this.target;
      if (e) {
        this.targetEl.classList.remove('hidden');
        this.targetName.textContent = e.killed ? `${e.name} · DEAD` : e.name;
        this.targetBar.style.width = `${Math.max(0, e.hp / e.maxHp) * 100}%`;
      }
      if (this.targetT <= 0) this.targetEl.classList.add('hidden');
    }
  }

  clear() {
    this.parts.length = 0;
    this.mesh.count = 0;
    this.cooldown = 0;
    this.pending = null;
    this.targetT = 0;
    this.target = null;
    this.targetEl.classList.add('hidden');
  }
}
