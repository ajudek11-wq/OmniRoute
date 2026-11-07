/**
 * Fully synthesised ambience (no audio files): Martian wind, habitat hum, UI cues.
 * Created lazily inside a user gesture so iOS Safari will allow playback. Never autoplays.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = 0.7;
  }

  ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // Wind: looped brown noise through a slowly modulated band-pass.
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.2;
    }
    // Crossfade the loop seam.
    for (let i = 0; i < 2000; i++) d[len - 2000 + i] = d[len - 2000 + i] * (1 - i / 2000) + d[i] * (i / 2000);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 380;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(this.windFilter.frequency);
    noise.connect(this.windFilter).connect(this.windGain).connect(this.master);
    noise.start();
    lfo.start();

    // Habitat hum: two soft low tones.
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    for (const [f, g] of [
      [55, 0.05],
      [110.4, 0.025],
      [164.8, 0.01],
    ]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.humGain);
      o.start();
    }
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = "lowpass";
    humFilter.frequency.value = 400;
    this.humGain.connect(humFilter).connect(this.master);

    // Rover drive motors: detuned saws through a low-pass whose cutoff and pitch follow speed.
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    this.motorFilter = ctx.createBiquadFilter();
    this.motorFilter.type = "lowpass";
    this.motorFilter.frequency.value = 300;
    this.motorOsc = [70, 70.9].map((f) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(this.motorFilter);
      o.start();
      return o;
    });
    this.motorFilter.connect(this.motorGain).connect(this.master);
    return true;
  }

  setEnabled(on) {
    if (on && !this.ensure()) return false;
    this.enabled = on;
    if (!this.ctx) return on;
    if (on && this.ctx.state === "suspended") this.ctx.resume();
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(on ? this.volume : 0, now, 0.4);
    return on;
  }

  setVolume(v) {
    this.volume = v;
    if (this.enabled && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2);
  }

  /** Called every frame: proximity to the habitat, storm intensity, rover speed × proximity. */
  update(habitatProximity, storm, rover = 0, roverSpeed = 0) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.humGain.gain.setTargetAtTime(habitatProximity * 0.9, t, 0.5);
    this.windGain.gain.setTargetAtTime(0.35 + storm * 0.9, t, 1.2);
    // Mars' thin CO₂ atmosphere carries sound poorly: keep the motors faint and muffled.
    this.motorGain.gain.setTargetAtTime(rover * 0.05, t, 0.3);
    this.motorFilter.frequency.setTargetAtTime(220 + roverSpeed * 60, t, 0.3);
    this.motorOsc.forEach((o, i) => o.frequency.setTargetAtTime(55 + roverSpeed * 9 + i * 0.9, t, 0.3));
  }

  tone(freq, dur = 0.12, type = "sine", gain = 0.08, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  tap() {
    this.tone(1320, 0.06, "sine", 0.04);
  }
  select() {
    this.tone(660, 0.1, "sine", 0.05);
    this.tone(990, 0.14, "sine", 0.04, 0.05);
  }
  chime() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.6, "sine", 0.06, i * 0.09));
  }
  warn() {
    this.tone(440, 0.18, "triangle", 0.06);
    this.tone(330, 0.24, "triangle", 0.06, 0.2);
  }
}
