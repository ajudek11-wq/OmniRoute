import * as THREE from "three";

/**
 * Procedural EVA gloves attached to the WebXR grip space.
 * Grip space (WebXR): origin at the centre of the closed fist, −Z along the fist (the way a held
 * flashlight would point), +Y roughly up the back of the thumb. The right glove is built here; the left
 * one is mirrored on X. Fingers curl with the analog trigger (index) and grip (other three); the thumb
 * lowers when a face button is touched. Every finger is a chain of capsule segments so the curl reads well.
 */

const FINGERS = [
  // knuckle position, open direction, palm-side direction, segment lengths, radius, which input curls it
  { name: "index", at: [-0.012, 0.028, -0.045], dir: [-0.15, 0.15, -1], palm: [0, -1, 0.1], seg: [0.042, 0.026, 0.022], r: 0.0095, by: "trigger", rest: 0.15 },
  { name: "middle", at: [-0.006, 0.02, -0.02], dir: [-0.85, -0.55, -0.15], palm: [0.55, -0.85, 0], seg: [0.046, 0.029, 0.023], r: 0.0098, by: "grip", rest: 0.35 },
  { name: "ring", at: [-0.004, 0.012, 0.002], dir: [-0.85, -0.55, -0.05], palm: [0.55, -0.85, 0], seg: [0.043, 0.027, 0.021], r: 0.0094, by: "grip", rest: 0.4 },
  { name: "pinky", at: [-0.002, 0.004, 0.022], dir: [-0.85, -0.55, 0.08], palm: [0.55, -0.85, 0], seg: [0.034, 0.021, 0.018], r: 0.0085, by: "grip", rest: 0.45 },
  { name: "thumb", at: [-0.026, 0.03, 0.01], dir: [-0.35, 0.45, -0.85], palm: [0.6, -0.6, 0.2], seg: [0.036, 0.028, 0.024], r: 0.0108, by: "thumb", rest: 0.1 },
];

const MAX_CURL = [1.35, 1.6, 1.1];

function frameFrom(dir, palm) {
  const y = new THREE.Vector3(...dir).normalize();
  const z = new THREE.Vector3(...palm);
  z.addScaledVector(y, -z.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export function createGlove(handedness, materials = {}) {
  const left = handedness === "left";
  const root = new THREE.Group();
  root.name = `glove-${handedness}`;
  const body = new THREE.Group();
  root.add(body);
  if (left) body.scale.x = -1;

  const fabric = materials.fabric ?? new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.82, metalness: 0 });
  const rubber = materials.rubber ?? new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.6, metalness: 0.05 });
  const accent = materials.accent ?? new THREE.MeshStandardMaterial({ color: 0xd9662a, roughness: 0.55, metalness: 0.1 });
  const ring = materials.ring ?? new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.35, metalness: 0.85 });
  if (left) for (const m of [fabric, rubber, accent, ring]) m.side = THREE.DoubleSide;

  // Palm + back of hand: a rounded block around the fist centre, offset to the back (+X).
  const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.05, 4, 10), fabric);
  palm.rotation.x = Math.PI / 2;
  palm.scale.set(1.05, 1, 0.72);
  palm.position.set(0.012, 0.012, 0.0);
  body.add(palm);
  const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.022, 0.078), rubber);
  knuckle.position.set(0.034, 0.024, -0.008);
  knuckle.rotation.z = -0.35;
  body.add(knuckle);
  // Wrist bearing and cuff (suit glove disconnect), angled back toward the forearm.
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.042, 0.06, 18, 1, true), fabric);
  cuff.position.set(0.016, -0.004, 0.072);
  cuff.rotation.x = Math.PI / 2 - 0.25;
  body.add(cuff);
  const bearing = new THREE.Mesh(new THREE.TorusGeometry(0.041, 0.006, 8, 22), ring);
  bearing.position.set(0.016, 0.0, 0.045);
  bearing.rotation.x = -0.25;
  body.add(bearing);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.003, 6, 22), accent);
  stripe.position.set(0.016, -0.008, 0.088);
  stripe.rotation.x = -0.25;
  body.add(stripe);

  const fingers = {};
  for (const f of FINGERS) {
    const base = new THREE.Group();
    base.position.set(...f.at);
    base.quaternion.copy(frameFrom(f.dir, f.palm));
    body.add(base);
    const joints = [];
    let parent = base;
    f.seg.forEach((L, i) => {
      const joint = new THREE.Group();
      if (i > 0) joint.position.y = f.seg[i - 1];
      parent.add(joint);
      const r = f.r * (1 - i * 0.1);
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, L - r * 2), 3, 8), i === f.seg.length - 1 ? rubber : fabric);
      seg.position.y = L / 2;
      joint.add(seg);
      joints.push(joint);
      parent = joint;
    });
    // Fingertip marker (used for poke interactions).
    const tip = new THREE.Object3D();
    tip.position.y = f.seg[f.seg.length - 1];
    parent.add(tip);
    fingers[f.name] = { joints, tip, cfg: f, curl: f.rest };
  }

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });

  const state = { trigger: 0, grip: 0, thumb: 0 };
  return {
    root,
    fingers,
    /** Index fingertip in world space (for pressing buttons). */
    tipWorld(target = new THREE.Vector3()) {
      return fingers.index.tip.getWorldPosition(target);
    },
    /** Smoothly pose the glove from the controller's analog inputs. */
    pose(pad, dt = 1 / 72) {
      const k = 1 - Math.exp(-dt * 22);
      state.trigger += ((pad?.trigger ?? 0) - state.trigger) * k;
      state.grip += ((pad?.grip ?? 0) - state.grip) * k;
      state.thumb += ((pad?.touchA ? 1 : 0) - state.thumb) * k;
      for (const f of Object.values(fingers)) {
        const v = f.cfg.by === "trigger" ? state.trigger : f.cfg.by === "grip" ? state.grip : state.thumb * 0.7 + state.grip * 0.3;
        const c = f.cfg.rest + (1 - f.cfg.rest) * v;
        f.joints.forEach((j, i) => (j.rotation.x = c * MAX_CURL[i] * (f.cfg.name === "thumb" ? 0.55 : 1)));
      }
    },
  };
}
