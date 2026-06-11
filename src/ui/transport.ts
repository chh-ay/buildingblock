/** Replay transport: play/pause, scrubber, speed cycle, skip — Create-ponder style. */
import { el } from "./el";

export interface ReplayTransport {
  readonly root: HTMLElement;
  /** Move the playhead (0..1); ignored while the user is dragging the scrubber. */
  setProgress(frac: number): void;
  setPlaying(playing: boolean): void;
  setSpeed(mult: number): void;
  dispose(): void;
}

export interface TransportHooks {
  onTogglePlay(): void;
  /** frac in 0..1, fired continuously while scrubbing. */
  onSeek(frac: number): void;
  onCycleSpeed(): void;
  onSkip(): void;
}

const SCRUB_STEPS = 1000;

export const createReplayTransport = (hooks: TransportHooks): ReplayTransport => {
  const playBtn = el("button", { type: "button", className: "rt-play", title: "Play / pause" });
  playBtn.textContent = "⏸";
  playBtn.onclick = hooks.onTogglePlay;

  const scrub = el("input", {
    type: "range",
    className: "rt-scrub",
    min: "0",
    max: String(SCRUB_STEPS),
    step: "1",
    value: "0",
  });
  let dragging = false;
  scrub.addEventListener("pointerdown", () => {
    dragging = true;
  });
  scrub.addEventListener("pointerup", () => {
    dragging = false;
  });
  scrub.addEventListener("input", () => hooks.onSeek(Number(scrub.value) / SCRUB_STEPS));

  const speedBtn = el("button", { type: "button", className: "rt-speed", title: "Playback speed" });
  speedBtn.textContent = "1×";
  speedBtn.onclick = hooks.onCycleSpeed;

  const skipBtn = el("button", { type: "button", className: "rt-skip", title: "Skip to the end" });
  skipBtn.textContent = "Skip";
  skipBtn.onclick = hooks.onSkip;

  const root = el("div", { className: "replay-transport" }, playBtn, scrub, speedBtn, skipBtn);
  document.body.appendChild(root);

  return {
    root,
    setProgress(frac) {
      if (dragging) return;
      scrub.value = String(Math.round(Math.min(1, Math.max(0, frac)) * SCRUB_STEPS));
    },
    setPlaying(playing) {
      playBtn.textContent = playing ? "⏸" : "⏵";
    },
    setSpeed(mult) {
      speedBtn.textContent = `${mult}×`;
    },
    dispose() {
      root.remove();
    },
  };
};
