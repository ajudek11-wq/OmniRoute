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
| Pause / speed of time | clock in the top-left            | clock, or `Space` to pause      |

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
- **Performance:** device-aware Low/Medium/High tiers, adaptive resolution (FrameGovernor),
  throttled shadow updates, instancing, merged geometry, and an optional performance readout in
  Settings.

## Honest limitations

- The simulation is educational. It is **not** a validated engineering model: seasons, failures,
  CO₂/N₂ balance, thermal and radiation dose are not modelled (see Methodology in the app).
- It was tested in headless Chromium with iPhone 15 Pro emulation and at desktop size, using a
  software GPU. It has **not** been run on a physical iPhone. Real Safari/WebKit performance and
  touch feel still need checking on the device.
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
scripts/             smoke test + icon renderer (Playwright)
```
