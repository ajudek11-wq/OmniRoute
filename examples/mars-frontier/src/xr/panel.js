import * as THREE from "three";

/**
 * A flat, ray-clickable UI panel drawn into a canvas texture. Used for the wrist menu, holographic
 * info cards, the discovery archive and cockpit screens. Buttons are laid out in canvas pixels;
 * a ray hit's UV is mapped back to the button under it.
 *
 *   const p = new Panel({ width: 0.4, height: 0.3 });
 *   p.setContent({ title, lines, buttons: [{ id, label, x, y, w, h, on }] });
 *   p.hit(uv) → button | null
 */
export class Panel {
  constructor({ width = 0.4, height = 0.3, ppm = 1400, glow = "#7fd3ff", opacity = 0.9, emissive = true } = {}) {
    this.w = Math.round(width * ppm);
    this.h = Math.round(height * ppm);
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx = this.canvas.getContext("2d");
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.glow = glow;
    const mat = emissive
      ? new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, opacity, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: 0.9 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    this.mesh.userData.panel = this;
    this.mesh.renderOrder = 10;
    this.buttons = [];
    this.hover = null;
    this.content = { title: "", lines: [], buttons: [] };
  }

  setContent(content) {
    this.content = { title: "", lines: [], buttons: [], ...content };
    this.buttons = this.content.buttons ?? [];
    this.draw();
  }

  setHover(id) {
    if (id === this.hover) return;
    this.hover = id;
    this.draw();
  }

  hit(uv) {
    if (!uv) return null;
    const x = uv.x * this.w;
    const y = (1 - uv.y) * this.h;
    return this.buttons.find((b) => !b.disabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) ?? null;
  }

  draw() {
    const { ctx, w, h } = this;
    const c = this.content;
    ctx.clearRect(0, 0, w, h);
    // Glass card
    const r = Math.min(w, h) * 0.06;
    roundRect(ctx, 4, 4, w - 8, h - 8, r);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(14,22,30,0.92)");
    g.addColorStop(1, "rgba(6,10,16,0.88)");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = hexA(this.glow, 0.65);
    ctx.stroke();
    const pad = Math.round(w * 0.05);
    let y = pad;
    if (c.eyebrow) {
      ctx.font = `600 ${Math.round(h * 0.045)}px system-ui, sans-serif`;
      ctx.fillStyle = hexA(this.glow, 0.95);
      ctx.fillText(c.eyebrow.toUpperCase(), pad, y + h * 0.045);
      y += h * 0.07;
    }
    if (c.title) {
      ctx.font = `700 ${Math.round(c.titleSize ?? h * 0.085)}px system-ui, sans-serif`;
      ctx.fillStyle = "#f4efe6";
      ctx.fillText(c.title, pad, y + (c.titleSize ?? h * 0.085));
      y += (c.titleSize ?? h * 0.085) * 1.45;
    }
    if (c.tag) {
      const tagH = h * 0.06;
      ctx.font = `600 ${Math.round(tagH * 0.62)}px system-ui, sans-serif`;
      const tw = ctx.measureText(c.tag.text).width + tagH;
      roundRect(ctx, pad, y, tw, tagH, tagH / 2);
      ctx.fillStyle = hexA(c.tag.color ?? this.glow, 0.25);
      ctx.fill();
      ctx.fillStyle = c.tag.color ?? this.glow;
      ctx.fillText(c.tag.text, pad + tagH / 2, y + tagH * 0.72);
      y += tagH * 1.5;
    }
    const lineSize = c.lineSize ?? Math.round(h * 0.05);
    ctx.font = `400 ${lineSize}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(236,230,220,0.86)";
    for (const line of c.lines ?? []) {
      for (const l of wrap(ctx, line, w - pad * 2)) {
        if (y > h - pad - lineSize) break;
        ctx.fillText(l, pad, y + lineSize);
        y += lineSize * 1.35;
      }
      y += lineSize * 0.35;
    }
    for (const b of this.buttons) {
      roundRect(ctx, b.x, b.y, b.w, b.h, Math.min(b.h * 0.3, 28));
      const hov = this.hover === b.id;
      ctx.fillStyle = b.disabled ? "rgba(60,60,60,0.5)" : b.on ? hexA(this.glow, hov ? 0.6 : 0.42) : hov ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.09)";
      ctx.fill();
      ctx.lineWidth = hov ? 5 : 3;
      ctx.strokeStyle = b.on ? this.glow : hov ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.25)";
      ctx.stroke();
      ctx.fillStyle = b.disabled ? "rgba(255,255,255,0.35)" : "#f6f2ea";
      ctx.font = `600 ${Math.round(b.size ?? b.h * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h * 0.64);
      ctx.textAlign = "left";
    }
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.tex.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** Lay out buttons in a grid inside a panel (canvas pixels). */
export function grid(panel, items, { top = 0.3, cols = 2, gap = 0.025, rowH = 0.12, side = 0.05 } = {}) {
  const W = panel.w;
  const H = panel.h;
  const x0 = W * side;
  const cw = (W - x0 * 2 - W * gap * (cols - 1)) / cols;
  return items.map((it, i) => ({
    ...it,
    x: x0 + (i % cols) * (cw + W * gap),
    y: H * top + Math.floor(i / cols) * H * (rowH + gap),
    w: cw,
    h: H * rowH,
  }));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxW) {
  const words = String(text).split(" ");
  const out = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) {
      out.push(line);
      line = w;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** A floating text label (sprite-like plane that faces the viewer when `billboard` is updated). */
export function textLabel(text, { size = 0.12, color = "#f4efe6", glow = "#7fd3ff", sub = "" } = {}) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const fs = 64;
  ctx.font = `700 ${fs}px system-ui, sans-serif`;
  const tw = Math.max(ctx.measureText(text).width, sub ? ctx.measureText(sub).width * 0.6 : 0);
  c.width = Math.ceil(tw + 48);
  c.height = sub ? 140 : 96;
  ctx.font = `700 ${fs}px system-ui, sans-serif`;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 16;
  ctx.fillStyle = color;
  ctx.fillText(text, 24, 70);
  if (sub) {
    ctx.shadowBlur = 0;
    ctx.font = `500 ${fs * 0.55}px system-ui, sans-serif`;
    ctx.fillStyle = glow;
    ctx.fillText(sub, 24, 122);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry((size * c.width) / 96, (size * c.height) / 96),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })
  );
  m.renderOrder = 11;
  return m;
}
