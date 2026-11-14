// DOM-side UI: screens, HUD, hotbar, compass, toasts and screen effects.

import { ITEMS, SLOTS, WEAPONS, SUBTYPES, MATERIALS, STORABLE } from './items.js';
import { STARS_TO_WIN, PLAYER, FLASHLIGHT, VENT, RECIPES } from './config.js';
import { ICON, fillIcons } from './icons.js';

const $ = (s) => document.querySelector(s);
const C = '#efe4bf', Y = '#e8d27a';
const svg = (inner) => `<svg viewBox="0 0 40 40"><g fill="none" stroke="${C}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">${inner}</g></svg>`;

export const ICONS = {
  flashlight: svg(`<rect x="5" y="16" width="17" height="8" rx="1.5"/><path d="M22 14 L29 11 L29 29 L22 26 Z"/><path d="M32 14 l4 -3 M33 20 h5 M32 26 l4 3" stroke="${Y}"/>`),
  bread: svg(`<path d="M6 25 C4 14 13 9 20 9 C27 9 36 14 34 25 L34 31 L6 31 Z"/><path d="M13 15 l3 4 M20 13 l2 5 M27 15 l1 4" stroke="${Y}"/>`),
  granola: svg(`<rect x="5" y="15" width="30" height="11" rx="2"/><path d="M11 15 v11 M29 15 v11" stroke="${Y}"/>`),
  cookie: svg(`<circle cx="20" cy="20" r="13"/><circle cx="15" cy="16" r="1.6" fill="${Y}" stroke="none"/><circle cx="24" cy="14" r="1.6" fill="${Y}" stroke="none"/><circle cx="22" cy="24" r="1.6" fill="${Y}" stroke="none"/><circle cx="14" cy="24" r="1.4" fill="${Y}" stroke="none"/>`),
  coffee: svg(`<path d="M11 11 L29 11 L26 34 L14 34 Z"/><path d="M9 11 h22 M12.5 19 h15 M13.3 26 h13.4" /><path d="M17 7 q2 -2 0 -4 M23 7 q2 -2 0 -4" stroke="${Y}"/>`),
  energy: svg(`<rect x="12" y="7" width="16" height="27" rx="3"/><path d="M21 12 l-4 8 h6 l-4 8" stroke="${Y}"/>`),
  almond: svg(`<path d="M16 6 h8 v4 l3 4 v19 a2 2 0 0 1 -2 2 h-10 a2 2 0 0 1 -2 -2 v-19 l3 -4 Z"/><path d="M13 19 h14 M13 27 h14" stroke="${Y}"/>`),
  rock: svg(`<path d="M7 28 L10 17 L18 10 L29 13 L34 23 L28 31 L14 33 Z"/><path d="M18 10 L20 20 L34 23 M20 20 L14 33" stroke-width="1.4"/>`),
  banana: svg(`<path d="M8 11 C10 27 23 33 34 27 C25 26 16 21 13 9 Z"/><path d="M8 11 l-1 -3" stroke="${Y}"/>`),
  key: svg(`<circle cx="12" cy="20" r="6.5"/><path d="M18.5 20 H35 M29 20 v5 M33 20 v4" stroke="${Y}"/>`),
  fists: svg(`<path d="M8 18a4 4 0 0 1 4-4h14a4 4 0 0 1 4 4v6a8 8 0 0 1-8 8h-6a8 8 0 0 1-8-8z"/><path d="M15 14v6M20 14v6M25 14v6M8 22h6a2.5 2.5 0 0 0 0-5"/>`),
  pipe: svg(`<path d="M9 33 L31 7" stroke-width="4"/><path d="M27 9 l5 5" stroke="${Y}" stroke-width="3"/>`),
  crowbar: svg(`<path d="M8 34 L28 10 q4 -5 0 -6 l-3 1" stroke="#d05050" stroke-width="3"/>`),
  bat: svg(`<path d="M8 34 L12 30" stroke-width="3"/><path d="M12 30 L31 9 a3 3 0 0 0 -3 -3 L10 28 Z" stroke="${Y}"/>`),
  axe: svg(`<path d="M9 34 L29 8" stroke="#d05050" stroke-width="3"/><path d="M22 6 q10 2 12 12 l-8 -2 z" stroke="${Y}"/>`),
  club: svg(`<path d="M9 34 L27 9" stroke-width="3.5"/><path d="M24 8 l6 4" stroke="${Y}" stroke-width="3"/>`),
  spikedbat: svg(`<path d="M8 34 L12 30" stroke-width="3"/><path d="M12 30 L31 9 a3 3 0 0 0 -3 -3 L10 28 Z"/><path d="M24 8 l-2 -3 M29 13 l3 2 M27 6 l1 -3 M31 10 l3 0" stroke="${Y}"/>`),
  fruit: svg(`<path d="M9 9 C8 24 18 33 33 30 C33 28 31 27 29 27 C19 27 13 20 12 9 Z"/><path d="M9 9 l1 -4" stroke="${Y}"/>`),
  noisemaker: svg(`<circle cx="20" cy="22" r="11"/><path d="M20 16 v6 l4 3" stroke="${Y}"/><path d="M10 12 l4 3 M30 12 l-4 3 M8 7 l3 2 M32 7 l-3 2" stroke="${Y}"/>`),
  bandage: svg(`<rect x="6" y="14" width="28" height="12" rx="6" transform="rotate(-35 20 20)"/><path d="M17 17 l6 6 M20 15 l2 2 M15 21 l2 2" stroke="${Y}"/>`),
  medkit: svg(`<rect x="6" y="11" width="28" height="22" rx="2"/><path d="M15 11 v-4 h10 v4" /><path d="M20 16 v12 M14 22 h12" stroke="#ff6a5a" stroke-width="3"/>`),
  wood: svg(`<path d="M6 26 L30 12 L34 17 L10 31 Z"/><path d="M12 24 l3 3 M20 19 l2 3" stroke="${Y}"/>`),
  metal: svg(`<path d="M7 22 L16 10 L33 14 L28 30 L12 31 Z"/><circle cx="16" cy="18" r="1.6" fill="${Y}" stroke="none"/><circle cx="26" cy="22" r="1.6" fill="${Y}" stroke="none"/>`),
  cloth: svg(`<path d="M8 10 h24 v18 q-6 -4 -12 0 q-6 4 -12 0 Z"/><path d="M8 16 h24 M8 22 h24" stroke="${Y}" stroke-width="1.4"/>`),
  tape: svg(`<circle cx="18" cy="20" r="11"/><circle cx="18" cy="20" r="4.5"/><path d="M29 20 h7 v6 h-9" stroke="${Y}"/>`),
  battery: svg(`<rect x="6" y="13" width="25" height="14" rx="2"/><path d="M31 17 h3 v6 h-3"/><path d="M11 17 v6 M16 17 v6 M21 17 v6" stroke="${Y}"/>`),
  med: null, food: null, drink: null,
};
ICONS.food = ICONS.bread; ICONS.drink = ICONS.coffee; ICONS.med = ICONS.bandage;

// On touch devices, keyboard/mouse hints are swapped for the on-screen button icons.
const K = (name) => `<kbd>${ICON[name]}</kbd>`;
const TOUCH_MAP = [
  [/<kbd>W<\/kbd> <kbd>A<\/kbd> <kbd>S<\/kbd> <kbd>D<\/kbd>/g, 'the <b>left thumbstick</b>'],
  [/Move the <b>mouse<\/b>/g, 'Drag the <b>right side of the screen</b>'],
  [/Hold <kbd>Shift<\/kbd> while walking forward/g, `Tap ${K('sprint')} while walking forward`],
  [/Press <kbd>Enter<\/kbd> to continue/g, 'Tap here to continue'],
  [/<kbd>Shift<\/kbd>/g, K('sprint')],
  [/<kbd>Space<\/kbd>/g, K('jump')],
  [/<kbd>L<\/kbd>/g, K('flashlight')],
  [/<kbd>R<\/kbd>/g, K('battery')],
  [/<kbd>E<\/kbd>/g, K('hand')],
  [/Press <kbd>F<\/kbd> to throw a punch/g, `Tap anywhere (or ${K('fist')}) to throw a punch`],
  [/<kbd>F<\/kbd>/g, K('fist')],
  [/click throw · right-click drop/g, `${K('use')} throw · ${K('drop')} drop`],
  [/click to throw/g, `${K('use')} to throw`],
  [/click or /g, 'tap anywhere or '],
  [/click to punch/g, 'tap anywhere to punch'],
  [/right-click/g, `tap ${K('drop')}`],
  [/left-click/g, `tap ${K('use')}`],
  [/Hold <kbd>C<\/kbd>/g, `Tap ${K('crouch')}`],
  [/<kbd>C<\/kbd>/g, K('crouch')],
  [/[Pp]ress <kbd>(\d)<\/kbd>/g, 'tap slot <kbd>$1</kbd>'],
  [/<kbd>(\d)<\/kbd> again/g, 'slot <kbd>$1</kbd> again'],
];

export class UI {
  constructor(game) {
    this.game = game;
    this.hud = $('#hud');
    this.screens = [...document.querySelectorAll('.screen')];
    this.toastsEl = $('#toasts');
    this.promptEl = $('#prompt');
    this.cross = $('#crosshair');
    this._buildHotbar();
    this._buildCompass();
    this._grain();
    this._drawJumpscare();
    this._fx = { gray: -1, bright: -1 };
    this.canvas = $('#game');
    this.stats = {
      sanity: $('#st-sanity'), hunger: $('#st-hunger'), energy: $('#st-energy'), battery: $('#st-battery'),
    };
    this.fxVig = $('#fx-vig'); this.fxFlick = $('#fx-flick'); this.fxRed = $('#fx-red'); this.fxDim = $('#fx-dim');
    this.lastHot = '';
    this.current = 'scr-splash';
    fillIcons();
    document.getElementById('compass-camp').innerHTML = ICON.tent;
    document.getElementById('compass-safe').innerHTML = ICON.house;
  }

  // ── screens ──
  show(id) {
    for (const s of this.screens) s.classList.toggle('active', s.id === id);
    this.current = id;
  }
  hideScreens() { for (const s of this.screens) s.classList.remove('active'); this.current = null; }
  showHud(on) { this.hud.classList.toggle('hidden', !on); }

  loading(p) { $('#loading-fill').style.width = `${Math.round(p * 100)}%`; }

  titleCard(text, sub = '', ms = 3200) {
    const el = $('#title-card');
    el.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    el.classList.add('show');
    clearTimeout(this._tc);
    this._tc = setTimeout(() => el.classList.remove('show'), ms);
  }

  fade(to, ms = 600) {
    const f = $('#fade');
    f.style.transition = `opacity ${ms}ms`;
    f.style.opacity = to;
  }

  t(html) {
    if (!this.game.touchMode || !html) return html;
    for (const [re, rep] of TOUCH_MAP) html = html.replace(re, rep);
    return html;
  }

  // ── toasts & prompts ──
  toast(text, kind = '', ms = 3200) {
    text = this.t(text);
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = text;
    this.toastsEl.appendChild(el);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 700);
  }

  prompt(html, locked = false) {
    html = this.t(html);
    if (this._lastPrompt === html + locked) return;
    this._lastPrompt = html + locked;
    this.promptEl.innerHTML = html || '';
    this.promptEl.classList.toggle('locked', locked);
    this.cross.classList.toggle('active', !!html);
  }

  // ── hotbar ──
  _buildHotbar() {
    const hb = $('#hotbar');
    hb.innerHTML = '';
    this.slotEls = SLOTS.map((cat, i) => {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `<span class="k">${i + 1}</span><div class="ic"></div><span class="n"></span>`;
      hb.appendChild(el);
      return el;
    });
    const nm = document.createElement('div');
    nm.id = 'hotbar-name';
    this.hud.appendChild(nm);
    this.hotName = nm;
  }

  updateHotbar(p) {
    const inv = p.inv;
    const key = JSON.stringify(inv.counts) + JSON.stringify(inv.weapons) + inv.equipped + inv.slot + JSON.stringify(inv.sub) + p.flashlightOn + p.mode;
    if (key === this.lastHot) return;
    this.lastHot = key;
    SLOTS.forEach((cat, i) => {
      const el = this.slotEls[i];
      const n = inv.catCount(cat);
      let icon = cat;
      if (SUBTYPES[cat]) icon = inv.counts[inv.sub[cat]] > 0 ? inv.sub[cat] : SUBTYPES[cat].find((s) => inv.counts[s] > 0) || (cat === 'rock' ? 'rock' : cat);
      if (cat === 'melee') icon = inv.equipped >= 0 ? inv.weapons[inv.equipped].type : 'fists';
      el.querySelector('.ic').innerHTML = ICONS[icon] || '';
      const w = cat === 'melee' ? inv.weapon() : null;
      el.querySelector('.n').textContent = cat === 'flashlight' ? '' : cat === 'melee' ? (w ? `${w.dur}` : '') : n ? `×${n}` : '';
      el.classList.toggle('sel', inv.slot === i);
      el.classList.toggle('empty', n === 0 && cat !== 'melee');
      let on = el.querySelector('.on');
      if (cat === 'flashlight') {
        if (!on) { on = document.createElement('span'); on.className = 'on'; el.appendChild(on); }
        on.textContent = p.flashlightOn ? 'ON' : 'OFF';
      }
    });
    const held = inv.held();
    const cat = SLOTS[inv.slot];
    let name;
    if (cat === 'flashlight') name = `Flashlight · ${p.flashlightOn ? 'ON' : 'OFF'} · click or <kbd>L</kbd> to toggle · <kbd>R</kbd> new battery (${inv.counts.battery})`;
    else if (cat === 'melee') {
      const w = inv.weapon(), d = WEAPONS[w ? w.type : 'fists'];
      name = `${d.name} · ${d.dmg} dmg${w ? ` · ${w.dur} hits left` : ''} · click or <kbd>F</kbd> to ${d.fist ? 'punch' : 'swing'}`;
      if (inv.weapons.length) name += ` · <kbd>7</kbd> again to switch`;
    }
    else if (!held) name = { food: 'No food', drink: 'No drinks', rock: 'No rocks or noisemakers', banana: 'No banana peels', key: 'No saferoom keys', med: 'No bandages or first aid kits' }[cat] + ' · click to punch';
    else {
      const d = ITEMS[held];
      name = d.name + (d.desc ? ` <span style="opacity:.6">· ${d.desc}</span>` : '');
      if (SUBTYPES[cat]) {
        const kinds = SUBTYPES[cat].filter((s) => inv.counts[s] > 0).length;
        if (kinds > 1) name += ` · press <kbd>${inv.slot + 1}</kbd> again to switch`;
      }
      if (held === 'key') name += ' · use it on a locked saferoom door with <kbd>E</kbd> · click to punch';
      if (held === 'rock' || held === 'noisemaker') name += ' · click to throw';
      if (held === 'banana') name += ' · click throw · right-click drop';
      if (cat === 'med') name += ' · click to use';
    }
    this.hotName.innerHTML = this.t(name);
  }

  // ── compass ──
  _buildCompass() {
    const t = $('#compass-ticks');
    this.ticks = [];
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let b = 0; b < 360; b += 15) {
      const s = document.createElement('span');
      s.textContent = labels[b] || '·';
      if (labels[b] && b % 90 === 0) s.className = 'major';
      t.appendChild(s);
      this.ticks.push({ el: s, b: (b * Math.PI) / 180 });
    }
    this.campEl = $('#compass-camp');
    this.safeEl = $('#compass-safe');
    this.distEl = $('#compass-dist');
  }

  updateCompass(heading, campBearing, dist, inCamp, safe) {
    const W = 340, half = W / 2, span = Math.PI / 2;
    const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
    for (const t of this.ticks) {
      const r = wrap(t.b - heading);
      if (Math.abs(r) > span * 1.1) { t.el.style.display = 'none'; continue; }
      t.el.style.display = '';
      t.el.style.left = `${half + (r / span) * half}px`;
    }
    const r = wrap(campBearing - heading);
    const x = Math.max(-1, Math.min(1, r / span));
    this.campEl.style.left = `${half + x * (half - 10)}px`;
    this.campEl.style.opacity = Math.abs(r) > span ? 0.5 : 1;
    let txt = inCamp ? 'CAMP · SAFE' : `camp ${Math.round(dist)} m`;
    if (safe) {
      const rs = wrap(safe.bearing - heading);
      const xs = Math.max(-1, Math.min(1, rs / span));
      this.safeEl.style.display = '';
      this.safeEl.style.left = `${half + xs * (half - 10)}px`;
      this.safeEl.style.opacity = Math.abs(rs) > span ? 0.5 : 1;
      txt += ` · <span style="color:#7ff0ff">saferoom ${Math.round(safe.dist)} m</span>`;
    } else this.safeEl.style.display = 'none';
    if (txt !== this._compTxt) { this.distEl.innerHTML = txt; this._compTxt = txt; }
  }

  // ── HUD ──
  updateHud(g) {
    const p = g.player, cy = g.cycle;
    $('#hud-day').textContent = `DAY ${cy.day}`;
    const ph = cy.isNight ? 'moon' : 'sun';
    if (this._phIcon !== ph) { $('#hud-phase-icon').innerHTML = ICON[ph]; this._phIcon = ph; }
    $('#hud-phase-name').textContent = g.tutorial ? 'TUTORIAL' : cy.isNight ? 'NIGHT' : 'DAY';
    $('#hud-clock').textContent = g.tutorial ? '--:--' : cy.clockText();
    $('#hud-time-bar').style.width = `${(1 - cy.progress) * 100}%`;
    this.hud.classList.toggle('night', cy.isNight);
    const t = Math.floor(g.playTime);
    $('#hud-tape').textContent = `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

    this._stat('sanity', p.sanity, 100, Math.ceil(p.sanity), p.sanity < 30);
    this._stat('hunger', p.hunger, 100, Math.ceil(p.hunger), p.hunger < 35);
    this._stat('energy', p.energy, PLAYER.maxEnergy, Math.ceil(p.energy), p.energy < 3);
    const bp = p.battery / FLASHLIGHT.batterySeconds;
    this._stat('battery', p.battery, FLASHLIGHT.batterySeconds, `${Math.ceil(bp * 100)}%`, bp < 0.15);

    // health (with a lagging "damage taken" bar)
    const hp = Math.max(0, p.health / PLAYER.maxHealth);
    if (this._hp !== hp) {
      this._hp = hp;
      $('#health .hb').style.width = `${hp * 100}%`;
      $('#health .hb-lag').style.width = `${hp * 100}%`;
      $('#health .hv').textContent = Math.ceil(p.health);
      $('#health').classList.toggle('low', hp < 0.3);
    }
    // crouch meter (only while it isn't full)
    const cm = $('#m-crouch');
    cm.classList.toggle('hidden', p.crouchMeter >= 0.999 && !p.crouching);
    cm.classList.toggle('locked', p.crouchLock);
    cm.querySelector('.bar > div').style.width = `${p.crouchMeter * 100}%`;
    // vent durability
    const vm = $('#m-vent');
    if (p.mode === 'vent' && p.vent) {
      const d = Math.max(0, p.vent.st.dur / VENT.durability);
      vm.classList.remove('hidden');
      vm.classList.toggle('low', d < 0.3 || p.ventT > VENT.maxTime - 20);
      vm.querySelector('.bar > div').style.width = `${d * 100}%`;
      vm.querySelector('small').textContent = `${Math.max(0, Math.ceil(VENT.maxTime - p.ventT))}s`;
    } else vm.classList.add('hidden');
    // crafting materials
    const short = { wood: 'Wood', metal: 'Metal', cloth: 'Cloth', tape: 'Tape' };
    const mats = MATERIALS.filter((m) => p.inv.counts[m] > 0).map((m) => `<span>${short[m]} <b>${p.inv.counts[m]}</b></span>`).join('');
    if (mats !== this._mats) { $('#mats').innerHTML = mats; this._mats = mats; }

    $('#stars-carried').textContent = p.stars;
    $('#stars-banked').textContent = g.banked;

    let fx = '';
    if (p.boost) fx += `<div>${ICON.bolt} ${ITEMS[p.boost.item].name} +${Math.round(p.boost.mult * 100)}% speed · ${Math.ceil(p.boost.t)}s</div>`;
    if (p.crash) fx += `<div class="crash">↓ Crash ${Math.round(p.crash.mult * 100)}% speed · ${Math.ceil(p.crash.t)}s</div>`;
    if (p.cookieBonus > 0) fx += `<div style="color:#e8d27a">${ICON.cookie} +${(p.cookieBonus * 100).toFixed(1)}% speed</div>`;
    if (p.energy <= 0) fx += `<div class="crash">Exhausted — stand still to recover</div>`;
    if (fx !== this._lastFx) { $('#effects').innerHTML = fx; this._lastFx = fx; }

    // chase indicator
    const ch = g.entities ? g.entities.chaseInfo() : { n: 0 };
    const chaseEl = $('#chase');
    if (ch.n > 0 && !p.dead) {
      chaseEl.classList.remove('hidden');
      chaseEl.classList.toggle('lost', !ch.seen);
      chaseEl.textContent = ch.seen ? '◉ HUNTED — BREAK LINE OF SIGHT' : `◌ HIDING · ESCAPE IN ${Math.ceil(ch.minLeft)}s`;
    } else chaseEl.classList.add('hidden');

    this.updateHotbar(p);
  }

  // weapon recharge bar under the crosshair (like Minecraft's attack indicator)
  updateCooldown(cd, max, show) {
    const el = this._cdEl || (this._cdEl = $('#cooldown'));
    const k = max > 0 ? Math.max(0, Math.min(1, 1 - cd / max)) : 1;
    const vis = show && k < 1;
    if (vis !== this._cdVis) { el.classList.toggle('hidden', !vis); this._cdVis = vis; }
    if (vis) el.firstChild.style.width = `${k * 100}%`;
  }

  hurtFlash(amount) {
    const el = $('#hurt');
    el.style.transition = 'none';
    el.style.opacity = Math.min(1, 0.35 + amount / 40).toFixed(2);
    void el.offsetWidth;
    el.style.transition = 'opacity 0.7s';
    el.style.opacity = 0;
  }

  _stat(name, v, max, text, low) {
    const el = this.stats[name];
    el.querySelector('.bar > div').style.width = `${Math.max(0, Math.min(1, v / max)) * 100}%`;
    el.querySelector('span').textContent = text;
    el.classList.toggle('low', !!low);
  }

  bumpStars() {
    const s = $('#stars');
    s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump');
  }

  // ── screen effects ──
  effects({ sanity, red, crash, brightness, dead }) {
    let gray = 0, vig = 0, flick = 0;
    if (sanity < 50) gray = 0.3 + (50 - sanity) / 50 * 0.25;
    if (sanity < 30) { gray += 0.2; vig = 0.35 + (30 - sanity) / 30 * 0.55; }
    if (sanity < 10) flick = Math.random() < 0.35 ? 0.55 + Math.random() * 0.45 : Math.random() * 0.25;
    const bright = brightness * (crash ? 0.72 : 1);
    if (Math.abs(gray - this._fx.gray) > 0.01 || Math.abs(bright - this._fx.bright) > 0.01) {
      this._fx.gray = gray; this._fx.bright = bright;
      this.canvas.style.filter = gray > 0 || bright !== 1 ? `grayscale(${gray.toFixed(2)}) brightness(${bright.toFixed(2)})` : 'none';
    }
    this.fxVig.style.opacity = vig.toFixed(2);
    this.fxFlick.style.opacity = flick.toFixed(2);
    this.fxRed.style.opacity = dead ? 0 : Math.min(1, red).toFixed(2);
  }

  clearEffects() {
    this.canvas.style.filter = 'none';
    this._fx = { gray: -1, bright: -1 };
    this.fxVig.style.opacity = 0; this.fxFlick.style.opacity = 0; this.fxRed.style.opacity = 0;
  }

  _grain() {
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const g = c.getContext('2d');
    const img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    $('#fx-grain').style.backgroundImage = `url(${c.toDataURL()})`;
  }

  // Jumpscare faces, one per monster type (drawn once, then cached).
  _drawJumpscare(type = 'hollow') {
    this._jsCache = this._jsCache || {};
    if (this._jsCache[type]) return this._jsCache[type];
    const W = 600;
    const c = document.createElement('canvas'); c.width = c.height = W;
    const g = c.getContext('2d');
    const P = {
      hollow:    { sk: ['#d8cdb9', '#9a8e7c', '#2a231c'], rx: 200, ry: 285, eyes: 'sockets', mouth: 'gape', teeth: '#d6cba2', veins: 'rgba(60,30,50,0.55)', tint: [18, -6, -8] },
      crawler:   { sk: ['#a7ab9a', '#6a6e5f', '#1b1c16'], rx: 260, ry: 190, eyes: 'many', mouth: 'wide', teeth: '#e4dcc0', veins: 'rgba(40,50,30,0.5)', tint: [0, 8, -4] },
      brute:     { sk: ['#c89482', '#8a4f40', '#2a120c'], rx: 250, ry: 250, eyes: 'small', mouth: 'maw', teeth: '#e8dfc4', veins: 'rgba(90,20,20,0.6)', tint: [24, -10, -10] },
      hound:     { sk: ['#efe0d0', '#b9a291', '#2c211a'], rx: 170, ry: 300, eyes: 'none', mouth: 'jaws', teeth: '#f2ecd8', veins: 'rgba(120,60,60,0.45)', tint: [10, 0, -6] },
      smiler:    { sk: ['#111', '#060606', '#000'], rx: 230, ry: 250, eyes: 'glow', mouth: 'grin', teeth: '#ffffff', veins: null, tint: [0, 0, 0] },
      mannequin: { sk: ['#f4efe6', '#cfc6b8', '#3a352e'], rx: 190, ry: 270, eyes: 'none', mouth: 'none', teeth: null, veins: null, crack: true, tint: [6, 4, 0] },
    }[type] || {};
    g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
    const face = g.createRadialGradient(300, 250, 20, 300, 300, Math.max(P.rx, P.ry) + 20);
    face.addColorStop(0, P.sk[0]); face.addColorStop(0.45, P.sk[1]); face.addColorStop(0.82, P.sk[2]); face.addColorStop(1, '#000');
    g.fillStyle = face;
    g.beginPath(); g.ellipse(300, 300, P.rx, P.ry, 0, 0, Math.PI * 2); g.fill();
    if (P.veins) {
      g.strokeStyle = P.veins; g.lineWidth = 2;
      for (let i = 0; i < 26; i++) {
        let x = 300 + (Math.random() - 0.5) * P.rx * 1.7, y = 300 + (Math.random() - 0.5) * P.ry * 1.6;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 50; y += (Math.random() - 0.5) * 50; g.lineTo(x, y); }
        g.stroke();
      }
    }
    const socket = (sx, sy, rx, ry) => {
      const e = g.createRadialGradient(sx, sy, 3, sx, sy, Math.max(rx, ry));
      e.addColorStop(0, '#000'); e.addColorStop(0.6, 'rgba(0,0,0,0.95)'); e.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = e; g.beginPath(); g.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    };
    if (P.eyes === 'sockets') { socket(215, 220, 72, 50); socket(385, 220, 72, 50); }
    if (P.eyes === 'small') { socket(240, 210, 30, 18); socket(360, 210, 30, 18); }
    if (P.eyes === 'many') for (let i = 0; i < 8; i++) socket(170 + (i % 4) * 85, 190 + Math.floor(i / 4) * 40 + (i % 2) * 8, 16, 12);
    if (P.eyes === 'glow') {
      for (const sx of [225, 375]) { g.shadowColor = '#fff'; g.shadowBlur = 30; g.fillStyle = '#fff'; g.beginPath(); g.ellipse(sx, 210, 34, 16, 0, 0, Math.PI * 2); g.fill(); }
      g.shadowBlur = 0;
    }
    const teethRow = (cx, cy, rx, ry, n, a0, a1, up) => {
      g.fillStyle = P.teeth;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / (n - 1)) * (a1 - a0);
        const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
        g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x + 9, y); g.lineTo(x + (cx - x) * 0.12, y + (up ? -1 : 1) * (30 + Math.random() * 22)); g.fill();
      }
    };
    if (P.mouth === 'gape' || P.mouth === 'maw' || P.mouth === 'wide' || P.mouth === 'jaws') {
      const [mx, my, mrx, mry] = P.mouth === 'maw' ? [300, 420, 150, 110] : P.mouth === 'wide' ? [300, 360, 200, 80] : P.mouth === 'jaws' ? [300, 440, 95, 150] : [300, 430, 80, 130];
      g.fillStyle = '#050202';
      g.beginPath(); g.ellipse(mx, my, mrx, mry, 0, 0, Math.PI * 2); g.fill();
      const n = P.mouth === 'jaws' ? 12 : 9;
      teethRow(mx, my, mrx * 0.95, mry * 0.95, n, Math.PI * 1.15, Math.PI * 1.85, false);
      teethRow(mx, my, mrx * 0.95, mry * 0.95, n, Math.PI * 0.15, Math.PI * 0.85, true);
      if (P.mouth === 'maw') { g.fillStyle = P.teeth; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(300 + s * 120, 400); g.lineTo(300 + s * 150, 400); g.lineTo(300 + s * 140, 300); g.fill(); } }
    }
    if (P.mouth === 'grin') {
      g.shadowColor = '#fff'; g.shadowBlur = 24;
      g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(110, 330); g.quadraticCurveTo(300, 560, 490, 330); g.quadraticCurveTo(300, 440, 110, 330); g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = '#000'; g.lineWidth = 4;
      for (let i = 1; i < 16; i++) { const x = 110 + i * 24.4; const t = (x - 110) / 380; const yTop = 330 + 4 * t * (1 - t) * 110 * 0.55, yBot = 330 + 4 * t * (1 - t) * 230 * 0.55; g.beginPath(); g.moveTo(x, yTop); g.lineTo(x, yBot); g.stroke(); }
    }
    if (P.crack) {
      g.strokeStyle = 'rgba(40,30,20,0.8)'; g.lineWidth = 3;
      g.beginPath(); let x = 330, y = 60; g.moveTo(x, y);
      for (let k = 0; k < 9; k++) { x += (Math.random() - 0.5) * 50; y += 40 + Math.random() * 20; g.lineTo(x, y); }
      g.stroke();
    }
    const img = g.getImageData(0, 0, W, W);
    const [tr, tg, tb] = P.tint;
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 50;
      img.data[i] += n + tr; img.data[i + 1] += n + tg; img.data[i + 2] += n + tb;
    }
    g.putImageData(img, 0, 0);
    this._jsCache[type] = c;
    return c;
  }

  jumpscare(ms = 750, type = 'hollow') {
    const el = $('#jumpscare');
    const dst = $('#js-canvas').getContext('2d');
    dst.drawImage(this._drawJumpscare(type), 0, 0);
    el.classList.add('on');
    clearTimeout(this._js);
    this._js = setTimeout(() => el.classList.remove('on'), ms);
  }

  // ── settings form ──
  bindSettings(settings, onChange) {
    const pct = (v) => `${Math.round(v * 100)}%`;
    const fmt = {
      sensitivity: (v) => `${(+v).toFixed(2)}×`, fov: (v) => `${v}°`, brightness: pct, masterVolume: pct, musicVolume: pct,
      renderScale: pct, maxDPR: (v) => `${(+v).toFixed(2)}×`, maxLights: (v) => `${v}`, lightRange: (v) => `${v} m`,
      viewDist: (v) => ['', 'Near (3×3 chunks)', 'Normal (5×5)', 'Far (7×7)'][v] || v, fogDay: (v) => `${v} m`, fogNight: (v) => `${v} m`,
    };
    this._syncers = [];
    for (const el of document.querySelectorAll('[data-set]')) {
      const k = el.dataset.set;
      const out = document.querySelector(`[data-out="${k}"]`);
      const sync = () => {
        if (el.type === 'checkbox') el.checked = !!settings[k];
        else el.value = settings[k];
        if (out) out.textContent = fmt[k] ? fmt[k](settings[k]) : settings[k];
      };
      sync();
      this._syncers.push(sync);
      el.addEventListener('input', () => {
        const num = el.tagName === 'SELECT' && /^\d+(\.\d+)?$/.test(el.value);
        settings[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' || num ? parseFloat(el.value) : el.value;
        if (out) out.textContent = fmt[k] ? fmt[k](settings[k]) : settings[k];
        onChange(k);
      });
    }
  }

  syncSettings() { for (const s of this._syncers || []) s(); }

  // ── crafting table ──
  renderCraft(p, onCraft) {
    const inv = p.inv;
    $('#craft-mats').innerHTML = ['wood', 'metal', 'cloth', 'tape'].map((m) => `<span>${ICONS[m].replace('<svg', '<svg style="width:26px;height:26px;vertical-align:-6px"')} ${ITEMS[m].name} <b>${inv.counts[m] || 0}</b></span>`).join('');
    const list = $('#craft-list');
    list.innerHTML = '';
    for (const r of RECIPES) {
      const can = Object.entries(r.needs).every(([m, n]) => (inv.counts[m] || 0) >= n);
      const el = document.createElement('div');
      el.className = `recipe${can ? '' : ' cant'}`;
      const name = (WEAPONS[r.out] || ITEMS[r.out]).name;
      const needs = Object.entries(r.needs).map(([m, n]) => `<span class="${(inv.counts[m] || 0) >= n ? 'ok' : 'no'}">${n} ${ITEMS[m].name}</span>`).join(' · ');
      el.innerHTML = `<div class="ric">${ICONS[r.out] || ''}</div><div><div class="rn">${name}</div><div class="rd">${r.desc}</div><div class="rq">${needs}</div></div><button class="btn" ${can ? '' : 'disabled'}>CRAFT</button>`;
      el.querySelector('button').addEventListener('click', () => onCraft(r));
      list.appendChild(el);
    }
  }

  // ── camp chest ──
  renderChest(p, chest, onMove) {
    const inv = p.inv;
    const row = (k, n, dir) => {
      const d = ITEMS[k];
      const el = document.createElement('div');
      el.className = 'chest-row';
      el.innerHTML = `<span>${ICONS[k] || ''}</span><span>${d.name} ×${n}</span><button>${dir === 'in' ? 'STORE 1' : 'TAKE 1'}</button><button>${dir === 'in' ? 'ALL' : 'ALL'}</button>`;
      const [b1, b2] = el.querySelectorAll('button');
      b1.addEventListener('click', () => onMove(k, dir, 1));
      b2.addEventListener('click', () => onMove(k, dir, n));
      return el;
    };
    const a = $('#chest-inv'), b = $('#chest-box');
    a.innerHTML = ''; b.innerHTML = '';
    for (const k of STORABLE) if ((inv.counts[k] || 0) > 0) a.appendChild(row(k, inv.counts[k], 'in'));
    for (const k of STORABLE) if ((chest[k] || 0) > 0) b.appendChild(row(k, chest[k], 'out'));
    if (!a.children.length) a.innerHTML = '<div class="chest-empty">Nothing to store</div>';
    if (!b.children.length) b.innerHTML = '<div class="chest-empty">Empty</div>';
  }

  // ── first-launch studio intro ──
  introBlack() { const el = $('#intro'); el.classList.remove('hidden', 'out', 'show'); }

  intro(done) {
    const el = $('#intro');
    el.classList.remove('hidden', 'out', 'show');
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      el.classList.add('out');
      setTimeout(() => { el.classList.add('hidden'); el.classList.remove('out', 'show'); done(); }, 750);
    };
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    setTimeout(() => el.classList.remove('show'), 3300);
    setTimeout(finish, 4800);
    el.addEventListener('pointerdown', finish, { once: true });
  }

  tutorial(step, total, html, hint, done = false) {
    const el = $('#tutorial');
    el.classList.remove('hidden');
    el.classList.toggle('done', done);
    el.querySelector('.tut-step').textContent = `TUTORIAL · ${step}/${total}`;
    el.querySelector('.tut-skip').innerHTML = this.game.touchMode ? `${ICON.pause} pause` : 'ESC · pause';
    el.querySelector('.tut-text').innerHTML = this.t(html);
    el.querySelector('.tut-hint').innerHTML = this.t(hint || '');
  }
  hideTutorial() { $('#tutorial').classList.add('hidden'); this.glow(null); }
  glow(sel) {
    document.querySelectorAll('.tut-glow').forEach((e) => e.classList.remove('tut-glow'));
    if (sel) document.querySelectorAll(sel).forEach((e) => e.classList.add('tut-glow'));
  }
}
