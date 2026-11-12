// DOM-side UI: screens, HUD, hotbar, compass, toasts and screen effects.

import { ITEMS, SLOTS } from './items.js';
import { STARS_TO_WIN, PLAYER, FLASHLIGHT } from './config.js';

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
  food: null, drink: null,
};
ICONS.food = ICONS.bread; ICONS.drink = ICONS.coffee;

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

  // ── toasts & prompts ──
  toast(text, kind = '', ms = 3200) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = text;
    this.toastsEl.appendChild(el);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 700);
  }

  prompt(html, locked = false) {
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
    const key = JSON.stringify(inv.counts) + inv.slot + inv.sub.food + inv.sub.drink + p.flashlightOn;
    if (key === this.lastHot) return;
    this.lastHot = key;
    SLOTS.forEach((cat, i) => {
      const el = this.slotEls[i];
      const n = inv.catCount(cat);
      let icon = cat;
      if (cat === 'food' || cat === 'drink') icon = inv.counts[inv.sub[cat]] > 0 ? inv.sub[cat] : cat;
      el.querySelector('.ic').innerHTML = ICONS[icon] || '';
      el.querySelector('.n').textContent = cat === 'flashlight' ? '' : n ? `×${n}` : '';
      el.classList.toggle('sel', inv.slot === i);
      el.classList.toggle('empty', n === 0);
      let on = el.querySelector('.on');
      if (cat === 'flashlight') {
        if (!on) { on = document.createElement('span'); on.className = 'on'; el.appendChild(on); }
        on.textContent = p.flashlightOn ? 'ON' : 'OFF';
      }
    });
    const held = inv.held();
    const cat = SLOTS[inv.slot];
    let name;
    if (cat === 'flashlight') name = `Flashlight · ${p.flashlightOn ? 'ON' : 'OFF'} · <kbd>L</kbd> toggle · <kbd>R</kbd> new battery (${inv.counts.battery})`;
    else if (!held) name = { food: 'No food', drink: 'No drinks', rock: 'No rocks', banana: 'No banana peels', key: 'No saferoom keys' }[cat];
    else {
      const d = ITEMS[held];
      name = d.name + (d.desc ? ` <span style="opacity:.6">· ${d.desc}</span>` : '');
      if (cat === 'food' || cat === 'drink') {
        const kinds = (cat === 'food' ? ['bread', 'granola', 'cookie'] : ['coffee', 'energy', 'almond']).filter((s) => inv.counts[s] > 0).length;
        if (kinds > 1) name += ` · press <kbd>${inv.slot + 1}</kbd> again to switch`;
      }
      if (held === 'rock') name += ' · click to throw';
      if (held === 'banana') name += ' · click throw · right-click drop';
    }
    this.hotName.innerHTML = name;
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
    this.distEl = $('#compass-dist');
  }

  updateCompass(heading, campBearing, dist, inCamp) {
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
    this.distEl.textContent = inCamp ? 'CAMP · SAFE' : `camp ${Math.round(dist)} m`;
  }

  // ── HUD ──
  updateHud(g) {
    const p = g.player, cy = g.cycle;
    $('#hud-day').textContent = `DAY ${cy.day}`;
    $('#hud-phase-icon').textContent = cy.isNight ? '☾' : '☀';
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

    $('#stars-carried').textContent = p.stars;
    $('#stars-banked').textContent = g.banked;

    let fx = '';
    if (p.boost) fx += `<div>⚡ ${ITEMS[p.boost.item].name} +${Math.round(p.boost.mult * 100)}% speed · ${Math.ceil(p.boost.t)}s</div>`;
    if (p.crash) fx += `<div class="crash">↓ Crash ${Math.round(p.crash.mult * 100)}% speed · ${Math.ceil(p.crash.t)}s</div>`;
    if (p.cookieBonus > 0) fx += `<div style="color:#e8d27a">🍪 +${(p.cookieBonus * 100).toFixed(1)}% speed</div>`;
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

  _drawJumpscare() {
    const c = $('#js-canvas'), g = c.getContext('2d');
    const W = 600;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
    const face = g.createRadialGradient(300, 250, 20, 300, 300, 290);
    face.addColorStop(0, '#d8cdb9'); face.addColorStop(0.45, '#9a8e7c'); face.addColorStop(0.8, '#2a231c'); face.addColorStop(1, '#000');
    g.fillStyle = face;
    g.beginPath(); g.ellipse(300, 300, 200, 285, 0, 0, Math.PI * 2); g.fill();
    // veins
    g.strokeStyle = 'rgba(60,30,50,0.55)'; g.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      let x = 300 + (Math.random() - 0.5) * 340, y = 300 + (Math.random() - 0.5) * 460;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 50; y += (Math.random() - 0.5) * 50; g.lineTo(x, y); }
      g.stroke();
    }
    // empty eye sockets
    for (const sx of [215, 385]) {
      const e = g.createRadialGradient(sx, 220, 4, sx, 220, 70);
      e.addColorStop(0, '#000'); e.addColorStop(0.6, 'rgba(0,0,0,0.95)'); e.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = e; g.beginPath(); g.ellipse(sx, 220, 72, 50, 0, 0, Math.PI * 2); g.fill();
    }
    // gaping mouth
    g.fillStyle = '#050202';
    g.beginPath(); g.ellipse(300, 430, 80, 130, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d6cba2';
    for (let i = 0; i < 9; i++) {
      const a0 = Math.PI * 1.15 + (i / 8) * Math.PI * 0.7;
      const x = 300 + Math.cos(a0) * 76, y = 430 + Math.sin(a0) * 124;
      g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x + 9, y); g.lineTo(x + (300 - x) * 0.12, y + 34 + Math.random() * 22); g.fill();
      const b0 = Math.PI * 0.15 + (i / 8) * Math.PI * 0.7;
      const x2 = 300 + Math.cos(b0) * 76, y2 = 430 + Math.sin(b0) * 124;
      g.beginPath(); g.moveTo(x2 - 9, y2); g.lineTo(x2 + 9, y2); g.lineTo(x2 + (300 - x2) * 0.12, y2 - 30 - Math.random() * 20); g.fill();
    }
    const img = g.getImageData(0, 0, W, W);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 50;
      img.data[i] += n + 18; img.data[i + 1] += n - 6; img.data[i + 2] += n - 8;
    }
    g.putImageData(img, 0, 0);
  }

  jumpscare(ms = 750) {
    const el = $('#jumpscare');
    el.classList.add('on');
    clearTimeout(this._js);
    this._js = setTimeout(() => el.classList.remove('on'), ms);
  }

  // ── settings form ──
  bindSettings(settings, onChange) {
    const fmt = { sensitivity: (v) => `${(+v).toFixed(2)}×`, fov: (v) => `${v}°`, brightness: (v) => `${Math.round(v * 100)}%`, masterVolume: (v) => `${Math.round(v * 100)}%`, musicVolume: (v) => `${Math.round(v * 100)}%` };
    for (const el of document.querySelectorAll('[data-set]')) {
      const k = el.dataset.set;
      const out = document.querySelector(`[data-out="${k}"]`);
      const sync = () => {
        if (el.type === 'checkbox') el.checked = !!settings[k];
        else el.value = settings[k];
        if (out) out.textContent = fmt[k] ? fmt[k](settings[k]) : settings[k];
      };
      sync();
      el.addEventListener('input', () => {
        settings[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
        if (out) out.textContent = fmt[k] ? fmt[k](settings[k]) : settings[k];
        onChange(k);
      });
    }
  }

  tutorial(step, total, html, hint, done = false) {
    const el = $('#tutorial');
    el.classList.remove('hidden');
    el.classList.toggle('done', done);
    el.querySelector('.tut-step').textContent = `TUTORIAL · ${step}/${total}`;
    el.querySelector('.tut-text').innerHTML = html;
    el.querySelector('.tut-hint').innerHTML = hint || '';
  }
  hideTutorial() { $('#tutorial').classList.add('hidden'); this.glow(null); }
  glow(sel) {
    document.querySelectorAll('.tut-glow').forEach((e) => e.classList.remove('tut-glow'));
    if (sel) document.querySelectorAll(sel).forEach((e) => e.classList.add('tut-glow'));
  }
}
