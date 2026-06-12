import type { AppState } from "../state";
import { el } from "./el";

const hrow = (keys: readonly string[], desc: string): HTMLElement => {
  const k = el("span", { className: "help-keys" });
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) k.append(" / ");
    k.append(el("kbd", {}, keys[i] ?? ""));
  }
  return el("div", { className: "help-row" }, k, el("span", { className: "help-desc" }, desc));
};

const KEYBOARD: readonly (readonly [readonly string[], string])[] = [
  [["B"], "Place tool"],
  [["E"], "Erase tool"],
  [["P"], "Paint tool"],
  [["X"], "Box tool"],
  [["I"], "Pick tool"],
  [["1–9"], "Select swatch"],
  [["Ctrl+Z"], "Undo"],
  [["Ctrl+Y", "Ctrl+Shift+Z"], "Redo"],
  [["Esc"], "Cancel gesture"],
  [["F"], "Focus block / frame build"],
  [["R"], "Rotate block"],
  [["[", "]"], "Build height up/down"],
  [["\\"], "Toggle build plane"],
  [["G"], "Toggle grid"],
  [["F3"], "Perf HUD"],
  [["?"], "Help"],
];

const POINTER: readonly (readonly [readonly string[], string])[] = [
  [["LMB"], "Act with tool"],
  [["RMB"], "Orbit camera"],
  [["MMB"], "Pan camera"],
  [["Wheel"], "Zoom"],
  [["Wheel"], "Box drag: set height"],
  [["Tap"], "Act with tool"],
  [["1 finger"], "Orbit"],
  [["2 fingers"], "Pan / zoom"],
];

const column = (
  title: string,
  rows: readonly (readonly [readonly string[], string])[],
): HTMLElement => {
  const col = el("div", { className: "help-col" }, el("div", { className: "help-title" }, title));
  for (const [keys, desc] of rows) col.append(hrow(keys, desc));
  return col;
};

/** Builds the full-screen help overlay driven by `state.helpOpen`. */
export const buildHelp = (state: AppState): HTMLElement => {
  const escBtn = el("button", { type: "button", className: "help-esc" }, "Esc");
  const card = el(
    "div",
    { className: "panel help-card" },
    el(
      "div",
      { className: "help-head" },
      el("span", { className: "help-heading" }, "Hotkeys"),
      escBtn,
    ),
    el(
      "div",
      { className: "help-cols" },
      column("Keyboard", KEYBOARD),
      column("Mouse / Touch", POINTER),
    ),
  );
  const overlay = el("div", { className: "help-overlay" }, card);
  overlay.onclick = () => state.helpOpen.set(false);
  state.helpOpen.sub((open) => overlay.classList.toggle("open", open));
  return overlay;
};
