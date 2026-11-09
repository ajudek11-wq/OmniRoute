import * as THREE from "three";
import { readPad, emptyPad, flick } from "./input.js";
import { createGlove } from "./hands.js";
import { Panel, grid } from "./panel.js";
import { turnAboutHead, moveDelta, pushOut, teleportArc, validTarget, seatedOffset, vignetteFor } from "./locomotion.js";

/**
 * The player in VR (WebXR → OpenXR → SteamVR → PS VR2) and in the desktop preview.
 *
 * One rig, one camera: the camera always lives inside `rig`; in VR the headset drives its local pose,
 * on desktop the mouse does. Worlds hand the system an adapter each frame:
 *   { scene, groundAt(x,z)→y|null, colliders:[{x,z,r}], bounds?:{x,z,r}, interactables:[…], eyeLock? }
 * Interactables: { object, label?, onSelect?(hand,hit), grab?, onGrab?, onRelease?, poke?, onPoke?, panel?, onButton?(btn), enabled?() }
 */

export const DEFAULT_COMFORT = {
  move: "smooth", // smooth | teleport
  turn: "snap", // snap | smooth
  snapDeg: 30,
  turnSpeed: 90, // °/s for smooth turning
  speed: 1.6, // m/s smooth locomotion
  vignette: true,
  seated: false,
  dominant: "right",
};

const EYE = 1.65;
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();

export class XRSystem {
  constructor({ renderer, comfort = {}, onMenu = () => {}, onSessionChange = () => {}, sound = null }) {
    this.renderer = renderer;
    this.comfort = { ...DEFAULT_COMFORT, ...comfort };
    this.onMenu = onMenu;
    this.onSessionChange = onSessionChange;
    this.sound = sound;
    this.presenting = false;

    this.rig = new THREE.Group();
    this.rig.name = "player-rig";
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 2e7);
    this.camera.position.set(0, EYE, 0);
    this.rig.add(this.camera);
    this.yaw = 0;
    this.pitch = 0;
    this.floorOffset = 0;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 40;
    this.hands = {};
    this.adapter = null;
    this.held = {};

    this.buildComfort();
    this.buildControllers();
    this.buildTeleport();
    this.buildMenu();
    this.buildToast();
    this.initDesktop();
    renderer.xr.addEventListener("sessionstart", () => this.sessionStarted());
    renderer.xr.addEventListener("sessionend", () => this.sessionEnded());
  }

  // ── Session ──────────────────────────────────────────────
  static async supported() {
    try {
      return !!(navigator.xr && (await navigator.xr.isSessionSupported("immersive-vr")));
    } catch {
      return false;
    }
  }

  async enter({ framebufferScale = 1, foveation = 0.5 } = {}) {
    if (this.presenting) return;
    const session = await navigator.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "layers"],
    });
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType("local-floor");
    this.renderer.xr.setFramebufferScaleFactor(framebufferScale);
    await this.renderer.xr.setSession(session);
    this.renderer.xr.setFoveation(foveation);
    // PS VR2 runs at 90 or 120 Hz on PC; ask for the highest supported rate ≤ 120 that the tier allows.
    if (session.supportedFrameRates && session.updateTargetFrameRate) {
      const want = this.targetHz ?? 90;
      const rates = [...session.supportedFrameRates].filter((r) => r <= want).sort((a, b) => b - a);
      if (rates.length) session.updateTargetFrameRate(rates[0]).catch(() => {});
    }
    this.session = session;
  }

  exit() {
    this.session?.end();
  }

  sessionStarted() {
    this.presenting = true;
    document.exitPointerLock?.();
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    this.desktopHand.visible = false;
    this.onSessionChange(true);
  }

  sessionEnded() {
    this.presenting = false;
    this.session = null;
    this.camera.position.set(0, EYE, 0);
    this.camera.rotation.set(this.pitch, 0, 0, "YXZ");
    this.floorOffset = 0;
    this.rig.position.y = this.groundY(this.rig.position.x, this.rig.position.z);
    this.desktopHand.visible = true;
    for (const h of Object.values(this.hands)) h.glove.root.visible = false;
    this.onSessionChange(false);
  }

  // ── Scene attachment ─────────────────────────────────────
  attach(scene) {
    if (this.rig.parent !== scene) scene.add(this.rig);
  }

  /** Place the player: feet at (x, ground, z) facing yaw (radians; 0 = looking toward −Z). */
  place(x, z, yaw = 0, y = null) {
    this.yaw = yaw;
    this.rig.rotation.set(0, yaw, 0);
    this.rig.position.set(x, 0, z);
    this.rig.position.y = y ?? this.groundY(x, z);
    if (this.presenting) {
      // Put the tracked head (not the play-space origin) on the spawn point.
      const hx = this.camera.position.x;
      const hz = this.camera.position.z;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      this.rig.position.x = x - (hx * c + hz * s);
      this.rig.position.z = z - (-hx * s + hz * c);
    }
    this.lastHead = null;
  }

  groundY(x, z) {
    const g = this.adapter?.groundAt?.(x, z);
    return (g ?? this.rig.position.y) + (this.presenting ? this.floorOffset : 0);
  }

  /** Recenter: face the given yaw (or keep it) with the head over the current spot; seated height re-measured. */
  recenter() {
    const head = this.headWorld();
    if (this.presenting) {
      const headYaw = this.headYaw();
      const local = this.camera.position;
      const st = turnAboutHead({ x: this.rig.position.x, z: this.rig.position.z, yaw: this.yaw }, local.x, local.z, this.yaw - headYaw);
      this.yaw = st.yaw;
      this.rig.rotation.y = st.yaw;
      this.rig.position.x = st.x;
      this.rig.position.z = st.z;
      this.floorOffset = this.comfort.seated ? seatedOffset(local.y) : 0;
      this.rig.position.y = (this.adapter?.groundAt?.(head.x, head.z) ?? this.rig.position.y - this.floorOffset) + this.floorOffset;
    }
    this.toast("Recentered", "");
  }

  setComfort(patch) {
    Object.assign(this.comfort, patch);
    if ("seated" in patch && this.presenting) this.floorOffset = this.comfort.seated ? seatedOffset(this.camera.position.y) : 0;
    this.refreshMenu();
  }

  headWorld(target = new THREE.Vector3()) {
    return this.camera.getWorldPosition(target);
  }

  headYaw() {
    this.camera.getWorldDirection(tmpV);
    return Math.atan2(-tmpV.x, -tmpV.z);
  }

  // ── Comfort: fade + tunnelling vignette ──────────────────
  buildComfort() {
    this.fade = { value: 1, target: 0, speed: 3 };
    this.fadeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 1, depthTest: false, depthWrite: false })
    );
    this.fadeMesh.renderOrder = 1000;
    this.fadeMesh.frustumCulled = false;
    this.camera.add(this.fadeMesh);
    this.vigMat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uK: { value: 0 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader:
        "uniform float uK; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0 - uK * 0.75, 1.15 - uK * 0.6, d) * min(1.0, uK * 1.6); gl_FragColor = vec4(0.0, 0.0, 0.0, a); }",
    });
    this.vignette = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), this.vigMat);
    this.vignette.position.z = -0.12;
    this.vignette.renderOrder = 999;
    this.vignette.frustumCulled = false;
    this.camera.add(this.vignette);
    this.vigK = 0;
  }

  /** Fade to black (or back); resolves when done. Used for every teleport and scene change. */
  fadeTo(target, seconds = 0.35) {
    this.fade.target = target;
    this.fade.speed = 1 / Math.max(0.01, seconds);
    return new Promise((res) => {
      const check = () => (Math.abs(this.fade.value - target) < 0.01 ? res() : setTimeout(check, 16));
      check();
    });
  }

  // ── Controllers + gloves ─────────────────────────────────
  buildControllers() {
    const rayGeo = new THREE.CylinderGeometry(0.0015, 0.004, 1, 6, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
    for (let i = 0; i < 2; i++) {
      const ray = this.renderer.xr.getController(i);
      const grip = this.renderer.xr.getControllerGrip(i);
      this.rig.add(ray, grip);
      const beam = new THREE.Mesh(rayGeo, new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));
      beam.visible = false;
      ray.add(beam);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      dot.visible = false;
      this.rig.add(dot);
      const slot = { index: i, ray, grip, beam, dot, source: null, pad: emptyPad(), glove: null, turnArmed: true, aiming: false, hover: null, pokeCool: 0 };
      ray.addEventListener("connected", (e) => {
        const hand = e.data.handedness === "left" ? "left" : "right";
        slot.source = e.data;
        slot.hand = hand;
        if (!slot.glove || slot.glove.hand !== hand) {
          if (slot.glove) grip.remove(slot.glove.root);
          slot.glove = createGlove(hand);
          slot.glove.hand = hand;
          grip.add(slot.glove.root);
        }
        slot.glove.root.visible = true;
        this.hands[hand] = slot;
      });
      ray.addEventListener("disconnected", () => {
        if (slot.hand && this.hands[slot.hand] === slot) delete this.hands[slot.hand];
        slot.source = null;
        if (slot.glove) slot.glove.root.visible = false;
        beam.visible = false;
        dot.visible = false;
      });
    }
  }

  // ── Teleport arc ─────────────────────────────────────────
  buildTeleport() {
    const n = 120;
    this.arcGeo = new THREE.BufferGeometry();
    this.arcGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.arcMat = new THREE.LineBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.9, toneMapped: false });
    this.arc = new THREE.Line(this.arcGeo, this.arcMat);
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.34, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false }));
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 3).rotateX(-Math.PI / 2).translate(0, 0.02, -0.42), ring.material);
    this.reticle = new THREE.Group();
    this.reticle.add(ring, arrow);
    this.reticle.visible = false;
  }

  // ── Wrist / hand menu ────────────────────────────────────
  buildMenu() {
    this.menu = new Panel({ width: 0.3, height: 0.36, ppm: 1600 });
    this.menu.mesh.visible = false;
    this.menu.mesh.userData.interact = {
      object: this.menu.mesh,
      panel: this.menu,
      onButton: (b) => this.menuButton(b),
    };
    this.menuItems = () => [
      { id: "hub", label: "Star map (hub)" },
      { id: "archive", label: "Discoveries" },
      { id: "move", label: this.comfort.move === "smooth" ? "Move: smooth" : "Move: teleport", on: true },
      { id: "turn", label: this.comfort.turn === "snap" ? `Turn: snap ${this.comfort.snapDeg}°` : "Turn: smooth", on: true },
      { id: "seated", label: this.comfort.seated ? "Seated" : "Standing", on: this.comfort.seated },
      { id: "vignette", label: this.comfort.vignette ? "Vignette: on" : "Vignette: off", on: this.comfort.vignette },
      { id: "slower", label: "Speed −" },
      { id: "faster", label: "Speed +" },
      { id: "recenter", label: "Recenter" },
      { id: "sound", label: this.sound?.enabled ? "Sound: on" : "Sound: off", on: !!this.sound?.enabled },
      { id: "quality", label: `Graphics: ${this.qualityLabel ?? "Auto"}` },
      { id: "exit", label: "Exit VR" },
    ];
    this.refreshMenu();
  }

  refreshMenu() {
    if (!this.menu) return;
    this.menu.setContent({
      eyebrow: "Suit computer",
      title: this.menuTitle ?? "Menu",
      titleSize: 64,
      lines: [`Move ${this.comfort.speed.toFixed(1)} m/s`],
      lineSize: 38,
      buttons: grid(this.menu, this.menuItems(), { top: 0.3, cols: 2, rowH: 0.095, gap: 0.022 }),
    });
  }

  toggleMenu(force) {
    const show = force ?? !this.menu.mesh.visible;
    this.menu.mesh.visible = show;
    if (show) {
      this.refreshMenu();
      const left = this.hands.left ?? this.hands.right;
      if (this.presenting && left) {
        left.grip.add(this.menu.mesh);
        this.menu.mesh.position.set(left === this.hands.left ? 0.06 : -0.06, 0.12, -0.08);
        this.menu.mesh.rotation.set(-0.9, 0, 0);
      } else {
        this.camera.add(this.menu.mesh);
        this.menu.mesh.position.set(0, -0.02, -0.55);
        this.menu.mesh.rotation.set(0, 0, 0);
      }
    }
  }

  menuButton(b) {
    const c = this.comfort;
    switch (b.id) {
      case "move":
        this.setComfort({ move: c.move === "smooth" ? "teleport" : "smooth" });
        break;
      case "turn":
        if (c.turn === "snap" && c.snapDeg === 30) this.setComfort({ snapDeg: 45 });
        else if (c.turn === "snap") this.setComfort({ turn: "smooth", snapDeg: 30 });
        else this.setComfort({ turn: "snap" });
        break;
      case "seated":
        this.setComfort({ seated: !c.seated });
        break;
      case "vignette":
        this.setComfort({ vignette: !c.vignette });
        break;
      case "slower":
        this.setComfort({ speed: Math.max(0.8, +(c.speed - 0.4).toFixed(1)) });
        break;
      case "faster":
        this.setComfort({ speed: Math.min(4, +(c.speed + 0.4).toFixed(1)) });
        break;
      case "recenter":
        this.recenter();
        break;
      case "exit":
        this.toggleMenu(false);
        this.exit();
        return;
      default:
        break;
    }
    this.onMenu(b.id);
    this.refreshMenu();
  }

  // ── VR toast (head-locked card, below the line of sight) ─
  buildToast() {
    this.toastPanel = new Panel({ width: 0.42, height: 0.14, ppm: 1500, opacity: 0.92 });
    this.toastPanel.mesh.visible = false;
    this.toastPanel.mesh.position.set(0, -0.2, -0.7);
    this.toastPanel.mesh.rotation.x = -0.25;
    this.camera.add(this.toastPanel.mesh);
    this.toastT = 0;
  }

  toast(title, text = "", { tag = null, seconds = 3.5 } = {}) {
    this.toastPanel.setContent({ title, lines: text ? [text] : [], titleSize: 62, lineSize: 40, tag });
    this.toastPanel.mesh.visible = true;
    this.toastT = seconds;
  }

  // ── Desktop preview: mouse-look + WASD, centre-screen pointer ──
  initDesktop() {
    this.keys = new Set();
    this.desktopHand = new THREE.Group();
    const glove = createGlove("right");
    glove.root.rotation.set(0.35, 0.25, 0);
    this.desktopHand.add(glove.root);
    this.desktopGlove = glove;
    this.desktopHand.position.set(0.16, -0.17, -0.34);
    this.camera.add(this.desktopHand);
    this.reticleDot = document.createElement("div");
    this.mouse = { down: false, clicked: false, grab: false, grabPressed: false };
    addEventListener("keydown", (e) => {
      if (e.target?.closest?.("input,textarea,select")) return;
      this.keys.add(e.code);
      if (e.code === "KeyE") this.mouse.grabPressed = true;
      if (e.code === "Tab" || e.code === "KeyM") {
        e.preventDefault();
        this.toggleMenu();
      }
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => this.keys.clear());
  }

  bindCanvas(canvas) {
    this.canvas = canvas;
    canvas.addEventListener("mousedown", (e) => {
      if (this.presenting || !this.desktopActive) return;
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock?.();
        return;
      }
      if (e.button === 0) this.mouse.clicked = true;
      if (e.button === 2) this.mouse.grabPressed = true;
    });
    canvas.addEventListener("contextmenu", (e) => this.desktopActive && e.preventDefault());
    addEventListener("mousemove", (e) => {
      if (this.presenting || document.pointerLockElement !== canvas) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0022));
    });
    // Touch fallback for the desktop preview on tablets: drag to look.
    let last = null;
    canvas.addEventListener("touchstart", (e) => this.desktopActive && (last = e.touches[0]), { passive: true });
    canvas.addEventListener("touchmove", (e) => {
      if (!this.desktopActive || !last) return;
      const t = e.touches[0];
      this.yaw -= (t.clientX - last.clientX) * 0.004;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - (t.clientY - last.clientY) * 0.004));
      last = t;
    }, { passive: true });
  }

  // ── Per-frame ────────────────────────────────────────────
  update(dt, adapter) {
    this.adapter = adapter;
    if (adapter?.scene) {
      this.attach(adapter.scene);
      if (this.arc.parent !== adapter.scene) adapter.scene.add(this.arc, this.reticle);
    }
    // Fade
    const f = this.fade;
    f.value += Math.sign(f.target - f.value) * Math.min(Math.abs(f.target - f.value), dt * f.speed);
    this.fadeMesh.material.opacity = f.value;
    this.fadeMesh.visible = f.value > 0.002;
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastPanel.mesh.visible = false;
    }
    const before = this.headWorld(tmpV2).clone();
    const yaw0 = this.yaw;
    if (this.presenting) this.updateVR(dt, adapter);
    else if (this.desktopActive) this.updateDesktop(dt, adapter);
    // Comfort vignette from the artificial motion only (not from real head movement).
    if (this.presenting && this.comfort.vignette && dt > 0) {
      const lin = this.artificial ? this.artificial / dt : 0;
      const ang = Math.abs(this.yaw - yaw0) / dt;
      this.vigK += (vignetteFor(lin, ang) - this.vigK) * Math.min(1, dt * 8);
    } else this.vigK *= 0.8;
    this.vigMat.uniforms.uK.value = this.vigK;
    this.vignette.visible = this.vigK > 0.01;
    this.artificial = 0;
    this.lastHeadPos = before;
  }

  updateVR(dt, adapter) {
    const c = this.comfort;
    for (const slot of Object.values(this.hands)) {
      slot.pad = readPad(slot.source?.gamepad, slot.pad);
      slot.glove?.pose(slot.pad, dt);
    }
    const L = this.hands.left;
    const R = this.hands.right ?? L;
    const moveHand = c.dominant === "right" ? L : R;
    const turnHand = c.dominant === "right" ? R : L;

    // Menu: B/Y or Triangle on the left controller; A/X/Cross recentres when held with the stick pressed.
    if (L?.pad.bPressed) this.toggleMenu();
    if (L?.pad.stickDownPressed) this.recenter();

    // Turning (right stick x)
    if (turnHand && !adapter?.lockTurn) {
      const sx = turnHand.pad.stick.x;
      if (c.turn === "snap") {
        const fl = flick(sx, turnHand.turnArmed);
        turnHand.turnArmed = fl.armed;
        if (fl.fire) this.turn((-fl.fire * c.snapDeg * Math.PI) / 180);
      } else if (Math.abs(sx) > 0.05) this.turn((-sx * c.turnSpeed * Math.PI * dt) / 180);
    }

    // Teleport (right stick forward to aim, release to go) — always available.
    if (turnHand && !adapter?.lockMove && adapter?.groundAt) this.updateTeleport(turnHand, adapter);
    else this.hideArc();

    // Smooth movement (left stick, head-relative)
    if (moveHand && c.move === "smooth" && !adapter?.lockMove) {
      const s = moveHand.pad.stick;
      if (s.m > 0) {
        const d = moveDelta(this.headYaw(), s.x, s.y, c.speed * (moveHand.pad.stickDown ? 1.8 : 1), dt);
        this.moveBy(d.dx, d.dz, adapter);
      }
    }
    if (!adapter?.lockMove) this.followGround(adapter);

    this.updatePointers(dt, adapter);
  }

  turn(delta) {
    const local = this.camera.position;
    const st = turnAboutHead({ x: this.rig.position.x, z: this.rig.position.z, yaw: this.yaw }, this.presenting ? local.x : 0, this.presenting ? local.z : 0, delta);
    this.yaw = st.yaw;
    this.rig.rotation.y = st.yaw;
    this.rig.position.x = st.x;
    this.rig.position.z = st.z;
  }

  moveBy(dx, dz, adapter) {
    const head = this.headWorld(tmpV);
    let nx = head.x + dx;
    let nz = head.z + dz;
    const cols = adapter?.colliders ?? [];
    if (cols.length) ({ x: nx, z: nz } = pushOut(nx, nz, 0.32, cols));
    const b = adapter?.bounds;
    if (b) {
      const d = Math.hypot(nx - b.x, nz - b.z);
      if (d > b.r) {
        nx = b.x + ((nx - b.x) / d) * b.r;
        nz = b.z + ((nz - b.z) / d) * b.r;
      }
    }
    if (adapter?.groundAt && adapter.groundAt(nx, nz) === null) return; // no floor there
    this.rig.position.x += nx - head.x;
    this.rig.position.z += nz - head.z;
    this.artificial = (this.artificial ?? 0) + Math.hypot(nx - head.x, nz - head.z);
  }

  followGround(adapter) {
    if (!adapter?.groundAt) return;
    const head = this.headWorld(tmpV);
    const g = adapter.groundAt(head.x, head.z);
    if (g === null || g === undefined) return;
    const target = g + (this.presenting ? this.floorOffset : 0);
    // Ease steps up/down slightly so uneven terrain never jolts the view.
    this.rig.position.y += (target - this.rig.position.y) * 0.35;
  }

  hideArc() {
    this.arc.visible = false;
    this.reticle.visible = false;
  }

  updateTeleport(slot, adapter) {
    const sy = slot.pad.stick.y;
    if (!slot.aiming && sy > 0.65 && Math.abs(slot.pad.stick.x) < 0.5) slot.aiming = true;
    if (!slot.aiming) return this.hideArc();
    slot.ray.getWorldPosition(tmpV);
    slot.ray.getWorldDirection(tmpV2).negate();
    const res = teleportArc(tmpV, tmpV2, adapter.groundAt);
    const ok = validTarget(res.hit, adapter.groundAt, adapter.colliders ?? [], { bounds: adapter.bounds });
    const pos = this.arcGeo.attributes.position;
    const n = Math.min(res.points.length, pos.count);
    for (let i = 0; i < pos.count; i++) {
      const p = res.points[Math.min(i, n - 1)];
      pos.setXYZ(i, p[0], p[1], p[2]);
    }
    pos.needsUpdate = true;
    this.arcGeo.setDrawRange(0, n);
    this.arcMat.color.set(ok ? 0x8fd8ff : 0xff6a4d);
    this.arc.visible = true;
    this.reticle.visible = !!res.hit;
    if (res.hit) {
      this.reticle.position.set(res.hit.x, res.hit.y + 0.02, res.hit.z);
      this.reticle.rotation.y = this.headYaw();
    }
    if (sy < 0.3) {
      slot.aiming = false;
      this.hideArc();
      if (ok) this.teleportTo(res.hit.x, res.hit.z);
      else this.sound?.tone?.(220, 0.08, "triangle", 0.04);
    }
  }

  async teleportTo(x, z) {
    this.sound?.tap?.();
    await this.fadeTo(1, 0.09);
    const head = this.headWorld(tmpV);
    this.rig.position.x += x - head.x;
    this.rig.position.z += z - head.z;
    const g = this.adapter?.groundAt?.(x, z);
    if (g !== null && g !== undefined) this.rig.position.y = g + (this.presenting ? this.floorOffset : 0);
    await this.fadeTo(0, 0.12);
  }

  /** Ray pointing, panel buttons, grabbing and poking — shared by both hands. */
  updatePointers(dt, adapter) {
    const its = (adapter?.interactables ?? []).filter((it) => !it.enabled || it.enabled());
    const menuIt = this.menu.mesh.visible ? [this.menu.mesh.userData.interact] : [];
    const targets = [...its, ...menuIt];
    const objs = targets.map((it) => {
      it.object.userData.interact = it;
      return it.object;
    });
    for (const slot of Object.values(this.hands)) {
      if (!slot.source) continue;
      const held = this.held[slot.hand];
      // Grab / release
      if (slot.pad.gripDownPressed && !held) this.tryGrab(slot, its);
      if (slot.pad.gripDownReleased && held) this.release(slot, adapter);
      // Poke (fingertip buttons)
      slot.pokeCool -= dt;
      if (slot.glove && slot.pokeCool <= 0) {
        const tip = slot.glove.tipWorld(tmpV);
        for (const it of its) {
          if (!it.poke) continue;
          it.object.getWorldPosition(tmpV2);
          if (tmpV2.distanceTo(tip) < (it.pokeRadius ?? 0.035)) {
            (it.onPoke ?? it.onSelect)?.(slot.hand, null);
            this.sound?.tap?.();
            slot.pokeCool = 0.45;
            this.pulse(slot, 0.6, 40);
            break;
          }
        }
      }
      // Ray
      slot.ray.getWorldPosition(tmpV);
      tmpQ.setFromRotationMatrix(tmpM.extractRotation(slot.ray.matrixWorld));
      tmpV2.set(0, 0, -1).applyQuaternion(tmpQ);
      this.raycaster.set(tmpV, tmpV2);
      const hit = objs.length ? this.raycaster.intersectObjects(objs, true)[0] : null;
      const it = hit ? findInteract(hit.object) : null;
      const aimingTeleport = slot.aiming;
      if (it && !aimingTeleport && !held) {
        slot.beam.visible = true;
        slot.beam.scale.z = hit.distance;
        slot.dot.visible = true;
        slot.dot.position.copy(hit.point);
        this.rig.worldToLocal(slot.dot.position);
        let btn = null;
        if (it.panel) {
          btn = it.panel.hit(hit.uv);
          it.panel.setHover(btn?.id ?? null);
        }
        if (slot.hover !== it) {
          slot.hover?.onHover?.(false);
          it.onHover?.(true);
          if (it.panel || it.onSelect) this.pulse(slot, 0.15, 12);
        }
        slot.hover = it;
        if (slot.pad.triggerDownPressed) {
          if (it.panel && btn) {
            it.onButton?.(btn);
            this.sound?.tap?.();
            this.pulse(slot, 0.5, 30);
          } else if (it.onSelect) {
            it.onSelect(slot.hand, hit);
            this.sound?.select?.();
            this.pulse(slot, 0.5, 30);
          }
        }
      } else {
        if (slot.hover) {
          slot.hover.onHover?.(false);
          slot.hover.panel?.setHover(null);
        }
        slot.hover = null;
        slot.beam.visible = !aimingTeleport && !held && slot.pad.trigger > 0.05;
        slot.beam.scale.z = 3;
        slot.dot.visible = false;
      }
    }
  }

  tryGrab(slot, its) {
    const g = slot.grip.getWorldPosition(tmpV);
    let best = null;
    let bestD = Infinity;
    for (const it of its) {
      if (!it.grab) continue;
      it.object.getWorldPosition(tmpV2);
      const d = tmpV2.distanceTo(g);
      if (d < (it.grabRadius ?? 0.16) && d < bestD) {
        best = it;
        bestD = d;
      }
    }
    if (!best) return;
    best.homeParent = best.object.parent;
    slot.grip.attach(best.object);
    this.held[slot.hand] = best;
    best.onGrab?.(slot.hand);
    this.pulse(slot, 0.7, 50);
    this.sound?.tap?.();
  }

  release(slot, adapter) {
    const it = this.held[slot.hand];
    delete this.held[slot.hand];
    (adapter?.scene ?? it.homeParent).attach(it.object);
    it.onRelease?.(slot.hand);
  }

  pulse(slot, intensity, ms) {
    const act = slot.source?.gamepad?.hapticActuators?.[0];
    act?.pulse?.(intensity, ms)?.catch?.(() => {});
  }

  updateDesktop(dt, adapter) {
    // Look
    this.rig.rotation.y = this.yaw;
    this.camera.rotation.set(this.pitch, 0, 0, "YXZ");
    this.camera.position.set(0, adapter?.eye ?? EYE, 0);
    this.desktopGlove.pose({ trigger: this.mouse.down ? 1 : 0.1, grip: this.held.right ? 1 : 0.25 }, dt);
    // Move
    if (!adapter?.lockMove) {
      let fx = 0;
      let fz = 0;
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) fz += 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) fz -= 1;
      if (this.keys.has("KeyD")) fx += 1;
      if (this.keys.has("KeyA")) fx -= 1;
      if (this.keys.has("ArrowLeft")) this.yaw += dt * 1.6;
      if (this.keys.has("ArrowRight")) this.yaw -= dt * 1.6;
      if (fx || fz) {
        const run = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 2.4 : 1;
        const d = moveDelta(this.yaw, fx, fz, this.comfort.speed * 1.6 * run, dt);
        this.moveBy(d.dx, d.dz, adapter);
      }
      this.followGround(adapter);
    }
    // Centre-screen pointer
    const its = (adapter?.interactables ?? []).filter((it) => !it.enabled || it.enabled());
    const targets = this.menu.mesh.visible ? [...its, this.menu.mesh.userData.interact] : its;
    const objs = targets.map((it) => {
      it.object.userData.interact = it;
      return it.object;
    });
    this.camera.getWorldPosition(tmpV);
    this.camera.getWorldDirection(tmpV2);
    this.raycaster.set(tmpV, tmpV2);
    const hit = objs.length ? this.raycaster.intersectObjects(objs, true)[0] : null;
    const it = hit ? findInteract(hit.object) : null;
    let btn = null;
    if (it?.panel) {
      btn = it.panel.hit(hit.uv);
      it.panel.setHover(btn?.id ?? null);
    }
    if (this.desktopHover && this.desktopHover !== it) {
      this.desktopHover.onHover?.(false);
      this.desktopHover.panel?.setHover(null);
    }
    if (it && this.desktopHover !== it) it.onHover?.(true);
    this.desktopHover = it;
    this.onPointerHover?.(it, hit);
    if (this.mouse.clicked) {
      if (it?.panel && btn) {
        it.onButton?.(btn);
        this.sound?.tap?.();
      } else if (it?.onSelect) {
        it.onSelect("right", hit);
        this.sound?.select?.();
      } else if (it?.poke) {
        (it.onPoke ?? it.onSelect)?.("right", hit);
        this.sound?.tap?.();
      }
    }
    if (this.mouse.grabPressed) {
      const held = this.held.right;
      if (held) {
        delete this.held.right;
        (adapter?.scene ?? held.homeParent).attach(held.object);
        held.onRelease?.("right");
      } else if (it?.grab && hit.distance < 3) {
        it.homeParent = it.object.parent;
        this.desktopHand.attach(it.object);
        it.object.position.set(-0.02, 0.06, -0.12);
        this.held.right = it;
        it.onGrab?.("right");
        this.sound?.tap?.();
      }
    }
    this.mouse.clicked = false;
    this.mouse.grabPressed = false;
  }
}

function findInteract(o) {
  while (o) {
    if (o.userData?.interact) return o.userData.interact;
    o = o.parent;
  }
  return null;
}
