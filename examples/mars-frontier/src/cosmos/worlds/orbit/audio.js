/**
 * Station sound, all WebAudio on the shared engine (ctx.audio): interior air handling and machinery
 * hum, door pneumatics, interface beeps, and — outside — only the suit: fans and breathing.
 * Vacuum carries no sound, so nothing external is ever played on the EVA platform.
 */
export function stationAudio(audio) {
  let nodes = null;
  let mode = "interior"; // "interior" | "airlock" | "suit"
  let breath = 0;
  let mach = 0;

  function noiseBuffer(ac, seconds = 2) {
    const b = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02; // brown-ish
      d[i] = last * 3.5 + w * 0.12;
    }
    return b;
  }

  function ensure() {
    if (nodes || !audio?.enabled || !audio.ctx || !audio.master) return nodes;
    const ac = audio.ctx;
    const buf = noiseBuffer(ac);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // Air handling: low broadband rush
    const airF = ac.createBiquadFilter();
    airF.type = "lowpass";
    airF.frequency.value = 700;
    const airG = ac.createGain();
    airG.gain.value = 0;
    src.connect(airF).connect(airG).connect(audio.master);
    // Machinery hum (fans / pumps) — two detuned oscillators through a gain
    const humG = ac.createGain();
    humG.gain.value = 0;
    const hums = [58, 116.5, 174].map((f, i) => {
      const o = ac.createOscillator();
      o.type = i === 0 ? "sine" : "triangle";
      o.frequency.value = f;
      const g = ac.createGain();
      g.gain.value = [0.5, 0.18, 0.06][i];
      o.connect(g).connect(humG);
      o.start();
      return o;
    });
    humG.connect(audio.master);
    // Suit: fan whine + breathing (band-passed noise with a slow envelope)
    const fanF = ac.createBiquadFilter();
    fanF.type = "bandpass";
    fanF.frequency.value = 1400;
    fanF.Q.value = 1.2;
    const fanG = ac.createGain();
    fanG.gain.value = 0;
    src.connect(fanF).connect(fanG).connect(audio.master);
    const brF = ac.createBiquadFilter();
    brF.type = "bandpass";
    brF.frequency.value = 600;
    brF.Q.value = 0.7;
    const brG = ac.createGain();
    brG.gain.value = 0;
    src.connect(brF).connect(brG).connect(audio.master);
    src.start();
    nodes = { ac, src, airG, humG, fanG, brG, brF, hums };
    return nodes;
  }

  function burst(dur, f0, f1, gain, q = 1.5) {
    const n = ensure();
    if (!n) return;
    const { ac } = n;
    const s = ac.createBufferSource();
    s.buffer = noiseBuffer(ac, Math.max(0.3, dur));
    const f = ac.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = q;
    const t = ac.currentTime;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(audio.master);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  return {
    setMode(m) {
      mode = m;
    },
    get mode() {
      return mode;
    },
    door(open) {
      if (mode === "suit") return;
      burst(0.65, open ? 2200 : 900, open ? 500 : 2400, 0.12);
      audio?.tone?.(open ? 92 : 70, 0.18, "sine", 0.08, open ? 0.6 : 0.62);
    },
    beep(k = 0) {
      audio?.tone?.([880, 1175, 660, 1320][k % 4], 0.07, "sine", 0.05);
    },
    hiss(dur = 3) {
      burst(dur, 3000, 400, 0.14, 0.8);
    },
    lift() {
      audio?.tone?.(110, 1.2, "sine", 0.05);
      audio?.tone?.(165, 1.2, "sine", 0.03, 0.1);
    },
    update(dt, { machinery = 0 } = {}) {
      const n = ensure();
      if (!n) return;
      if (!audio.enabled) return;
      const t = n.ac.currentTime;
      mach += (machinery - mach) * Math.min(1, dt * 2);
      const inside = mode !== "suit";
      const air = mode === "interior" ? 0.05 : mode === "airlock" ? 0.03 : 0;
      n.airG.gain.setTargetAtTime(air, t, 0.4);
      n.humG.gain.setTargetAtTime(inside ? 0.012 + mach * 0.035 : 0, t, 0.4);
      n.fanG.gain.setTargetAtTime(mode === "suit" ? 0.018 : 0, t, 0.5);
      // Breathing: ~14 breaths/min, inhale (brighter) then exhale
      breath += dt;
      const ph = (breath % 4.3) / 4.3;
      const env = mode === "suit" ? (ph < 0.38 ? Math.sin((ph / 0.38) * Math.PI) * 0.06 : ph < 0.8 ? Math.sin(((ph - 0.38) / 0.42) * Math.PI) * 0.045 : 0) : 0;
      n.brG.gain.setTargetAtTime(env, t, 0.08);
      n.brF.frequency.setTargetAtTime(ph < 0.38 ? 900 : 520, t, 0.15);
    },
    dispose() {
      if (!nodes) return;
      try {
        nodes.src.stop();
        for (const o of nodes.hums) o.stop();
        for (const k of ["airG", "humG", "fanG", "brG"]) nodes[k].disconnect();
      } catch {
        /* already stopped */
      }
      nodes = null;
    },
  };
}
