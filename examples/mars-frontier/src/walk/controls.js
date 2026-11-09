/**
 * Walking controls for touch, mouse and keyboard.
 *  - Left half: floating joystick (appears where the thumb lands) moves the player.
 *  - Right half: drag to look; a short tap inspects what is under the finger.
 *  - Keyboard: WASD / arrows move, Shift sprints, arrows also turn, E interacts.
 */
const JOY_MAX = 58; // px from centre to full deflection
const TAP_MOVE = 10; // px
const TAP_TIME = 320; // ms

export class WalkControls {
  constructor({ walker, zone, joy, knob, onTap, onInteract, onSprint, getSens, isActive }) {
    this.walker = walker;
    this.zone = zone;
    this.joy = joy;
    this.knob = knob;
    this.onTap = onTap;
    this.onInteract = onInteract;
    this.onSprint = onSprint;
    this.getSens = getSens;
    this.isActive = isActive;
    this.joyId = null;
    this.lookId = null;
    this.keys = new Set();
    this.sprintHeld = false;
    this.bind();
  }

  bind() {
    const z = this.zone;
    z.addEventListener("pointerdown", (e) => this.down(e));
    z.addEventListener("pointermove", (e) => this.move(e));
    const up = (e) => this.up(e, false);
    z.addEventListener("pointerup", up);
    z.addEventListener("pointercancel", (e) => this.up(e, true));
    window.addEventListener("keydown", (e) => this.key(e, true));
    window.addEventListener("keyup", (e) => this.key(e, false));
    window.addEventListener("blur", () => this.reset());
  }

  reset() {
    this.keys.clear();
    this.joyId = this.lookId = null;
    this.joy.hidden = true;
    this.zero();
  }

  zero() {
    const i = this.walker.input;
    i.mx = i.mz = i.lookX = i.lookY = 0;
  }

  down(e) {
    if (!this.isActive()) return;
    if (e.target.closest("button")) return;
    this.zone.setPointerCapture?.(e.pointerId);
    const left = e.clientX < window.innerWidth * 0.5;
    if (left && this.joyId === null) {
      this.joyId = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joy.hidden = false;
      this.joy.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.knob.style.transform = "translate(0px, 0px)";
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.last = { x: e.clientX, y: e.clientY };
      this.tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
    }
  }

  move(e) {
    if (!this.isActive()) return;
    if (e.pointerId === this.joyId) {
      const dx = e.clientX - this.joyOrigin.x;
      const dy = e.clientY - this.joyOrigin.y;
      const d = Math.hypot(dx, dy);
      const k = d > JOY_MAX ? JOY_MAX / d : 1;
      const kx = dx * k;
      const ky = dy * k;
      this.knob.style.transform = `translate(${kx}px, ${ky}px)`;
      const dead = 0.12;
      const mag = Math.min(1, d / JOY_MAX);
      const scale = mag < dead ? 0 : (mag - dead) / (1 - dead);
      const dirX = d ? dx / d : 0;
      const dirY = d ? dy / d : 0;
      this.walker.input.mx = dirX * scale;
      this.walker.input.mz = -dirY * scale; // up on screen = forward
      this.walker.input.sprint = this.sprintHeld || this.sprintLatch === true;
    } else if (e.pointerId === this.lookId) {
      const dx = e.clientX - this.last.x;
      const dy = e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
      this.tapStart.moved += Math.hypot(dx, dy);
      this.walker.look(dx, dy);
    }
  }

  up(e, cancelled) {
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.joy.hidden = true;
      this.zero();
      this.walker.input.sprint = this.sprintHeld;
    } else if (e.pointerId === this.lookId) {
      const t = this.tapStart;
      this.lookId = null;
      if (!cancelled && t && t.moved < TAP_MOVE && performance.now() - t.t < TAP_TIME) this.onTap?.(e.clientX, e.clientY);
    }
  }

  key(e, down) {
    if (!this.isActive()) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const move = { w: "fwd", ArrowUp: "fwd", s: "back", ArrowDown: "back", a: "left", ArrowLeft: "left", d: "right", ArrowRight: "right" };
    if (k === "Shift") this.sprintHeld = down;
    if (down && k === "e") this.onInteract?.();
    if (!(k in move) && k !== "Shift") return;
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k)) e.preventDefault();
    this.applyKeys();
  }

  applyKeys() {
    const has = (...ks) => ks.some((k) => this.keys.has(k));
    let mx = (has("d", "ArrowRight") ? 1 : 0) - (has("a", "ArrowLeft") ? 1 : 0);
    let mz = (has("w", "ArrowUp") ? 1 : 0) - (has("s", "ArrowDown") ? 1 : 0);
    if (this.joyId === null) {
      this.walker.input.mx = mx;
      this.walker.input.mz = mz;
    }
    this.walker.input.sprint = this.sprintHeld || this.sprintLatch === true;
  }

  /** Sprint button: toggles a latched sprint for hands-free running. */
  toggleSprint() {
    this.sprintLatch = !this.sprintLatch;
    this.walker.input.sprint = this.sprintLatch || this.sprintHeld;
    return this.sprintLatch;
  }
}
