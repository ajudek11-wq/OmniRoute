import * as THREE from "three";
import { DESTINATIONS, SCI, byId } from "./destinations.js";
import { Panel, grid, textLabel } from "../xr/panel.js";
import { starSky, sun, earth, planet, planetTex, distanceForAngle } from "./common.js";
import { surface } from "../scene/surfaces.js";

/**
 * The navigation deck of the survey ship *Meridian*, parked in high Earth orbit.
 * A walkable circular deck with a ring of windows; in the middle a holographic orrery you can
 * walk into. Point at a world and pull the trigger to open its mission card, then launch.
 */

const DECK_R = 9.4;
const MAP_Y = 1.32;
// Hologram layout: orbit radius on the table (m), hologram size (m). Not to scale (labelled in the UI).
const LAYOUT = {
  venus: { r: 0.62, s: 0.075, a: 2.4 },
  orbit: { r: 0.9, s: 0.08, a: 0.6 },
  moon: { r: 0.9, s: 0.03, a: 0.6, moonOf: "orbit", mr: 0.16 },
  mars: { r: 1.2, s: 0.068, a: 4.1 },
  asteroids: { r: 1.5, s: 0.05, a: 5.4 },
  jupiter: { r: 1.85, s: 0.17, a: 1.5 },
  europa: { r: 1.85, s: 0.026, a: 1.5, moonOf: "jupiter", mr: 0.3 },
  saturn: { r: 2.3, s: 0.14, a: 3.3 },
  titan: { r: 2.3, s: 0.03, a: 3.3, moonOf: "saturn", mr: 0.36 },
  deep: { r: 3.3, s: 0.22, a: 5.0, y: 0.75 },
};

export async function build(ctx) {
  const { tier, xr, renderer } = ctx;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const interactables = [];

  // ── Sky: stars, Sun, the Earth far below, the Moon ──
  const sky = starSky({ tier });
  scene.add(sky.group);
  const sunDir = new THREE.Vector3(-0.62, 0.32, -0.71).normalize();
  const sol = sun({ dir: sunDir, angDeg: 0.53 });
  scene.add(sol.group);
  const earthR = 6371;
  const e = earth(earthR, { tier, sunDir });
  // High orbit (~20,000 km): the Earth spans about 30° below the deck.
  const eDist = distanceForAngle(earthR, 30);
  e.group.position.set(eDist * 0.35, -eDist * 0.78, eDist * 0.52);
  e.group.rotation.set(0.4, 2.2, 0.1);
  scene.add(e.group);
  const moonBody = planet(1737, { tex: "moon", tier, segments: 64 });
  const mDist = distanceForAngle(1737, 1.2);
  moonBody.group.position.copy(new THREE.Vector3(0.8, 0.12, -0.55).normalize().multiplyScalar(mDist));
  scene.add(moonBody.group);

  // ── Lighting ──
  const sunLight = new THREE.DirectionalLight(0xfff4e6, 2.4);
  sunLight.position.copy(sunDir).multiplyScalar(30);
  scene.add(sunLight);
  scene.add(new THREE.HemisphereLight(0x9ab8ff, 0x1a2230, 0.35));
  const earthshine = new THREE.DirectionalLight(0x6f9fff, 0.5);
  earthshine.position.set(0.35, -0.78, 0.52);
  scene.add(earthshine);
  const deckLight = new THREE.PointLight(0x9fd8ff, 6, 14, 1.6);
  deckLight.position.set(0, 3.2, 0);
  scene.add(deckLight);
  const holoLight = new THREE.PointLight(0x5fc8ff, 3, 6, 2);
  holoLight.position.set(0, 1.0, 0);
  scene.add(holoLight);

  // ── Materials ──
  const clean = { dustTop: 0, dustBase: 0, grime: 0.12 };
  const deckMat = surface({ kind: "panel", color: 0x2c3138, roughness: 0.5, metalness: 0.55, scale: 0.6, ...clean });
  const trimMat = surface({ kind: "brushed", color: 0x8a939c, roughness: 0.32, metalness: 0.9, scale: 1.2, ...clean });
  const darkMat = surface({ kind: "panel", color: 0x15181c, roughness: 0.6, metalness: 0.4, scale: 0.8, ...clean });
  const whiteMat = surface({ kind: "composite", color: 0xd9dcdf, roughness: 0.55, metalness: 0.05, scale: 0.5, ...clean });
  const glowCyan = new THREE.MeshBasicMaterial({ color: 0x7fd3ff, toneMapped: false });
  const glowWarm = new THREE.MeshBasicMaterial({ color: 0xffc58a, toneMapped: false });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4e8, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });

  // ── The deck ──
  const deck = new THREE.Group();
  scene.add(deck);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(DECK_R, 96).rotateX(-Math.PI / 2), deckMat);
  deck.add(floor);
  for (const [r, w] of [
    [3.25, 0.03],
    [6.2, 0.025],
    [DECK_R - 0.25, 0.04],
  ]) {
    const strip = new THREE.Mesh(new THREE.RingGeometry(r - w, r + w, 128).rotateX(-Math.PI / 2), glowCyan);
    strip.position.y = 0.004;
    deck.add(strip);
  }
  // Radial floor seams
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, DECK_R - 3.4), darkMat);
    seam.position.set(Math.sin(a) * (3.4 + (DECK_R - 3.4) / 2), 0.003, Math.cos(a) * (3.4 + (DECK_R - 3.4) / 2));
    seam.rotation.y = a;
    deck.add(seam);
  }
  // Window ring: 16 tall panes between structural ribs, a sill and a ceiling ring.
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const a2 = ((i + 0.5) / N) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.2, 0.42), trimMat);
    rib.position.set(Math.sin(a) * DECK_R, 2.1, Math.cos(a) * DECK_R);
    rib.rotation.y = a;
    deck.add(rib);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(2 * DECK_R * Math.sin(Math.PI / N) - 0.22, 3.3), glass);
    pane.position.set(Math.sin(a2) * DECK_R * Math.cos(Math.PI / N), 2.15, Math.cos(a2) * DECK_R * Math.cos(Math.PI / N));
    pane.rotation.y = a2 + Math.PI;
    deck.add(pane);
    // Ceiling ribs arching to the centre
    const arch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, DECK_R - 1.2), whiteMat);
    arch.position.set(Math.sin(a) * (DECK_R / 2 + 0.6), 4.35 + 0.0, Math.cos(a) * (DECK_R / 2 + 0.6));
    arch.rotation.set(0, a, 0);
    arch.rotateX(-0.16);
    deck.add(arch);
  }
  const sill = new THREE.Mesh(new THREE.TorusGeometry(DECK_R - 0.2, 0.18, 8, 96).rotateX(Math.PI / 2), whiteMat);
  sill.position.y = 0.42;
  deck.add(sill);
  const sillBench = new THREE.Mesh(new THREE.CylinderGeometry(DECK_R - 0.05, DECK_R - 0.05, 0.4, 96, 1, true), darkMat);
  sillBench.position.y = 0.2;
  sillBench.material.side = THREE.DoubleSide;
  deck.add(sillBench);
  const topRing = new THREE.Mesh(new THREE.TorusGeometry(DECK_R - 0.15, 0.22, 10, 96).rotateX(Math.PI / 2), whiteMat);
  topRing.position.y = 4.2;
  deck.add(topRing);
  const ceilingLight = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.04, 8, 80).rotateX(Math.PI / 2), glowCyan);
  ceilingLight.position.y = 5.2;
  deck.add(ceilingLight);
  const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.4, 48), whiteMat);
  hubCap.position.y = 5.35;
  deck.add(hubCap);

  // ── Holo table ──
  const table = new THREE.Group();
  deck.add(table);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.45, 0.78, 64), darkMat);
  base.position.y = 0.39;
  table.add(base);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.05, 10, 96).rotateX(Math.PI / 2), trimMat);
  rim.position.y = 0.8;
  table.add(rim);
  const emitter = new THREE.Mesh(new THREE.CircleGeometry(1.24, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0c2a3a, toneMapped: false }));
  emitter.position.y = 0.81;
  table.add(emitter);
  for (let k = 1; k <= 5; k++) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(k * 0.24 - 0.006, k * 0.24 + 0.006, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4fb8e8, transparent: true, opacity: 0.5, toneMapped: false }));
    ring.position.y = 0.815;
    table.add(ring);
  }
  // Light cone rising from the emitter
  const cone = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 1.2, 1.4, 64, 1, true),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader:
        "uniform float uT; varying vec2 vUv; void main(){ float a = (1.0 - vUv.y) * 0.07 * (0.8 + 0.2 * sin(vUv.y * 60.0 - uT * 3.0)); gl_FragColor = vec4(0.35, 0.75, 1.0, a); }",
    })
  );
  cone.position.y = 1.5;
  table.add(cone);

  // ── The holographic orrery ──
  const holo = new THREE.Group();
  holo.position.y = MAP_Y;
  scene.add(holo);
  const holoSun = new THREE.Mesh(new THREE.SphereGeometry(0.11, 32, 16), new THREE.MeshBasicMaterial({ map: planetTex("sun", "balanced"), color: 0xffb060, toneMapped: false }));
  holo.add(holoSun);
  const sunGlow = textGlow(0xffa040, 0.7);
  holo.add(sunGlow);
  const orbitMat = new THREE.LineBasicMaterial({ color: 0x7fd3ff, transparent: true, opacity: 0.35, toneMapped: false });
  const markers = {};
  for (const d of DESTINATIONS) {
    const L = LAYOUT[d.id];
    if (!L) continue;
    if (!L.moonOf && d.id !== "deep") holo.add(orbitLine(L.r, orbitMat));
    const node = new THREE.Group();
    const mat = d.tex
      ? new THREE.MeshBasicMaterial({ map: planetTex(d.tex === "earth_day" ? "earth_day" : d.tex, "balanced"), toneMapped: false })
      : new THREE.MeshBasicMaterial({ color: d.color, toneMapped: false });
    if (d.tex === "venus_atmos") mat.color.setScalar(0.95);
    let body;
    if (d.id === "asteroids") body = asteroidCluster(L.s, d.color);
    else if (d.id === "deep") body = nebulaMarker(L.s);
    else body = new THREE.Mesh(new THREE.SphereGeometry(L.s, 32, 16), mat);
    node.add(body);
    if (d.id === "saturn") {
      const ringTex = planetTex("saturn_ring", "balanced");
      const rg = new THREE.Mesh(
        new THREE.RingGeometry(L.s * 1.25, L.s * 2.25, 64, 1),
        new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, side: THREE.DoubleSide, toneMapped: false, depthWrite: false })
      );
      fixRingUV(rg.geometry, L.s * 1.25, L.s * 2.25);
      rg.rotation.x = -Math.PI / 2 + 0.47;
      node.add(rg);
    }
    // Holographic rim + selection ring
    const rimMesh = new THREE.Mesh(
      new THREE.SphereGeometry(L.s * 1.08, 24, 12),
      new THREE.MeshBasicMaterial({ color: 0x7fd3ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    node.add(rimMesh);
    const sel = new THREE.Mesh(new THREE.RingGeometry(L.s * 1.6, L.s * 1.75, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    node.add(sel);
    const label = textLabel(d.name, { size: 0.05, sub: ctx.state.visited.includes(d.id) ? "visited" : "" });
    label.position.y = L.s + 0.07;
    node.add(label);
    // Generous invisible pick target so small moons are easy to point at.
    const pick = new THREE.Mesh(new THREE.SphereGeometry(Math.max(L.s * 1.4, 0.09), 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    node.add(pick);
    holo.add(node);
    markers[d.id] = { node, body, sel, label, L, hover: 0 };
    interactables.push({
      object: pick,
      label: d.name,
      onHover: (on) => (markers[d.id].hover = on ? 1 : 0),
      onSelect: () => openCard(d.id),
    });
  }

  // ── Mission card ──
  const card = new Panel({ width: 0.95, height: 0.72, ppm: 1250 });
  card.mesh.visible = false;
  scene.add(card.mesh);
  let selected = null;
  interactables.push({
    object: card.mesh,
    panel: card,
    enabled: () => card.mesh.visible,
    onButton: (b) => {
      if (b.id === "close") return closeCard();
      if (b.id === "launch") return ctx.travel(selected);
      if (b.id === "jump") return ctx.go(selected, { direct: true });
    },
  });
  function openCard(id) {
    const d = byId[id];
    selected = id;
    const notes = d.notes.slice(0, 3);
    const found = Object.values(ctx.state.found).filter((f) => f.dest === id).length;
    card.setContent({
      eyebrow: d.site,
      title: d.name,
      titleSize: 92,
      tag: SCI[notes[0][0]],
      lines: [...notes.map(([k, t]) => `${k === "fiction" ? "◆" : k === "established" ? "●" : "▲"} ${t}`), `Discoveries logged here: ${found}`],
      lineSize: 34,
      buttons: grid(card, [{ id: "launch", label: "Launch mission", on: true }, { id: "jump", label: "Go directly" }, { id: "close", label: "Close" }], { top: 0.84, cols: 3, rowH: 0.11, gap: 0.02 }),
    });
    card.mesh.visible = true;
    // Float the card between the player and the selected world, facing the player.
    const head = xr.headWorld(new THREE.Vector3());
    const m = markers[id].node.getWorldPosition(new THREE.Vector3());
    const dir = m.clone().sub(head).setY(0).normalize();
    card.mesh.position.copy(head).addScaledVector(dir, Math.min(1.25, Math.max(0.9, head.distanceTo(m) * 0.6)));
    card.mesh.position.y = head.y - 0.12;
    card.mesh.lookAt(head.x, head.y - 0.12, head.z);
    for (const k of Object.keys(markers)) markers[k].sel.material.opacity = k === id ? 0.9 : 0;
  }
  function closeCard() {
    card.mesh.visible = false;
    selected = null;
    for (const k of Object.keys(markers)) markers[k].sel.material.opacity = 0;
  }

  // ── Wall consoles: archive, comfort, vehicles, progress ──
  const consoles = [];
  const consoleDefs = [
    { id: "archive", a: Math.PI * 0.75, title: "Discovery archive" },
    { id: "comfort", a: -Math.PI * 0.75, title: "Comfort & graphics" },
    { id: "vehicles", a: Math.PI * 0.25 + Math.PI, title: "Vehicles" },
  ];
  for (const c of consoleDefs) {
    const g = new THREE.Group();
    const r = 6.9;
    g.position.set(Math.sin(c.a) * r, 0, Math.cos(c.a) * r);
    g.rotation.y = c.a + Math.PI;
    const ped = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 0.5), darkMat);
    ped.position.set(0, 0.5, 0);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.05, 0.56), trimMat);
    lip.position.y = 1.02;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.02), glowCyan);
    strip.position.set(0, 0.92, 0.26);
    const p = new Panel({ width: 1.1, height: 0.72, ppm: 1150 });
    p.mesh.position.set(0, 1.55, -0.05);
    p.mesh.rotation.x = -0.15;
    g.add(ped, lip, strip, p.mesh);
    deck.add(g);
    consoles.push({ ...c, panel: p });
    interactables.push({ object: p.mesh, panel: p, onButton: (b) => consoleButton(c.id, b) });
  }
  function drawConsoles() {
    const st = ctx.state;
    const found = Object.values(st.found);
    for (const c of consoles) {
      if (c.id === "archive") {
        c.panel.setContent({
          eyebrow: "Holographic archive",
          title: `${found.length} discoveries`,
          titleSize: 80,
          lines: found.length
            ? found
                .sort((a, b) => b.t - a.t)
                .slice(0, 6)
                .map((f) => `${byId[f.dest]?.name ?? f.dest}: ${f.title}`)
            : ["Nothing logged yet. On each world, point at rocks, ice and landmarks and pull the trigger to scan them."],
          lineSize: 36,
          buttons: grid(c.panel, [{ id: "open", label: "Open full archive", on: true }], { top: 0.82, cols: 1, rowH: 0.12, side: 0.25 }),
        });
      } else if (c.id === "comfort") {
        const cf = xr.comfort;
        c.panel.setContent({
          eyebrow: "Settings",
          title: "Comfort & graphics",
          titleSize: 72,
          lines: [`Graphics: ${ctx.tierLabel ?? ctx.tier} · ${ctx.gpu ?? "GPU unknown"}`],
          lineSize: 32,
          buttons: grid(
            c.panel,
            [
              { id: "move", label: cf.move === "smooth" ? "Smooth movement" : "Teleport only", on: true },
              { id: "turn", label: cf.turn === "snap" ? `Snap turn ${cf.snapDeg}°` : "Smooth turn", on: true },
              { id: "seated", label: cf.seated ? "Seated" : "Standing", on: cf.seated },
              { id: "vignette", label: cf.vignette ? "Vignette on" : "Vignette off", on: cf.vignette },
              { id: "slower", label: `Speed − (${cf.speed.toFixed(1)})` },
              { id: "faster", label: "Speed +" },
              { id: "quality", label: "Cycle graphics tier" },
              { id: "recenter", label: "Recenter" },
            ],
            { top: 0.3, cols: 2, rowH: 0.13, gap: 0.03 }
          ),
        });
      } else if (c.id === "vehicles") {
        c.panel.setContent({
          eyebrow: "Hangar manifest",
          title: "Vehicles",
          titleSize: 72,
          lines: [
            "Pathfinder shuttle — crew transfer, landing and docking (all missions)",
            "FR-1 pressurised rover — Mars (drive it from the garage)",
            "LTV-2 lunar rover — the Moon",
            "Skimmer hovercraft — Titan",
            "All vehicles are fictional designs.",
          ],
          lineSize: 34,
          buttons: [],
        });
      }
    }
  }
  function consoleButton(id, b) {
    if (id === "archive") return ctx.toggleArchive?.();
    if (id === "comfort") {
      if (b.id === "quality") ctx.cycleQuality?.();
      else xr.menuButton({ id: b.id });
      drawConsoles();
    }
  }
  drawConsoles();

  // Station plaque / welcome
  const plaque = textLabel("SURVEY SHIP MERIDIAN · NAVIGATION DECK", { size: 0.09, sub: "Point at a world and pull the trigger" });
  plaque.position.set(0, 3.1, -3.4);
  scene.add(plaque);

  const groundAt = (x, z) => (Math.hypot(x, z) < DECK_R - 0.45 ? 0 : null);
  const colliders = [{ x: 0, z: 0, r: 1.42 }, ...consoles.map((c) => ({ x: Math.sin(c.a) * 6.9, z: Math.cos(c.a) * 6.9, r: 0.8 }))];

  let t0 = 0;
  let orreryT = 0;
  return {
    title: "Meridian · Navigation deck",
    scene,
    spawn: { x: 0, z: 3.4, yaw: 0 },
    near: 0.05,
    far: 1.2e7,
    groundAt,
    colliders,
    bounds: { x: 0, z: 0, r: DECK_R - 0.5 },
    interactables,
    refresh: drawConsoles,
    update(dt, t) {
      t0 += dt;
      const cam = xr.camera.getWorldPosition(new THREE.Vector3());
      sky.follow(cam);
      sol.follow(cam);
      e.update(dt);
      e.globe.rotation.y += dt * 0.004;
      cone.material.uniforms.uT.value = t0;
      holoSun.rotation.y += dt * 0.2;
      // The orrery holds still while a world is pointed at or its card is open, so it is easy to select.
      const hovering = card.mesh.visible || Object.values(markers).some((m) => m.hover);
      if (!hovering) orreryT += dt;
      for (const [id, m] of Object.entries(markers)) {
        const L = m.L;
        const ang = L.a + orreryT * (0.05 / Math.max(0.5, L.r));
        if (L.moonOf) {
          const host = LAYOUT[L.moonOf];
          const ha = host.a + orreryT * (0.05 / Math.max(0.5, host.r));
          const ma = orreryT * 0.4 + L.r * 3;
          m.node.position.set(Math.cos(ha) * host.r + Math.cos(ma) * L.mr, Math.sin(ma) * L.mr * 0.15, Math.sin(ha) * host.r + Math.sin(ma) * L.mr);
        } else m.node.position.set(Math.cos(ang) * L.r, L.y ?? 0, Math.sin(ang) * L.r);
        m.body.rotation.y += dt * 0.3;
        const s = 1 + m.hover * 0.25;
        m.node.scale.lerp(new THREE.Vector3(s, s, s), Math.min(1, dt * 10));
        m.label.lookAt(cam);
        m.sel.lookAt(cam);
      }
      plaque.lookAt(cam.x, plaque.position.y, cam.z);
    },
    dispose() {},
  };
}

function orbitLine(r, mat) {
  const pts = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
}

function textGlow(color, size) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,200,120,0.9)");
  grd.addColorStop(0.3, "rgba(255,160,60,0.3)");
  grd.addColorStop(1, "rgba(255,120,30,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  s.scale.setScalar(size);
  return s;
}

function asteroidCluster(s, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s * (0.25 + (i % 3) * 0.12), 0), mat);
    m.position.set(Math.cos(i * 2.4) * s, Math.sin(i * 1.7) * s * 0.4, Math.sin(i * 2.4) * s);
    g.add(m);
  }
  return g;
}

function nebulaMarker(s) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  for (let i = 0; i < 26; i++) {
    const x = 128 + Math.cos(i * 1.9) * 50 * Math.sin(i);
    const y = 128 + Math.sin(i * 2.3) * 40;
    const grd = g.createRadialGradient(x, y, 0, x, y, 60);
    grd.addColorStop(0, i % 3 ? "rgba(170,110,255,0.25)" : "rgba(255,120,180,0.25)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  sp.scale.setScalar(s * 2.4);
  const core = new THREE.Mesh(new THREE.SphereGeometry(s * 0.12, 16, 8), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  const disk = new THREE.Mesh(new THREE.RingGeometry(s * 0.16, s * 0.42, 48), new THREE.MeshBasicMaterial({ color: 0xffb070, side: THREE.DoubleSide, transparent: true, opacity: 0.8, toneMapped: false, blending: THREE.AdditiveBlending }));
  disk.rotation.x = 1.2;
  const g2 = new THREE.Group();
  g2.add(sp, core, disk);
  return g2;
}

/** RingGeometry UVs are planar; remap so u runs inner→outer for a radial ring texture. */
export function fixRingUV(geo, inner, outer) {
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getY(i));
    uv.setXY(i, (r - inner) / (outer - inner), 0.5);
  }
  uv.needsUpdate = true;
}
