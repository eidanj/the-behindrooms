// First-person hand (bottom-left) rendered in its own scene on top of
// the world, so it never clips into walls. The held model swaps when you
// change items, with lower/raise, eat, throw and click animations.

import * as THREE from '../lib/three.module.min.js';
import * as Models from './models.js';

const L = (o) => new THREE.MeshLambertMaterial(o);

export class Hands {
  constructor(M) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 10);
    this.amb = new THREE.AmbientLight(0xfff0d8, 1);
    this.key = new THREE.DirectionalLight(0xfff4e0, 0.9);
    this.key.position.set(0.6, 1, 0.5);
    this.spill = new THREE.PointLight(0xfff2d0, 0, 1.4, 2);
    this.spill.position.set(-0.1, -0.05, -0.75);
    this.scene.add(this.amb, this.key, this.spill);

    this.rig = new THREE.Group();
    this.base = new THREE.Vector3(-0.25, -0.235, -0.55);
    this.rig.position.copy(this.base);
    this.rig.rotation.set(0.12, 0.28, 0.12);
    this.scene.add(this.rig);
    this.hold = new THREE.Group();
    this.rig.add(this.hold);

    const skin = L({ color: 0xc8987a });
    const sleeve = L({ color: 0x2b3038 });
    const fist = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skin);
    fist.scale.set(0.043, 0.04, 0.054);
    this.hold.add(fist);
    const knG = new THREE.SphereGeometry(0.013, 8, 6);
    for (let i = 0; i < 4; i++) {
      const k = new THREE.Mesh(knG, skin);
      k.position.set(0.028, 0.022, -0.032 + i * 0.021);
      this.hold.add(k);
    }
    const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.055, 8), skin);
    thumb.rotation.x = Math.PI / 2 - 0.4;
    thumb.position.set(-0.012, 0.03, -0.035);
    this.hold.add(thumb);
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.033, 0.09, 10), skin);
    wrist.rotation.x = Math.PI / 2;
    wrist.position.set(0, -0.005, 0.07);
    this.hold.add(wrist);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.054, 0.5, 12), sleeve);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(0, -0.01, 0.33);
    this.hold.add(arm);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.03, 12), L({ color: 0x1e2228 }));
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, -0.01, 0.09);
    this.hold.add(cuff);

    this.items = {};
    this._buildItems(M);
    for (const k in this.items) { this.items[k].visible = false; this.hold.add(this.items[k]); }

    this.current = undefined;
    this.pending = undefined;
    this.switchT = 0; // 0 = raised, 1 = lowered
    this.switching = false;
    this.anim = null;
    this.sway = new THREE.Vector2();
    this.hidden = false;
  }

  _buildItems(M) {
    const I = this.items;
    // flashlight
    {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.17, 12), L({ color: 0x2a2a2c }));
      body.rotation.x = Math.PI / 2; body.position.z = -0.02;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.019, 0.05, 14), L({ color: 0x353538 }));
      head.rotation.x = Math.PI / 2; head.position.z = -0.125;
      this.lensMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.023, 16), this.lensMat);
      lens.position.z = -0.151; lens.rotation.y = Math.PI;
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.016), L({ color: 0x8a1a1a }));
      sw.position.set(0, 0.019, -0.06);
      g.add(body, head, lens, sw);
      I.flashlight = g;
    }
    {
      const g = new THREE.Group();
      const loaf = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, 0.07, 6, 12), L({ color: 0xc58a4a }));
      loaf.rotation.x = Math.PI / 2; loaf.scale.set(1, 1, 0.8); loaf.position.set(0, 0.03, -0.04);
      g.add(loaf);
      I.bread = g;
    }
    {
      const g = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.018, 0.12), new THREE.MeshPhongMaterial({ color: 0x2f62c8, shininess: 70 }));
      bar.position.set(0, 0.03, -0.05);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.019, 0.02), L({ color: 0xf2c230 }));
      stripe.position.set(0, 0.03, -0.07);
      g.add(bar, stripe);
      I.granola = g;
    }
    {
      const g = new THREE.Group();
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.012, 18), L({ color: 0xb5793a }));
      c.rotation.z = Math.PI / 2 - 0.3; c.position.set(0.0, 0.045, -0.035);
      g.add(c);
      const chipG = new THREE.SphereGeometry(0.0065, 5, 4);
      const chipM = L({ color: 0x3a2412 });
      for (let i = 0; i < 6; i++) {
        const ch = new THREE.Mesh(chipG, chipM);
        const a = i * 1.1, r = 0.012 + (i % 3) * 0.009;
        ch.position.set(-0.007, 0.045 + Math.sin(a) * r, -0.035 + Math.cos(a) * r);
        g.add(ch);
      }
      I.cookie = g;
    }
    {
      const g = new THREE.Group();
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.027, 0.11, 14), L({ color: 0xece8e0 }));
      cup.position.set(0, 0.04, -0.02);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.03, 0.045, 14), L({ color: 0x7a5232 }));
      band.position.set(0, 0.035, -0.02);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.037, 0.012, 14), L({ color: 0x2a2420 }));
      lid.position.set(0, 0.1, -0.02);
      g.add(cup, band, lid);
      I.coffee = g;
    }
    {
      const g = new THREE.Group();
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 16), L({ map: M.tex.can }));
      can.position.set(0, 0.04, -0.02);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.01, 16), new THREE.MeshPhongMaterial({ color: 0xc0c0c8, shininess: 90 }));
      top.position.set(0, 0.105, -0.02);
      g.add(can, top);
      I.energy = g;
    }
    {
      const g = new THREE.Group();
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.14, 14), new THREE.MeshPhongMaterial({ color: 0xd8e6ff, transparent: true, opacity: 0.6, shininess: 100 }));
      bottle.position.set(0, 0.05, -0.02);
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0285, 0.0285, 0.05, 14), L({ map: M.tex.bottle }));
      label.position.set(0, 0.05, -0.02);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.026, 0.03, 12), bottle.material);
      neck.position.set(0, 0.135, -0.02);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.016, 10), L({ color: 0x2a6adf }));
      cap.position.set(0, 0.157, -0.02);
      g.add(bottle, label, neck, cap);
      I.almond = g;
    }
    {
      const g = new THREE.Group();
      const r = Models.rock(M, 1);
      r.scale.setScalar(0.62);
      r.position.set(0, 0.035, -0.035);
      g.add(r);
      I.rock = g;
    }
    {
      const g = new THREE.Group();
      const p = Models.bananaPeel(M);
      p.scale.setScalar(0.85);
      p.rotation.set(Math.PI / 2 + 0.3, 0, 0);
      p.position.set(0, 0.03, -0.06);
      g.add(p);
      I.banana = g;
    }
    {
      const g = new THREE.Group();
      const brass = M.brass;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 16), brass);
      ring.position.set(0, 0.035, -0.035);
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.065), brass);
      shaft.position.set(0, 0.035, -0.085);
      const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.012, 0.008), brass); t1.position.set(0, 0.027, -0.105);
      const t2 = t1.clone(); t2.position.z = -0.09; t2.scale.y = 0.7;
      const tag = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.03, 0.04), L({ color: 0xb82222 }));
      tag.position.set(0, 0.012, -0.02);
      g.add(ring, shaft, t1, t2, tag);
      I.key = g;
    }
    // ── melee weapons: held upright through the fist, tipped forward ──
    const weapon = (build) => { const g = new THREE.Group(); build(g); g.rotation.x = -0.95; g.position.set(0, 0.0, -0.02); return g; };
    const metal = new THREE.MeshPhongMaterial({ color: 0x8a8d90, shininess: 60, specular: 0x444444 });
    I.pipe = weapon((g) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.62, 10), metal); p.position.y = 0.2;
      const j = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.05, 10), metal); j.position.y = 0.5;
      g.add(p, j);
    });
    I.crowbar = weapon((g) => {
      const m = new THREE.MeshPhongMaterial({ color: 0x7a1414, shininess: 40 });
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.6, 6), m); b.position.y = 0.2;
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.011, 6, 10, Math.PI * 1.2), m); h.position.set(0.05, 0.5, 0); h.rotation.z = -0.3;
      g.add(b, h);
    });
    I.bat = weapon((g) => {
      const wood = new THREE.MeshPhongMaterial({ color: 0xb98a52, shininess: 30 });
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.016, 0.7, 12), wood); b.position.y = 0.26;
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 10), wood); k.position.y = -0.1;
      const tape = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.017, 0.12, 10), L({ color: 0x1a1a1a })); tape.position.y = -0.02;
      g.add(b, k, tape);
    });
    I.axe = weapon((g) => {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.66, 8), L({ color: 0xa52a1e })); handle.position.y = 0.22;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.16), metal); head.position.set(0, 0.5, -0.06);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.13, 0.05), new THREE.MeshPhongMaterial({ color: 0xd8dadc, shininess: 100 })); blade.position.set(0, 0.5, -0.16);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.08, 4), metal); spike.rotation.x = Math.PI / 2; spike.position.set(0, 0.5, 0.05);
      g.add(handle, head, blade, spike);
    });
  }

  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  play(type) {
    const dur = { eat: 1.0, drink: 1.0, throw: 0.5, click: 0.16, use: 0.3, punch: 0.34, swing: 0.62 }[type] || 0.3;
    this.anim = { type, t: 0, dur };
  }

  get busy() { return !!this.anim && ['eat', 'drink', 'throw', 'punch', 'swing'].includes(this.anim.type); }

  update(dt, s) {
    // item swapping
    if (s.held !== this.current && !this.switching) { this.switching = true; this.pending = s.held; }
    if (this.switching) {
      if (this.pending !== this.current) {
        this.switchT = Math.min(1, this.switchT + dt / 0.14);
        if (this.switchT >= 1) {
          if (this.current && this.items[this.current]) this.items[this.current].visible = false;
          this.current = this.pending;
          if (this.current && this.items[this.current]) this.items[this.current].visible = true;
        }
      } else {
        this.switchT = Math.max(0, this.switchT - dt / 0.18);
        if (this.switchT <= 0) this.switching = false;
      }
      if (s.held !== this.pending) this.pending = s.held;
    }
    this.lensMat.color.setHex(s.flashlightOn ? 0xfff6d4 : 0x1d1d1d);

    // sway (lags behind the mouse)
    this.sway.x += (-s.mouseDX * 0.00045 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (s.mouseDY * 0.00045 - this.sway.y) * Math.min(1, dt * 10);
    this.sway.x = Math.max(-0.04, Math.min(0.04, this.sway.x));
    this.sway.y = Math.max(-0.04, Math.min(0.04, this.sway.y));

    const bobAmt = s.moving ? (s.sprint ? 1.7 : 1) : 0;
    this._bobAmt = (this._bobAmt || 0) + (bobAmt - (this._bobAmt || 0)) * Math.min(1, dt * 8);
    const ph = s.bobPhase;
    const breathe = Math.sin(s.time * 1.6) * 0.003;
    let px = this.base.x + this.sway.x + Math.sin(ph) * 0.011 * this._bobAmt;
    let py = this.base.y + this.sway.y + breathe - Math.abs(Math.cos(ph)) * 0.009 * this._bobAmt - this.switchT * 0.28;
    let pz = this.base.z;
    let rx = 0.12, ry = 0.28, rz = 0.12;
    if (s.sprint) { py -= 0.03; rx -= 0.15; rz += 0.1; }
    if (s.lowered) { py -= 0.06; }

    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const k = a.t / a.dur;
      if (a.type === 'eat' || a.type === 'drink') {
        const u = k < 0.35 ? k / 0.35 : k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
        const e = u * u * (3 - 2 * u);
        px += 0.2 * e; py += 0.14 * e; pz += 0.18 * e;
        rx += (a.type === 'drink' ? 0.9 : 0.4) * e; ry -= 0.3 * e;
        if (k > 0.35 && k < 0.75) py += Math.sin(a.t * 30) * 0.004;
      } else if (a.type === 'throw') {
        if (k < 0.45) { const e = k / 0.45; pz += 0.1 * e; py += 0.08 * e; rx -= 0.6 * e; }
        else { const e = Math.min(1, (k - 0.45) / 0.25); pz += 0.1 - 0.3 * e; py += 0.08 - 0.05 * e; rx += -0.6 + 1.2 * e; }
        if (k > 0.5 && this.current && this.items[this.current]) this.items[this.current].visible = false;
      } else if (a.type === 'punch') {
        // quick jab toward the crosshair
        const u = k < 0.35 ? k / 0.35 : Math.max(0, 1 - (k - 0.35) / 0.65);
        const e = u * u * (3 - 2 * u);
        px += 0.17 * e; py += 0.07 * e; pz -= 0.3 * e;
        rx -= 0.25 * e; ry -= 0.35 * e;
      } else if (a.type === 'swing') {
        // wind up to the left, then a fast arc across the screen
        if (k < 0.32) { const e = k / 0.32; px -= 0.06 * e; py += 0.1 * e; pz += 0.05 * e; rz += 0.7 * e; rx += 0.25 * e; }
        else if (k < 0.55) { const e = (k - 0.32) / 0.23; px += -0.06 + 0.34 * e; py += 0.1 - 0.16 * e; pz += 0.05 - 0.2 * e; rz += 0.7 - 1.9 * e; rx += 0.25 - 0.9 * e; }
        else { const e = 1 - (k - 0.55) / 0.45; px += 0.28 * e; py -= 0.06 * e; pz -= 0.15 * e; rz -= 1.2 * e; rx -= 0.65 * e; }
      } else if (a.type === 'click') {
        rx -= Math.sin(k * Math.PI) * 0.08;
      } else if (a.type === 'use') {
        pz -= Math.sin(k * Math.PI) * 0.06;
      }
      if (a.t >= a.dur) {
        this.anim = null;
        if (this.current && this.items[this.current]) this.items[this.current].visible = true;
      }
    }

    this.rig.position.set(px, py, pz);
    this.rig.rotation.set(rx, ry, rz);
    this.rig.visible = !this.hidden;

    // match the hand's lighting to the environment
    const env = Math.max(0.035, Math.min(1.7, s.env));
    this.amb.intensity = env * 0.95;
    this.key.intensity = env * 0.75;
    this.spill.intensity = s.flashlightOn ? 0.9 * s.flashBright : 0;
    this.amb.color.setRGB(1, 0.94, 0.85);
  }

  // After a throw/eat the item may be gone
  refresh(held) {
    if (this.current !== held) return;
    if (held && this.items[held]) this.items[held].visible = true;
  }
}
