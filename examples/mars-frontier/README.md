# MARS: FRONTIER

An interactive, mobile-first Three.js experience: operate and explore a Mars research settlement in
Arcadia Planitia. It combines a procedural planet surface, a detailed outpost, a drivable rover, a
transparent life-support simulation and an exploration mission system.

It is a standalone Vite app. It does not depend on, or change, the OmniRoute app around it.

## Run it

Requires Node.js 20.19+ (Node 22 LTS recommended).

```bash
cd examples/mars-frontier
npm install
npm run dev          # http://localhost:5173 (also exposed on your local network)
```

Production build:

```bash
npm run build
npm run preview      # serves dist/ on http://localhost:4173 (and your LAN)
```

Tests:

```bash
npm test             # simulation engine unit tests (node:test, no extra deps)
npm run smoke        # headless browser smoke test — needs Playwright and a running `npm run preview`
```

## Easiest way: one click for your iPhone

On the Windows laptop, double-click **`start-on-phone.bat`** in this folder (first run installs
dependencies). It builds the app and prints an address such as `http://192.168.1.23:4173/`.
Type that into Safari on the iPhone (same Wi-Fi). Close the window to stop.

From a terminal the same thing is `npm run phone`. The steps below are the manual version.

## Open it on your iPhone (Windows laptop, same Wi-Fi)

1. On the laptop, run `npm run dev`. Vite prints two URLs; use the **Network** one, e.g.
   `http://192.168.1.23:5173/`.
   - To find the address yourself, run `ipconfig` in PowerShell and use the **IPv4 Address** of
     the Wi-Fi adapter.
2. **Windows Firewall:** the first time, Windows asks whether Node.js may communicate on networks.
   Allow it on **Private networks**. Your Wi-Fi must be set to *Private*: Settings → Network &
   internet → Wi-Fi → your network → Network profile type → Private.
   If the phone still can't connect, open PowerShell **as Administrator** and run:
   ```powershell
   New-NetFirewallRule -DisplayName "Mars Frontier dev" -Direction Inbound -Protocol TCP -LocalPort 5173,4173 -Action Allow -Profile Private
   ```
3. On the iPhone (same Wi-Fi, not mobile data or a guest network), open Safari and enter the
   Network URL.
4. Optional, app-like: Share → **Add to Home Screen**. It then launches full-screen without
   Safari's toolbars.

Notes:

- Offline caching (the service worker) only activates over HTTPS or on `localhost`, so it is off
  over a plain `http://192.168…` LAN address. Everything else works. Deploy `dist/` to any HTTPS
  static host to get full offline PWA behaviour.
- Sound never autoplays. Enable it on the start screen or with the speaker button. The iPhone's
  silent switch also mutes web audio.
- Some public/guest Wi-Fi networks isolate devices from each other; use a home network or a
  phone hotspot.

## Controls

| Action                | Phone                            | Desktop                         |
| --------------------- | -------------------------------- | ------------------------------- |
| Look around           | drag                             | left-drag                       |
| Zoom                  | pinch                            | scroll                          |
| Pan                   | two-finger drag                  | right-drag                      |
| Inspect a structure   | tap it or its label              | click                           |
| Drive the rover       | Rover view → tap the ground      | Rover view → click the ground   |
| Camera views          | bottom pill                      | bottom pill or keys `1`–`5`     |
| Lighting presets      | tap the clock → Time & light     | click the clock                 |
| Cinematic mode        | film button (top right)          | film button or `C`; `Esc` exits |
| Rover inspect/Mastcam | Rover panel → Inspect / Mastcam  | same                            |
| Pause / speed of time | clock in the top-left            | clock, or `Space` to pause      |

## V2: realism & immersion

- **Photographic terrain:** CC0 Poly Haven sets (regolith, bedrock, layered strata), packed for
  mobile and blended in a custom terrain shader:
  - two rotated scales plus a macro mask, so there is no visible tiling;
  - slope-driven bedrock, and horizontal strata on steep walls (mesa, crater walls);
  - mid-scale structure that still reads from orbit distance, and far-distance fade-out.
- **Geology:** derivative-damped ("eroded") mountains, irregular crater rims, central peaks,
  hummocky ejecta, boulders clustered on crater rims, and bright wind streaks trailing downwind
  of craters.
- **Atmosphere:** height-dependent dust haze with sun-side forward scattering (aerial
  perspective) on every material. A sky shader with blue sunsets and twilight afterglow drives
  image-based lighting (a PMREM environment map that is regenerated as the sun moves).
- **Lighting presets:** Sunrise, Midday, Sunset, Blue hour and Night time-lapse the simulation
  to that local solar time, so sun, shadows, sky, haze and settlement lights stay consistent.
- **PBR material system:** procedural packed maps (painted panels with seams and grime
  streaks, quilted MLI insulation, brushed metal, gold foil, composite, sintered regolith,
  rubber, solar cells). They are mapped triplanar in object space with a dust layer: up-facing
  surfaces and the lowest metre collect dust and lose metalness. Greenhouse glass uses a
  Fresnel term. Solar modules visibly dull as simulated dust builds up.
- **Architecture:** a regolith sandbag shielding wall, an insulated pressure shell with ribs and
  ring frames, sunshaded windows, an airlock with suitports, handrails and a status light,
  roof radiators, conduits, vertical-farm racks with HVAC, framed solar modules on torque tubes
  with drive motors, battery thermal units, a guyed comms tower with a back-structured dish, and
  ground contact shadows and night light pools (one draw call each).
- **Rover:** rocker-bogie linkage, chevron-grouser wheels with corner steering, a pan/tilt mast
  with stereo cameras and a laser spectrometer, a five-joint arm that deploys at survey sites,
  a tracking high-gain antenna, hazcams, lidar and status LEDs. It has an **Inspect** mode with
  tappable component hotspots, and a first-person **Mastcam** view.
- **Horizon:** the terrain is two meshes. A dense near grid covers the base (about 2.6 m
  spacing at the centre). A polar horizon ring to 3.7 km spends its vertices on angular
  resolution, which is what shapes mountain silhouettes seen from the settlement.
- **Wheel tracks:** the rover leaves tread-patterned tracks in the regolith. They are a
  ring-buffered ribbon in one draw call, and older tracks fade out.
- **Rover audio:** a faint, muffled motor sound follows speed and camera distance. Mars' thin
  CO₂ air carries sound poorly.
- **Cinematic mode:** seven composed shots with smootherstep dollies, crossfades, letterbox and
  captions, and the UI hidden.
- **Graphics settings:** Low / Balanced / High / **Automatic**. Automatic lowers resolution,
  then sheds shadows and effects live if the frame rate stays low, and remembers that for the
  next launch. A lost WebGL context gets a reload prompt instead of a frozen page.

## What's inside

- **World:** a 6.4 km procedural terrain that is dense near the base and sparse at the horizon.
  It has craters (one exposing bright ground ice), a layered mesa, ridged mountains, three
  instanced boulder types, compacted roads, a tileable regolith detail texture and normal map, an
  atmospheric sky shader with blue Martian sunsets and stars, airborne dust, and dust storms that
  darken and redden the sky.
- **Settlement:** a regolith-bermed habitat dome, science lab with radiators and a spinning
  anemometer, a glowing LED greenhouse, sun-tracking solar arrays, battery containers with
  charge-level LEDs, a tracking comms dish, a water/ISRU plant with a spinning drum, a rover garage
  whose door opens, a landing pad with chase lights, a distant fission-power site, pressurised
  tunnels and lamp posts. Static parts are merged per material to keep draw calls low.
- **Rover:** a six-wheel rocker-bogie rover that follows the terrain (pitch and roll from four
  contact points), steers around structures, and runs survey and panel-cleaning tasks.
- **Cameras:** Orbit, Surface, Aerial, Habitat and Rover modes, with smooth arcing transitions,
  auto-orbit when idle, and ground-collision clamping.
- **Simulation** (`src/sim/`, pure JS, unit-tested): crew O₂, water, food, solar and fission power,
  battery storage, priority load shedding, dust accumulation, storms, closure and autonomy, reserve
  and a 760-sol endurance projection. Four scenarios plus live sliders. Every parameter is tagged
  *Measured / Reference / Assumption / Estimate* with its source, and the in-app **Methodology**
  page shows the formulas and the list of what is not modelled.
- **Missions:** 12 objectives (inspection, comms, driving, geology surveys, dust patrol, blue
  sunset, steady state, autonomy engineering, storm survival) with toasts, sound cues and unlockable
  log entries. Progress is saved in `localStorage`.
- **Performance:** device-aware Low/Balanced/High tiers, adaptive resolution (FrameGovernor),
  throttled shadow updates, instancing, merged geometry, and an optional performance readout in
  Settings.

## Honest limitations

- The simulation is educational. It is **not** a validated engineering model: seasons, failures,
  CO₂/N₂ balance, thermal and radiation dose are not modelled (see Methodology in the app).
- It was tested in headless Chromium with iPhone 15 Pro / iPhone SE emulation and at desktop
  size, using a software GPU. It has **not** been run on a physical iPhone. Real Safari/WebKit
  performance and touch feel still need checking on the device. Automatic quality exists for
  exactly this reason.
- Structures and the rover are procedural geometry with procedural PBR materials, not scanned or
  artist-made GLB models. Only the terrain uses photographic textures.
- The rover drives far faster than real Mars rovers, for interactivity.

## Project layout

```
src/
  main.js            app orchestration: boot, input, rover tasks, persistence, render loop
  core/quality.js    device tiers + adaptive resolution
  scene/             world (renderer, sky, lights), terrain, settlement, rover, camera rig, noise
  sim/               constants (with provenance), scenarios, engine (no rendering code)
  game/missions.js   mission definitions + manager
  data/              layout (master plan) and structure inspector content
  ui/                HUD, sheet component, panel views, icons
  audio/audio.js     synthesised ambience (no audio files)
public/              PWA manifest, icons, service worker
tests/               engine unit tests
scripts/             smoke test, visual QC gallery, icon renderer (Playwright), texture packer (Python)
public/textures/     packed CC0 terrain textures (see CREDITS.md)
```
