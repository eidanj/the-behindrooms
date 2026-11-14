// On-screen touch controls for phones and tablets.
//  • Left side: floating thumbstick (appears where you put your thumb)
//  • Right side: drag anywhere to look around
//  • Buttons: attack, use item, jump, interact, sprint toggle, flashlight,
//    battery, drop banana peel, pause. Hotbar slots are tappable.
// A quick tap anywhere that isn't a button throws a punch.
// Everything is fed into the same Input object the keyboard uses.

import { ICON } from './icons.js';

export function isTouchDevice() {
  const mm = (q) => (window.matchMedia ? window.matchMedia(q).matches : false);
  const coarse = mm('(pointer: coarse)');
  const anyFine = mm('(any-pointer: fine)');
  const touchCapable = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  // a touchscreen laptop (fine primary pointer) keeps keyboard + mouse controls
  return touchCapable && (coarse || !anyFine);
}

const STICK_R = 56;     // thumbstick radius in px
const LOOK_GAIN = 1.6;  // touch-drag pixels → mouse-pixels
const TAP_MS = 320;     // a touch shorter than this…
const TAP_PX = 14;      // …that moved less than this is a tap → punch

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.visible = false;
    this.joyId = null;
    this.lookId = null;
    this.sprint = false;

    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.className = 'hidden';
    root.innerHTML = `
      <div id="t-joy" class="hidden"><div class="knob"></div></div>
      <button class="t-btn" id="t-pause" aria-label="Pause">${ICON.pause}</button>
      <button class="t-btn big" id="t-attack" aria-label="Attack">${ICON.fist}</button>
      <button class="t-btn" id="t-use" aria-label="Use held item">${ICON.use}</button>
      <button class="t-btn" id="t-jump" aria-label="Jump">${ICON.jump}</button>
      <button class="t-btn" id="t-act" aria-label="Interact">${ICON.hand}</button>
      <button class="t-btn small" id="t-sprint" aria-label="Sprint">${ICON.sprint}</button>
      <button class="t-btn small" id="t-light" aria-label="Flashlight">${ICON.flashlight}</button>
      <button class="t-btn small" id="t-batt" aria-label="Replace battery">${ICON.battery}</button>
      <button class="t-btn small" id="t-drop" aria-label="Drop banana peel">${ICON.drop}</button>
      <button class="t-btn small" id="t-crouch" aria-label="Crouch">${ICON.crouch}</button>`;
    const hud = document.getElementById('hud');
    hud.parentNode.insertBefore(root, hud.nextSibling);
    this.joy = root.querySelector('#t-joy');
    this.knob = root.querySelector('.knob');
    this.actBtn = root.querySelector('#t-act');
    this.sprintBtn = root.querySelector('#t-sprint');

    const I = this.input;
    const bind = (id, fn) => {
      const el = root.querySelector(id);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('down');
        fn();
      });
      const up = () => el.classList.remove('down');
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    };
    bind('#t-attack', () => I.press('KeyF'));
    bind('#t-use', () => I.click(0));
    bind('#t-jump', () => { I.press('Space'); I.touchJumpHeld = true; });
    const jumpUp = () => { I.touchJumpHeld = false; };
    root.querySelector('#t-jump').addEventListener('pointerup', jumpUp);
    root.querySelector('#t-jump').addEventListener('pointercancel', jumpUp);
    this.crouchBtn = root.querySelector('#t-crouch');
    bind('#t-crouch', () => { I.touchCrouch = !I.touchCrouch; });
    bind('#t-act', () => I.press('KeyE'));
    bind('#t-light', () => I.press('KeyL'));
    bind('#t-batt', () => I.press('KeyR'));
    bind('#t-drop', () => I.click(2));
    bind('#t-sprint', () => this.setSprint(!this.sprint));
    bind('#t-pause', () => game.pause());

    root.addEventListener('pointerdown', (e) => this._down(e));
    root.addEventListener('pointermove', (e) => this._move(e));
    root.addEventListener('pointerup', (e) => this._up(e));
    root.addEventListener('pointercancel', (e) => this._up(e));

    // hotbar slots become tappable
    document.querySelectorAll('#hotbar .slot').forEach((el, i) => {
      el.addEventListener('pointerdown', (e) => {
        if (!game.touchMode) return;
        e.preventDefault();
        e.stopPropagation();
        I.press('Digit' + (i + 1));
      });
    });
    // tap the tutorial panel = Enter
    document.getElementById('tutorial').addEventListener('pointerdown', (e) => {
      if (!game.touchMode) return;
      e.preventDefault();
      I.press('Enter');
    });
  }

  setSprint(on) {
    this.sprint = on;
    this.input.hold('ShiftLeft', on);
    this.sprintBtn.classList.toggle('on', on);
  }

  setVisible(on) {
    if (on === this.visible) return;
    this.visible = on;
    this.root.classList.toggle('hidden', !on);
    if (!on) this._reset();
  }

  setReady(on) {
    this.actBtn.classList.toggle('ready', on);
    this.crouchBtn.classList.toggle('on', !!this.input.touchCrouch);
  }

  _reset() {
    this.joyId = null;
    this.lookId = null;
    this.input.moveX = 0;
    this.input.moveY = 0;
    this.joy.classList.add('hidden');
    this.setSprint(false);
    this.input.touchCrouch = false;
    this.input.touchJumpHeld = false;
  }

  _down(e) {
    if (e.pointerType === 'mouse' && !this.game.touchMode) return;
    e.preventDefault();
    const x = e.clientX, y = e.clientY;
    try { this.root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    this.taps = this.taps || new Map();
    this.taps.set(e.pointerId, { t: e.timeStamp, x, y, moved: 0 });
    if (x < window.innerWidth * 0.42 && this.joyId === null) {
      this.joyId = e.pointerId;
      this.ox = x; this.oy = y;
      this.joy.style.left = `${x}px`;
      this.joy.style.top = `${y}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
      this.joy.classList.remove('hidden');
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lx = x; this.ly = y;
    }
  }

  _move(e) {
    const tp = this.taps && this.taps.get(e.pointerId);
    if (tp) tp.moved = Math.max(tp.moved, Math.hypot(e.clientX - tp.x, e.clientY - tp.y));
    if (e.pointerId === this.joyId) {
      e.preventDefault();
      let dx = e.clientX - this.ox, dy = e.clientY - this.oy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      // small dead zone, then analog (push further = walk faster)
      const m = Math.min(1, d / STICK_R);
      const amt = m < 0.12 ? 0 : (m - 0.12) / 0.88;
      const len = Math.hypot(dx, dy) || 1;
      this.input.moveX = (dx / len) * amt;
      this.input.moveY = (dy / len) * amt;
    } else if (e.pointerId === this.lookId) {
      e.preventDefault();
      this.input.dx += (e.clientX - this.lx) * LOOK_GAIN;
      this.input.dy += (e.clientY - this.ly) * LOOK_GAIN;
      this.lx = e.clientX; this.ly = e.clientY;
    }
  }

  _up(e) {
    const tp = this.taps && this.taps.get(e.pointerId);
    if (tp) {
      this.taps.delete(e.pointerId);
      // quick tap anywhere (not on a button) = punch / swing
      if (e.type === 'pointerup' && e.timeStamp - tp.t < TAP_MS && tp.moved < TAP_PX) this.input.press('KeyF');
    }
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.input.moveX = 0;
      this.input.moveY = 0;
      this.joy.classList.add('hidden');
      if (this.sprint) this.setSprint(false);
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
    }
  }
}
