/**
 * Shuttle sound, synthesised with WebAudio on the shared AudioEngine (ctx.audio).
 * Only the vehicle is heard in vacuum: cabin fans, avionics, and the engines carried through the
 * structure as a low rumble. Air outside (entry plasma, wind) is only heard inside an atmosphere.
 */
export class ShipSound {
  constructor(audio) {
    this.audio = audio;
    this.ready = false;
    this.nodes = [];
    this.beepT = 3;
    this.levels = { engine: 0, plasma: 0, wind: 0, fan: 1 };
  }

  ensure() {
    const a = this.audio;
    if (this.ready || !a?.enabled || !a.ctx) return this.ready;
    const ctx = a.ctx;
    this.ctx = ctx;
    // Quiet the Mars ambience nodes (they keep their last level while another world is live).
    for (const k of ["windGain", "humGain", "motorGain", "whineGain", "rumbleGain"]) a[k]?.gain?.setTargetAtTime(0, ctx.currentTime, 0.3);
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(a.master);
    this.out.gain.setTargetAtTime(1, ctx.currentTime, 0.6);
    const noiseBuf = (seconds, brown) => {
      const len = Math.floor(ctx.sampleRate * seconds);
      const b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.4;
        } else d[i] = w * 0.5;
      }
      for (let i = 0; i < 2000; i++) d[len - 2000 + i] = d[len - 2000 + i] * (1 - i / 2000) + d[i] * (i / 2000);
      return b;
    };
    this.white = noiseBuf(3, false);
    this.brown = noiseBuf(4, true);
    const loop = (buf, filterType, freq, q, gain) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(f).connect(g).connect(this.out);
      src.start();
      this.nodes.push(src);
      return { src, f, g };
    };
    // Cabin fans: a soft broadband hiss with a gentle whir
    this.fan = loop(this.white, "lowpass", 900, 0.4, 0.035);
    this.whir = loop(this.white, "bandpass", 240, 6, 0.02);
    // Engine through the structure: deep rumble + a low tone
    this.eng = loop(this.brown, "lowpass", 140, 0.7, 0);
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = 41;
    const of = ctx.createBiquadFilter();
    of.type = "lowpass";
    of.frequency.value = 120;
    this.engTone = ctx.createGain();
    this.engTone.gain.value = 0;
    o.connect(of).connect(this.engTone).connect(this.out);
    o.start();
    this.nodes.push(o);
    // Plasma roar (atmospheric entry) and wind (in an atmosphere only)
    this.plasma = loop(this.brown, "bandpass", 520, 0.8, 0);
    this.wind = loop(this.white, "bandpass", 380, 0.7, 0);
    this.ready = true;
    return true;
  }

  set(k, v) {
    this.levels[k] = v;
  }

  update(dt) {
    if (!this.ensure()) return;
    if (!this.audio.enabled) return;
    const t = this.ctx.currentTime;
    const L = this.levels;
    this.eng.g.gain.setTargetAtTime(L.engine * 0.55, t, 0.25);
    this.eng.f.frequency.setTargetAtTime(90 + L.engine * 110, t, 0.3);
    this.engTone.gain.setTargetAtTime(L.engine * 0.05, t, 0.3);
    this.plasma.g.gain.setTargetAtTime(L.plasma * 0.5, t, 0.3);
    this.plasma.f.frequency.setTargetAtTime(380 + L.plasma * 500, t, 0.4);
    this.wind.g.gain.setTargetAtTime(L.wind * 0.25, t, 0.6);
    this.fan.g.gain.setTargetAtTime(0.035 * L.fan, t, 0.5);
    // Avionics: sparse soft beeps
    this.beepT -= dt;
    if (this.beepT <= 0) {
      this.beepT = 5 + Math.random() * 7;
      const f = [1760, 2093, 2349][Math.floor(Math.random() * 3)];
      this.audio.tone(f, 0.05, "sine", 0.012);
      if (Math.random() < 0.4) this.audio.tone(f * 1.26, 0.05, "sine", 0.01, 0.09);
    }
  }

  burst({ freq = 200, type = "lowpass", dur = 0.4, gain = 0.3, rate = 1 } = {}) {
    if (!this.ensure()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** Button press: a firm mechanical click plus a confirmation tone. */
  click(ok = true) {
    this.burst({ freq: 3200, type: "bandpass", dur: 0.03, gain: 0.18, rate: 1.5 });
    this.audio.tone(ok ? 1046 : 330, 0.07, "sine", 0.03, 0.02);
  }

  latch() {
    // Docking latch: a heavy clunk carried through the hull, then the hooks ratcheting.
    this.burst({ freq: 160, dur: 0.6, gain: 0.7 });
    this.audio.tone(52, 0.5, "sine", 0.18);
    this.audio.tone(880, 0.25, "triangle", 0.02, 0.05);
    for (let i = 0; i < 4; i++) setTimeout(() => this.burst({ freq: 1800, type: "bandpass", dur: 0.05, gain: 0.12 }), 300 + i * 110);
  }

  thud() {
    this.burst({ freq: 120, dur: 0.7, gain: 0.8 });
    this.audio.tone(38, 0.6, "sine", 0.2);
  }

  chuteSnap() {
    this.burst({ freq: 1400, type: "highpass", dur: 0.15, gain: 0.5 });
    this.burst({ freq: 200, dur: 0.5, gain: 0.5 });
    this.audio.tone(70, 0.4, "sine", 0.14);
  }

  hatch() {
    this.burst({ freq: 900, type: "bandpass", dur: 1.4, gain: 0.12, rate: 0.6 });
    this.audio.tone(98, 0.3, "sine", 0.08, 0.1);
  }

  fold() {
    this.audio.tone(110, 2.5, "sine", 0.06);
    this.audio.tone(165, 2.5, "sine", 0.04, 0.3);
    this.audio.tone(220, 2.2, "sine", 0.03, 0.6);
  }

  dispose() {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    this.out?.disconnect();
    this.nodes = [];
    this.ready = false;
  }
}
