import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { surface } from "../../../scene/surfaces.js";

/**
 * Building kit for Meridian Station: shared materials, a static-geometry merger (one draw call per
 * material per zone), canvas signage and small geometry helpers. Units are metres.
 */

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);

export function mat4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

/**
 * Masks the directional (Sun) light on a material with a shared uniform: closed rooms get 0, the
 * observation lounge gets the share of sunlight its windows let in. Three has no per-light masks.
 */
export function maskSun(mat, uniform) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, r) => {
    prev.call(mat, shader, r);
    shader.uniforms.uDirK = uniform;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float uDirK;\nvoid main() {")
      .replace(
        "#include <lights_fragment_begin>",
        THREE.ShaderChunk.lights_fragment_begin.replace(
          "getDirectionalLightInfo( directionalLight, directLight );",
          "getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= uDirK;"
        )
      );
  };
  mat.customProgramCacheKey = () => `${prevKey}|dirk`;
  return mat;
}

function surf(o) {
  const m = surface({ dustTop: 0, dustBase: 0, grime: 0.04, ...o });
  const t = m.userData.surface?.uSurfTex?.value;
  if (t) t.userData.shared = true; // module-level cache in surfaces.js: never dispose
  return m;
}

/** A generic console UI (shared by all desk screens). */
function deskTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 146;
  const g = c.getContext("2d");
  g.fillStyle = "#06101a";
  g.fillRect(0, 0, 512, 146);
  g.strokeStyle = "rgba(143,216,255,0.35)";
  for (let x = 0; x < 512; x += 32) g.strokeRect(x + 4, 6, 1, 134);
  g.lineWidth = 2;
  for (const [col, ph, a] of [
    ["#8fd8ff", 0, 30],
    ["#7fe0a8", 1.7, 18],
    ["#ffd27f", 3.1, 12],
  ]) {
    g.strokeStyle = col;
    g.beginPath();
    for (let x = 0; x < 300; x += 4) g.lineTo(10 + x, 80 + Math.sin(x * 0.04 + ph) * a + Math.sin(x * 0.17 + ph) * 4);
    g.stroke();
  }
  g.fillStyle = "#e8edf2";
  g.font = "600 18px system-ui, sans-serif";
  ["CABIN 101.2 kPa", "O2 21.0 %", "CO2 0.3 kPa", "T 22.4 °C"].forEach((t, i) => g.fillText(t, 330, 30 + i * 32));
  g.fillStyle = "#30ff70";
  for (let i = 0; i < 8; i++) g.fillRect(330 + i * 20, 132, 12, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Materials. `closed` / `lounge` are the Sun-mask uniforms for interior zones. */
export function makeMaterials() {
  const closed = { value: 0 };
  const lounge = { value: 1 };
  const interior = (o, u = closed) => maskSun(surf(o), u);
  const glow = (hex, k = 1.6) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(hex), emissiveIntensity: k, roughness: 0.6 });
  const M = {
    closedSun: closed,
    loungeSun: lounge,
    // Interior (sun masked)
    wall: interior({ kind: "panel", color: "#dfe2e5", roughness: 0.5, metalness: 0.02, scale: 0.35, bump: 0.12 }),
    wallL: interior({ kind: "panel", color: "#dfe2e5", roughness: 0.5, metalness: 0.02, scale: 0.35, bump: 0.12 }, lounge),
    floor: interior({ kind: "rubber", color: "#4a5058", roughness: 0.8, scale: 1.2, bump: 0.25 }),
    floorL: interior({ kind: "rubber", color: "#4a5058", roughness: 0.8, scale: 1.2, bump: 0.25 }, lounge),
    trim: interior({ kind: "brushed", color: "#c4c8cd", roughness: 0.32, metalness: 0.85, scale: 2, bump: 0.05 }),
    trimL: interior({ kind: "brushed", color: "#c4c8cd", roughness: 0.32, metalness: 0.85, scale: 2, bump: 0.05 }, lounge),
    dark: interior({ kind: "panel", color: "#30353c", roughness: 0.5, metalness: 0.3, scale: 0.8, bump: 0.1 }),
    darkL: interior({ kind: "panel", color: "#30353c", roughness: 0.5, metalness: 0.3, scale: 0.8, bump: 0.1 }, lounge),
    accent: interior({ kind: "panel", color: "#2f6aa8", roughness: 0.45, metalness: 0.1, scale: 0.8, bump: 0.1 }),
    accentL: interior({ kind: "panel", color: "#2f6aa8", roughness: 0.45, metalness: 0.1, scale: 0.8, bump: 0.1 }, lounge),
    rail: interior({ kind: "brushed", color: "#9fb4c8", roughness: 0.28, metalness: 0.9, scale: 3, bump: 0.03 }),
    railL: interior({ kind: "brushed", color: "#9fb4c8", roughness: 0.28, metalness: 0.9, scale: 3, bump: 0.03 }, lounge),
    white: interior({ kind: "panel", color: "#eef0f1", roughness: 0.4, metalness: 0.05, scale: 0.8, bump: 0.08 }),
    whiteL: interior({ kind: "panel", color: "#eef0f1", roughness: 0.4, metalness: 0.05, scale: 0.8, bump: 0.08 }, lounge),
    fabric: interior({ kind: "rubber", color: "#56606e", roughness: 0.95, scale: 3, bump: 0.3 }),
    fabricL: interior({ kind: "rubber", color: "#3f5a78", roughness: 0.95, scale: 3, bump: 0.3 }, lounge),
    yellow: interior({ kind: "panel", color: "#d8b340", roughness: 0.5, metalness: 0.05, scale: 1, bump: 0.05 }),
    copper: interior({ kind: "brushed", color: "#b87a4b", roughness: 0.35, metalness: 0.9, scale: 2, bump: 0.05 }),
    pipe: interior({ kind: "brushed", color: "#8d959e", roughness: 0.4, metalness: 0.8, scale: 2, bump: 0.05 }),
    green: interior({ kind: "panel", color: "#3f8a4a", roughness: 0.7, metalness: 0, scale: 1, bump: 0.2 }),
    leaf: maskSun(new THREE.MeshStandardMaterial({ color: "#4f9a3c", roughness: 0.75, side: THREE.DoubleSide }), closed),
    leafRed: maskSun(new THREE.MeshStandardMaterial({ color: "#8a2f3c", roughness: 0.7, side: THREE.DoubleSide }), closed),
    soil: maskSun(new THREE.MeshStandardMaterial({ color: "#3b2f27", roughness: 1 }), closed),
    screen: new THREE.MeshStandardMaterial({ color: "#05080c", roughness: 0.2, metalness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: "#a8c8e0", roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.1, depthWrite: false, envMapIntensity: 1.2 }),
    glassTint: new THREE.MeshStandardMaterial({ color: "#7fb0d0", roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.22, depthWrite: false }),
    lightPanel: glow("#f2f6ff", 1.5),
    lightWarm: glow("#ffe9cc", 1.3),
    strip: glow("#8fd8ff", 1.4),
    stripAmber: glow("#ffb347", 1.2),
    ledGrow: glow("#ff6fe0", 1.3),
    texDesk: new THREE.MeshBasicMaterial({ map: deskTexture(), toneMapped: false }),
    ledRed: glow("#ff3030", 2),
    ledGreen: glow("#30ff70", 2),
    ledWhite: glow("#ffffff", 3),
    // Exterior (sunlit, not masked)
    hull: surf({ kind: "panel", color: "#e7e7e2", roughness: 0.55, metalness: 0.05, scale: 0.15, bump: 0.2, envMapIntensity: 0.25 }),
    mli: surf({ kind: "mli", color: "#e9e6dc", roughness: 0.7, metalness: 0, scale: 0.25, bump: 0.5, envMapIntensity: 0.2 }),
    foil: surf({ kind: "foil", color: "#c9a44a", roughness: 0.35, metalness: 0.9, scale: 0.3, bump: 0.5, envMapIntensity: 0.3 }),
    truss: surf({ kind: "brushed", color: "#a7adb4", roughness: 0.4, metalness: 0.8, scale: 0.6, bump: 0.05, envMapIntensity: 0.3 }),
    solar: surf({ kind: "solar", color: "#24304c", roughness: 0.25, metalness: 0.5, scale: 0.12, bump: 0.05, envMapIntensity: 0.6 }),
    radiator: surf({ kind: "panel", color: "#f4f4f0", roughness: 0.5, metalness: 0.02, scale: 0.2, bump: 0.1, envMapIntensity: 0.2 }),
    extDark: surf({ kind: "panel", color: "#3a3f46", roughness: 0.5, metalness: 0.4, scale: 0.3, bump: 0.1, envMapIntensity: 0.2 }),
    extGlass: new THREE.MeshStandardMaterial({ color: "#0b1622", roughness: 0.08, metalness: 0.6, envMapIntensity: 0.6, emissive: new THREE.Color("#ffd9a0"), emissiveIntensity: 0.15 }),
  };
  return M;
}

/** Collects static geometry per material key and merges it into one mesh per key. */
export class Merger {
  constructor() {
    this.parts = new Map();
    this.stack = [new THREE.Matrix4()];
  }
  get top() {
    return this.stack[this.stack.length - 1];
  }
  push(m) {
    this.stack.push(this.top.clone().multiply(m));
    return this;
  }
  pop() {
    this.stack.pop();
    return this;
  }
  /** Add a geometry under the current transform × local transform. */
  add(key, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this.addM(key, geo, mat4(x, y, z, rx, ry, rz));
  }
  addM(key, geo, m) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    const keepUV = key.startsWith("tex");
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && !(keepUV && k === "uv")) g.deleteAttribute(k);
    g.applyMatrix4(this.top.clone().multiply(m));
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    geo.dispose();
    return this;
  }
  /** Box by size centred at (x,y,z). */
  box(key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
    return this.add(key, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
  }
  /** Box by min/max corners (axis aligned in the current frame). */
  span(key, x0, y0, z0, x1, y1, z1) {
    return this.box(key, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }
  /** Cylinder between two points. */
  tube(key, a, b, r, seg = 10) {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    const m = new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.addM(key, g, m);
  }
  build(materials, parent, name = "merged") {
    const out = [];
    for (const [key, list] of this.parts) {
      const geo = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!geo) continue;
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, materials[key]);
      mesh.name = `${name}:${key}`;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

/** A flat sign (canvas texture), double-sided off by default. Width in metres. */
export function sign(lines, { w = 1.2, h = null, bg = "#1b2a3a", fg = "#f2f4f6", accent = "#8fd8ff", size = 64, align = "left", border = true } = {}) {
  const L = Array.isArray(lines) ? lines : [lines];
  const c = document.createElement("canvas");
  const ppm = 360;
  c.width = Math.round(w * ppm);
  const hh = h ?? (L.length * size * 1.35 + size * 0.8) / ppm;
  c.height = Math.round(hh * ppm);
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  if (border) {
    g.fillStyle = accent;
    g.fillRect(0, 0, Math.max(10, c.width * 0.012), c.height);
  }
  let y = size * 1.1;
  L.forEach((t, i) => {
    const big = i === 0;
    g.font = `${big ? 700 : 500} ${Math.round(big ? size : size * 0.62)}px system-ui, sans-serif`;
    g.fillStyle = big ? fg : accent;
    g.textAlign = align;
    g.fillText(t, align === "center" ? c.width / 2 : size * 0.6, y);
    y += big ? size * 1.15 : size * 0.85;
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  m.material.color.setScalar(0.85);
  return m;
}

/** A canvas-backed screen that a draw callback repaints. */
export function screen(w, h, ppm = 300) {
  const c = document.createElement("canvas");
  c.width = Math.round(w * ppm);
  c.height = Math.round(h * ppm);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  return { mesh, canvas: c, g: c.getContext("2d"), tex, W: c.width, H: c.height };
}

/** Invisible pick volume. */
export function pick(w, h, d) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
}
