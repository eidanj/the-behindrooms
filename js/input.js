// Keyboard + mouse input with per-frame "pressed" edges.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.mouse = new Set();
    this.pressedMouse = new Set();
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.moveX = 0; this.moveY = 0; // analog stick (touch); −y = forward
    this.enabled = true;
    this.allowUnlocked = false;

    window.addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code) && document.activeElement?.tagName !== 'INPUT') e.preventDefault();
      if (!e.repeat) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.clear(); });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas || this.allowUnlocked) {
        // ignore the occasional huge spike some browsers emit on lock
        if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
        this.dx += e.movementX; this.dy += e.movementY;
      }
    });
    window.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== canvas && !this.allowUnlocked) return;
      this.mouse.add(e.button); this.pressedMouse.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.mouse.delete(e.button));
    window.addEventListener('wheel', (e) => { if (document.pointerLockElement === canvas || this.allowUnlocked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('contextmenu', (e) => { if (document.pointerLockElement === canvas) e.preventDefault(); });
  }

  // used by the touch controls
  press(code) { this.pressedKeys.add(code); }
  hold(code, on) { if (on) this.keys.add(code); else this.keys.delete(code); }
  click(button) { this.pressedMouse.add(button); }

  down(code) { return this.keys.has(code); }
  pressed(code) { return this.pressedKeys.has(code); }
  mousePressed(b) { return this.pressedMouse.has(b); }

  endFrame() {
    this.pressedKeys.clear();
    this.pressedMouse.clear();
    this.dx = 0; this.dy = 0; this.wheel = 0;
  }
}
