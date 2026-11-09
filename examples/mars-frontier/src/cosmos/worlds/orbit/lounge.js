import * as THREE from "three";
import { Panel, grid } from "../../../xr/panel.js";
import { sign, screen } from "./kit.js";
import { RING_R, RING_RPM, omegaOf, spinAccel, rimSpeed, G0 } from "./physics.js";

/** Observation lounge: floor-to-ceiling windows on the Earth side, benches, info panel, window shade. */
export function furnishLounge(room, kit, env) {
  const { mats, sci } = env;
  const m = room.merger;
  const D = 11.55;
  // Windows: glass, mullions, sill and header, an outer reveal
  const panes = 6;
  for (let i = 0; i <= panes; i++) {
    const w = -6.6 + (i * 13.2) / panes;
    m.span("trimL", D - 0.05, 0, w - 0.06, D + 0.3, 3.4, w + 0.06);
  }
  m.span("trimL", D - 0.1, 0, -7, D + 0.3, 0.1, 7);
  m.span("trimL", D - 0.1, 3.28, -7, D + 0.3, 3.4, 7);
  for (const e of [-1, 1]) m.span("wallL", D - 0.1, 0, e * 6.6, D + 0.3, 3.4, e * 7.12);
  m.span("glass", D + 0.1, 0.1, -6.6, D + 0.12, 3.28, 6.6);
  // Hand rail along the glass
  m.tube("railL", [D - 0.35, 0.95, -6.5], [D - 0.35, 0.95, 6.5], 0.025, 10);
  for (let i = 0; i <= panes; i++) m.span("trimL", D - 0.37, 0.93, -6.6 + (i * 13.2) / panes - 0.02, D - 0.05, 0.97, -6.6 + (i * 13.2) / panes + 0.02);
  m.span("stripAmber", D - 0.2, 0.1, -6.6, D - 0.1, 0.13, 6.6);
  // Benches facing the window
  for (const w0 of [-3.4, 3.4]) {
    m.span("trimL", 7.7, 0, w0 - 2.0, 8.9, 0.32, w0 + 2.0);
    m.span("fabricL", 7.75, 0.32, w0 - 1.95, 8.85, 0.46, w0 + 1.95);
    m.span("fabricL", 8.65, 0.46, w0 - 1.95, 8.9, 0.95, w0 + 1.95);
    kit.block(7.7, w0 - 2.0, 8.9, w0 + 2.0);
  }
  // Low table with the tablet
  m.span("trimL", 6.1, 0, -0.6, 6.9, 0.38, 0.6);
  m.span("whiteL", 5.95, 0.38, -0.75, 7.05, 0.42, 0.75);
  kit.collide(6.5, 0, 0.65);
  env.restSurfaces.push({ ...kit.world(6.5, 0), r: 0.7, y: room.y0 + 0.42 });
  // Planters in the back corners
  for (const e of [-1, 1]) {
    m.span("whiteL", 1.0, 0, e * 6.0 - 0.5, 2.0, 0.6, e * 6.0 + 0.5);
    m.span("soil", 1.05, 0.6, e * 6.0 - 0.45, 1.95, 0.62, e * 6.0 + 0.45);
    for (let k = 0; k < 9; k++) {
      const a = k * 2.4;
      const h = 0.5 + ((k * 37) % 10) / 14;
      m.add("leaf", new THREE.ConeGeometry(0.16, h, 5), 1.5 + Math.cos(a) * 0.25, 0.62 + h / 2, e * 6.0 + Math.sin(a) * 0.25, Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3);
    }
    kit.collide(1.5, e * 6, 0.65);
  }
  // Telescope on a tripod (decorative) by the window
  m.tube("darkL", [10.2, 0, 5.2], [10.4, 1.2, 5.6], 0.03, 6);
  m.tube("darkL", [10.6, 0, 5.2], [10.4, 1.2, 5.6], 0.03, 6);
  m.tube("darkL", [10.4, 0, 6.0], [10.4, 1.2, 5.6], 0.03, 6);
  m.tube("whiteL", [10.1, 1.25, 5.6], [10.9, 1.5, 5.6], 0.09, 14);
  kit.collide(10.4, 5.6, 0.45);

  // ── Window shade (slides down from the header) ──
  const shade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 3.2, 13.2), mats.darkL);
  shade.position.set(D - 0.6, 3.2 + 1.6, 0);
  room.group.add(shade);
  const shadeState = { down: false, t: 0 };
  kit.anim((dt) => {
    const tgt = shadeState.down ? 1 : 0;
    shadeState.t += Math.sign(tgt - shadeState.t) * Math.min(Math.abs(tgt - shadeState.t), dt * 0.4);
    shade.position.y = 3.25 + 1.6 - shadeState.t * 3.15;
    shade.scale.y = Math.max(0.02, shadeState.t);
    shade.position.y = 3.25 - (3.15 * shadeState.t) / 2;
    shade.visible = shadeState.t > 0.01;
  });
  const shadeBtn = kit.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.12), mats.stripAmber), D - 0.12, 1.25, -6.85);
  shadeBtn.rotation.y = 0;

  // ── Info panel on the side wall: the physics of the spinning ring ──
  const panel = new Panel({ width: 1.5, height: 1.05, ppm: 900, glow: "#ffd27f" });
  panel.mesh.position.set(4.6, 1.75, -6.86);
  room.group.add(panel.mesh);
  const w = omegaOf(RING_RPM);
  const pages = {
    gravity: {
      eyebrow: "Meridian Station · artificial gravity",
      title: "Gravity from rotation",
      tag: sci.simplified,
      lines: [
        `The floor pushes you toward the ring's centre: a = ω²r. At ${RING_RPM} rpm, ω = 2π·${RING_RPM}/60 = ${w.toFixed(4)} rad/s.`,
        `a = ${w.toFixed(4)}² × ${RING_R} m ≈ ${spinAccel(RING_R, RING_RPM).toFixed(2)} m/s² ≈ ${(spinAccel(RING_R, RING_RPM) / G0).toFixed(2)} g. Your head (1.7 m nearer the axis) feels 0.8% less.`,
        `The floor moves at ωr ≈ ${rimSpeed(RING_R, RING_RPM).toFixed(0)} m/s. The floor curves up ahead and behind you: you are standing inside a 450 m wheel.`,
        "Through the windows the spin is slowed ~7× (one turn per 3.5 min instead of 30 s) for comfort. Meridian Station itself is fiction.",
      ],
    },
    earth: {
      eyebrow: "Window notes",
      title: "Earth from 400 km",
      tag: sci.established,
      lines: [
        "From the altitude of the ISS the Earth spans about 140° of sky. The curved limb is the horizon about 2,300 km away.",
        "The thin glowing blue line on the limb is the atmosphere seen edge-on: most of its mass lies in the lowest ~16 km.",
        "One orbit takes ~92 minutes, so the crew sees ~16 sunrises and sunsets a day. Here the orbit is compressed to 10 minutes (simplified).",
      ],
    },
  };
  let page = "gravity";
  const draw = () =>
    panel.setContent({
      ...pages[page],
      titleSize: 64,
      lineSize: 30,
      buttons: grid(
        panel,
        [
          { id: "gravity", label: "Spin gravity", on: page === "gravity" },
          { id: "earth", label: "Earth view", on: page === "earth" },
          { id: "shade", label: shadeState.down ? "Raise shade" : "Lower shade" },
        ],
        { top: 0.83, cols: 3, rowH: 0.11, side: 0.05 }
      ),
    });
  draw();
  const toggleShade = () => {
    shadeState.down = !shadeState.down;
    env.sfx.beep(2);
    env.sfx.lift();
    draw();
  };
  kit.interact({
    object: panel.mesh,
    panel,
    onButton: (b) => {
      env.sfx.beep(1);
      if (b.id === "shade") return toggleShade();
      page = b.id;
      draw();
      if (page === "gravity") env.discover("orbit-spin-gravity");
      if (page === "earth") env.discover("orbit-limb");
    },
  });
  kit.interact({ object: shadeBtn, label: "Window shade", onSelect: toggleShade, poke: true, pokeRadius: 0.07, onPoke: toggleShade });
  // Window plaque
  const plaque = sign(["EARTH · 400 KM BELOW", "The limb, the terminator, city lights and aurora"], { w: 1.1, size: 54, bg: "#14202c" });
  kit.add(plaque, D - 0.4, 0.72, -5.4, -Math.PI / 2);
  plaque.rotation.x = -0.5;
  plaque.rotation.order = "YXZ";
  kit.interact({ object: plaque, label: "Window notes", onSelect: () => env.discover("orbit-limb") });

  // ── Tablet (grabbable) ──
  const tab = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.18), mats.darkL);
  const scr = screen(0.24, 0.16, 1100);
  scr.mesh.rotation.x = -Math.PI / 2;
  scr.mesh.position.y = 0.0065;
  tab.add(body, scr.mesh);
  tab.position.set(6.4, 0.43, 0.1);
  tab.rotation.y = 0.3;
  room.group.add(tab);
  env.tablet = { obj: tab, scr };
  env.grabbable(tab, "Crew tablet");

  return { shadeState, panel };
}
