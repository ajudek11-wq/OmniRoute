import * as THREE from "three";
import { heightAt } from "./terrain.js";

const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10); // smootherstep: no jerk at either end
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Linear dolly between two framed positions, each looking at its own target. */
function dolly(fromPos, fromTgt, toPos, toTgt) {
  return (k, out) => {
    out.pos.lerpVectors(fromPos, toPos, k);
    out.target.lerpVectors(fromTgt, toTgt, k);
  };
}

/** Slow arc around a point. */
function arc(center, radius, height, a0, a1, lookOffset = V(0, 0, 0)) {
  return (k, out) => {
    const a = a0 + (a1 - a0) * k;
    out.pos.set(center.x + Math.sin(a) * radius, center.y + height, center.z + Math.cos(a) * radius);
    out.target.copy(center).add(lookOffset);
  };
}

export function buildShots(app) {
  const rover = app.rover;
  return [
    {
      title: "Frontier Base",
      sub: "Arcadia Planitia · 40.2° N · first permanent research settlement",
      dur: 10,
      pose: dolly(V(-560, 34, 700), V(0, 10, 0), V(-330, 24, 430), V(10, 8, -4)),
    },
    {
      title: "Crew Habitat",
      sub: "Pressure vessel under regolith shielding · crew of four",
      dur: 9,
      pose: arc(V(0, 4, 0), 36, 6, 0.15, 0.85, V(0, 2, 0)),
    },
    {
      title: "Greenhouse",
      sub: "Hydroponic racks under LED supplementary light",
      dur: 8,
      pose: dolly(V(42, 3.2, -16), V(4, 2.4, -34), V(30, 2.6, -21), V(0, 2.2, -34)),
    },
    {
      title: "Solar Field",
      sub: "Single-axis trackers follow the sun from east to west",
      dur: 9,
      pose: dolly(V(76, 3.2, -44), V(118, 1.5, 0), V(80, 4, 44), V(118, 1.5, 6)),
    },
    {
      title: "Rover FR-1",
      sub: "Six-wheel rocker-bogie exploration rover",
      dur: 9,
      pose: (k, out) => {
        const a = rover.heading + 0.9 + k * 1.1;
        out.target.copy(rover.pos).add(V(0, 1.3, 0));
        out.pos.set(rover.pos.x + Math.sin(a) * 9, rover.pos.y + 2.4, rover.pos.z + Math.cos(a) * 9);
      },
    },
    {
      title: "Deep-Space Link",
      sub: "3 to 22 light-minutes from Earth, depending on orbital geometry",
      dur: 7,
      pose: dolly(V(-26, 2.2, 52), V(-42, 13, 36), V(-31, 2.6, 47), V(-42, 14, 36)),
    },
    {
      title: "A Human Outpost",
      sub: "Mountains 2 km away · a 240 m crater to the south-east",
      dur: 11,
      pose: dolly(V(50, 50, 120), V(0, 4, 0), V(330, 420, 760), V(40, 0, -60)),
    },
  ];
}

export class Cinematic {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.pose = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this.el = document.getElementById("cine");
    this.titleEl = document.getElementById("cine-title");
    this.subEl = document.getElementById("cine-sub");
    this.fadeEl = document.getElementById("cine-fade");
    this.el.addEventListener("click", () => app.toggleCinematic(false));
  }

  start() {
    this.shots = buildShots(this.app);
    this.i = 0;
    this.t = 0;
    this.active = true;
    this.el.hidden = false;
    document.getElementById("app").classList.add("cinematic");
    this.showCaption();
  }

  stop() {
    this.active = false;
    this.el.hidden = true;
    document.getElementById("app").classList.remove("cinematic");
    this.fadeEl.style.opacity = "0";
  }

  showCaption() {
    const s = this.shots[this.i];
    this.titleEl.textContent = s.title;
    this.subEl.textContent = s.sub;
    const cap = this.titleEl.parentElement;
    cap.classList.remove("show");
    void cap.offsetWidth;
    cap.classList.add("show");
  }

  update(dt, camera) {
    if (!this.active) return;
    const shot = this.shots[this.i];
    this.t += dt;
    const k = Math.min(1, this.t / shot.dur);
    shot.pose(smooth(k), this.pose);
    const g = heightAt(this.pose.pos.x, this.pose.pos.z) + 1.4;
    if (this.pose.pos.y < g) this.pose.pos.y = g;
    camera.position.copy(this.pose.pos);
    camera.lookAt(this.pose.target);
    // Crossfade through black between shots.
    const fade = Math.max(0, 1 - this.t / 0.8, 1 - (shot.dur - this.t) / 0.8);
    this.fadeEl.style.opacity = String(Math.min(1, fade));
    if (this.t >= shot.dur) {
      this.i = (this.i + 1) % this.shots.length;
      this.t = 0;
      this.showCaption();
    }
  }
}
