import * as THREE from "three";
import { createNoise2D, mulberry32 } from "../../scene/noise.js";

/**
 * Scenery building blocks shared by the departure, cruise and arrival legs:
 * scaled-space placement for celestial bodies, monotone path tracks, terrain discs,
 * a gradient sky dome, particle sheets, glows, markers and procedural textures.
 */

/** Celestial bodies farther than LIM are drawn at LIM, shrunk to keep their true angular size. */
export const LIM = 6.0e4;

export const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
/** 0 → 1 as x goes a → b (smoothstep window). */
export const ramp = (x, a, b) => smooth((x - a) / (b - a));
/** Trapezoid window: rises over [a,b], falls over [c,d]. */
export const win = (x, a, b, c, d) => Math.min(ramp(x, a, b), 1 - ramp(x, c, d));

const tmpV = new THREE.Vector3();

/** Place a body (true position/radius in metres, frame coords) in scaled space around the ship. */
export function placeScaled(obj, pos, radius, ship, base = 1000) {
  tmpV.set(pos.x - ship.pos.x, pos.y - ship.pos.y, pos.z - ship.pos.z).applyQuaternion(ship.qInv);
  const d = tmpV.length();
  const k = d > LIM ? LIM / d : 1;
  obj.position.copy(tmpV).multiplyScalar(k);
  obj.scale.setScalar((radius / base) * k);
  return d;
}

/**
 * A path through keyframes { s, p:[x,y,z], yaw, pitch, roll } (degrees), interpolated with
 * monotone cubic (no overshoot, so altitudes never dip below the pad).
 */
export function track(keys) {
  const S = keys.map((k) => k.s);
  const comps = [0, 1, 2].map((i) => keys.map((k) => k.p[i]));
  const angs = ["yaw", "pitch", "roll"].map((n) => keys.map((k) => k[n] ?? 0));
  const slopes = (Y) => {
    const n = S.length;
    const d = [];
    for (let i = 0; i < n - 1; i++) d.push((Y[i + 1] - Y[i]) / (S[i + 1] - S[i]));
    const m = new Array(n);
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]) * 1;
    // final keys come to rest
    m[n - 1] = 0;
    return m;
  };
  const M = comps.map(slopes);
  const MA = angs.map(slopes);
  const ev = (Y, m, s) => {
    let i = 0;
    while (i < S.length - 2 && s > S[i + 1]) i++;
    const h = S[i + 1] - S[i];
    const t = clamp((s - S[i]) / h, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * Y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * Y[i + 1] + (t3 - t2) * h * m[i + 1];
  };
  const e = new THREE.Euler(0, 0, 0, "YXZ");
  const D = Math.PI / 180;
  return {
    pos(s, out = new THREE.Vector3()) {
      s = clamp(s, S[0], S[S.length - 1]);
      return out.set(ev(comps[0], M[0], s), ev(comps[1], M[1], s), ev(comps[2], M[2], s));
    },
    quat(s, out = new THREE.Quaternion()) {
      s = clamp(s, S[0], S[S.length - 1]);
      e.set(ev(angs[1], MA[1], s) * D, ev(angs[0], MA[0], s) * D, ev(angs[2], MA[2], s) * D, "YXZ");
      return out.setFromEuler(e);
    },
  };
}

/** Canvas texture helper. */
export function canvasTex(w, h, draw, { color = true, repeat = false } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function glowTexture(stops = [[0, "rgba(255,255,255,1)"], [0.3, "rgba(255,255,255,0.45)"], [1, "rgba(255,255,255,0)"]]) {
  return canvasTex(128, 128, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    for (const [o, s] of stops) grd.addColorStop(o, s);
    g.fillStyle = grd;
    g.fillRect(0, 0, w, w);
  });
}

/** Photographic regolith detail (CC0, already in /public/textures), shared and cached. */
let detailTex = null;
export function regolithDetail() {
  if (detailTex) return detailTex;
  detailTex = new THREE.TextureLoader().load("./textures/regolith_detail_1024.jpg");
  detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
  detailTex.colorSpace = THREE.SRGBColorSpace;
  detailTex.anisotropy = 8;
  detailTex.userData.shared = true;
  return detailTex;
}

/**
 * A large terrain disc in a polar grid with rings spaced exponentially (dense under the ship,
 * kilometres apart near the horizon). Vertices drop with the planet's curvature.
 * height(x,z) and color(x,z,h,out) are callbacks; returns a Mesh.
 */
export function terrain({ radius = 1.2e5, planetR = 3.4e6, rings = 150, segs = 220, inner = 3, height, color, material }) {
  const k = Math.log(radius / inner) / rings;
  const pos = [];
  const col = [];
  const uv = [];
  const c = new THREE.Color();
  // centre vertex
  const pushV = (x, z) => {
    const h = height(x, z);
    const r2 = x * x + z * z;
    pos.push(x, h - r2 / (2 * planetR), z);
    color(x, z, h, c);
    col.push(c.r, c.g, c.b);
    uv.push(x / 9, z / 9);
  };
  pushV(0, 0);
  for (let i = 0; i < rings; i++) {
    const r = inner * Math.exp(k * i) - inner + inner * 0.6 * (i + 1) / rings + (i === 0 ? 0.8 : 0);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2 + (i % 2) * (Math.PI / segs);
      pushV(Math.cos(a) * r, Math.sin(a) * r);
    }
  }
  const idx = [];
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * segs;
    const b0 = 1 + (i + 1) * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      if (i % 2 === 0) {
        idx.push(a0 + j, a0 + j1, b0 + j);
        idx.push(a0 + j1, b0 + j1, b0 + j);
      } else {
        idx.push(a0 + j, b0 + j1, b0 + j);
        idx.push(a0 + j, a0 + j1, b0 + j1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  return mesh;
}

/** Standard terrain material: vertex colours × photographic detail, fades detail with distance. */
export function terrainMaterial({ roughness = 0.95, detail = 0.55, tint = 0xffffff } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, color: tint });
  const map = regolithDetail();
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: map };
    sh.uniforms.uDetailK = { value: detail };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vTerrW;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvTerrW = (modelMatrix * vec4(transformed,1.0)).xyz; vTerrW = transformed;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uDetail; uniform float uDetailK; varying vec3 vTerrW;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float dd = length(vViewPosition);
        vec3 d1 = texture2D(uDetail, vTerrW.xz / 7.0).rgb;
        vec3 d2 = texture2D(uDetail, vTerrW.xz / 61.0).rgb;
        vec3 d3 = texture2D(uDetail, vTerrW.xz / 530.0).rgb;
        float f1 = 1.0 - smoothstep(30.0, 220.0, dd);
        float f2 = 1.0 - smoothstep(300.0, 2500.0, dd);
        float lum = mix(1.0, dot(d1, vec3(0.333)) * 2.1, f1 * uDetailK);
        lum *= mix(1.0, dot(d2, vec3(0.333)) * 2.1, f2 * uDetailK * 0.8);
        lum *= mix(1.0, dot(d3, vec3(0.333)) * 2.1, uDetailK * 0.6);
        diffuseColor.rgb *= clamp(lum, 0.35, 1.8);`
      );
  };
  mat.customProgramCacheKey = () => "pf-terrain";
  return mat;
}

/** Crater field as a height function: bowl + raised rim, sizes following a power law. */
export function craterField(seed, { count = 260, area = 9000, rMin = 8, rMax = 900, clearR = 120 } = {}) {
  const rand = mulberry32(seed);
  const craters = [];
  for (let i = 0; i < count; i++) {
    const r = rMin * Math.pow(rMax / rMin, Math.pow(rand(), 2.6));
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * area;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (Math.hypot(x, z) < clearR + r) continue;
    craters.push({ x, z, r, depth: r * (0.14 + rand() * 0.08) });
  }
  return (x, z) => {
    let h = 0;
    for (const c of craters) {
      const dx = x - c.x;
      const dz = z - c.z;
      const q = (dx * dx + dz * dz) / (c.r * c.r);
      if (q > 2.6) continue;
      const d = Math.sqrt(q);
      if (d < 1) h += c.depth * (d * d - 1) + c.depth * 0.22;
      else h += c.depth * 0.22 * Math.exp(-((d - 1) * (d - 1)) * 9);
    }
    return h;
  };
}

export function fbm(seed) {
  const n = createNoise2D(seed);
  return (x, z, oct = 5, f = 1) => {
    let a = 1;
    let s = 0;
    let t = 0;
    for (let i = 0; i < oct; i++) {
      s += n(x * f, z * f) * a;
      t += a;
      a *= 0.5;
      f *= 2.03;
    }
    return s / t;
  };
}

/** Gradient sky dome: zenith/horizon colours, a sun glow, opacity for fading in/out of an atmosphere. */
export function skyDome(radius = 4.0e4) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color("#c98a70") },
      uHor: { value: new THREE.Color("#e3a68c") },
      uSunCol: { value: new THREE.Color("#fff2dc") },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uA: { value: 1 },
      uBelow: { value: new THREE.Color("#7a4a33") },
    },
    vertexShader: "varying vec3 vD; void main(){ vD = normalize((modelMatrix * vec4(position,0.0)).xyz); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform vec3 uTop, uHor, uSunCol, uSun, uUp, uBelow; uniform float uA; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float e = dot(d, uUp);
        vec3 c = mix(uHor, uTop, pow(clamp(e,0.0,1.0), 0.55));
        c = mix(c, uBelow, smoothstep(0.0, -0.25, e));
        float s = max(dot(d, uSun), 0.0);
        c += uSunCol * (pow(s, 8.0) * 0.35 + pow(s, 200.0) * 1.2);
        gl_FragColor = vec4(c, uA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  mesh.renderOrder = -5;
  mesh.frustumCulled = false;
  return { mesh, u: mat.uniforms };
}

/**
 * A pool of soft particles (dust, ice, cloud wisps). Each particle has position, velocity, age.
 * `step(dt, fn)` lets the caller integrate; drawn as round sprites with per-particle alpha/size.
 */
export function particles(n, { color = "#b07850", size = 1, additive = false, lit = 1 } = {}) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const a = new Float32Array(n);
  const sz = new Float32Array(n);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("alpha", new THREE.BufferAttribute(a, 1));
  g.setAttribute("size", new THREE.BufferAttribute(sz, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uPx: { value: 600 }, uLit: { value: lit } },
    vertexShader: `attribute float alpha; attribute float size; varying float vA; uniform float uPx;
      void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * uPx / max(0.5, -mv.z), 1.0, 256.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uLit; varying float vA;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; float k = smoothstep(0.25, 0.0, r);
        gl_FragColor = vec4(uColor * uLit, vA * k);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  const st = { vel: new Float32Array(n * 3), age: new Float32Array(n).fill(1e9), life: new Float32Array(n), base: new Float32Array(n) };
  let next = 0;
  return {
    points: pts,
    mat,
    st,
    emit(x, y, z, vx, vy, vz, life, size0) {
      const i = next;
      next = (next + 1) % n;
      pos.set([x, y, z], i * 3);
      st.vel.set([vx, vy, vz], i * 3);
      st.age[i] = 0;
      st.life[i] = life;
      st.base[i] = size0;
      return i;
    },
    /** fn(i, t01, dt, pos, vel) integrates particle i; returns [alpha, size]. */
    step(dt, fn) {
      for (let i = 0; i < n; i++) {
        if (st.age[i] >= st.life[i]) {
          a[i] = 0;
          continue;
        }
        st.age[i] += dt;
        const t = st.age[i] / st.life[i];
        const r = fn(i, t, dt, pos, st.vel);
        a[i] = r[0];
        sz[i] = r[1];
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.alpha.needsUpdate = true;
      g.attributes.size.needsUpdate = true;
    },
    clear() {
      st.age.fill(1e9);
      a.fill(0);
    },
  };
}

/** Additive glow sprite. */
export function glowSprite(color = "#ffb070", size = 1, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
  s.scale.setScalar(size);
  return s;
}

/** Procedural equirect textures for bodies without imagery. */
export function europaTexture() {
  return canvasTex(1024, 512, (g, w, h) => {
    const n = createNoise2D(41);
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = n(x / 70, y / 70) * 0.5 + n(x / 18, y / 18) * 0.25;
        const i = (y * w + x) * 4;
        img.data[i] = 214 + v * 30;
        img.data[i + 1] = 206 + v * 28;
        img.data[i + 2] = 196 + v * 22;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    const rand = mulberry32(5);
    g.lineCap = "round";
    for (let k = 0; k < 140; k++) {
      g.strokeStyle = `rgba(${120 + rand() * 40},${60 + rand() * 30},${40 + rand() * 20},${0.25 + rand() * 0.45})`;
      g.lineWidth = 0.8 + rand() * 2.6;
      g.beginPath();
      const x0 = rand() * w;
      const y0 = h * (0.1 + rand() * 0.8);
      const len = 120 + rand() * 600;
      const amp = 20 + rand() * 90;
      const ph = rand() * 6;
      for (let t = 0; t <= 1; t += 0.02) {
        const x = x0 + t * len;
        const y = y0 + Math.sin(t * 3 + ph) * amp;
        if (t === 0) g.moveTo(x % w, y);
        else g.lineTo(x % w, y);
      }
      g.stroke();
    }
    // chaos patches
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(150,95,70,${0.1 + rand() * 0.2})`;
      g.beginPath();
      g.arc(rand() * w, h * (0.2 + rand() * 0.6), 6 + rand() * 30, 0, Math.PI * 2);
      g.fill();
    }
  });
}

export function titanTexture() {
  return canvasTex(512, 256, (g, w, h) => {
    const n = createNoise2D(77);
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const lat = y / h;
        const v = n(x / 60, y / 25) * 0.08 + Math.sin(lat * 9) * 0.03;
        const i = (y * w + x) * 4;
        img.data[i] = 222 + v * 200;
        img.data[i + 1] = 150 + v * 160;
        img.data[i + 2] = 60 + v * 80;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
  });
}

/** Lumpy asteroid geometry: an icosphere displaced with noise. */
export function rockGeometry(seed, detail = 3, lump = 0.32) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const n = createNoise2D(seed);
  const n2 = createNoise2D(seed + 1);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const d = 1 + n(v.x * 1.3 + v.y, v.z * 1.3 - v.y) * lump + n2(v.x * 4 + v.z, v.y * 4) * lump * 0.25;
    v.multiplyScalar(d);
    v.y *= 0.82;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
