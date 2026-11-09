import { fmtDist, fmtSpeed, fmtTime } from "./flight.js";

/**
 * Multi-function displays of the Pathfinder flight deck, drawn into canvases.
 * Screens (left → right): NAV · ATT (attitude) · MISSION (brief + science) · RANGE · VEL.
 */

const C = {
  bg: "#05080b",
  grid: "rgba(111,214,255,0.10)",
  cyan: "#6fd6ff",
  green: "#7fffb0",
  amber: "#ffc27a",
  red: "#ff6a5a",
  text: "#e8eef2",
  dim: "rgba(232,238,242,0.55)",
};

function frame(s, title, accent = C.cyan) {
  const { ctx: g, canvas } = s;
  const w = canvas.width;
  const h = canvas.height;
  g.fillStyle = C.bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = C.grid;
  g.lineWidth = 1;
  for (let x = 0; x < w; x += 32) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  for (let y = 0; y < h; y += 32) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.fillStyle = accent;
  g.font = "700 30px system-ui, sans-serif";
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillText(title, 18, 38);
  g.fillStyle = "rgba(111,214,255,0.25)";
  g.fillRect(18, 48, w - 36, 2);
  return { g, w, h };
}

function big(g, text, x, y, size = 54, color = C.text, align = "left") {
  g.font = `700 ${size}px system-ui, sans-serif`;
  g.fillStyle = color;
  g.textAlign = align;
  g.fillText(text, x, y);
}

function small(g, text, x, y, size = 26, color = C.dim, align = "left") {
  g.font = `500 ${size}px system-ui, sans-serif`;
  g.fillStyle = color;
  g.textAlign = align;
  g.fillText(text, x, y);
}

function wrap(g, text, maxW) {
  const out = [];
  let line = "";
  for (const w of String(text).split(" ")) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > maxW && line) {
      out.push(line);
      line = w;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

export function drawNav(s, st) {
  const { g, w, h } = frame(s, "NAV");
  small(g, st.phaseLabel, w - 18, 38, 24, st.auto ? C.cyan : C.amber, "right");
  big(g, st.destName, 18, 100, 44);
  small(g, st.site, 18, 136, 24);
  // Target bearing indicator: where the target is relative to the nose.
  const cx = w / 2;
  const cy = 265;
  const R = 105;
  g.strokeStyle = "rgba(111,214,255,0.5)";
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(cx - R, cy);
  g.lineTo(cx + R, cy);
  g.moveTo(cx, cy - R);
  g.lineTo(cx, cy + R);
  g.stroke();
  if (st.target) {
    const off = Math.min(1, st.target.angle / (Math.PI / 2));
    const a = Math.atan2(st.target.dy, st.target.dx);
    const px = cx + Math.cos(a) * off * R;
    const py = cy - Math.sin(a) * off * R;
    g.fillStyle = off < 0.06 ? C.green : C.amber;
    g.beginPath();
    g.arc(px, py, 12, 0, Math.PI * 2);
    g.fill();
    small(g, off < 0.06 ? "ON TARGET" : `${Math.round((st.target.angle * 180) / Math.PI)}° OFF`, cx, cy + R + 34, 24, off < 0.06 ? C.green : C.amber, "center");
  }
  g.strokeStyle = C.text;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx - 16, cy);
  g.lineTo(cx + 16, cy);
  g.moveTo(cx, cy - 16);
  g.lineTo(cx, cy + 16);
  g.stroke();
}

export function drawAttitude(s, st) {
  const { g, w, h } = frame(s, "ATT");
  const cx = w / 2;
  const cy = 225;
  const R = 150;
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.clip();
  g.translate(cx, cy);
  g.rotate(-st.roll);
  const off = (st.pitch * 180) / Math.PI * 3.2;
  g.fillStyle = st.space ? "#10233a" : "#2c6aa8";
  g.fillRect(-300, -600 + off, 600, 600);
  g.fillStyle = st.space ? "#1c1712" : "#6a4526";
  g.fillRect(-300, off, 600, 600);
  g.strokeStyle = "#ffffff";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(-300, off);
  g.lineTo(300, off);
  g.stroke();
  g.lineWidth = 2;
  g.font = "500 18px system-ui";
  g.fillStyle = "#fff";
  g.textAlign = "left";
  for (let p = -60; p <= 60; p += 10) {
    if (!p) continue;
    const y = off - p * 3.2;
    g.beginPath();
    g.moveTo(-40, y);
    g.lineTo(40, y);
    g.stroke();
    g.fillText(`${p}`, 46, y + 6);
  }
  g.restore();
  g.strokeStyle = C.amber;
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(cx - 80, cy);
  g.lineTo(cx - 25, cy);
  g.lineTo(cx - 12, cy + 14);
  g.moveTo(cx + 80, cy);
  g.lineTo(cx + 25, cy);
  g.lineTo(cx + 12, cy + 14);
  g.stroke();
  g.strokeStyle = "rgba(111,214,255,0.6)";
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.stroke();
  small(g, st.space ? "REF: TRAJECTORY" : "REF: LOCAL HORIZON", 18, h - 16, 22);
  small(g, `HDG ${String(Math.round(((st.heading * 180) / Math.PI + 360) % 360)).padStart(3, "0")}°`, w - 18, h - 16, 22, C.text, "right");
}

export function drawBrief(s, st) {
  const { g, w, h } = frame(s, st.briefTitle ?? "MISSION", C.green);
  let y = 84;
  for (const item of st.brief ?? []) {
    const [tag, text] = item;
    const col = { established: C.green, simplified: C.amber, hypothesis: "#c8a2ff", fiction: "#ff9f7f", info: C.cyan }[tag] ?? C.dim;
    if (tag !== "info") {
      g.font = "700 18px system-ui";
      g.fillStyle = col;
      g.textAlign = "left";
      g.fillText({ established: "ESTABLISHED", simplified: "SIMPLIFIED", hypothesis: "HYPOTHESIS", fiction: "FICTION" }[tag] ?? "", 18, y);
      y += 26;
    }
    g.font = "500 25px system-ui";
    g.fillStyle = tag === "info" ? C.text : "rgba(232,238,242,0.88)";
    for (const l of wrap(g, text, w - 36)) {
      if (y > h - 12) break;
      g.fillText(l, 18, y);
      y += 30;
    }
    y += 10;
  }
}

export function drawRange(s, st) {
  const { g, w, h } = frame(s, "RANGE");
  small(g, st.rangeLabel ?? "TO TARGET", 18, 90, 24);
  big(g, fmtDist(st.range), 18, 150, st.range > 1e9 ? 46 : 56);
  small(g, "ETA (THIS LEG)", 18, 212, 24);
  big(g, fmtTime(st.eta), 18, 270, 56, C.cyan);
  if (st.alt != null) {
    small(g, "ALTITUDE", 18, 322, 24);
    big(g, fmtDist(st.alt), 18, 372, 44, st.alt < 100 ? C.amber : C.text);
  } else {
    // progress bar
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(18, 320, w - 36, 22);
    g.fillStyle = C.cyan;
    g.fillRect(18, 320, (w - 36) * Math.max(0, Math.min(1, st.progress ?? 0)), 22);
    small(g, st.legLabel ?? "", 18, 375, 24);
  }
}

export function drawVel(s, st) {
  const { g, w, h } = frame(s, "VEL / THR");
  small(g, st.speedLabel ?? "SPEED", 18, 90, 24);
  big(g, fmtSpeed(st.speed), 18, 150, st.speed > 1e5 ? 44 : 54);
  if (st.vs != null) small(g, `V/S ${st.vs >= 0 ? "+" : "−"}${fmtSpeed(Math.abs(st.vs))}`, 18, 188, 24, st.vs < -15 ? C.amber : C.dim);
  small(g, st.auto ? "THROTTLE · AUTO" : "THROTTLE · MANUAL", 18, 232, 24, st.auto ? C.cyan : C.amber);
  g.fillStyle = "rgba(255,255,255,0.1)";
  g.fillRect(18, 248, w - 36, 34);
  g.fillStyle = st.auto ? C.cyan : C.amber;
  g.fillRect(18, 248, (w - 36) * st.throttle, 34);
  big(g, `${Math.round(st.throttle * 100)}%`, w - 18, 276, 28, "#05080b", "right");
  small(g, "ENGINE", 18, 330, 24);
  big(g, st.engine ?? "SAFE", 18, 372, 36, st.engine === "BURN" ? C.amber : st.engine === "CONTACT" ? "#6fb6ff" : C.text);
  if (st.contact) {
    g.fillStyle = "#3d7dff";
    g.fillRect(w - 170, 330, 152, 52);
    big(g, "CONTACT", w - 94, 366, 26, "#fff", "center");
  }
  if (st.fiction) small(g, "Speed: fiction", w - 18, h - 14, 20, "#ff9f7f", "right");
}

export const DRAW = [drawNav, drawAttitude, drawBrief, drawRange, drawVel];
