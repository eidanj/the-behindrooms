// Fully procedural audio with the Web Audio API: no sound files.
//  • Day: calm lounge/elevator-style chords + fluorescent hum
//  • Night: detuned drone, wind, dissonant stings, heartbeat
//  • Entities: positional (HRTF) heavy breathing loops
//  • SFX: footsteps, drawers, eating, throws, power cuts, etc.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, music: 0.6 };
    this.diffMult = 1;
    this.breathMult = 1;
    this.breathers = new Set();
    this.tension = 0;
    this.nightMix = 0;
    this.hard = false;
    this.menuMode = true;
    this._nextBeat = 0;
    this._nextSting = 0;
    this._nextHeart = 0;
    this._bar = 0;
    this._melody = 72;
  }

  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.connect(comp);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.musicLP = ctx.createBiquadFilter(); this.musicLP.type = 'lowpass'; this.musicLP.frequency.value = 650; this.musicLP.connect(this.musicBus);
    this.dayBus = ctx.createGain(); this.dayBus.connect(this.musicLP);
    this.nightBus = ctx.createGain(); this.nightBus.gain.value = 0; this.nightBus.connect(this.musicBus);
    this.ui = ctx.createGain(); this.ui.gain.value = 0.5; this.ui.connect(this.master);

    this.noiseBuf = this._noise(2.5, false);
    this.brownBuf = this._noise(4, true);
    const conv = ctx.createConvolver();
    conv.buffer = this._ir(1.7, 2.6);
    const rev = ctx.createGain(); rev.gain.value = 0.32;
    conv.connect(rev); rev.connect(this.master);
    this.revSend = ctx.createGain(); this.revSend.gain.value = 0.45; this.revSend.connect(conv);
    this.sfx.connect(this.revSend);
    this.nightBus.connect(this.revSend);

    // fluorescent hum
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 120;
    const humF = ctx.createBiquadFilter(); humF.type = 'bandpass'; humF.frequency.value = 240; humF.Q.value = 5;
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0;
    hum.connect(humF); humF.connect(this.humGain); this.humGain.connect(this.master);
    hum.start();

    this._buildNightDrone();
    this.applyVolumes();
    const t = ctx.currentTime + 0.1;
    this._nextBeat = t; this._nextSting = t + 6; this._nextHeart = t;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  setVolumes(master, music) { this.vol.master = master; this.vol.music = music; this.applyVolumes(); }
  setDifficulty(d) { this.diffMult = d.audioMult; this.breathMult = d.breathMult; this.hard = d.id === 'hard'; this.applyVolumes(); }
  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.vol.master * this.diffMult, this.ctx.currentTime, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music, this.ctx.currentTime, 0.05);
  }

  setMenuMode(on) {
    this.menuMode = on;
    if (!this.ctx) return;
    this.musicLP.frequency.setTargetAtTime(on ? 650 : 18000, this.ctx.currentTime, 0.4);
    if (on) this.setNightMix(0);
  }

  setNightMix(x) {
    this.nightMix = x;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.dayBus.gain.setTargetAtTime(Math.cos(x * Math.PI / 2) * 0.9, t, 0.3);
    this.nightBus.gain.setTargetAtTime(Math.sin(x * Math.PI / 2) * (this.hard ? 1.25 : 1), t, 0.3);
  }

  setHum(level) { if (this.ctx) this.humGain.gain.setTargetAtTime(level * 0.022, this.ctx.currentTime, 0.08); }

  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
      L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  // ── buffers ──────────────────────────────────────────────
  _noise(seconds, brown) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  _ir(seconds, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 200 ? i / 200 : 1);
    }
    return b;
  }

  // ── primitives ───────────────────────────────────────────
  tone(freq, t, dur, o = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const a = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain ?? 0.1), t + a);
    if (o.hold) g.gain.setValueAtTime(Math.max(0.0002, o.gain ?? 0.1), t + a + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.filter;
      osc.connect(f); node = f;
    }
    node.connect(g); g.connect(o.dest || this.sfx);
    osc.start(t); osc.stop(t + dur + 0.05);
    return g;
  }

  noise(t, dur, o = {}) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = o.brown ? this.brownBuf : this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
    f.Q.value = o.q ?? 0.7;
    const g = ctx.createGain();
    const a = o.attack ?? 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain ?? 0.2), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(o.dest || this.sfx);
    s.start(t, Math.random() * 1.2); s.stop(t + dur + 0.05);
  }

  _panner(pos, ref = 1.5, roll = 1.3) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 80;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(this.sfx);
    return p;
  }

  // ── music ────────────────────────────────────────────────
  _buildNightDrone() {
    const ctx = this.ctx, bus = this.nightBus;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240; lp.Q.value = 3;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.045;
    const lfoG = ctx.createGain(); lfoG.gain.value = 130;
    lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
    const g = ctx.createGain(); g.gain.value = 0.06;
    for (const f of [55, 55.7, 82.6]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start();
    }
    lp.connect(g); g.connect(bus);
    const sub = ctx.createOscillator(); sub.frequency.value = 36.7;
    const sg = ctx.createGain(); sg.gain.value = 0.07; sub.connect(sg); sg.connect(bus); sub.start();
    // wind
    const w = ctx.createBufferSource(); w.buffer = this.brownBuf; w.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 340; wf.Q.value = 0.8;
    const wl = ctx.createOscillator(); wl.frequency.value = 0.07;
    const wlg = ctx.createGain(); wlg.gain.value = 180; wl.connect(wlg); wlg.connect(wf.frequency); wl.start();
    const wg = ctx.createGain(); wg.gain.value = 0.05;
    w.connect(wf); wf.connect(wg); wg.connect(bus); w.start();
    // high dissonance
    for (const [f, rate] of [[1318.5, 0.13], [1396.9, 0.17]]) {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = 0.0025;
      const tl = ctx.createOscillator(); tl.frequency.value = rate;
      const tlg = ctx.createGain(); tlg.gain.value = 0.0025;
      tl.connect(tlg); tlg.connect(og.gain); tl.start();
      o.connect(og); og.connect(bus); o.start();
    }
  }

  _dayBar(t, beat) {
    const prog = [
      { root: 41, pad: [57, 60, 64, 67] }, // Fmaj9
      { root: 40, pad: [55, 59, 62, 64] }, // Em7
      { root: 38, pad: [53, 57, 60, 64] }, // Dm9
      { root: 36, pad: [52, 55, 59, 62] }, // Cmaj9
    ];
    const ch = prog[this._bar % 4];
    const bar = beat * 4;
    for (const n of ch.pad) {
      for (const [type, det] of [['triangle', -5], ['sine', 6]]) {
        this.tone(midi(n), t, bar + 1.6, { type, gain: 0.018, attack: 1.1, hold: bar - 1.0, detune: det, dest: this.dayBus, filter: 1600 });
      }
    }
    this.tone(midi(ch.root), t, bar * 0.9, { gain: 0.06, attack: 0.02, dest: this.dayBus, filter: 400 });
    if (Math.random() < 0.6) this.tone(midi(ch.root + 7), t + beat * 2, beat * 1.6, { gain: 0.035, attack: 0.02, dest: this.dayBus, filter: 400 });
    const scale = [60, 62, 64, 67, 69, 72, 74, 76, 79];
    for (let i = 0; i < 8; i++) {
      if (Math.random() > 0.5) continue;
      let idx = scale.indexOf(this._melody);
      if (idx < 0) idx = 4;
      idx = Math.max(0, Math.min(scale.length - 1, idx + Math.floor(Math.random() * 5) - 2));
      this._melody = scale[idx];
      const nt = t + i * beat / 2 + (Math.random() - 0.5) * 0.02;
      const f = midi(this._melody + 12);
      this.tone(f, nt, 1.6, { gain: 0.03, attack: 0.004, dest: this.dayBus });
      this.tone(f * 2, nt, 0.5, { gain: 0.006, attack: 0.002, dest: this.dayBus });
    }
    this._bar++;
  }

  _sting(t) {
    const r = Math.random(), bus = this.nightBus, h = this.hard ? 1.5 : 1;
    if (r < 0.25) {
      this.tone(70, t, 3.5, { gain: 0.14 * h, freqEnd: 28, attack: 0.01, dest: bus });
      this.noise(t, 2.5, { gain: 0.08 * h, freq: 200, freqEnd: 60, dest: bus, brown: true });
    } else if (r < 0.5) {
      this.noise(t, 2.8, { gain: 0.05 * h, type: 'bandpass', freq: 3200, freqEnd: 900, q: 18, attack: 0.6, dest: bus });
      this.noise(t + 0.2, 2.2, { gain: 0.03 * h, type: 'bandpass', freq: 1800, freqEnd: 2600, q: 22, attack: 0.5, dest: bus });
    } else if (r < 0.75) {
      const base = 48 + Math.floor(Math.random() * 12);
      for (const n of [base, base + 1, base + 6, base + 13]) this.tone(midi(n), t, 5, { gain: 0.03 * h, attack: 0.003, dest: bus, type: 'triangle' });
    } else {
      this.noise(t, 3.2, { gain: 0.09 * h, freq: 400, freqEnd: 4000, attack: 3.0, dest: bus });
      this.tone(midi(37), t, 3.3, { gain: 0.04 * h, attack: 3.0, type: 'sawtooth', dest: bus, filter: 600 });
    }
  }

  update(dt) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const beat = 60 / 66;
    if (this.nightMix < 0.98) {
      while (this._nextBeat < now + 0.6) { this._dayBar(this._nextBeat, beat); this._nextBeat += beat * 4; }
    } else this._nextBeat = Math.max(this._nextBeat, now);
    if (this.nightMix > 0.05 && !this.menuMode) {
      if (now > this._nextSting) {
        this._sting(now + 0.05);
        this._nextSting = now + (this.hard ? 4 + Math.random() * 7 : 8 + Math.random() * 12);
      }
    } else this._nextSting = Math.max(this._nextSting, now + 4);
    if (this.tension > 0.15 && !this.menuMode) {
      if (now > this._nextHeart) {
        const g = 0.25 + 0.4 * this.tension;
        this.tone(58, now + 0.02, 0.16, { gain: g, attack: 0.01 });
        this.tone(50, now + 0.25, 0.14, { gain: g * 0.8, attack: 0.01 });
        this._nextHeart = now + 60 / (62 + 90 * this.tension);
      }
    }
    for (const b of this.breathers) if (!b.dead && now > b.next - 0.3) this._breath(b);
  }

  // ── monster voices ───────────────────────────────────────
  // voice: breath (Hollow) · chitter (Crawler) · growl (Brute) · pant (Hound)
  //        hum (Smiler) · creak (Mannequin)
  createBreather(pos, voice = 'breath') {
    if (!this.ctx) return null;
    const ctx = this.ctx;
    const panner = this._panner(pos, 2.0, 1.15);
    const out = ctx.createGain(); out.gain.value = 0; out.connect(panner);
    out.gain.setTargetAtTime(this.breathMult, ctx.currentTime, 0.5);
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.3;
    const env = ctx.createGain(); env.gain.value = 0.0001;
    src.connect(bp); bp.connect(env); env.connect(out);
    const growl = ctx.createOscillator();
    const glp = ctx.createBiquadFilter(); glp.type = 'lowpass';
    const V = {
      breath: ['sawtooth', 52 + Math.random() * 18, 170],
      chitter: ['square', 160 + Math.random() * 60, 1200],
      growl: ['sawtooth', 38 + Math.random() * 8, 260],
      pant: ['sawtooth', 95 + Math.random() * 25, 500],
      hum: ['sine', 233 + Math.random() * 40, 3000],
      creak: ['triangle', 300, 900],
    }[voice] || ['sawtooth', 55, 170];
    growl.type = V[0]; growl.frequency.value = V[1]; glp.frequency.value = V[2];
    const genv = ctx.createGain(); genv.gain.value = 0.0001;
    growl.connect(glp); glp.connect(genv); genv.connect(out);
    src.start(); growl.start();
    const b = { panner, out, src, growl, bp, env, genv, voice, base: V[1], next: ctx.currentTime + Math.random() * 1.2, rate: 1, intensity: 1, dead: false };
    this.breathers.add(b);
    return b;
  }

  _breath(b) {
    const t = Math.max(b.next, this.ctx.currentTime + 0.02);
    const r = b.rate, I = Math.max(0.02, b.intensity);
    const E = b.env.gain, G = b.genv.gain, F = b.bp.frequency, O = b.growl.frequency;
    switch (b.voice) {
      case 'chitter': {
        const n = 6 + Math.floor(Math.random() * 8), gap = 0.035 / Math.max(0.6, r * 0.8);
        b.bp.Q.value = 6;
        for (let i = 0; i < n; i++) {
          const k = t + i * gap;
          F.setValueAtTime(2400 + Math.random() * 1800, k);
          E.setValueAtTime(0.0001, k); E.exponentialRampToValueAtTime(0.5 * I, k + 0.004); E.exponentialRampToValueAtTime(0.0001, k + 0.025);
          G.setValueAtTime(0.0001, k); G.exponentialRampToValueAtTime(0.05 * I, k + 0.004); G.exponentialRampToValueAtTime(0.0001, k + 0.02);
        }
        b.next = t + n * gap + (0.4 + Math.random() * 1.1) / r;
        return;
      }
      case 'growl': {
        const d = 1.9 / r;
        O.setValueAtTime(b.base, t); O.linearRampToValueAtTime(b.base * (0.8 + Math.random() * 0.3), t + d);
        G.setValueAtTime(0.0001, t); G.exponentialRampToValueAtTime(0.55 * I, t + 0.35); G.exponentialRampToValueAtTime(0.0001, t + d);
        F.setValueAtTime(220, t); E.setValueAtTime(0.0001, t); E.exponentialRampToValueAtTime(0.35 * I, t + 0.3); E.exponentialRampToValueAtTime(0.0001, t + d);
        b.next = t + d + (0.5 + Math.random()) / r;
        return;
      }
      case 'pant': {
        const n = 3 + Math.floor(r * 2.5), p = 0.32 / r;
        for (let i = 0; i < n; i++) {
          const k = t + i * p;
          F.setValueAtTime(i % 2 ? 900 : 1500, k);
          E.setValueAtTime(0.0001, k); E.exponentialRampToValueAtTime(0.45 * I, k + 0.04); E.exponentialRampToValueAtTime(0.0001, k + p * 0.8);
        }
        if (Math.random() < 0.25 * r) { const k = t + n * p; G.setValueAtTime(0.0001, k); G.exponentialRampToValueAtTime(0.35 * I, k + 0.05); G.exponentialRampToValueAtTime(0.0001, k + 0.6); }
        b.next = t + n * p + (0.3 + Math.random() * 0.8) / r;
        return;
      }
      case 'hum': {
        const d = 2.4 / Math.sqrt(r);
        O.setValueAtTime(b.base * (r > 1.5 ? 1.5 : 1), t);
        O.linearRampToValueAtTime(b.base * (r > 1.5 ? 1.7 : 1.06), t + d * 0.5);
        O.linearRampToValueAtTime(b.base * (r > 1.5 ? 1.3 : 0.97), t + d);
        G.setValueAtTime(0.0001, t); G.exponentialRampToValueAtTime(0.12 * I, t + d * 0.4); G.exponentialRampToValueAtTime(0.0001, t + d);
        if (r > 1.5) for (let i = 0; i < 6; i++) { const k = t + i * 0.11; F.setValueAtTime(2200, k); E.setValueAtTime(0.0001, k); E.exponentialRampToValueAtTime(0.18 * I, k + 0.02); E.exponentialRampToValueAtTime(0.0001, k + 0.08); }
        b.next = t + d + Math.random() * 1.5;
        return;
      }
      case 'creak': {
        const d = 0.25 + Math.random() * 0.35;
        b.bp.Q.value = 9;
        F.setValueAtTime(1300 + Math.random() * 900, t); F.linearRampToValueAtTime(700 + Math.random() * 600, t + d);
        E.setValueAtTime(0.0001, t); E.exponentialRampToValueAtTime(0.6 * I, t + 0.03); E.exponentialRampToValueAtTime(0.0001, t + d);
        if (Math.random() < 0.5) { G.setValueAtTime(0.0001, t + d); G.exponentialRampToValueAtTime(0.25 * I, t + d + 0.005); G.exponentialRampToValueAtTime(0.0001, t + d + 0.05); }
        b.next = t + d + (0.15 + Math.random() * 0.9) / r;
        return;
      }
    }
    const inD = 1.05 / r, outD = 1.45 / r;
    F.setValueAtTime(420, t);
    F.linearRampToValueAtTime(1250, t + inD);
    E.setValueAtTime(0.0001, t);
    E.exponentialRampToValueAtTime(0.38 * I, t + inD * 0.6);
    E.exponentialRampToValueAtTime(0.06 * I, t + inD);
    const t2 = t + inD + 0.06;
    F.setValueAtTime(980, t2);
    F.exponentialRampToValueAtTime(360, t2 + outD);
    E.exponentialRampToValueAtTime(0.7 * I, t2 + 0.14);
    E.exponentialRampToValueAtTime(0.0001, t2 + outD);
    G.setValueAtTime(0.0001, t2);
    G.exponentialRampToValueAtTime(0.3 * I, t2 + 0.18);
    G.exponentialRampToValueAtTime(0.0001, t2 + outD);
    b.next = t2 + outD + (0.45 / r) * (0.6 + Math.random() * 0.9);
  }

  moveBreather(b, x, y, z) {
    if (!b) return;
    const p = b.panner;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
    else p.setPosition(x, y, z);
  }

  releaseBreather(b) {
    if (!b || b.dead) return;
    b.dead = true;
    const t = this.ctx.currentTime;
    b.out.gain.setTargetAtTime(0, t, 0.15);
    setTimeout(() => {
      try { b.src.stop(); b.growl.stop(); b.panner.disconnect(); } catch (e) { /* already stopped */ }
      this.breathers.delete(b);
    }, 800);
  }

  // ── sound effects ────────────────────────────────────────
  _ok() { return this.ctx && this.ctx.state === 'running'; }

  footstep(sprint, surface = 'carpet', crouch = false) {
    if (!this._ok()) return;
    const t = this.now;
    const g = (sprint ? 0.32 : 0.2) * (crouch ? 0.35 : 1);
    switch (surface) {
      case 'concrete':
      case 'tile':
        this.noise(t, 0.05, { gain: g * 1.1, type: 'bandpass', freq: surface === 'tile' ? 2600 : 1600, q: 1.4, attack: 0.002 });
        this.tone(surface === 'tile' ? 150 : 95, t, 0.06, { gain: g * 0.5 });
        break;
      case 'wood':
        this.tone(140 + Math.random() * 30, t, 0.09, { gain: g * 0.9, type: 'triangle', filter: 900 });
        this.noise(t, 0.06, { gain: g * 0.6, type: 'bandpass', freq: 900, q: 1.5 });
        break;
      case 'water':
        this.noise(t, 0.28, { gain: g * 1.4, type: 'bandpass', freq: 900 + Math.random() * 500, freqEnd: 2600, q: 1.1, attack: 0.02 });
        this.noise(t + 0.06, 0.2, { gain: g * 0.6, type: 'highpass', freq: 3000 });
        break;
      case 'metal':
        this.tone(110 + Math.random() * 30, t, 0.22, { gain: g * 1.2, type: 'triangle', filter: 700 });
        this.noise(t, 0.08, { gain: g * 0.7, type: 'bandpass', freq: 600, q: 3 });
        break;
      default:
        this.noise(t, 0.09, { gain: g, freq: 420 + Math.random() * 180, attack: 0.004 });
        this.tone(70 + Math.random() * 15, t, 0.08, { gain: g * 0.6 });
    }
  }

  land() {
    if (!this._ok()) return;
    const t = this.now;
    this.noise(t, 0.14, { gain: 0.35, freq: 300 });
    this.tone(55, t, 0.14, { gain: 0.3 });
  }

  entityStep(pos, heavy, type) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 2, 1.2);
    if (type === 'crawler') { this.noise(t, 0.03, { gain: 0.25, type: 'bandpass', freq: 2200, q: 3, dest: p }); return; }
    if (type === 'mannequin') { this.noise(t, 0.04, { gain: 0.4, type: 'bandpass', freq: 1500, q: 4, dest: p }); this.tone(320, t, 0.04, { gain: 0.1, type: 'square', filter: 1200, dest: p }); return; }
    const b = type === 'brute' ? 1.8 : 1;
    this.noise(t, 0.12, { gain: (heavy ? 0.45 : 0.22) * b, freq: 260 / b, dest: p });
    this.tone(48 / Math.sqrt(b), t, 0.12 * b, { gain: (heavy ? 0.4 : 0.2) * b, dest: p });
  }

  drawer(pos, rusty) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 2, 1);
    if (rusty) {
      this.tone(900 + Math.random() * 300, t, 0.5, { gain: 0.05, type: 'sawtooth', freqEnd: 1400, attack: 0.05, filter: 3000, dest: p });
      this.noise(t, 0.5, { gain: 0.14, type: 'bandpass', freq: 2200, freqEnd: 1100, q: 6, attack: 0.05, dest: p });
    }
    this.noise(t, 0.3, { gain: 0.16, type: 'bandpass', freq: 1400, freqEnd: 700, q: 2.5, attack: 0.04, dest: p });
    this.noise(t + 0.3, 0.12, { gain: 0.25, freq: 500, dest: p });
    this.tone(180, t + 0.3, 0.1, { gain: 0.12, type: 'square', filter: 600, dest: p });
  }

  pickup() {
    if (!this._ok()) return;
    const t = this.now;
    this.tone(660, t, 0.12, { gain: 0.08, dest: this.ui });
    this.tone(990, t + 0.06, 0.16, { gain: 0.06, dest: this.ui });
  }

  eat() {
    if (!this._ok()) return;
    const t = this.now;
    for (let i = 0; i < 5; i++) this.noise(t + i * 0.13 + Math.random() * 0.03, 0.06, { gain: 0.18, type: 'bandpass', freq: 1800 + Math.random() * 900, q: 1.2 });
  }

  drink() {
    if (!this._ok()) return;
    const t = this.now;
    for (let i = 0; i < 3; i++) this.tone(180 + Math.random() * 30, t + i * 0.25, 0.16, { gain: 0.14, freqEnd: 90, attack: 0.02, filter: 700 });
  }

  whoosh() {
    if (!this._ok()) return;
    this.noise(this.now, 0.25, { gain: 0.14, type: 'bandpass', freq: 600, freqEnd: 2200, q: 1.5, attack: 0.05 });
  }

  rockHit(pos, loud = 1) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 2, 1);
    this.noise(t, 0.08, { gain: 0.5 * loud, type: 'bandpass', freq: 1700 + Math.random() * 600, q: 3, dest: p });
    this.tone(900 + Math.random() * 300, t, 0.06, { gain: 0.08 * loud, type: 'triangle', dest: p });
    this.noise(t + 0.09, 0.05, { gain: 0.18 * loud, type: 'bandpass', freq: 2200, q: 3, dest: p });
  }

  squelch(pos) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 2, 1);
    this.noise(t, 0.18, { gain: 0.22, type: 'bandpass', freq: 500, freqEnd: 1500, q: 4, dest: p });
    this.tone(300, t, 0.15, { gain: 0.08, freqEnd: 120, dest: p });
  }

  fallThud(pos) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 2, 1);
    this.noise(t, 0.4, { gain: 0.6, freq: 240, dest: p });
    this.tone(42, t, 0.45, { gain: 0.55, dest: p });
    this.noise(t + 0.15, 0.6, { gain: 0.2, type: 'bandpass', freq: 400, q: 1, attack: 0.05, dest: p });
  }

  shriek(pos) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 3, 0.9);
    for (let i = 0; i < 3; i++) this.tone(420 + i * 90, t, 1.2, { gain: 0.07, type: 'sawtooth', freqEnd: 180 + i * 40, attack: 0.05, filter: 2200, dest: p });
    this.noise(t, 1.1, { gain: 0.25, type: 'bandpass', freq: 1500, freqEnd: 600, q: 1.5, attack: 0.05, dest: p });
  }

  click() {
    if (!this._ok()) return;
    const t = this.now;
    this.noise(t, 0.03, { gain: 0.2, type: 'highpass', freq: 3000 });
    this.tone(2200, t, 0.03, { gain: 0.04, type: 'square' });
  }

  battery() {
    if (!this._ok()) return;
    const t = this.now;
    this.noise(t, 0.08, { gain: 0.2, type: 'bandpass', freq: 2500, q: 2 });
    this.noise(t + 0.18, 0.06, { gain: 0.3, type: 'bandpass', freq: 1500, q: 2 });
    this.tone(880, t + 0.28, 0.1, { gain: 0.05, dest: this.ui });
  }

  powerDown() {
    if (!this._ok()) return;
    const t = this.now;
    this.tone(120, t, 1.6, { gain: 0.16, type: 'sawtooth', freqEnd: 24, attack: 0.01, filter: 900 });
    this.noise(t, 0.35, { gain: 0.6, freq: 300, brown: true });
    this.tone(45, t, 0.6, { gain: 0.5 });
  }

  powerUp() {
    if (!this._ok()) return;
    const t = this.now;
    this.tone(30, t, 1.4, { gain: 0.12, type: 'sawtooth', freqEnd: 120, attack: 0.6, filter: 900 });
    for (let i = 0; i < 6; i++) this.noise(t + 0.2 + i * 0.12, 0.04, { gain: 0.25, type: 'highpass', freq: 2500 });
  }

  buzz(level) {
    if (!this._ok() || Math.random() > level * 0.25) return;
    const t = this.now;
    this.tone(100, t, 0.06 + Math.random() * 0.1, { gain: 0.03 * level, type: 'sawtooth', filter: 2500 });
    if (Math.random() < 0.4) this.noise(t, 0.03, { gain: 0.06 * level, type: 'highpass', freq: 4000 });
  }

  doorUnlock(pos) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 2, 1);
    this.tone(880, t, 0.1, { gain: 0.08, type: 'square', filter: 3000, dest: p });
    this.tone(1320, t + 0.1, 0.15, { gain: 0.08, type: 'square', filter: 3000, dest: p });
    this.noise(t + 0.25, 0.2, { gain: 0.35, type: 'bandpass', freq: 800, q: 3, dest: p });
    this.noise(t + 0.5, 1.2, { gain: 0.1, type: 'bandpass', freq: 300, freqEnd: 180, q: 6, attack: 0.1, dest: p });
  }

  denied() {
    if (!this._ok()) return;
    const t = this.now;
    this.tone(220, t, 0.18, { gain: 0.08, type: 'square', filter: 1500, dest: this.ui });
    this.tone(180, t + 0.18, 0.25, { gain: 0.08, type: 'square', filter: 1500, dest: this.ui });
  }

  star() {
    if (!this._ok()) return;
    const t = this.now;
    [76, 79, 83, 88].forEach((n, i) => this.tone(midi(n), t + i * 0.09, 1.2, { gain: 0.07, dest: this.ui }));
  }

  bank() {
    if (!this._ok()) return;
    const t = this.now;
    [64, 67, 71, 76, 79, 83].forEach((n, i) => this.tone(midi(n), t + i * 0.07, 1.6, { gain: 0.06, dest: this.ui, type: 'triangle' }));
  }

  death() {
    if (!this._ok()) return;
    const t = this.now;
    for (const n of [36, 37, 42, 43]) this.tone(midi(n), t, 4, { gain: 0.09, type: 'sawtooth', attack: 0.02, filter: 900 });
    this.noise(t, 2.5, { gain: 0.4, freq: 600, freqEnd: 80, brown: true });
  }

  jumpscare() {
    if (!this._ok()) return;
    const t = this.now;
    for (let i = 0; i < 5; i++) this.tone(650 + i * 141, t, 1.2, { gain: 0.11, type: 'sawtooth', freqEnd: 260 + i * 50, attack: 0.005 });
    this.noise(t, 1.0, { gain: 0.6, type: 'bandpass', freq: 2600, freqEnd: 800, q: 0.8, attack: 0.005 });
    this.tone(58, t, 0.9, { gain: 0.5, freqEnd: 30 });
  }

  growl(pos) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 2, 1);
    this.tone(70, t, 1.1, { gain: 0.3, type: 'sawtooth', freqEnd: 50, attack: 0.08, filter: 300, dest: p });
    this.noise(t, 1.0, { gain: 0.2, type: 'bandpass', freq: 400, q: 2, attack: 0.08, dest: p });
  }

  squash(pos) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 2, 1);
    this.noise(t, 0.3, { gain: 0.5, type: 'bandpass', freq: 700, freqEnd: 200, q: 2, dest: p });
    this.tone(90, t, 0.4, { gain: 0.4, freqEnd: 40, dest: p });
  }

  // ── combat ──
  swing(heavy) {
    if (!this._ok()) return;
    const t = this.now;
    this.noise(t, heavy ? 0.3 : 0.16, { gain: heavy ? 0.22 : 0.12, type: 'bandpass', freq: heavy ? 450 : 800, freqEnd: heavy ? 1800 : 2600, q: 1.4, attack: 0.04 });
  }

  hitFlesh(pos, heavy) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 2, 1);
    this.noise(t, 0.16, { gain: heavy ? 0.7 : 0.5, type: 'bandpass', freq: 380, q: 0.9, dest: p });
    this.tone(heavy ? 85 : 110, t, 0.18, { gain: heavy ? 0.5 : 0.35, freqEnd: 40, dest: p });
    this.noise(t + 0.01, 0.12, { gain: 0.25, type: 'bandpass', freq: 1200, freqEnd: 500, q: 3, dest: p });
    if (heavy) this.noise(t, 0.05, { gain: 0.3, type: 'highpass', freq: 2500, dest: p });
  }

  weaponBreak() {
    if (!this._ok()) return;
    const t = this.now;
    this.noise(t, 0.09, { gain: 0.5, type: 'highpass', freq: 2800 });
    this.tone(1900, t, 0.25, { gain: 0.06, type: 'triangle', freqEnd: 1300 });
    this.noise(t + 0.25, 0.12, { gain: 0.3, freq: 600 });
  }

  monsterHurt(pos) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 2.5, 1);
    this.tone(560 + Math.random() * 120, t, 0.4, { gain: 0.12, type: 'sawtooth', freqEnd: 280, attack: 0.01, filter: 2400, dest: p });
    this.noise(t, 0.35, { gain: 0.25, type: 'bandpass', freq: 1500, freqEnd: 700, q: 2, dest: p });
  }

  monsterDeath(pos) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 3, 0.9);
    for (let i = 0; i < 3; i++) this.tone(520 + i * 70, t, 1.4, { gain: 0.08, type: 'sawtooth', freqEnd: 70 + i * 15, attack: 0.02, filter: 2000, dest: p });
    this.noise(t, 1.2, { gain: 0.3, type: 'bandpass', freq: 1300, freqEnd: 250, q: 1.2, dest: p });
    this.noise(t + 0.45, 0.4, { gain: 0.6, freq: 220, dest: p });
    this.tone(40, t + 0.45, 0.45, { gain: 0.5, dest: p });
  }

  bounce() {
    if (!this._ok()) return;
    this.tone(160, this.now, 0.12, { gain: 0.12, freqEnd: 260 });
  }

  win() {
    if (!this._ok()) return;
    const t = this.now;
    [[60, 64, 67, 72], [65, 69, 72, 77], [67, 71, 74, 79], [72, 76, 79, 84]].forEach((c, i) => {
      for (const n of c) this.tone(midi(n), t + i * 0.6, 2.4, { gain: 0.035, type: 'triangle', attack: 0.05, dest: this.ui });
    });
  }

  uiHover() { if (this._ok()) this.tone(1200, this.now, 0.04, { gain: 0.02, dest: this.ui }); }
  uiClick() { if (this._ok()) { this.tone(700, this.now, 0.06, { gain: 0.05, dest: this.ui }); this.noise(this.now, 0.02, { gain: 0.05, type: 'highpass', freq: 3000, dest: this.ui }); } }

  // ── overhaul SFX ─────────────────────────────────────────
  monsterAttack(pos, voice) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 2, 1);
    const low = voice === 'growl' ? 0.5 : voice === 'chitter' ? 2.2 : voice === 'hum' ? 1.6 : 1;
    this.tone(300 * low, t, 0.35, { gain: 0.12, type: 'sawtooth', freqEnd: 140 * low, attack: 0.01, filter: 2200, dest: p });
    this.noise(t, 0.3, { gain: 0.35, type: 'bandpass', freq: 900 * low, freqEnd: 400 * low, q: 1.5, dest: p });
    this.noise(t + 0.15, 0.12, { gain: 0.3, type: 'bandpass', freq: 1600, freqEnd: 700, q: 1.2, attack: 0.03, dest: p });
  }

  hurt(heavy) {
    if (!this._ok()) return;
    const t = this.now;
    this.noise(t, 0.2, { gain: heavy ? 0.7 : 0.5, freq: 320, attack: 0.002 });
    this.tone(heavy ? 70 : 90, t, 0.25, { gain: 0.5, freqEnd: 40 });
    this.tone(210 + Math.random() * 40, t + 0.03, 0.22, { gain: 0.08, type: 'sawtooth', freqEnd: 150, attack: 0.01, filter: 1400 });
  }

  heal() {
    if (!this._ok()) return;
    const t = this.now;
    this.noise(t, 0.5, { gain: 0.1, type: 'bandpass', freq: 3000, freqEnd: 1500, q: 1, attack: 0.1 });
    [72, 76, 79].forEach((n, i) => this.tone(midi(n), t + 0.3 + i * 0.08, 0.6, { gain: 0.04, dest: this.ui }));
  }

  scratch(pos) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 1.5, 1);
    for (let i = 0; i < 4; i++) this.noise(t + i * 0.13, 0.11, { gain: 0.55, type: 'bandpass', freq: 2600 + i * 300, freqEnd: 900, q: 4, attack: 0.01, dest: p });
    this.tone(160, t, 0.6, { gain: 0.2, type: 'triangle', freqEnd: 110, filter: 800, dest: p });
  }

  ventThump(sprint) {
    if (!this._ok()) return;
    const t = this.now;
    this.tone(85 + Math.random() * 25, t, 0.3, { gain: sprint ? 0.42 : 0.26, type: 'triangle', filter: 500 });
    this.noise(t, 0.12, { gain: sprint ? 0.3 : 0.18, type: 'bandpass', freq: 700, q: 2.5 });
  }

  ventCreak(level) {
    if (!this._ok()) return;
    const t = this.now;
    this.tone(500 + Math.random() * 600, t, 0.6, { gain: 0.03 + level * 0.05, type: 'sawtooth', freqEnd: 300 + Math.random() * 500, attack: 0.1, filter: 1800 });
    this.noise(t, 0.6, { gain: 0.08 + level * 0.1, type: 'bandpass', freq: 1200, freqEnd: 600, q: 8, attack: 0.1 });
  }

  ventBreak() {
    if (!this._ok()) return;
    const t = this.now;
    for (let i = 0; i < 6; i++) this.tone(200 + Math.random() * 500, t + i * 0.06, 0.7, { gain: 0.12, type: 'triangle', freqEnd: 90, filter: 2500 });
    this.noise(t, 1.0, { gain: 0.8, freq: 1800, freqEnd: 200 });
    this.noise(t + 0.55, 0.5, { gain: 0.7, freq: 300 });
    this.tone(40, t + 0.55, 0.5, { gain: 0.6 });
  }

  clank() {
    if (!this._ok()) return;
    const t = this.now;
    this.tone(420 + Math.random() * 100, t, 0.18, { gain: 0.08, type: 'triangle', filter: 2000 });
    this.noise(t, 0.05, { gain: 0.15, type: 'bandpass', freq: 1800, q: 3 });
  }

  grate() {
    if (!this._ok()) return;
    const t = this.now;
    this.noise(t, 0.25, { gain: 0.35, type: 'bandpass', freq: 1400, freqEnd: 600, q: 3 });
    this.tone(260, t, 0.3, { gain: 0.14, type: 'triangle', freqEnd: 120, filter: 1500 });
    this.noise(t + 0.4, 0.2, { gain: 0.45, freq: 400 });
  }

  splash(big) {
    if (!this._ok()) return;
    const t = this.now;
    this.noise(t, big ? 0.9 : 0.4, { gain: big ? 0.8 : 0.45, type: 'bandpass', freq: 700, freqEnd: 2500, q: 0.8, attack: 0.01 });
    this.noise(t + 0.1, big ? 1.2 : 0.5, { gain: 0.3, type: 'highpass', freq: 2500, attack: 0.05 });
  }

  craft() {
    if (!this._ok()) return;
    const t = this.now;
    for (let i = 0; i < 4; i++) {
      this.tone(320 + Math.random() * 120, t + i * 0.16, 0.12, { gain: 0.12, type: 'triangle', filter: 2500 });
      this.noise(t + i * 0.16, 0.06, { gain: 0.3, type: 'bandpass', freq: 1500, q: 2 });
    }
    [67, 71, 74].forEach((n, i) => this.tone(midi(n), t + 0.7 + i * 0.07, 0.5, { gain: 0.05, dest: this.ui }));
  }

  chestOpen() {
    if (!this._ok()) return;
    const t = this.now;
    this.noise(t, 0.4, { gain: 0.12, type: 'bandpass', freq: 600, freqEnd: 1200, q: 5, attack: 0.05 });
    this.tone(160, t + 0.35, 0.15, { gain: 0.15, type: 'triangle', filter: 800 });
  }

  rattle(pos) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 2, 1);
    for (let i = 0; i < 7; i++) this.noise(t + i * 0.06, 0.04, { gain: 0.3, type: 'bandpass', freq: 1300 + Math.random() * 500, q: 3, dest: p });
  }

  noisemaker(pos) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 3, 0.6);
    for (let i = 0; i < 40; i++) {
      this.tone(i % 2 ? 2300 : 2600, t + i * 0.1, 0.09, { gain: 0.12, type: 'square', filter: 5000, dest: p });
    }
  }

  // positional music box near the Christmas tree
  musicBox(pos) {
    if (!this._ok()) return;
    const t = this.now, p = this._panner(pos, 1.5, 1.4);
    const notes = [76, 74, 72, 74, 76, 76, 76, 0, 74, 74, 74, 0, 76, 79, 79];
    notes.forEach((n, i) => { if (n) this.tone(midi(n + 12), t + i * 0.36, 0.9, { gain: 0.05, type: 'sine', attack: 0.003, dest: p }); });
    return notes.length * 0.36 + 1.5;
  }

  // gentle water lapping + drips (Poolrooms)
  setWater(level) {
    if (!this.ctx) return;
    if (!this._water) {
      const ctx = this.ctx;
      const s = ctx.createBufferSource(); s.buffer = this.brownBuf; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.6;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.18;
      const lg = ctx.createGain(); lg.gain.value = 220;
      lfo.connect(lg); lg.connect(f.frequency);
      s.connect(f); f.connect(g); g.connect(this.sfx);
      s.start(); lfo.start();
      this._water = { g, next: 0 };
    }
    this._water.g.gain.setTargetAtTime(level * 0.25, this.ctx.currentTime, 0.6);
    if (level > 0.05 && this.now > this._water.next) {
      this._water.next = this.now + 0.8 + Math.random() * 2.5;
      const t = this.now;
      this.tone(900 + Math.random() * 900, t, 0.12, { gain: 0.03 * level, freqEnd: 1800 + Math.random() * 800, attack: 0.002 });
    }
  }

  introHit() {
    if (!this._ok()) return;
    const t = this.now;
    this.tone(55, t, 2.6, { gain: 0.25, attack: 0.02 });
    for (const n of [43, 50, 55]) this.tone(midi(n), t, 3.2, { gain: 0.04, type: 'triangle', attack: 0.6, dest: this.ui });
  }
}
