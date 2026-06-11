/** Tiny procedural sound engine. No assets, no DOM — pure WebAudio synthesis. */

export type SoundName = "place" | "erase" | "paint" | "pick" | "ui" | "tick";

export interface SoundEngine {
  /** Fire-and-forget; never throws. pitch ∈ [0,1] meaningful for "tick"; gain scales 0..1. */
  play(name: SoundName, opts?: { pitch?: number; gain?: number }): void;
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
}

interface ToneSpec {
  type: OscillatorType;
  freqStart: number;
  freqEnd?: number;
  duration: number;
  gain: number;
  delay?: number;
}

export const createSound = (initiallyEnabled: boolean): SoundEngine => {
  let enabled = initiallyEnabled;
  let broken = false;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;

  const ensureContext = (): AudioContext | null => {
    if (broken) return null;
    if (ctx) return ctx;
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctor) {
      broken = true;
      return null;
    }
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    } catch {
      broken = true;
      ctx = null;
      master = null;
      return null;
    }
    return ctx;
  };

  /** Shared ~0.1s white-noise buffer for transients, built once. */
  const ensureNoise = (audio: AudioContext): AudioBuffer => {
    if (noiseBuffer) return noiseBuffer;
    const frames = Math.floor(audio.sampleRate * 0.1);
    noiseBuffer = audio.createBuffer(1, frames, audio.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  };

  /** Short oscillator with exponential decay envelope; nodes are garbage after stop. */
  const tone = (audio: AudioContext, out: GainNode, detune: number, spec: ToneSpec): void => {
    const start = audio.currentTime + (spec.delay ?? 0);
    const stop = start + spec.duration;
    const osc = audio.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.freqStart * detune, start);
    if (spec.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.freqEnd * detune), stop);
    }
    const env = audio.createGain();
    env.gain.setValueAtTime(spec.gain, start);
    env.gain.exponentialRampToValueAtTime(0.0001, stop);
    osc.connect(env);
    env.connect(out);
    osc.start(start);
    osc.stop(stop);
  };

  /** Bandpassed slice of the shared noise buffer. */
  const noiseBurst = (
    audio: AudioContext,
    out: GainNode,
    centerHz: number,
    duration: number,
    gain: number,
  ): void => {
    const start = audio.currentTime;
    const stop = start + duration;
    const src = audio.createBufferSource();
    src.buffer = ensureNoise(audio);
    const filter = audio.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = centerHz;
    filter.Q.value = 1.2;
    const env = audio.createGain();
    env.gain.setValueAtTime(gain, start);
    env.gain.exponentialRampToValueAtTime(0.0001, stop);
    src.connect(filter);
    filter.connect(env);
    env.connect(out);
    src.start(start);
    src.stop(stop);
  };

  const synth = (audio: AudioContext, out: GainNode, name: SoundName, pitch: number): void => {
    const detune = 1 + (Math.random() * 2 - 1) * 0.05;
    switch (name) {
      case "place":
        // Lego snap: high click plus a tiny noise transient.
        tone(audio, out, detune, {
          type: "square",
          freqStart: 1900,
          freqEnd: 2500,
          duration: 0.035,
          gain: 0.5,
        });
        noiseBurst(audio, out, 3200 * detune, 0.025, 0.3);
        break;
      case "erase":
        tone(audio, out, detune, {
          type: "triangle",
          freqStart: 280,
          freqEnd: 110,
          duration: 0.09,
          gain: 0.8,
        });
        break;
      case "paint":
        tone(audio, out, detune, { type: "sine", freqStart: 880, duration: 0.03, gain: 0.25 });
        break;
      case "pick":
        tone(audio, out, detune, { type: "sine", freqStart: 660, duration: 0.025, gain: 0.4 });
        tone(audio, out, detune, {
          type: "sine",
          freqStart: 990,
          duration: 0.025,
          gain: 0.4,
          delay: 0.03,
        });
        break;
      case "ui":
        tone(audio, out, detune, { type: "sine", freqStart: 1200, duration: 0.015, gain: 0.15 });
        break;
      case "tick": {
        const hz = 400 + Math.min(1, Math.max(0, pitch)) * 1200;
        tone(audio, out, detune, { type: "sine", freqStart: hz, duration: 0.025, gain: 0.35 });
        break;
      }
    }
  };

  const play = (name: SoundName, opts?: { pitch?: number; gain?: number }): void => {
    if (!enabled) return;
    try {
      const audio = ensureContext();
      if (!audio || !master) return;
      if (audio.state === "suspended") audio.resume().catch(() => {});
      let out = master;
      const gain = opts?.gain;
      if (gain !== undefined && gain !== 1) {
        out = audio.createGain();
        out.gain.value = Math.min(1, Math.max(0, gain));
        out.connect(master);
      }
      synth(audio, out, name, opts?.pitch ?? 0.5);
    } catch {
      // Fire-and-forget: a failed play is silence, never an error.
    }
  };

  return {
    play,
    setEnabled(on: boolean): void {
      enabled = on;
    },
    isEnabled(): boolean {
      return enabled;
    },
  };
};
