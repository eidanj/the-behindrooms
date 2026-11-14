// ─────────────────────────────────────────────────────────────
//  THE BEHINDROOMS — main game loop & state machine
// ─────────────────────────────────────────────────────────────

import * as THREE from '../lib/three.module.min.js';
import { DIFFICULTIES, GFX_PRESETS, DEFAULT_SETTINGS, CYCLE, STARS_TO_WIN, ENTITY, ENTITY_TYPES, FLASHLIGHT, PLAYER, DEBUG, VENT, NIGHT_LIGHTS } from './config.js';
import { buildMaterials, setAnisotropy, SURF, warmOne, LAZY_KEYS } from './textures.js';
import { World } from './world.js';
import { Cycle } from './cycle.js';
import { AudioEngine } from './audio.js';
import { EntityManager } from './entities.js';
import { Throwables, ITEMS, FOOD_TABLE, DRINK_TABLE, WEAPONS, WEAPON_TABLE, STORABLE, MATERIALS, SLOTS } from './items.js';
import { Combat } from './combat.js';
import { Player } from './player.js';
import { Hands } from './hands.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { Tutorial } from './tutorial.js';
import { Guide } from './guide.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { weighted, lerp } from './rng.js';

const SETTINGS_KEY = 'behindrooms.settings.v1';
const BEST_KEY = 'behindrooms.best.v1';
const INTRO_KEY = 'behindrooms.intro.v1';
const GFX_KEYS = ['renderScale', 'maxDPR', 'maxLights', 'lightRange', 'viewDist', 'shadows', 'aniso', 'fogDay', 'fogNight'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const DAY_FOG = new THREE.Color(0xc9bd92);
const NIGHT_FOG = new THREE.Color(0x020202);

function loadSettings() {
  const base = { ...DEFAULT_SETTINGS };
  if (isTouchDevice()) Object.assign(base, GFX_PRESETS.low, { gfxPreset: 'low', antialias: false }); // phones start on the fastest preset
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    // migrate the old single "quality" setting
    if (s.quality && !s.gfxPreset && GFX_PRESETS[s.quality]) Object.assign(s, GFX_PRESETS[s.quality], { gfxPreset: s.quality });
    delete s.quality;
    const out = { ...base, ...s };
    for (const k of GFX_KEYS) if (out[k] === undefined) out[k] = GFX_PRESETS.medium[k];
    return out;
  } catch (e) { return base; }
}
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ } }

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.settings = loadSettings();

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !!this.settings.antialias, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(DAY_FOG.getHex(), 8, 46);
    this.scene.background = DAY_FOG.clone();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.05, 110);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.hemi = new THREE.HemisphereLight(0xfff0cc, 0xa49b86, 1);
    this.scene.add(this.hemi);

    // flashlight: short focused beam from the left hand + soft close fill
    this.flash = new THREE.SpotLight(0xfff3d8, 0, 17, 0.36, 0.5, 1.45);
    this.flash.position.set(-0.22, -0.2, 0.05);
    this.flash.target.position.set(-0.05, -0.12, -6);
    this.flash.shadow.mapSize.set(1024, 1024);
    this.flash.shadow.camera.near = 0.3;
    this.flash.shadow.camera.far = 18;
    this.flash.shadow.bias = -0.0015;
    this.camera.add(this.flash, this.flash.target);
    this.flashFill = new THREE.PointLight(0xfff0d0, 0, 3.2, 2);
    this.flashFill.position.set(0, -0.1, -0.6);
    this.camera.add(this.flashFill);

    this.mats = buildMaterials(this.q.anisotropy);
    this.audio = new AudioEngine();
    this.audio.setVolumes(this.settings.masterVolume, this.settings.musicVolume);
    this.input = new Input(this.canvas);
    this.hands = new Hands(this.mats);
    this.ui = new UI(this);

    this.pool = [];
    this._setPool(this.q.poolLights);
    this._applyGraphics(false);
    this.chest = {};
    this.shake = 0;
    this._camDir = new THREE.Vector3();

    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.36, 4), new THREE.MeshBasicMaterial({ color: 0xffd24a, fog: false }));
    this.marker.rotation.x = Math.PI;
    this.marker.visible = false;
    this.scene.add(this.marker);
    this.guide = new Guide(this);
    this.combat = new Combat(this);
    this.touch = new TouchControls(this);

    this.state = 'splash';
    this.world = null; this.player = null; this.entities = null; this.throwables = null; this.cycle = null;
    this.timers = [];
    this.time = 0;
    this.last = performance.now();
    this.fpsT = 0; this.fpsN = 0;
    this.locked = false;
    this.noLock = false;
    this.returnTo = 'scr-menu';
    this.diffId = 'normal';

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this._bindUI();
    document.addEventListener('pointerlockchange', () => this._onLockChange());
    document.addEventListener('pointerlockerror', () => { this.noLock = true; this.input.allowUnlocked = true; if (this.state === 'resume') this.resume(); });
    this._applyTouchMode();
    window.__game = this;
    requestAnimationFrame((t) => this.loop(t));
  }

  // ── settings / quality ─────────────────────────────────────
  _setPool(n) {
    for (const l of this.pool) this.scene.remove(l);
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xfff1cf, 0, 9, 2);
      this.scene.add(l);
      this.pool.push(l);
    }
    if (this.world) this.world.setPool(this.pool);
  }

  // graphics settings (see the Graphics page / GFX_PRESETS in config.js)
  get q() {
    const s = this.settings;
    return { renderScale: s.renderScale, maxDPR: s.maxDPR, poolLights: s.maxLights | 0, lightRange: s.lightRange, loadRadius: s.viewDist | 0, shadows: !!s.shadows, anisotropy: +s.aniso || 1, fogDay: s.fogDay, fogNight: s.fogNight };
  }

  _applyGraphics(recompile = true) {
    const q = this.q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.maxDPR) * q.renderScale);
    this.renderer.shadowMap.enabled = q.shadows;
    this.flash.castShadow = q.shadows;
    if (this.pool.length !== q.poolLights) this._setPool(q.poolLights);
    setAnisotropy(this.mats, q.anisotropy);
    if (this.world && this.world.loadRadius !== q.loadRadius) { this.world.loadRadius = q.loadRadius; this.world._dirty = true; }
    if (this.world) this.world.lightRange = q.lightRange;
    if (recompile) this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true)); });
    this.resize();
  }

  applySetting(k) {
    const s = this.settings;
    if (k === 'gfxPreset' && GFX_PRESETS[s.gfxPreset]) {
      Object.assign(s, GFX_PRESETS[s.gfxPreset]);
      this.ui.syncSettings();
      this._applyGraphics(true);
    } else if (GFX_KEYS.includes(k)) {
      const p = GFX_PRESETS[s.gfxPreset];
      if (p && p[k] !== s[k]) { s.gfxPreset = 'custom'; this.ui.syncSettings(); }
      this._applyGraphics(k === 'shadows');
    }
    saveSettings(s);
    if (k === 'fov') { this.camera.fov = s.fov; this.camera.updateProjectionMatrix(); }
    if (k === 'masterVolume' || k === 'musicVolume') this.audio.setVolumes(s.masterVolume, s.musicVolume);
    if (k === 'showFps') document.getElementById('fps').classList.toggle('hidden', !s.showFps);
    if (k === 'touchControls') this._applyTouchMode();
    if (k === 'antialias') this.toast('Anti-aliasing changes when you reload the page.', '', 3000);
  }

  // touch controls: Auto (detect the device), On or Off — Settings → Touch controls
  _applyTouchMode() {
    const m = this.settings.touchControls || 'auto';
    this.touchMode = m === 'on' || (m === 'auto' && isTouchDevice());
    document.getElementById('app').classList.toggle('touch', this.touchMode);
    if (this.touchMode) { this.noLock = true; this.input.allowUnlocked = false; }
    else if (this._wasTouch) { this.noLock = false; }
    this._wasTouch = this.touchMode;
    this.ui.lastHot = '';
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hands.resize(w / h);
  }

  // ── UI wiring ──────────────────────────────────────────────
  _bindUI() {
    const on = (sel, fn) => document.querySelectorAll(sel).forEach((el) => el.addEventListener('click', fn));
    document.getElementById('btn-splash').addEventListener('click', () => {
      if (this.touchMode) {
        try {
          const el = document.documentElement;
          const req = el.requestFullscreen || el.webkitRequestFullscreen;
          const p = req && req.call(el);
          if (p && p.then) p.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
        } catch (e) { /* fullscreen not available (e.g. iPhone Safari) */ }
      }
      this.audio.init();
      this.audio.setMenuMode(true);
      // first visit: "Altekz Studios" card (the menu loads behind the black screen)
      let seen = false;
      try { seen = !!localStorage.getItem(INTRO_KEY); localStorage.setItem(INTRO_KEY, '1'); } catch (e) { /* ignore */ }
      if (!seen || this.forceIntro) {
        this.ui.introBlack();
        setTimeout(() => { this.enterMenu(); this.audio.introHit(); this.ui.intro(() => {}); }, 60);
      } else this.enterMenu();
    });
    on('[data-action]', (e) => {
      const a = e.currentTarget.dataset.action;
      this.audio.uiClick();
      this._action(a);
    });
    document.querySelectorAll('.mbtn, .btn, .diff-card').forEach((b) => b.addEventListener('mouseenter', () => this.audio.uiHover()));
    on('.diff-card', (e) => {
      document.querySelectorAll('.diff-card').forEach((c) => c.classList.remove('selected'));
      e.currentTarget.classList.add('selected');
      this.diffId = e.currentTarget.dataset.diff;
      this.audio.uiClick();
    });
    document.querySelectorAll('.diff-card').forEach((c) => c.addEventListener('dblclick', () => this.startGame(c.dataset.diff, false)));
    this.ui.bindSettings(this.settings, (k) => this.applySetting(k));
    document.getElementById('fps').classList.toggle('hidden', !this.settings.showFps);
    document.getElementById('btn-testing').classList.toggle('hidden', !DEBUG.testTools);
    const types = Object.entries(ENTITY_TYPES).map(([k, d]) => `<option value="${k}">${d.name}</option>`).join('');
    document.getElementById('tt-entity').innerHTML = `<option value="">Random type</option>${types}`;
    document.getElementById('tt-scare').innerHTML = types;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.state === 'playing' && (this.noLock || !this.locked)) this.pause();
        else if (this.state === 'craft' || this.state === 'chest') this.closeOverlay();
        else if (['scr-settings', 'scr-howto', 'scr-diff', 'scr-graphics', 'scr-test'].includes(this.ui.current)) this._action('back');
      }
      if (e.code === 'Enter' && this.state === 'tutdone') this._action('new');
    });
  }

  _action(a) {
    switch (a) {
      case 'new':
        this.returnTo = 'scr-menu';
        if (this.state !== 'menu') this.enterMenu();
        this.ui.show('scr-diff');
        break;
      case 'tutorial': this.startGame('normal', true); break;
      case 'howto': this.returnTo = this.ui.current; this.ui.show('scr-howto'); break;
      case 'settings': this.returnTo = this.ui.current; this.ui.show('scr-settings'); break;
      case 'graphics': this.ui.show('scr-graphics'); break;
      case 'testing': this.ui.show('scr-test'); break;
      case 'back':
        if (this.ui.current === 'scr-diff') this.ui.show('scr-menu');
        else if (this.ui.current === 'scr-graphics') this.ui.show('scr-settings');
        else if (this.ui.current === 'scr-test') this.ui.show('scr-pause');
        else this.ui.show(this.returnTo && this.returnTo !== this.ui.current ? this.returnTo : 'scr-menu');
        break;
      case 'start': this.startGame(this.diffId, false); break;
      case 'resume': this.requestLock(); if (this.noLock) this.resume(); break;
      case 'quit': this.quitToMenu(); break;
      case 'respawn': this.respawn(); break;
      case 'closeui': this.closeOverlay(); break;
      case 'storeall': this.storeAll(); break;
      case 'night': case 'day': case 'spawn': case 'guide': case 'bed': case 'scare': case 'kit': case 'heal': case 'goto':
        ({
          night: () => this.makeNight(), day: () => this.makeDay(),
          spawn: () => this.spawnTestMonster(document.getElementById('tt-entity').value || null),
          scare: () => this.testJumpscare(document.getElementById('tt-scare').value),
          guide: () => this.toggleGuide(), bed: () => this.spawnTestBed(),
          kit: () => this.giveTestKit(), heal: () => this.testHeal(),
          goto: () => this.teleportTo(document.getElementById('tt-room').value),
        })[a]();
        this.requestLock();
        if (this.noLock) this.resume();
        break;
    }
  }

  requestLock() {
    if (this.noLock) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { /* will show resume screen */ });
    } catch (e) { this.noLock = true; this.input.allowUnlocked = true; }
  }

  _onLockChange() {
    this.locked = document.pointerLockElement === this.canvas;
    if (this.locked) {
      if (this.state === 'paused' || this.state === 'resume') this.resume();
    } else if (this.state === 'playing') this.pause();
  }

  // ── menu ───────────────────────────────────────────────────
  enterMenu() {
    this.state = 'menu';
    this.ui.show('scr-menu');
    this.ui.showHud(false);
    this.ui.hideTutorial();
    this.ui.clearEffects();
    this.ui.fade(0, 400);
    this.audio.setMenuMode(true);
    this._exitToMenuWorld();
    try {
      const best = JSON.parse(localStorage.getItem(BEST_KEY) || 'null');
      document.getElementById('menu-best').textContent = best ? `BEST ESCAPE · DAY ${best.day} · ${best.diff.toUpperCase()}` : '';
    } catch (e) { /* ignore */ }
  }

  // generate + upload room textures in the background, one every few frames
  _warmStep() {
    if (this._warmI === undefined) this._warmI = 0;
    if (this._warmI >= LAZY_KEYS.length) return;
    warmOne(this.mats, this.renderer, this._warmI++);
  }

  _exitToMenuWorld() {
    if (this.world && this.world.menu) return;
    this._disposeRun();
    this.world = new World(this, { seed: 40213, difficulty: DIFFICULTIES.normal, menu: true, loadRadius: Math.min(2, this.q.loadRadius), lightRange: this.q.lightRange });
    this.world.setPool(this.pool);
    // pick a nice spot: the first non-camp room near the origin
    this.world.loadAllAround(new THREE.Vector3(36, 0, 36));
    const room = [...this.world.rooms()].filter((r) => !r.camp && (r.type === 'normal' || r.type === 'pillars')).sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0))[0];
    const cell = room ? room.cells[Math.floor(room.cells.length / 2)] : [12, 12];
    this.menuCam = new THREE.Vector3(cell[0] * 3 + 1.5, 1.62, cell[1] * 3 + 1.5);
    this.menuT = Math.random() * 100;
    this.menuChaos = 0;
    this.menuNextBurst = 4;
    this.hands.hidden = true;
  }

  _disposeRun() {
    if (this.entities) this.entities.clear();
    if (this.throwables) this.throwables.clear();
    if (this.world) this.world.dispose();
    for (const b of this.bedBreathers || []) this.audio.releaseBreather(b);
    this.bedBreathers = [];
    this.world = null; this.entities = null; this.throwables = null; this.tut = null;
    this.setMarker(null);
    if (this.guide) this.guide.stop();
    if (this.combat) this.combat.clear();
    this.timers = [];
  }

  updateMenu(dt) {
    this.menuT += dt;
    const t = this.menuT, c = this.menuCam;
    this.camera.position.set(c.x + Math.sin(t * 0.13) * 0.5, 1.62 + Math.sin(t * 0.7) * 0.015, c.z + Math.cos(t * 0.11) * 0.5);
    this.camera.rotation.set(Math.sin(t * 0.21) * 0.05 - 0.02, t * 0.05, Math.sin(t * 0.3) * 0.006);
    this.menuNextBurst -= dt;
    if (this.menuNextBurst <= 0) { this.menuChaos = 0.55 + Math.random() * 0.4; this.menuNextBurst = 5 + Math.random() * 9; }
    this.menuChaos = Math.max(0, this.menuChaos - dt * 0.9);
    const f = { day: 1, night: 0, chaos: this.menuChaos > 0.05 ? this.menuChaos : 0, ambient: 0.82, nightMix: 0 };
    this.world.update(dt, this.camera.position, this.camera, this.time);
    this.world.updateLights(this.time, f, [], this.camera.position);
    this._applyEnv(f);
    this.flash.intensity = 0; this.flashFill.intensity = 0;
    this.audio.setHum(0.7);
    this.audio.setListener(this.camera.position, this.camera.getWorldDirection(tmpV), UP);
    if (this.world.flickerNear > 0.3) this.audio.buzz(this.world.flickerNear);
    const d = new Date();
    document.getElementById('menu-clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ── starting a run ─────────────────────────────────────────
  startGame(diffId, tutorial) {
    this.requestLock();
    this.audio.init();
    this.state = 'loading';
    this.ui.show('scr-loading');
    this.ui.loading(0.1);
    this.ui.showHud(false);
    setTimeout(() => this._build(diffId, tutorial), 40);
  }

  _build(diffId, tutorial) {
    while (this._warmI === undefined || this._warmI < LAZY_KEYS.length) this._warmStep();
    this._disposeRun();
    this.diff = DIFFICULTIES[diffId] || DIFFICULTIES.normal;
    this.diffId = this.diff.id;
    this.tutorial = tutorial;
    this.seed = tutorial ? 777 : this.forceSeed ?? (Math.random() * 2 ** 31) | 0;
    this.cycle = new Cycle();
    if (tutorial) this.cycle.paused = true;
    this.world = new World(this, { seed: this.seed, difficulty: this.diff, tutorial, loadRadius: this.q.loadRadius, lightRange: this.q.lightRange });
    this.world.setPool(this.pool);
    this.world.isNight = () => this.cycle.isNight;
    this.player = new Player(this);
    this.player.reset(this.world.spawn, false);
    this.entities = new EntityManager(this, this.diff);
    this.entities.enabled = !tutorial;
    this.throwables = new Throwables(this);
    this.banked = 0;
    this.playTime = 0;
    this.gameTime = 0;
    this.stats = { escapes: 0, squashed: 0, deaths: 0, nights: 0, kills: 0 };
    this.chest = {};
    this._ventTipShown = false;
    this.portalOpen = false;
    this.ui.loading(0.4);
    this.world.loadAllAround(this.player.pos);
    this.world.onChunkLoaded = (c) => this.entities && this.entities.onChunk(c, this.cycle.isNight);
    if (!tutorial) this.entities.populate(false, 30);
    if (this.world.portal) this.world.portal.setCount(0, STARS_TO_WIN);
    this._hookCycle();
    this.audio.setDifficulty(this.diff);
    this.audio.setMenuMode(false);
    this.audio.setNightMix(0);
    this.hands.hidden = false;
    this.ui.loading(1);
    this.ui.hideScreens();
    this.ui.showHud(true);
    this.ui.clearEffects();
    this.ui.fade(1, 0);
    setTimeout(() => this.ui.fade(0, 1400), 50);
    this.state = 'playing';
    if (tutorial) {
      this.tut = new Tutorial(this);
      this.tut.start();
      this.ui.titleCard('TUTORIAL', 'the camp');
    } else {
      this.ui.hideTutorial();
      this.ui.titleCard('DAY 1', `${this.diff.name.toUpperCase()} · find stars · survive · return to camp`, 4200);
    }
    if (!this.locked && !this.noLock) { this.state = 'resume'; this.ui.show('scr-resume'); }
  }

  _hookCycle() {
    const c = this.cycle;
    c.onDuskWarning = () => this.toast('The lights are failing… night is coming.', 'bad', 5000);
    c.onNightfall = () => {
      this.audio.powerDown();
      this.world.setBedTraps(true);
      this.ui.titleCard(`NIGHT ${c.day}`, 'they can see you now', 3600);
    };
    c.onNightLights = () => {
      this.entities.populate(true);
      const a = Math.random() * Math.PI * 2;
      this.audio.shriek(tmpV.set(this.player.pos.x + Math.cos(a) * 25, 2, this.player.pos.z + Math.sin(a) * 25));
    };
    c.onDawn = () => {
      this.audio.powerUp();
      this.entities.dawn(this._ctx());
      this.world.setBedTraps(false);
      this.stats.nights++;
      this.ui.titleCard(`DAY ${c.day}`, 'you survived the night', 3600);
      this.after(4, () => this.entities && this.entities.populate(false, 30));
    };
  }

  after(sec, fn) { this.timers.push({ t: sec, fn }); }

  // ── test tools (Testing tab + hotkeys N / T / M / G / B / J / K / H) ──
  _testOk() {
    if (!DEBUG.testTools || !this.cycle || !this.world || this.world.menu || !this.player) return false;
    if (this.tutorial) { this.toast('Test tools are off during the tutorial.'); return false; }
    return true;
  }

  // Jump to just before nightfall so the flicker + power cut still plays.
  makeNight() {
    if (!this._testOk()) return;
    if (this.cycle.isNight) { this.toast('It\'s already night.'); return; }
    this.cycle.t = Math.max(this.cycle.t, this.cycle.dayLength - 3);
    this.toast('TEST · skipping to nightfall…', '', 2000);
  }

  makeDay() {
    if (!this._testOk()) return;
    const c = this.cycle;
    if (c.isNight) { c.toDawn(); this.toast('TEST · skipping to morning…', '', 2000); }
    else if (c.t > c.dayLength - CYCLE.duskWarning - 1) { c.t = 0; c._warned = false; this.toast('TEST · back to the start of the day', '', 2000); }
    else this.toast('It\'s already daytime.');
  }

  // Spawn one monster 6–16 m away, preferring a spot you can see in front of you.
  spawnTestMonster(type) {
    if (!this._testOk()) return;
    const P = this.player, W = this.world;
    if (type && ENTITY_TYPES[type]?.nightOnly && !this.cycle.isNight) this.toast(`${ENTITY_TYPES[type].name} normally only comes out at night.`, '', 2500);
    const cx = Math.floor(P.pos.x / 3), cz = Math.floor(P.pos.z / 3);
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    let best = null, bs = -Infinity;
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) {
      const x = (cx + dx) * 3 + 1.5, z = (cz + dz) * 3 + 1.5;
      const d = Math.hypot(x - P.pos.x, z - P.pos.z);
      if (d < 6 || d > 16 || W.isForbidden(x, z)) continue;
      const los = W.lineOfSight(P.pos.x, P.eyeY, P.pos.z, x, W.entFloor(x, z) + 1.6, z);
      const dot = ((x - P.pos.x) * fx + (z - P.pos.z) * fz) / d;
      const sc = (los ? 10 : 0) + dot * 3 - Math.abs(d - 10) * 0.25 + Math.random() * 0.5;
      if (sc > bs) { bs = sc; best = { x, z, d, los }; }
    }
    if (!best) { this.toast('No room to spawn a monster here — step out of camp first.', 'bad'); return; }
    const e = this.entities.spawn(best.x, best.z, !this.cycle.isNight && !type, type || undefined);
    e.noticed = true;
    e.yaw = Math.atan2(P.pos.x - best.x, P.pos.z - best.z);
    this.toast(`TEST · ${e.name} spawned ${Math.round(best.d)} m away${best.los ? '' : ' (out of sight)'}`, 'bad', 3000);
  }

  testJumpscare(type) {
    if (!this.player) return;
    this.ui.jumpscare(900, type || 'hollow');
    this.audio.jumpscare();
  }

  spawnTestBed() {
    if (!this._testOk()) return;
    const P = this.player, W = this.world;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    const across = Math.abs(fx) > Math.abs(fz);
    for (const rot of [across, !across]) {
      const hx = rot ? 0.5 : 1.0, hz = rot ? 1.0 : 0.5;
      for (const d of [2.4, 2.9, 3.5, 4.2, 1.9]) {
        for (const lat of [0, 0.7, -0.7, 1.3, -1.3]) {
          const x = P.pos.x + fx * d - fz * lat, z = P.pos.z + fz * d + fx * lat;
          const m = 0.12;
          if (!W.rectFree(x - hx - m, x + hx + m, z - hz - m, z + hz + m)) continue;
          const cx = Math.max(x - hx, Math.min(P.pos.x, x + hx)), cz = Math.max(z - hz, Math.min(P.pos.z, z + hz));
          if (Math.hypot(P.pos.x - cx, P.pos.z - cz) < 0.6) continue;
          const bed = W.spawnTestBed(x, z, rot);
          if (!bed) continue;
          this.toast('TEST · Trapped bed spawned — listen for breathing, then jump on it 4 times!', 'bad', 4000);
          return;
        }
      }
    }
    this.toast('No space for a bed here — face an open area and try again.', 'bad');
  }

  toggleGuide() {
    if (!this._testOk()) return;
    if (this.guide.active) { this.guide.stop(); this.toast('Saferoom guide off.'); return; }
    if (this.guide.start()) {
      const b = this.guide.bearing();
      const keys = this.player.inv.counts.key;
      this.toast(`Saferoom ${Math.round(b.dist)} m away — follow the arrows${this.guide.door.unlocked ? '' : ` · locked, you have ${keys} key${keys === 1 ? '' : 's'}`}`, 'good', 4000);
    }
  }

  giveTestKit() {
    if (!this._testOk()) return;
    const inv = this.player.inv;
    for (const [k, n] of [['wood', 6], ['metal', 8], ['cloth', 4], ['tape', 4], ['bandage', 2], ['medkit', 1], ['noisemaker', 2], ['rock', 3], ['fruit', 2], ['battery', 2], ['key', 1], ['almond', 1], ['energy', 1]]) inv.add(k, n);
    inv.addWeapon('spikedbat');
    inv.addWeapon('axe');
    this.audio.pickup();
    this.toast('TEST · Test kit added (materials, meds, noisemakers, weapons, key…)', 'good', 3500);
  }

  testHeal() {
    if (!this._testOk()) return;
    const P = this.player;
    P.health = PLAYER.maxHealth; P.hunger = 100; P.energy = PLAYER.maxEnergy; P.sanity = 100;
    P.crouchMeter = 1; P.crouchLock = false;
    if (P.vent) P.vent.st.dur = VENT.durability;
    this.audio.heal();
    this.toast('TEST · Healed and stats refilled', 'good');
  }

  teleportTo(type) {
    if (!this._testOk()) return;
    const P = this.player, W = this.world;
    if (P.mode !== 'walk') { this.toast('Get out of the vent first.'); return; }
    let spot = null;
    if (type === 'vent') {
      let bd = Infinity;
      for (const v of W.vents.values()) for (const g of v.grates) {
        if (!g.ladder || v.st.broken) continue;
        const d = Math.hypot(g.x - P.pos.x, g.z - P.pos.z);
        if (d < bd) { bd = d; spot = { x: g.x, z: g.z + 0.9 }; }
      }
      if (!spot) {
        // search a little further out
        const pcx = Math.floor(P.pos.x / 24), pcz = Math.floor(P.pos.z / 24);
        for (let r = 1; r <= 6 && !spot; r++) for (let dz = -r; dz <= r && !spot; dz++) for (let dx = -r; dx <= r && !spot; dx++) {
          const L = W._layout(pcx + dx, pcz + dz);
          const g = L.vent && L.vent.grates.find((q) => q.ladder);
          if (g && !(W.state.vents.get(L.vent.id) || {}).broken) spot = { x: g.gx * 3 + 1.5, z: g.gz * 3 + 1.5 + 0.9 };
        }
      }
    } else spot = W.findRoomOfType(type, P.pos.x, P.pos.z, type === 'pool' ? 22 : 9);
    if (!spot) { this.toast('Couldn\'t find one nearby.', 'bad'); return; }
    P.pos.set(spot.x, 0, spot.z);
    W.loadAllAround(P.pos);
    P.pos.y = W.floorAt(spot.x, spot.z);
    P.vy = 0; P.fallFrom = P.pos.y; P.onGround = true;
    for (const e of this.entities.list) { if (Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) > 60) e.dead = true; }
    const names = { pit: 'a room with holes in the floor', sunken: 'a sunken room', xmas: 'the Christmas room', pool: 'the Poolrooms', flooded: 'a flooded room', cubicle: 'the cubicles', pillars: 'a pillar hall', vent: 'a vent ladder' };
    this.toast(`TEST · Teleported to ${names[type] || type}`, 'good', 2500);
  }

  // ── pause / resume / quit ──────────────────────────────────
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.returnTo = 'scr-pause';
    this.ui.show('scr-pause');
    this.audio.suspend();
  }

  resume() {
    if (this.state !== 'paused' && this.state !== 'resume') return;
    this.state = 'playing';
    this.ui.hideScreens();
    this.audio.resume();
    this.input.endFrame();
  }

  quitToMenu() {
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.resume();
    this.ui.hideTutorial();
    this.enterMenu();
  }

  finishTutorial() {
    this.state = 'tutdone';
    this.ui.hideTutorial();
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.show('scr-tutdone');
  }

  // ── crafting table + camp chest ────────────────────────────
  _openOverlay(state, screen) {
    this.state = state;
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.show(screen);
    this.ui.prompt('');
  }

  closeOverlay() {
    if (this.state !== 'craft' && this.state !== 'chest') return;
    if (this.world.campChest) this.world.campChest.lid.rotation.x = 0;
    this.state = 'playing';
    this.ui.hideScreens();
    this.input.endFrame();
    this.requestLock();
    if (!this.noLock) {
      // if the browser refuses the lock, fall back to the click-to-continue screen
      setTimeout(() => { if (this.state === 'playing' && !this.locked && !this.noLock) { this.state = 'resume'; this.ui.show('scr-resume'); } }, 400);
    }
  }

  openCraft() {
    this._openOverlay('craft', 'scr-craft');
    this.ui.renderCraft(this.player, (r) => this.craft(r));
  }

  craft(r) {
    const inv = this.player.inv;
    if (!Object.entries(r.needs).every(([m, n]) => (inv.counts[m] || 0) >= n)) { this.audio.denied(); return; }
    for (const [m, n] of Object.entries(r.needs)) inv.counts[m] -= n;
    if (r.weapon) inv.addWeapon(r.out); else inv.add(r.out);
    this.audio.craft();
    this.toast(`Crafted: <b>${(WEAPONS[r.out] || ITEMS[r.out]).name}</b>`, 'good', 2500);
    this.ui.renderCraft(this.player, (q) => this.craft(q));
  }

  openChest() {
    this._openOverlay('chest', 'scr-chest');
    if (this.world.campChest) this.world.campChest.lid.rotation.x = -1.15;
    this.audio.chestOpen();
    this._renderChest();
  }

  _renderChest() { this.ui.renderChest(this.player, this.chest, (k, dir, n) => this.moveChest(k, dir, n)); }

  moveChest(k, dir, n) {
    const inv = this.player.inv;
    for (let i = 0; i < n; i++) {
      if (dir === 'in') { if (!inv.take(k)) break; this.chest[k] = (this.chest[k] || 0) + 1; }
      else { if (!(this.chest[k] > 0)) break; this.chest[k]--; inv.add(k); }
    }
    this.audio.click();
    this._renderChest();
  }

  storeAll() {
    const inv = this.player.inv;
    for (const k of STORABLE) {
      const cat = ITEMS[k].cat;
      if (cat !== 'food' && cat !== 'drink' && cat !== 'battery') continue;
      const n = inv.counts[k] || 0;
      if (n) this.moveChest(k, 'in', n);
    }
    this._renderChest();
  }

  // ── gameplay events ────────────────────────────────────────
  toast(t, k, ms) { this.ui.toast(t, k, ms); }
  tutEvent(name, v) { if (this.tut) this.tut.event(name, v); }

  setMarker(x, y, z) {
    if (x === null || x === undefined) { this.marker.visible = false; return; }
    this.marker.visible = true;
    this.marker.userData.base = new THREE.Vector3(x, y, z);
  }

  awardStar(reason) {
    if (!this.player || this.player.dead) return;
    this.player.stars++;
    this.audio.star();
    this.ui.toast(`+1 ★ · ${reason}`, 'star', 4000);
    this.ui.bumpStars();
  }

  _ctx(f) {
    const P = this.player;
    const cam = this.camera;
    const halfH = THREE.MathUtils.degToRad(cam.fov / 2);
    const halfW = Math.atan(Math.tan(halfH) * cam.aspect);
    return {
      player: P, world: this.world, audio: this.audio, diff: this.diff, tutorial: this.tutorial,
      night: this.cycle.isNight, huntable: !P.dead && this.state === 'playing',
      time: this.gameTime, nearestDist: this.entities ? this.entities.nearestDist : Infinity,
      cam: { pos: cam.position, dir: cam.getWorldDirection(this._camDir), fovCos: Math.cos(Math.min(halfW, halfH * 1.6) * 0.92) },
      ambient: f ? f.ambient * Math.max(f.day, 0.001) : 1,
      flashlightOn: P.flashlightOn && P.flashCut <= 0 && !P.dead,
      playerDead: P.dead,
      onChaseStart: (e) => this.onChaseStart(e),
      onEscape: (e) => { if (!P.dead) { this.stats.escapes++; this.awardStar(`You escaped ${e.name}`); } },
      onHit: (e, dmg) => this.onPlayerHit(e, dmg),
      onClawVent: (e) => this.onClawVent(e),
      onEntityKilled: (e) => this.onEntityKilled(e),
    };
  }

  onChaseStart(e) {
    const P = this.player;
    this.audio.shriek(e.pos);
    // the flashlight dies for a second when something spots you
    if (P.flashlightOn && P.flashCut <= 0) { P.flashCut = FLASHLIGHT.seenCutout; this.audio.click(); }
    if (!this._chaseToastT || this.gameTime - this._chaseToastT > 12) {
      this._chaseToastT = this.gameTime;
      this.toast(`${e.name} sees you — RUN`, 'bad', 2500);
    }
    if (Math.random() < this.diff.jumpscareChance) { this.ui.jumpscare(450, e.type); this.audio.jumpscare(); }
  }

  onPlayerHit(e, dmg) {
    const P = this.player;
    if (P.dead) return;
    dmg = Math.round(dmg);
    P.damage(dmg, e.name, e);
    if (P.dead) { this.killer = e; return; }
    // knock the player back a little
    const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
    P.vel.x += (dx / d) * (e.type === 'brute' ? 6 : 3.5);
    P.vel.z += (dz / d) * (e.type === 'brute' ? 6 : 3.5);
    this.combat.burst(P.pos.x - dx / d * 0.3, P.eyeY - 0.4, P.pos.z - dz / d * 0.3, dx, dz, 6);
    if (P.hurtTipT === undefined) { P.hurtTipT = 1; this.toast(`${e.name} hit you for ${dmg} — fight back or run!`, 'bad', 2500); }
  }

  onPlayerHurt(amount) {
    this.ui.hurtFlash(amount);
    this.audio.hurt(amount >= 25);
    this.shake = Math.max(this.shake, Math.min(0.5, 0.12 + amount / 70));
  }

  onClawVent(e) {
    const P = this.player;
    if (!P.inVent || !P.vent) return;
    P.vent.st.dur -= VENT.clawDamage;
    this.audio.scratch(tmpV.set(P.pos.x, VENT.floorY, P.pos.z));
    this.shake = Math.max(this.shake, 0.3);
    if (!this._clawToastT || this.gameTime - this._clawToastT > 6) { this._clawToastT = this.gameTime; this.toast(`${e.name} is clawing at the vent below you!`, 'bad', 2200); }
  }

  onEntityKilled(e) {
    this.stats.kills++;
    this.awardStar(`You killed ${e.name}`);
  }

  landKick(v) { if (this.player) this.player.landKick = Math.max(this.player.landKick, v); }

  onEntityTripped(e, type) {
    this.toast(type === 'banana' ? `${e.name} slipped on a banana peel!` : `You tripped ${e.name}!`, 'good');
  }

  onPlayerLand(speed, ground, drop = 0, water = false) {
    const P = this.player;
    if (water) this.audio.splash(drop > 1.2); else this.audio.land();
    this.entities.noise(P.pos.x, P.pos.z, 'land');
    if (drop > PLAYER.fallSafe && !this.tutorial) {
      const dmg = Math.round((drop - PLAYER.fallSafe) * PLAYER.fallDamagePerM * (water ? 0.3 : 1));
      if (dmg >= 1) { P.damage(dmg, this._fallCause || 'Fall'); this.landKick(0.12); }
      if (P.dead) return;
    }
    this._fallCause = null;
    const bed = ground > 0.45 ? this.world.bedUnder(P.pos.x, P.pos.z) : null;
    if (!bed) return;
    this.audio.bounce();
    P.vy = speed * 0.42;
    P.onGround = false;
    P.fallFrom = P.pos.y;
    if (!bed.trapped || speed < 3) return;
    bed.hits++;
    this.audio.squash(bed.pos);
    if (bed.hits === 1) {
      bed.awake = 7;
      this.audio.growl(bed.pos);
      this.toast('Something thrashes under the blanket — KEEP JUMPING!', 'bad', 3000);
    }
    bed.model.bulge.scale.y = 0.13 * Math.max(0.15, 1 - bed.hits / 4);
    if (bed.hits >= 4) {
      bed.squashed = true;
      bed.trapped = false;
      bed.awake = 0;
      this.world.state.squashed.add(bed.id);
      bed.model.bulge.scale.set(0.66, 0.025, 0.36);
      bed.model.limb.rotation.x = 0.6;
      if (bed.breather) { this.audio.releaseBreather(bed.breather); bed.breather = null; }
      this.stats.squashed++;
      this.awardStar('You squashed The Sleeper');
      this.toast('It\'s dead. The bed is safe to sleep in now.', 'good', 3500);
    }
  }

  interact() {
    const it = this.focus;
    const P = this.player;
    if (!it || P.dead || P.mode === 'anim') return;
    const A = this.audio;
    switch (it.kind) {
      case 'drawer':
        if (it.looted) { this.toast('Already searched.'); return; }
        if (it.stuck) {
          it.jiggle();
          A.rattle(it.pos);
          this.entities.noise(it.pos.x, it.pos.z, 'drawer');
          this.toast('It\'s rusted shut… pull again.', '', 1800);
          return;
        }
        it.open();
        A.drawer(it.pos, it.rusty);
        this.entities.noise(it.pos.x, it.pos.z, 'drawer');
        this.giveLoot(it.loot);
        this.tutEvent('drawer');
        break;
      case 'lootbox':
        this.world.removePickup(it);
        A.drawer(it.pos);
        this.giveLoot(it.loot);
        break;
      case 'gift':
        this.world.state.looted.add(it.id);
        this.world.removePickup(it);
        A.chestOpen();
        this.giveLoot(it.loot);
        break;
      case 'pickup':
        P.inv.add(it.item);
        this.world.removePickup(it);
        A.pickup();
        this.toast(`Picked up: <b>${ITEMS[it.item].name}</b>`, 'good', 2200);
        this.tutEvent('pickup', it.item);
        break;
      case 'sdoor':
        if (it.unlocked) { this.toast('Saferoom — monsters can\'t get in here.'); return; }
        if (P.inv.take('key')) {
          it.unlock();
          A.doorUnlock(it.pos);
          this.toast('Saferoom unlocked. Monsters can\'t enter.', 'good');
        } else { A.denied(); this.toast('Locked. You need a Saferoom Key — or craft one at camp.', 'bad'); }
        break;
      case 'bed':
        if (!this.cycle.isNight) { this.toast('You\'re not tired. You can only sleep at night.'); return; }
        if (it.awake > 0) return;
        if (it.trapped) { this.die('The Sleeper', { bed: it }); return; }
        this.sleep();
        break;
      case 'portal':
        this.tutEvent('portal');
        if (this.banked >= STARS_TO_WIN) this.win();
        else this.toast(`The portal needs ${STARS_TO_WIN} banked ★ · ${this.banked}/${STARS_TO_WIN}`, '', 3000);
        break;
      case 'craft': this.openCraft(); this.tutEvent('craft'); break;
      case 'chest': this.openChest(); this.tutEvent('chest'); break;
      case 'ventLadder':
        if (it.vent.st.broken) { A.denied(); this.toast('This vent has collapsed. It can\'t be used any more.', 'bad'); return; }
        this.climbIntoVent(it);
        break;
      case 'ventExit':
        this.leaveVent(it.grate);
        break;
    }
  }

  giveLoot(type) {
    const A = this.audio;
    const inv = this.player.inv;
    if (!type) { this.toast('Empty.', '', 1800); return; }
    let item = type;
    if (MATERIALS.includes(type)) {
      const n = type === 'tape' ? 1 : 1 + (Math.random() < 0.45 ? 1 : 0);
      inv.add(type, n);
      A.pickup();
      this.toast(`Found: <b>${n} × ${ITEMS[type].name}</b> · craft with it at camp`, 'good', 2800);
      return;
    }
    if (type === 'food') item = this.tutorial ? 'bread' : weighted(Math.random, FOOD_TABLE);
    if (type === 'drink') item = weighted(Math.random, DRINK_TABLE);
    if (type === 'medkit') item = Math.random() < 0.65 ? 'bandage' : 'medkit';
    if (type === 'weapon') {
      item = weighted(Math.random, WEAPON_TABLE);
      inv.addWeapon(item);
      A.pickup();
      this.toast(`Found a weapon: <b>${WEAPONS[item].name}</b> · press <kbd>7</kbd> or <kbd>F</kbd>`, 'good', 4000);
      return;
    }
    inv.add(item);
    A.pickup();
    this.toast(`Found: <b>${ITEMS[item].name}</b>`, 'good', 3000);
  }

  // ── vents ──────────────────────────────────────────────────
  // a short scripted camera move; the player can't act until it's done
  _playAnim(dur, step, done) {
    const P = this.player;
    P.mode = 'anim';
    this.hands.hidden = true;
    this.anim = { t: 0, dur, step, done };
  }

  _updateAnim(dt) {
    const a = this.anim;
    if (!a) return;
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    a.step(k, dt);
    if (k >= 1) { this.anim = null; this.hands.hidden = false; a.done(); }
  }

  climbIntoVent(it) {
    const P = this.player, A = this.audio, g = it.grate;
    const f0 = this.world.floorAt(g.x, g.z);
    const sx = P.pos.x, sz = P.pos.z, sy = P.pos.y, sp = P.pitch;
    let yaw0 = P.yaw;
    const dyaw = Math.atan2(Math.sin(0 - yaw0), Math.cos(0 - yaw0));
    let clank = 0;
    this._playAnim(1.7, (k, dt) => {
      const a = Math.min(1, k / 0.22), c = Math.max(0, (k - 0.2) / 0.8);
      const ce = c * c * (3 - 2 * c);
      // step to the ladder, face it, climb up through the grate
      P.pos.x = sx + (g.x - sx) * a;
      P.pos.z = sz + (g.z - 0.12 - sz) * a + 0.12 * ce;
      P.yaw = yaw0 + dyaw * a;
      P.pos.y = sy + (f0 - sy) * a + (VENT.floorY + 0.42 - f0 - P.eye) * ce;
      P.pitch = sp + (0.45 - sp) * a - 0.45 * ce;
      if (c > 0 && (clank += dt) > 0.28) { clank = 0; A.clank(); }
      if (c > 0.75 && !g.opened) { g.opened = true; this.world.state.grates.add(g.id); g.mesh.parent?.remove(g.mesh); A.grate(); }
    }, () => {
      P.enterVent(it.vent, g.x, g.z);
      P.pitch = 0;
      this.tutEvent('vent');
      if (!this._ventTipShown) {
        this._ventTipShown = true;
        this.toast('In the vent: monsters can\'t see or hear you. Crawling wears it down (faster if you hurry) — stay still to let it recover. Find a grate to drop out.', '', 6500);
      }
    });
  }

  leaveVent(grate) {
    const P = this.player, A = this.audio, W = this.world;
    if (!grate.opened) { grate.opened = true; W.state.grates.add(grate.id); grate.mesh.parent?.remove(grate.mesh); A.grate(); }
    const f = W.floorAt(grate.x, grate.z);
    const sx = P.pos.x, sz = P.pos.z, sp = P.pitch;
    const camY0 = VENT.floorY + P.eye;
    const ladder = grate.ladder;
    let landed = false, clank = 0;
    P.mode = 'anim';
    this._playAnim(ladder ? 1.6 : 1.15, (k, dt) => {
      const a = Math.min(1, k / 0.25);
      P.pos.x = sx + (grate.x - sx) * a;
      P.pos.z = sz + (grate.z + (ladder ? 0.05 : 0) - sz) * a;
      let camY;
      if (ladder) {
        const c = Math.max(0, (k - 0.15) / 0.85), ce = c * c * (3 - 2 * c);
        camY = camY0 + (f + PLAYER.eyeHeight - camY0) * ce;
        P.pitch = sp + (-0.5 - sp) * a + 0.5 * ce;
        if (c > 0 && (clank += dt) > 0.28) { clank = 0; A.clank(); }
      } else {
        // hang, drop, absorb the landing, stand up
        const d = Math.max(0, Math.min(1, (k - 0.25) / 0.4));
        const s = Math.max(0, (k - 0.65) / 0.35);
        const land = f + 0.95;
        camY = d < 1 ? camY0 + (land - camY0) * d * d : land + (PLAYER.eyeHeight - 0.95) * (s * s * (3 - 2 * s));
        P.pitch = sp + (-1.1 - sp) * a + (1.0) * Math.min(1, d * 1.4);
        if (d >= 1 && !landed) { landed = true; A.land(); this.entities.noise(grate.x, grate.z, 'land'); this.landKick(0.08); }
      }
      P.eye = ladder ? Math.max(0.42, PLAYER.eyeHeight * Math.min(1, k * 1.3)) : 0.95;
      P.pos.y = camY - P.eye;
    }, () => {
      P.mode = 'walk';
      P.vent = null;
      P.pos.set(grate.x, f, grate.z + (ladder ? 0.05 : 0));
      P.eye = PLAYER.eyeHeight;
      P.vy = 0; P.onGround = true; P.fallFrom = f;
      P.vel.set(0, 0, 0);
      this.tutEvent('ventOut');
    });
  }

  ventCollapse(reason) {
    const P = this.player, W = this.world;
    if (!P.vent) return;
    const v = P.vent;
    W.breakVent(v, P.pos.x, P.pos.z);
    this.audio.ventBreak();
    this.shake = 0.6;
    this.toast(reason === 'time' ? 'You stayed too long — the vent gives way!' : 'The vent buckles and collapses under you!', 'bad', 4000);
    P.mode = 'walk';
    P.vent = null;
    P.pos.y = WALL_Y_BELOW;
    P.eye = 1.0;
    P.vy = -1; P.onGround = false; P.fallFrom = VENT.floorY;
    this._fallCause = 'Vent';
  }

  sleep() {
    this.state = 'sleeping';
    this.ui.fade(1, 1400);
    setTimeout(() => {
      if (this.state !== 'sleeping') return;
      this.cycle.toDawn();
      const P = this.player;
      P.energy = PLAYER.maxEnergy;
      P.sanity = Math.min(100, P.sanity + 25);
      P.heal(40);
      this.ui.fade(0, 1600);
      this.state = 'playing';
      this.toast('You slept through the night.', 'good', 4000);
    }, 2200);
  }

  _deathMessage(cause, opts) {
    if (opts.entity) return pick([`${cause} got you.`, `You died to ${cause}.`, `${cause} caught you.`, `${cause} tore you apart.`, `You were killed by ${cause}.`]);
    switch (cause) {
      case 'Fall': return pick(['You fell too far.', 'The fall killed you.', 'You died to gravity.']);
      case 'Vent': return pick(['The vent gave way under you.', 'You died to a collapsing vent.']);
      case 'Insanity': return pick(['The Behindrooms took your mind.', 'You died to insanity.', 'Your mind gave out.']);
      case 'Starvation': return pick(['You starved.', 'You died to hunger.']);
      case 'The Sleeper': return pick(['The Sleeper got you.', 'Something under the bed got you.', 'You died to The Sleeper.']);
      default: return `You died to ${cause}.`;
    }
  }

  die(cause, opts = {}) {
    const P = this.player;
    if (this.state !== 'playing' && this.state !== 'sleeping') return;
    P.dead = true;
    this.state = 'dying';
    this.deathT = 0;
    this.killer = opts.entity || null;
    this.deathBed = opts.bed || null;
    this.anim = null;
    this.stats.deaths++;
    const keep = Math.floor(P.stars * this.diff.starsKeptOnDeath);
    this.lostStars = P.stars - keep;
    P.stars = keep;
    P.flashlightOn = false;
    this.guide.stop();
    this.combat.clear();
    const scare = opts.entity && Math.random() < this.diff.jumpscareChance;
    if (scare) { this.ui.jumpscare(800, opts.entity.type); this.audio.jumpscare(); } else this.audio.death();
    if (opts.bed) {
      opts.bed.model.trap.visible = true;
      this.audio.growl(opts.bed.pos);
      this._bedStart = { x: P.pos.x, y: P.pos.y + P.eye, z: P.pos.z, yaw: P.yaw, pitch: P.pitch };
      this._bedScared = false;
    }
    document.getElementById('death-msg').textContent = this._deathMessage(cause, opts);
    document.getElementById('death-sub').textContent = this.lostStars > 0 ? `You lost ${this.lostStars} carried ★.` + (keep ? ` Kept ${keep}.` : '') : '';
    this.hands.hidden = true;
  }

  updateDying(dt) {
    this.deathT += dt;
    const P = this.player, t = this.deathT;
    let endAt = 2.1;
    if (this.deathBed) {
      // you lie down… and it was still under there
      const b = this.deathBed, s = this._bedStart;
      endAt = 2.9;
      const a = Math.min(1, t / 0.9), e = a * a * (3 - 2 * a);
      const shake = t > 0.9 ? (Math.random() - 0.5) * 0.06 : 0;
      this.camera.position.set(s.x + (b.pos.x - s.x) * e + shake, s.y + (b.pos.y + 0.32 - s.y) * e + shake, s.z + (b.pos.z - s.z) * e);
      this.camera.rotation.set(s.pitch + (1.35 - s.pitch) * e, s.yaw, 0.4 * e);
      const m = b.model;
      if (t > 0.9) {
        m.group.position.x = b.pos.x + (Math.random() - 0.5) * 0.05;
        m.bulge.scale.y = 0.13 + Math.abs(Math.sin(t * 22)) * 0.12;
        m.limb.rotation.x = -Math.min(2.4, (t - 0.9) * 5);
      }
      if (t > 1.45 && !this._bedScared) { this._bedScared = true; this.ui.jumpscare(650, 'hollow'); this.audio.jumpscare(); }
      if (t > 1.9 && !this._fadeStarted) { this._fadeStarted = true; this.ui.fade(1, 700); }
    } else {
      if (this.killer && !this.killer.killed) {
        const k = this.killer.pos;
        const want = Math.atan2(-(k.x - P.pos.x), -(k.z - P.pos.z));
        let d = want - P.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        P.yaw += d * Math.min(1, dt * 8);
        const tilt = Math.atan2(this.killer.headY - 0.3 - (P.pos.y + P.eye), Math.max(0.5, Math.hypot(k.x - P.pos.x, k.z - P.pos.z)));
        P.pitch += (tilt - P.pitch) * Math.min(1, dt * 6);
        const m = this.killer.model;
        if (m.arms) m.arms.forEach((a) => (a.sh.rotation.x = -1.6));
        if (m.jaw) m.jaw.rotation.x = 0.7;
      } else {
        P.pitch += (-0.6 - P.pitch) * Math.min(1, dt * 2);
      }
      this.camera.position.set(P.pos.x, P.pos.y + P.eye - Math.min(Math.max(0.3, P.eye - 0.5), t * 0.8), P.pos.z);
      this.camera.rotation.set(P.pitch, P.yaw, Math.min(0.5, t * 0.4));
      if (t > 0.35 && !this._fadeStarted) { this._fadeStarted = true; this.ui.fade(1, 1500); }
    }
    this.world.update(dt, P.pos, this.camera, this.time);
    this.world.updateLights(this.time, this.cycle.factors(this.diff.ambientMult), this.entities.positions, P.pos);
    if (t > endAt) {
      this._fadeStarted = false;
      if (this.deathBed) { this.deathBed.model.group.position.x = this.deathBed.pos.x; this.deathBed.model.limb.rotation.set(0, 0, 0); }
      this.deathBed = null;
      this.state = 'dead';
      if (document.pointerLockElement) document.exitPointerLock();
      this.ui.showHud(false);
      this.ui.clearEffects();
      this.ui.show('scr-death');
    }
  }

  respawn() {
    const P = this.player;
    this.requestLock();
    P.reset(this.world.spawn, true);
    this.killer = null;
    for (const e of this.entities.list) { e.chasing = false; e.mode = 'wander'; e.heard = null; e.atk = null; }
    this.hands.hidden = false;
    this.ui.hideScreens();
    this.ui.showHud(true);
    this.ui.fade(0, 1000);
    this.state = 'playing';
    this.toast('You wake up back at camp. Anything in the camp chest is still there.', '', 3500);
    if (!this.locked && !this.noLock) { this.state = 'resume'; this.ui.show('scr-resume'); }
  }

  win() {
    this.state = 'won';
    this.audio.win();
    this.ui.fade(1, 1800);
    const t = Math.floor(this.playTime);
    document.getElementById('win-stats').textContent =
      `${this.diff.name} · Day ${this.cycle.day} · ${Math.floor(t / 60)}m ${t % 60}s\n${this.stats.escapes} chases escaped · ${this.stats.kills} monsters killed · ${this.stats.squashed} sleepers squashed · ${this.stats.deaths} deaths`;
    try { localStorage.setItem(BEST_KEY, JSON.stringify({ day: this.cycle.day, diff: this.diff.id })); } catch (e) { /* ignore */ }
    setTimeout(() => {
      if (document.pointerLockElement) document.exitPointerLock();
      this.ui.showHud(false);
      this.ui.clearEffects();
      this.ui.show('scr-win');
      this.ui.fade(0, 600);
    }, 2000);
  }

  // ── per-frame gameplay ─────────────────────────────────────
  update(dt) {
    const P = this.player, W = this.world, C = this.cycle, E = this.entities, A = this.audio;
    this.playTime += dt;
    this.gameTime += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }
    C.update(dt);
    const f = C.factors(this.diff.ambientMult);
    const ctx = this._ctx(f);

    this._updateAnim(dt);
    P.update(dt, this.input, ctx);
    if (this.state !== 'playing') return;
    P.inCamp = W.isCamp(P.pos.x, P.pos.z);
    P.inSafe = W.isSafe(P.pos.x, P.pos.z);

    if (P.inCamp && P.stars > 0) {
      this.banked += P.stars;
      this.toast(`Banked ${P.stars} ★ · ${this.banked}/${STARS_TO_WIN}`, 'star', 3500);
      P.stars = 0;
      A.bank();
      if (W.portal) W.portal.setCount(this.banked, STARS_TO_WIN);
      if (this.banked >= STARS_TO_WIN && !this.portalOpen) {
        this.portalOpen = true;
        this.ui.titleCard('THE PORTAL IS OPEN', 'step through to escape', 4500);
      }
    }

    E.update(dt, ctx);
    if (this.state !== 'playing') return;
    this.throwables.update(dt);
    this.combat.update(dt);
    W.update(dt, P.pos, this.camera, this.time);
    W.updateLights(this.time, f, E.positions, P.pos);
    if (W.portal) {
      W.portal.uniforms.uActive.value += ((this.banked >= STARS_TO_WIN ? 1 : 0) - W.portal.uniforms.uActive.value) * Math.min(1, dt * 2);
      W.portal.uniforms.uCharge.value = Math.min(1, this.banked / STARS_TO_WIN);
      if (this.banked >= STARS_TO_WIN && Math.hypot(P.pos.x - 12, P.pos.z - 4.2) < 0.75) this.win();
    }
    if (this.state !== 'playing') return;

    this._applyCamera(dt);
    this._updateFlashlight(dt);
    this._applyEnv(f);
    this._updateBeds(dt);
    this._updatePrompt();

    // audio
    A.setNightMix(f.nightMix);
    A.setHum(f.day * (P.inCamp ? 0.6 : P.inVent ? 0.25 : 1));
    const nd = E.nearestDist;
    A.tension = C.isNight ? Math.max(0, 1 - nd / 16) : 0;
    A.setListener(this.camera.position, this.camera.getWorldDirection(tmpV), UP);
    if (W.flickerNear > 0.3) A.buzz(W.flickerNear);
    A.setWater(W.styleAt(P.pos.x, P.pos.z) === 'pool' ? 1 : P.wading ? 0.5 : 0);
    // music box in the Christmas room
    this._mbT = (this._mbT || 0) - dt;
    if (this._mbT <= 0) {
      this._mbT = 1;
      for (const c of W.chunks.values()) {
        const mb = c.musicBox;
        if (mb && Math.hypot(mb.x - P.pos.x, mb.z - P.pos.z) < 16) { this._mbT = A.musicBox(tmpV.set(mb.x, mb.y, mb.z)) || 8; break; }
      }
    }

    // screen effects
    const redR = ENTITY.redVignetteRadius;
    this.ui.effects({ sanity: P.sanity, red: nd < redR ? Math.pow(1 - nd / redR, 1.3) * (C.isNight ? 1 : 0.6) : 0, crash: !!P.crash, brightness: this.settings.brightness, dead: P.dead });

    // hands
    this.hands.update(dt, {
      held: P.inv.held(), moving: P.moving, sprint: P.sprinting, bobPhase: P.bobPhase,
      mouseDX: this.input.dx, mouseDY: this.input.dy, flashlightOn: P.flashlightOn && P.flashCut <= 0, flashBright: P.flashBright,
      env: W.envLight * this.settings.brightness + (P.flashlightOn ? 0.18 : 0), time: this.time, lowered: P.crouching || P.inVent,
    });
    this.ui.updateCooldown(this.combat.cooldown, this.combat.cdMax, true);

    this._hudT = (this._hudT || 0) - dt;
    if (this._hudT <= 0) {
      this._hudT = 0.08;
      this.ui.updateHud(this);
      const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
      const heading = Math.atan2(fx, -fz);
      const dx = W.campCenter.x - P.pos.x, dz = W.campCenter.z - P.pos.z;
      this.ui.updateCompass(heading, Math.atan2(dx, -dz), Math.hypot(dx, dz), P.inCamp, this.guide.bearing());
    }

    if (this.marker.visible) {
      const b = this.marker.userData.base;
      this.marker.position.set(b.x, b.y + 0.35 + Math.sin(this.time * 3) * 0.08, b.z);
      this.marker.rotation.y += dt * 2;
    }
    if (this.tut) this.tut.update(dt, this.input);
    this.guide.update(dt);
    if (DEBUG.testTools) {
      const I = this.input;
      if (I.pressed('KeyN')) this.makeNight();
      if (I.pressed('KeyT')) this.makeDay();
      if (I.pressed('KeyM')) this.spawnTestMonster(document.getElementById('tt-entity').value || null);
      if (I.pressed('KeyG')) this.toggleGuide();
      if (I.pressed('KeyB')) this.spawnTestBed();
      if (I.pressed('KeyJ')) this.testJumpscare(document.getElementById('tt-scare').value);
      if (I.pressed('KeyK')) this.giveTestKit();
      if (I.pressed('KeyH')) this.testHeal();
    }
  }

  _applyCamera(dt = 0.016) {
    const P = this.player, S = this.settings;
    const bob = S.headBob ? P.bobAmt : 0;
    const ph = P.bobPhase;
    const crawl = P.inVent ? 1.6 : 1;
    const by = -(0.5 - 0.5 * Math.cos(2 * ph)) * 0.038 * bob * (P.inVent ? 0.5 : 1) - P.landKick;
    const bx = Math.sin(ph) * 0.024 * bob * crawl;
    const roll = Math.sin(ph) * 0.013 * bob * crawl;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * this.shake;
    const sx = (Math.random() - 0.5) * sh * 0.3, sy = (Math.random() - 0.5) * sh * 0.3;
    this.camera.position.set(P.pos.x + Math.cos(P.yaw) * bx + sx, P.pos.y + P.eye + by + sy, P.pos.z - Math.sin(P.yaw) * bx);
    this.camera.rotation.set(P.pitch + sy * 0.4, P.yaw, roll + sx * 0.5);
  }

  _updateFlashlight() {
    const P = this.player;
    const on = P.flashlightOn && !P.dead && P.flashCut <= 0;
    let fl = 1;
    const nd = this.entities.nearestDist;
    if (nd < 12) { const a = 1 - nd / 12; if (Math.random() < a * 0.55) fl = Math.random() * 0.45; }
    const bp = P.battery / FLASHLIGHT.batterySeconds;
    if (bp < 0.1) { fl *= 0.55 + bp * 4; if (Math.random() < 0.04) fl *= 0.2; }
    P.flashBright = fl;
    this.flash.intensity = on ? 18 * fl : 0;
    this.flashFill.intensity = on ? 0.9 * fl : 0;
  }

  _applyEnv(f) {
    const b = this.settings.brightness;
    const amb = f.ambient;
    // output is sRGB, so tiny linear values still read as visible: keep night ambient very low
    this.hemi.intensity = b * (0.003 + 0.95 * Math.pow(amb, 1.8));
    // baked room light (day lights + the few night lights)
    SURF.uBakeDay.value = f.day * (this.world && this.world.bakeFlicker !== undefined ? Math.min(1.2, this.world.bakeFlicker) : 1);
    SURF.uBakeNight.value = f.night * NIGHT_LIGHTS.level * ((this.diff && this.diff.nightLight) ?? 1);
    SURF.uBakeScale.value = 0.5 * b;
    const nightK = Math.max(0, Math.min(1, 1 - amb));
    this.scene.fog.color.copy(DAY_FOG).lerp(NIGHT_FOG, nightK);
    this.scene.background.copy(this.scene.fog.color);
    this.scene.fog.near = lerp(7, 1.5, nightK);
    this.scene.fog.far = lerp(this.q.fogDay, this.q.fogNight, nightK);
  }

  _updateBeds(dt) {
    const P = this.player;
    for (const bed of this.world.beds) {
      const d = Math.hypot(P.pos.x - bed.pos.x, P.pos.z - bed.pos.z);
      if (bed.trapped) {
        if (d < 15 && !bed.breather) {
          bed.breather = this.audio.createBreather(bed.pos);
          if (bed.breather) { bed.breather.rate = 0.8; bed.breather.intensity = bed.awake > 0 ? 1.4 : 0.75; this.bedBreathers.push(bed.breather); }
        }
        const s = bed.model.bulge.scale;
        s.y = Math.max(0.02, (0.13 * Math.max(0.15, 1 - bed.hits / 4)) + Math.sin(this.time * 2.1) * 0.012);
        if (bed.awake > 0) {
          bed.awake -= dt;
          bed.model.group.position.x = bed.pos.x + (Math.random() - 0.5) * 0.04;
          if (bed.breather) { bed.breather.rate = 2; bed.breather.intensity = 1.5; }
          if (bed.awake <= 0) { bed.model.group.position.x = bed.pos.x; this.die('The Sleeper', { bed }); return; }
        }
      } else if (bed.awake > 0) bed.awake = 0;
      if ((!bed.trapped || d > 17) && bed.breather) {
        this.audio.releaseBreather(bed.breather);
        bed.breather = null;
      }
    }
  }

  _updatePrompt() {
    const P = this.player;
    if (P.mode === 'anim') { this.focus = null; this.ui.prompt(''); return; }
    const dir = this.camera.getWorldDirection(tmpV2);
    const it = this.world.findInteractable(this.camera.position, dir, 2.4, P.inVent);
    this.focus = it;
    if (!it) { this.ui.prompt(''); return; }
    const E = '<kbd>E</kbd>';
    switch (it.kind) {
      case 'drawer': this.ui.prompt(it.looted ? 'Searched' : `${E} Search ${it.rusty ? 'rusty ' : ''}drawer`, it.looted); break;
      case 'pickup': this.ui.prompt(`${E} Pick up ${ITEMS[it.item].name}`); break;
      case 'lootbox': this.ui.prompt(`${E} Search the box`); break;
      case 'gift': this.ui.prompt(`${E} Open the present`); break;
      case 'craft': this.ui.prompt(`${E} Use the crafting table`); break;
      case 'chest': this.ui.prompt(`${E} Open the camp chest`); break;
      case 'ventLadder': this.ui.prompt(it.vent.st.broken ? 'Collapsed vent' : `${E} Climb into the vent`, it.vent.st.broken); break;
      case 'ventExit': this.ui.prompt(it.grate.ladder ? `${E} Climb down the ladder` : `${E} Kick out the grate and drop down`); break;
      case 'sdoor':
        if (it.unlocked) this.ui.prompt('Saferoom');
        else if (P.inv.counts.key > 0) this.ui.prompt(`${E} Unlock saferoom (uses 1 key)`);
        else this.ui.prompt('Locked saferoom · needs a key', true);
        break;
      case 'bed':
        if (it.awake > 0) this.ui.prompt('JUMP! JUMP!', true);
        else this.ui.prompt(this.cycle.isNight ? `${E} Sleep until morning` : 'Bed · you can only sleep at night', !this.cycle.isNight);
        break;
      case 'portal':
        this.ui.prompt(this.banked >= STARS_TO_WIN ? `${E} ESCAPE THE BEHINDROOMS` : `Escape portal · ${this.banked}/${STARS_TO_WIN} ★ banked`, this.banked < STARS_TO_WIN && !this.tutorial);
        if (this.tutorial) this.ui.prompt(`${E} Check the portal`);
        break;
    }
  }

  // ── main loop ──────────────────────────────────────────────
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.fpsT += dt; this.fpsN++;
    if (this.fpsT > 0.5) {
      if (this.settings.showFps) {
        const el = document.getElementById('fps');
        el.classList.remove('hidden');
        el.textContent = `${Math.round(this.fpsN / this.fpsT)} FPS · ${this.renderer.info.render.calls} draws`;
      }
      this.fpsT = 0; this.fpsN = 0;
    }
    switch (this.state) {
      case 'menu':
        if (this.world) this.updateMenu(dt);
        if ((this._warmT = (this._warmT || 0) + dt) > 0.12) { this._warmT = 0; this._warmStep(); }
        break;
      case 'playing': this.update(dt); break;
      case 'dying': this.updateDying(dt); break;
      case 'sleeping':
        this.world.update(dt, this.player.pos, this.camera, this.time);
        break;
      default: break;
    }
    this.touch.setVisible(this.touchMode && this.state === 'playing');
    if (this.touch.visible) this.touch.setReady(!!this.focus);
    this.audio.update(dt);
    this.render();
    this.input.endFrame();
  }

  render() {
    const r = this.renderer;
    r.info.reset();
    r.clear();
    if (!this.world) return;
    r.render(this.scene, this.camera);
    const showHands = ['playing', 'paused', 'resume', 'sleeping', 'craft', 'chest'].includes(this.state) && !this.hands.hidden;
    if (showHands) {
      r.clearDepth();
      r.render(this.hands.scene, this.hands.camera);
    }
  }
}

const WALL_Y_BELOW = 1.9;
new Game();
