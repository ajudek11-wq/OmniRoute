import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { surface } from "../../../scene/surfaces.js";
import { moonify } from "./shade.js";

/**
 * Small toolkit for hardware: Moon-lit materials (no dust layer — that one is Martian) and a static
 * geometry batcher that merges everything sharing a material into one draw call.
 */
export function hw(opts, { indoor = false, env = null, envI = 0.4 } = {}) {
  const { kind = "panel", ...rest } = opts;
  const m = surface({ kind, dustTop: 0, dustBase: 0, grime: 0.18, scale: 0.6, roughness: 0.6, metalness: 0.1, ...rest });
  if (env) {
    m.envMap = env;
    m.envMapIntensity = envI;
  }
  return moonify(m, { indoor, key: `hw-${kind}` });
}

export function plain(params, { indoor = false, env = null, envI = 0.4 } = {}) {
  const m = new THREE.MeshStandardMaterial(params);
  if (env) {
    m.envMap = env;
    m.envMapIntensity = envI;
  }
  return moonify(m, { indoor, key: "plain" });
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

export class Batch {
  constructor() {
    this.parts = new Map();
  }
  /** Add `geo` transformed by position/rotation(euler)/scale or a matrix, under material `mat`. */
  add(mat, geo, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], m = null } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    if (m) g.applyMatrix4(m);
    else {
      tmpE.set(r[0], r[1], r[2]);
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpP.set(p[0], p[1], p[2]), tmpQ, tmpS.set(s[0], s[1], s[2]));
      g.applyMatrix4(tmpM);
    }
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return g;
  }
  /** Merge into one mesh per material, added to `parent`. */
  build(parent, { cast = true, receive = true } = {}) {
    const out = [];
    for (const [mat, list] of this.parts) {
      const g = mergeGeometries(list, false);
      for (const x of list) x.dispose();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}
