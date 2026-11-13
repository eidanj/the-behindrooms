// ─────────────────────────────────────────────────────────────
//  THE BEHINDROOMS — main game loop & state machine
// ─────────────────────────────────────────────────────────────

import * as THREE from '../lib/three.module.min.js';
import { DIFFICULTIES, QUALITY, DEFAULT_SETTINGS, CYCLE, STARS_TO_WIN, ENTITY, FLASHLIGHT, PLAYER, DEBUG } from './config.js';
import { buildMaterials, setAnisotropy } from './textures.js';
import { World } from './world.js';
import { Cycle } from './cycle.js';
import { AudioEngine } from './audio.js';
import { EntityManager } from './entities.js';
import { Throwables, ITEMS, FOOD_TABLE, DRINK_TABLE, WEAPONS, WEAPON_TABLE } from './items.js';
import { Combat } from './combat.js';
import { Player } from './player.js';
import { Hands } from './hands.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { Tutorial } from './tutorial.js';
import { Guide } from './guide.js';
import { weighted, lerp } from './rng.js';

const SETTINGS_KEY = 'behindrooms.settings.v1';
const BEST_KEY = 'behindrooms.best.v1';
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const DAY_FOG = new THREE.Color(0xc9bd92);
const NIGHT_FOG = new THREE.Color(0x020202);

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...s };
  } catch (e) { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ } }

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.settings = loadSettings();
    if (!QUALITY[this.settings.quality]) this.settings.quality = 'medium';
    this.q = QUALITY[this.settings.quality];

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.settings.quality !== 'low', powerPreference: 'high-performance' });
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
    this.hemi = new THREE.HemisphereLight(0xfff0cc, 0xe2dac4, 1);
    this.scene.add(this.hemi);

    // flashlight: short focused beam from the left hand + soft close fill
    this.flash = new THREE.SpotLight(0xfff3d8, 0, 13, 0.34, 0.55, 1.5);
    this.flash.position.set(-0.22, -0.2, 0.05);
    this.flash.target.position.set(-0.05, -0.12, -6);
    this.flash.shadow.mapSize.set(512, 512);
    this.flash.shadow.camera.near = 0.3;
    this.flash.shadow.camera.far = 14;
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
    this._applyQuality(false);

    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.36, 4), new THREE.MeshBasicMaterial({ color: 0xffd24a, fog: false }));
    this.marker.rotation.x = Math.PI;
    this.marker.visible = false;
    this.scene.add(this.marker);
    this.guide = new Guide(this);
    this.combat = new Combat(this);

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

  _applyQuality(recompile = true) {
    const q = (this.q = QUALITY[this.settings.quality]);
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
    saveSettings(s);
    if (k === 'fov') { this.camera.fov = s.fov; this.camera.updateProjectionMatrix(); }
    if (k === 'masterVolume' || k === 'musicVolume') this.audio.setVolumes(s.masterVolume, s.musicVolume);
    if (k === 'quality') this._applyQuality(true);
    if (k === 'showFps') document.getElementById('fps').classList.toggle('hidden', !s.showFps);
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
      this.audio.init();
      this.audio.setMenuMode(true);
      this.enterMenu();
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
    document.getElementById('test-tools').classList.toggle('hidden', !DEBUG.testTools);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.state === 'playing' && (this.noLock || !this.locked)) this.pause();
        else if (this.ui.current === 'scr-settings' || this.ui.current === 'scr-howto' || this.ui.current === 'scr-diff') this._action('back');
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
      case 'back':
        if (this.ui.current === 'scr-diff') this.ui.show('scr-menu');
        else this.ui.show(this.returnTo && this.returnTo !== this.ui.current ? this.returnTo : 'scr-menu');
        break;
      case 'start': this.startGame(this.diffId, false); break;
      case 'resume': this.requestLock(); if (this.noLock) this.resume(); break;
      case 'quit': this.quitToMenu(); break;
      case 'respawn': this.respawn(); break;
      case 'night': case 'day': case 'spawn': case 'guide':
        ({ night: () => this.makeNight(), day: () => this.makeDay(), spawn: () => this.spawnTestMonster(), guide: () => this.toggleGuide() })[a]();
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

  _exitToMenuWorld() {
    if (this.world && this.world.menu) return;
    this._disposeRun();
    this.world = new World(this, { seed: 40213, difficulty: DIFFICULTIES.normal, menu: true, loadRadius: 2, lightRange: this.q.lightRange });
    this.world.setPool(this.pool);
    // pick a nice spot: the first non-camp room near the origin
    this.world.loadAllAround(new THREE.Vector3(36, 0, 36));
    const room = [...this.world.rooms()].filter((r) => !r.camp).sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0))[0];
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

  // ── test tools (pause menu + hotkeys N / T / M / G) ─────────
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
  spawnTestMonster() {
    if (!this._testOk()) return;
    const P = this.player, W = this.world;
    const cx = Math.floor(P.pos.x / 3), cz = Math.floor(P.pos.z / 3);
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    let best = null, bs = -Infinity;
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) {
      const x = (cx + dx) * 3 + 1.5, z = (cz + dz) * 3 + 1.5;
      const d = Math.hypot(x - P.pos.x, z - P.pos.z);
      if (d < 6 || d > 16 || W.isForbidden(x, z)) continue;
      const los = W.lineOfSight(P.pos.x, P.pos.y + 1.6, P.pos.z, x, 1.6, z);
      const dot = ((x - P.pos.x) * fx + (z - P.pos.z) * fz) / d;
      const sc = (los ? 10 : 0) + dot * 3 - Math.abs(d - 10) * 0.25 + Math.random() * 0.5;
      if (sc > bs) { bs = sc; best = { x, z, d, los }; }
    }
    if (!best) { this.toast('No room to spawn a monster here — step out of camp first.', 'bad'); return; }
    const e = this.entities.spawn(best.x, best.z, !this.cycle.isNight);
    e.noticed = true;
    e.yaw = Math.atan2(P.pos.x - best.x, P.pos.z - best.z);
    this.toast(`TEST · ${e.name} spawned ${Math.round(best.d)} m away${best.los ? '' : ' (out of sight)'}`, 'bad', 3000);
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

  _ctx() {
    const P = this.player;
    return {
      player: P, world: this.world, audio: this.audio, diff: this.diff, tutorial: this.tutorial,
      night: this.cycle.isNight, huntable: !P.dead && this.state === 'playing',
      time: this.gameTime, nearestDist: this.entities ? this.entities.nearestDist : Infinity,
      onChaseStart: (e) => this.onChaseStart(e),
      onEscape: (e) => { if (!P.dead) { this.stats.escapes++; this.awardStar(`You escaped ${e.name}`); } },
      onCatch: (e) => this.die(e.name, { entity: e }),
    };
  }

  onChaseStart(e) {
    this.audio.shriek(e.pos);
    if (!this._chaseToastT || this.gameTime - this._chaseToastT > 12) {
      this._chaseToastT = this.gameTime;
      this.toast(`${e.name} sees you — RUN`, 'bad', 2500);
    }
    if (Math.random() < this.diff.jumpscareChance) { this.ui.jumpscare(450); this.audio.jumpscare(); }
  }

  onEntityKilled(e) {
    this.stats.kills++;
    this.awardStar(`You killed ${e.name}`);
  }

  landKick(v) { if (this.player) this.player.landKick = Math.max(this.player.landKick, v); }

  onEntityTripped(e, type) {
    this.toast(type === 'rock' ? `You tripped ${e.name}!` : `${e.name} slipped on a banana peel!`, 'good');
  }

  onPlayerLand(speed, ground) {
    const P = this.player;
    this.audio.land();
    this.entities.noise(P.pos.x, P.pos.z, 'land');
    const bed = ground > 0.45 ? this.world.bedUnder(P.pos.x, P.pos.z) : null;
    if (!bed) return;
    this.audio.bounce();
    P.vy = speed * 0.42;
    P.onGround = false;
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
      this.world.state.squashed.add(bed.id);
      bed.model.bulge.scale.set(0.66, 0.025, 0.36);
      bed.model.limb.rotation.x = 0.6;
      if (bed.breather) { this.audio.releaseBreather(bed.breather); bed.breather = null; }
      this.stats.squashed++;
      this.awardStar('You squashed The Sleeper');
    }
  }

  interact() {
    const it = this.focus;
    const P = this.player;
    if (!it || P.dead) return;
    const A = this.audio;
    switch (it.kind) {
      case 'drawer':
        if (it.looted) { this.toast('Already searched.'); return; }
        it.open();
        A.drawer(it.pos);
        this.entities.noise(it.pos.x, it.pos.z, 'drawer');
        this.giveLoot(it.loot);
        this.tutEvent('drawer');
        break;
      case 'pickup':
        P.inv.add(it.item);
        this.world.removePickup(it);
        A.pickup();
        this.toast(`Picked up: <b>${ITEMS[it.item].name}</b>`, 'good', 2200);
        break;
      case 'sdoor':
        if (it.unlocked) { this.toast('Saferoom — monsters can\'t get in here.'); return; }
        if (P.inv.take('key')) {
          it.unlock();
          A.doorUnlock(it.pos);
          this.toast('Saferoom unlocked. Monsters can\'t enter.', 'good');
        } else { A.denied(); this.toast('Locked. You need a Saferoom Key.', 'bad'); }
        break;
      case 'bed':
        if (!this.cycle.isNight) { this.toast('You\'re not tired. You can only sleep at night.'); return; }
        if (bed_awake(it)) return;
        if (it.trapped) { this.die('The Sleeper', { bed: it }); return; }
        this.sleep();
        break;
      case 'portal':
        this.tutEvent('portal');
        if (this.banked >= STARS_TO_WIN) this.win();
        else this.toast(`The portal needs ${STARS_TO_WIN} banked ★ · ${this.banked}/${STARS_TO_WIN}`, '', 3000);
        break;
    }
    function bed_awake(b) { return b.awake > 0; }
  }

  giveLoot(type) {
    const A = this.audio;
    if (!type) { this.toast('Empty.', '', 1800); return; }
    let item = type;
    if (type === 'food') item = this.tutorial ? 'bread' : weighted(Math.random, FOOD_TABLE);
    if (type === 'drink') item = weighted(Math.random, DRINK_TABLE);
    if (type === 'weapon') {
      item = weighted(Math.random, WEAPON_TABLE);
      this.player.inv.addWeapon(item);
      A.pickup();
      this.toast(`Found a weapon: <b>${WEAPONS[item].name}</b> · press <kbd>7</kbd> or <kbd>F</kbd>`, 'good', 4000);
      return;
    }
    this.player.inv.add(item);
    A.pickup();
    this.toast(`Found: <b>${ITEMS[item].name}</b>`, 'good', 3000);
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
      this.ui.fade(0, 1600);
      this.state = 'playing';
      this.toast('You slept through the night.', 'good', 4000);
    }, 2200);
  }

  die(cause, opts = {}) {
    const P = this.player;
    if (P.dead || this.state !== 'playing') return;
    P.dead = true;
    this.state = 'dying';
    this.deathT = 0;
    this.killer = opts.entity || null;
    this.stats.deaths++;
    const keep = Math.floor(P.stars * this.diff.starsKeptOnDeath);
    this.lostStars = P.stars - keep;
    P.stars = keep;
    P.flashlightOn = false;
    this.guide.stop();
    this.combat.clear();
    const scare = (opts.entity || opts.bed) && Math.random() < this.diff.jumpscareChance;
    if (scare) { this.ui.jumpscare(800); this.audio.jumpscare(); } else this.audio.death();
    if (opts.bed) { opts.bed.model.trap.visible = true; this.audio.growl(opts.bed.pos); }
    const msg = `You died to ${cause}. Better luck next time.`;
    document.getElementById('death-msg').textContent = msg;
    document.getElementById('death-sub').textContent = this.lostStars > 0 ? `You lost ${this.lostStars} carried ★.` + (keep ? ` Kept ${keep}.` : '') : '';
    this.hands.hidden = true;
  }

  updateDying(dt) {
    this.deathT += dt;
    const P = this.player;
    if (this.killer) {
      const k = this.killer.pos;
      const want = Math.atan2(-(k.x - P.pos.x), -(k.z - P.pos.z));
      let d = want - P.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      P.yaw += d * Math.min(1, dt * 8);
      P.pitch += (0.32 - P.pitch) * Math.min(1, dt * 6);
      this.killer.model.arms.forEach((a) => (a.sh.rotation.x = -1.6));
    } else {
      P.pitch += (-0.6 - P.pitch) * Math.min(1, dt * 2);
    }
    this.camera.position.set(P.pos.x, P.pos.y + P.eye - Math.min(1.1, this.deathT * 0.8), P.pos.z);
    this.camera.rotation.set(P.pitch, P.yaw, Math.min(0.5, this.deathT * 0.4));
    if (this.deathT > 0.35 && !this._fadeStarted) { this._fadeStarted = true; this.ui.fade(1, 1500); }
    this.world.update(dt, P.pos, this.camera, this.time);
    this.world.updateLights(this.time, this.cycle.factors(this.diff.ambientMult), this.entities.positions, P.pos);
    if (this.deathT > 2.1) {
      this._fadeStarted = false;
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
    for (const e of this.entities.list) { e.chasing = false; e.mode = 'wander'; e.heard = null; }
    this.hands.hidden = false;
    this.ui.hideScreens();
    this.ui.showHud(true);
    this.ui.fade(0, 1000);
    this.state = 'playing';
    this.toast('You wake up back at camp.', '', 3000);
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
    const ctx = this._ctx();

    P.update(dt, this.input, ctx);
    if (this.state !== 'playing') return; // died this frame (insanity) etc.
    P.inCamp = W.isCamp(P.pos.x, P.pos.z);
    P.inSafe = W.isSafe(P.pos.x, P.pos.z);

    // bank carried stars when inside camp
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
    A.setHum(f.day * (P.inCamp ? 0.6 : 1));
    const nd = E.nearestDist;
    A.tension = C.isNight ? Math.max(0, 1 - nd / 16) : 0;
    A.setListener(this.camera.position, this.camera.getWorldDirection(tmpV), UP);
    if (W.flickerNear > 0.3) A.buzz(W.flickerNear);

    // screen effects
    const redR = ENTITY.redVignetteRadius;
    this.ui.effects({ sanity: P.sanity, red: nd < redR ? Math.pow(1 - nd / redR, 1.3) * (C.isNight ? 1 : 0.6) : 0, crash: !!P.crash, brightness: this.settings.brightness, dead: P.dead });

    // hands
    this.hands.update(dt, {
      held: P.inv.held(), moving: P.moving, sprint: P.sprinting, bobPhase: P.bobPhase,
      mouseDX: this.input.dx, mouseDY: this.input.dy, flashlightOn: P.flashlightOn, flashBright: P.flashBright,
      env: W.envLight * this.settings.brightness + (P.flashlightOn ? 0.18 : 0), time: this.time,
    });

    // HUD (throttled)
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
      if (this.input.pressed('KeyN')) this.makeNight();
      if (this.input.pressed('KeyT')) this.makeDay();
      if (this.input.pressed('KeyM')) this.spawnTestMonster();
      if (this.input.pressed('KeyG')) this.toggleGuide();
    }
  }

  _applyCamera() {
    const P = this.player, S = this.settings;
    const bob = S.headBob ? P.bobAmt : 0;
    const ph = P.bobPhase;
    const by = -(0.5 - 0.5 * Math.cos(2 * ph)) * 0.038 * bob - P.landKick;
    const bx = Math.sin(ph) * 0.024 * bob;
    const roll = Math.sin(ph) * 0.013 * bob;
    this.camera.position.set(P.pos.x + Math.cos(P.yaw) * bx, P.pos.y + P.eye + by, P.pos.z - Math.sin(P.yaw) * bx);
    this.camera.rotation.set(P.pitch, P.yaw, roll);
  }

  _updateFlashlight() {
    const P = this.player;
    const on = P.flashlightOn && !P.dead;
    let fl = 1;
    const nd = this.entities.nearestDist;
    if (nd < 12) { const a = 1 - nd / 12; if (Math.random() < a * 0.55) fl = Math.random() * 0.45; }
    const bp = P.battery / FLASHLIGHT.batterySeconds;
    if (bp < 0.1) { fl *= 0.55 + bp * 4; if (Math.random() < 0.04) fl *= 0.2; }
    P.flashBright = fl;
    this.flash.intensity = on ? 15 * fl : 0;
    this.flashFill.intensity = on ? 0.9 * fl : 0;
  }

  _applyEnv(f) {
    const b = this.settings.brightness;
    const amb = f.ambient;
    // output is sRGB, so tiny linear values still read as visible: keep night ambient very low
    this.hemi.intensity = b * (0.004 + 1.25 * Math.pow(amb, 1.8));
    const nightK = Math.max(0, Math.min(1, 1 - amb));
    this.scene.fog.color.copy(DAY_FOG).lerp(NIGHT_FOG, nightK);
    this.scene.background.copy(this.scene.fog.color);
    const fogDay = this.q.fogDay;
    this.scene.fog.near = lerp(7, 1.5, nightK);
    this.scene.fog.far = lerp(fogDay, this.q.fogNight, nightK);
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
      }
      if ((!bed.trapped || d > 17) && bed.breather) {
        this.audio.releaseBreather(bed.breather);
        bed.breather = null;
      }
    }
  }

  _updatePrompt() {
    const P = this.player;
    const dir = this.camera.getWorldDirection(tmpV2);
    const it = this.world.findInteractable(this.camera.position, dir, 2.4);
    this.focus = it;
    if (!it) { this.ui.prompt(''); return; }
    const E = '<kbd>E</kbd>';
    switch (it.kind) {
      case 'drawer': this.ui.prompt(it.looted ? 'Searched' : `${E} Search drawer`, it.looted); break;
      case 'pickup': this.ui.prompt(`${E} Pick up ${ITEMS[it.item].name}`); break;
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
      if (this.settings.showFps) document.getElementById('fps').textContent = `${Math.round(this.fpsN / this.fpsT)} FPS · ${this.renderer.info.render.calls} draws`;
      this.fpsT = 0; this.fpsN = 0;
    }
    switch (this.state) {
      case 'menu': if (this.world) this.updateMenu(dt); break;
      case 'playing': this.update(dt); break;
      case 'dying': this.updateDying(dt); break;
      case 'sleeping':
        this.world.update(dt, this.player.pos, this.camera, this.time);
        break;
      default: break;
    }
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
    const showHands = (this.state === 'playing' || this.state === 'paused' || this.state === 'resume' || this.state === 'sleeping') && !this.hands.hidden;
    if (showHands) {
      r.clearDepth();
      r.render(this.hands.scene, this.hands.camera);
    }
  }
}

new Game();
