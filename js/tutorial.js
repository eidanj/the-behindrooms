// Interactive tutorial, played inside the (safe) spawn camp.
// Each step either waits for Enter (info) or for the player to do something.

import { ICON } from './icons.js';

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.i = 0;
    this.ev = {};
    this.t = 0;
    this.doneT = -1;
    const g = game;
    const P = () => g.player;
    this.steps = [
      {
        text: 'Welcome to <b>The Behindrooms</b>. You\'ve noclipped out of reality into an endless office maze.<br><br>This is your <b>camp</b> — the only place that\'s always safe.',
        info: true,
      },
      { text: 'Move the <b>mouse</b> to look around.', check: () => this.ev.look > 900 },
      { text: 'Walk with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>.', check: () => this.ev.walk > 6 },
      {
        text: 'Hold <kbd>Shift</kbd> while walking forward to <b>sprint</b> (+20% speed).<br>Sprinting is louder and burns Hunger and Energy much faster.',
        check: () => this.ev.sprint > 1.6,
      },
      { text: 'Press <kbd>Space</kbd> to <b>jump</b>.', check: () => this.ev.jump >= 1 },
      {
        text: 'Hold <kbd>C</kbd> to <b>crouch</b>. While you\'re crouched, monsters <b>can\'t hear you</b>, even while you move.<br><br>You can only stay down for 10 seconds — then your legs need 20 seconds to recover.',
        check: () => this.ev.crouch >= 1,
      },
      {
        text: 'Press <kbd>L</kbd> to switch your <b>flashlight</b> on, then press it again to switch it off.<br><br>Each battery lasts 5 minutes. Press <kbd>R</kbd> to swap in a spare.',
        check: () => this.ev.flash >= 2,
      },
      {
        text: 'Search the <b>filing cabinet</b> on the east side of camp. Look at its top drawer and press <kbd>E</kbd>.',
        hint: 'Follow the yellow marker',
        setup: () => g.setMarker(21.8, 1.6, 12),
        check: () => this.ev.drawer >= 1,
      },
      {
        text: 'You found <b>Bread</b>. You\'re a little hungry — press <kbd>2</kbd> to hold food, then <b>left-click</b> to eat.<br><br>Pressing a number again cycles between food or drink types.',
        setup: () => { g.setMarker(null); P().hunger = Math.min(P().hunger, 70); },
        check: () => this.ev.ate >= 1,
      },
      {
        text: 'Pick up the <b>rock</b> with <kbd>E</kbd>, press <kbd>4</kbd>, then <b>left-click</b> to throw it.<br><br>Rocks make noise where they land — use them to <b>lure monsters away</b>, or hit one to <b>trip it</b>.',
        setup: () => g.setMarker(13.6, 0.6, 13.6),
        check: () => this.ev.rock >= 1,
      },
      {
        text: 'Grab the <b>banana</b> with <kbd>E</kbd>, press <kbd>2</kbd> and <b>left-click</b> to eat it. You keep the <b>peel</b>.',
        setup: () => g.setMarker(10.4, 0.6, 13.6),
        check: () => this.ev.ate >= 1,
      },
      {
        text: 'Now press <kbd>5</kbd> to hold the <b>banana peel</b>, then <b>left-click</b> to throw it or <b>right-click</b> to drop it at your feet.<br><br>A chasing monster that steps on a peel <b>slips and falls</b>.',
        setup: () => g.setMarker(null),
        check: () => this.ev.peel >= 1,
      },
      {
        text: 'You can <b>fight back</b>. Press <kbd>F</kbd> to throw a punch, or just click anywhere. The little bar under the crosshair shows when you can hit again.<br><br>Fists are weak. Weapons from drawers (or the crafting table) hit much harder but break. Monsters already knocked down take <b>double damage</b>.',
        setup: () => g.setMarker(null),
        check: () => this.ev.attack >= 1,
      },
      {
        text: 'Your <b>health</b> is above the hotbar. Monsters and long falls hurt you; it slowly comes back after a while (much faster at camp), and <b>bandages</b> heal you.<br><br>Bottom-right: <b>Sanity</b> drains over time (at 0 you die), <b>Hunger</b> drains while you move, <b>Energy</b> drains while you move — stand still to recover.',
        info: true,
        setup: () => g.ui.glow('#health, #hud-br'),
      },
      {
        text: 'Drawers also hold <b>materials</b>: wood, metal, cloth and tape. Bring them to the <b>crafting table</b> by the fire to make weapons, bandages, batteries, keys and noisemakers.<br><br>The <b>chest</b> on the other side of the fire stores food and batteries — it keeps them even if you die.',
        info: true,
        setup: () => { g.ui.glow(null); g.setMarker(16.4, 1.3, 12.4); },
      },
      {
        text: 'You need <b>30 ★ Stars</b> to escape.<br>Earn one by <b>escaping a chase</b> (break line of sight and survive 20 s), <b>killing a monster</b>, or <b>squashing</b> one hiding in a saferoom bed.<br><br>Carried stars are <b>lost if you die</b>. Walk into camp to <b>bank</b> them.',
        info: true,
        setup: () => g.ui.glow('#hud-tr'),
      },
      {
        text: 'Here\'s a free star. You\'re in camp, so it banks right away.<br><br>Now walk to the <b>Escape Portal</b> at the north end of camp and press <kbd>E</kbd>.',
        setup: () => { g.ui.glow(null); g.awardStar('Tutorial gift'); g.setMarker(12, 3.4, 4.2); },
        check: () => this.ev.portal >= 1,
      },
      {
        text: `The <b>compass</b> at the top of the screen always points back to camp ${ICON.tent}. The maze is endless, so don't lose it.`,
        info: true,
        setup: () => { g.setMarker(null); g.ui.glow('#compass'); },
      },
      {
        text: 'Each <b>day</b> lasts 10 minutes. When the lights start <b>flickering violently</b>, night is coming.<br><br>Watch, this is what it looks like…',
        info: true,
        setup: () => {
          g.ui.glow(null);
          g.cycle.startPreview();
          g.after(3.5, () => g.audio.powerDown());
          g.after(9.0, () => g.audio.powerUp());
        },
      },
      {
        text: 'At <b>night</b> monsters roam. They\'re <b>blind</b> and hunt by <b>sound</b>: walking can be heard up to 20 ft away, sprinting up to 35 ft.<br><br>But if one gets <b>line of sight</b> at night, it sprints at you. Sprint away and break line of sight. Your flashlight makes you easier to spot.',
        info: true,
      },
      {
        text: '<b>Saferooms</b> are sealed rooms monsters can\'t enter. Unlock them with <b>keys</b>. Some have a <b>bed</b> to sleep through the night.<br><br>But at night, listen at the door. Breathing? A bulge under the blanket? <b>Don\'t sleep. Jump on it.</b>',
        info: true,
      },
      {
        text: 'Look up: there are <b>vents</b> above the ceiling. Climb a <b>ladder</b> (there\'s one at the back of camp) to crawl inside and hide — monsters can\'t see or hear you up there.<br><br>But crawling wears the vent out, and after 2 minutes it collapses. Find a grate and press <kbd>E</kbd> to drop out.',
        info: true,
        setup: () => g.setMarker(4.5, 2.4, 22.1),
      },
      { text: 'That\'s everything. Good luck in there.', info: true, final: true, setup: () => g.setMarker(null) },
    ];
  }

  event(name, v = 1) { this.ev[name] = (this.ev[name] || 0) + v; }

  start() {
    this.i = 0;
    this.ev = {};
    this._enter();
  }

  _enter() {
    const s = this.steps[this.i];
    this.t = 0;
    this.doneT = -1;
    this.ev = {};
    if (s.setup) s.setup();
    this._render(false);
  }

  _render(done) {
    const s = this.steps[this.i];
    const hint = s.info ? 'Press <kbd>Enter</kbd> to continue' : done ? '✓ Nice.' : s.hint || '';
    this.game.ui.tutorial(this.i + 1, this.steps.length, s.text, hint, done);
  }

  update(dt, input) {
    const s = this.steps[this.i];
    this.t += dt;
    if (s.info) {
      if (this.t > 0.4 && (input.pressed('Enter') || input.pressed('NumpadEnter'))) this._next();
      return;
    }
    if (this.doneT < 0 && s.check()) { this.doneT = 0; this._render(true); this.game.audio.pickup(); }
    if (this.doneT >= 0) { this.doneT += dt; if (this.doneT > 1.0) this._next(); }
  }

  _next() {
    const s = this.steps[this.i];
    if (s.final) { this.game.finishTutorial(); return; }
    this.i++;
    this._enter();
  }
}
