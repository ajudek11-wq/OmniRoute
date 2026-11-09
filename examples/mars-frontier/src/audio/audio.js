/**
 * Fully synthesised ambience (no audio files): Martian wind, habitat hum, UI cues.
 * Created lazily inside a user gesture so iOS Safari will allow playback. Never autoplays.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = 0.7;
    this.driving = false;
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
    // Spatial: the habitat hum and rover motor come from where they are in the world.
    const mkPanner = () => {
      const p = ctx.createPanner();
      p.panningModel = "HRTF";
      p.distanceModel = "inverse";
      p.refDistance = 14;
      p.maxDistance = 400;
      p.rolloffFactor = 1.3;
      p.connect(this.master);
      return p;
    };
    this.humPanner = mkPanner();
    this.setPanPos(this.humPanner, 0, 3, 0);
    humFilter.connect(this.humPanner);

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
    this.motorPanner = mkPanner();
    this.motorFilter.connect(this.motorGain).connect(this.motorPanner);
    // Gear whine: a soft triangle an octave or two above the motors, rising with speed.
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc = ctx.createOscillator();
    this.whineOsc.type = "triangle";
    this.whineOsc.frequency.value = 320;
    this.whineOsc.connect(this.whineGain).connect(this.motorPanner);
    this.whineOsc.start();
    // Regolith crunch under six wheels: looped noise through a low band-pass, gain ∝ speed.
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = "bandpass";
    this.rumbleFilter.frequency.value = 160;
    this.rumbleFilter.Q.value = 0.9;
    const rumble = ctx.createBufferSource();
    rumble.buffer = buf;
    rumble.loop = true;
    rumble.playbackRate.value = 1.7;
    rumble.connect(this.rumbleFilter).connect(this.rumbleGain).connect(this.motorPanner);
    rumble.start();
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nd.length, 3);
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

  setPanPos(p, x, y, z) {
    if (!p) return;
    const t = this.ctx.currentTime;
    if (p.positionX) {
      p.positionX.setValueAtTime(x, t);
      p.positionY.setValueAtTime(y, t);
      p.positionZ.setValueAtTime(z, t);
    } else p.setPosition(x, y, z);
  }

  /** Listener follows the walking camera. yaw: forward = (sin, cos) in x/z, as in the walker. */
  setListener(x, y, z, yaw) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    if (L.positionX) {
      L.positionX.setValueAtTime(x, t);
      L.positionY.setValueAtTime(y, t);
      L.positionZ.setValueAtTime(z, t);
      L.forwardX.setValueAtTime(fx, t);
      L.forwardY.setValueAtTime(0, t);
      L.forwardZ.setValueAtTime(-fz, t);
      L.upX.setValueAtTime(0, t);
      L.upY.setValueAtTime(1, t);
      L.upZ.setValueAtTime(0, t);
    }
  }

  setSources(roverX, roverY, roverZ) {
    this.setPanPos(this.motorPanner, roverX, roverY + 1, roverZ);
  }

  /** A soft, low footfall on regolith (thin air: no crisp clicks). */
  step(volume = 0.05) {
    if (!this.enabled || !this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.3;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 420;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  /**
   * Called every frame: proximity to the habitat, storm intensity, rover speed × proximity,
   * absolute rover speed (m/s) and, while driving, the steering effort (0..1).
   */
  update(habitatProximity, storm, rover = 0, roverSpeed = 0, steer = 0) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.abs(roverSpeed);
    this.humGain.gain.setTargetAtTime(habitatProximity * 1.6, t, 0.5);
    this.windGain.gain.setTargetAtTime(0.35 + storm * 0.9, t, 1.2);
    // Mars' thin CO₂ atmosphere carries sound poorly: keep the motors faint and muffled.
    // At the wheel, the cab carries the drivetrain through the structure, so it is louder.
    const near = this.driving ? Math.max(rover, 0.85 * Math.min(1, 0.25 + v / 3)) : rover;
    const k = this.driving ? 2.2 : 1;
    this.motorGain.gain.setTargetAtTime(near * 0.05 * k, t, 0.25);
    this.motorFilter.frequency.setTargetAtTime(220 + v * 60 + steer * 80, t, 0.25);
    this.motorOsc.forEach((o, i) => o.frequency.setTargetAtTime(55 + v * 9 + steer * 6 + i * 0.9, t, 0.25));
    this.whineOsc.frequency.setTargetAtTime(300 + v * 70 + steer * 40, t, 0.2);
    this.whineGain.gain.setTargetAtTime(near * Math.min(1, v / 5 + steer * 0.3) * 0.012 * k, t, 0.25);
    this.rumbleFilter.frequency.setTargetAtTime(120 + v * 22, t, 0.3);
    this.rumbleGain.gain.setTargetAtTime(near * Math.min(1, v / 6) * 0.22 * k, t, 0.25);
  }

  /** Driving from the rover: drivetrain sounds come forward in the mix. */
  setDriving(on) {
    this.driving = on;
  }

  /** Power-up chirp when the player takes the wheel; reversed when they hand it back. */
  driveStart() {
    this.tone(330, 0.12, "triangle", 0.05);
    this.tone(495, 0.12, "triangle", 0.05, 0.1);
    this.tone(660, 0.22, "sine", 0.05, 0.2);
  }
  driveStop() {
    this.tone(660, 0.12, "sine", 0.045);
    this.tone(440, 0.2, "triangle", 0.045, 0.1);
  }

  /** A dull thud when the rover runs into something it cannot climb. */
  bump(strength = 1) {
    if (!this.enabled || !this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.45;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 180;
    const g = this.ctx.createGain();
    g.gain.value = 0.12 * Math.min(1, strength);
    src.connect(f).connect(g).connect(this.master);
    src.start();
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
