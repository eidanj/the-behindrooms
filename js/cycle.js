// Day / night cycle. Produces lighting "factors" every frame:
//   day     – how much of the daytime ceiling lighting is on (0..1)
//   night   – how much of the 1–3 dim night lights per room are on (0..1)
//   chaos   – violent flicker amount (0..1) during transitions
//   ambient – global ambient light level
//   nightMix– music crossfade (0 = calm day track, 1 = night track)

import { CYCLE } from './config.js';
import { clamp, smoothstep } from './rng.js';

export class Cycle {
  constructor({ dayLength = CYCLE.dayLength, nightLength = CYCLE.nightLength } = {}) {
    this.dayLength = dayLength;
    this.nightLength = nightLength;
    this.phase = 'day';
    this.t = 0;
    this.day = 1;
    this.paused = false;
    this.onNightfall = null; // power cuts out
    this.onNightLights = null; // dim night lights come on
    this.onDawn = null;
    this.onDuskWarning = null;
    this._warned = false;
    this._nightLit = false;
    this.preview = null;
  }

  get isNight() { return this.phase === 'night'; }
  get timeLeft() { return (this.phase === 'day' ? this.dayLength : this.nightLength) - this.t; }
  get progress() { return this.t / (this.phase === 'day' ? this.dayLength : this.nightLength); }

  update(dt) {
    if (this.preview) {
      this.preview.t += dt;
      if (this.preview.t > 11) this.preview = null;
      return;
    }
    if (this.paused) return;
    this.t += dt;
    if (this.phase === 'day') {
      if (!this._warned && this.t >= this.dayLength - CYCLE.duskWarning) {
        this._warned = true;
        if (this.onDuskWarning) this.onDuskWarning();
      }
      if (this.t >= this.dayLength) {
        this.phase = 'night'; this.t = 0; this._nightLit = false;
        if (this.onNightfall) this.onNightfall();
      }
    } else {
      if (!this._nightLit && this.t >= CYCLE.blackout) {
        this._nightLit = true;
        if (this.onNightLights) this.onNightLights();
      }
      if (this.t >= this.nightLength) this.toDawn();
    }
  }

  toDawn() {
    this.phase = 'day'; this.t = 0; this.day++; this._warned = false;
    if (this.onDawn) this.onDawn();
  }

  startPreview() { this.preview = { t: 0 }; }

  factors(ambientMult = 1) {
    let day = 1, night = 0, chaos = 0, nightMix = 0;
    if (this.preview) {
      const t = this.preview.t;
      if (t < 3.5) { chaos = smoothstep(0, 3.5, t); }
      else if (t < 5.5) { day = 0; }
      else if (t < 9) { day = 0; night = 1; chaos = t < 6.3 ? 0.6 : 0; }
      else { day = 1; chaos = 1 - smoothstep(9, 11, t); }
      const nightAmb = 0.05 * ambientMult;
      const ambient = t < 3.5 ? 1 : t < 9 ? nightAmb : 1;
      return { day, night, chaos, ambient, nightMix: 0 };
    }
    const D = CYCLE.duskWarning;
    if (this.phase === 'day') {
      const left = this.dayLength - this.t;
      if (left < D) chaos = Math.pow(1 - left / D, 1.6);
      if (this.t < 2) chaos = Math.max(chaos, 0.7 * (1 - this.t / 2));
      nightMix = left < 6 ? 1 - left / 6 : 0;
      if (this.t < 6 && this.day > 1) nightMix = Math.max(nightMix, 1 - this.t / 6);
    } else {
      day = 0;
      nightMix = 1;
      if (this.t < CYCLE.blackout) night = 0;
      else if (this.t < CYCLE.blackout + 1.4) { night = 1; chaos = 0.75; }
      else night = 1;
      const left = this.nightLength - this.t;
      if (left < 6) { chaos = Math.max(chaos, 1 - left / 6); nightMix = Math.max(0.5, left / 6); }
    }
    const nightAmb = 0.05 * ambientMult;
    let ambient;
    if (this.phase === 'day') {
      const left = this.dayLength - this.t;
      ambient = left < 1.2 ? nightAmb + (1 - nightAmb) * clamp(left / 1.2, 0, 1) : 1;
      if (this.t < 1.5 && this.day > 1) ambient = nightAmb + (1 - nightAmb) * (this.t / 1.5);
    } else ambient = nightAmb;
    return { day, night, chaos, ambient, nightMix };
  }

  clockText() {
    const s = Math.max(0, Math.ceil(this.timeLeft));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}
