import { SHAPE_FAMILIES } from "../core/types";
import type { AppState } from "../state";
import { el } from "./el";
import { togglePopover } from "./popover";

/** 0xRRGGBB → CSS hex string. */
export const hexString = (rgb: number): string =>
  `#${(rgb & 0xffffff).toString(16).padStart(6, "0")}`;

/** 0xRRGGBB → [h, s, v], each in [0, 1]. */
export const rgbToHsv = (rgb: number): [number, number, number] => {
  const r = ((rgb >>> 16) & 0xff) / 255;
  const g = ((rgb >>> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, max === 0 ? 0 : d / max, max];
};

/** [h, s, v] in [0, 1] → 0xRRGGBB. */
export const hsvToRgb = (h: number, s: number, v: number): number => {
  const i = Math.floor(h * 6) % 6;
  const f = h * 6 - Math.floor(h * 6);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = v;
  let g = t;
  let b = p;
  if (i === 1) {
    r = q;
    g = v;
    b = p;
  } else if (i === 2) {
    r = p;
    g = v;
    b = t;
  } else if (i === 3) {
    r = p;
    g = q;
    b = v;
  } else if (i === 4) {
    r = t;
    g = p;
    b = v;
  } else if (i === 5) {
    r = v;
    g = p;
    b = q;
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
};

const ctx2d = (c: HTMLCanvasElement): CanvasRenderingContext2D => {
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  return ctx;
};

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Builds the bottom-left color panel: shape + class chips, current chip + HSV popover, hex, swatches, recents. */
export const buildColorPanel = (state: AppState): HTMLElement => {
  const panel = el("div", { className: "panel color-panel" });

  const classRow = el("div", { className: "class-row" });
  const renderClasses = (): void => {
    classRow.textContent = "";
    const active = state.cls();
    for (const c of state.classes()) {
      const b = el("button", { type: "button", className: "chip", title: c.name }, c.name);
      if (c.id === active) b.classList.add("active");
      b.onclick = () => state.cls.set(c.id);
      classRow.append(b);
    }
  };
  state.classes.sub(renderClasses);
  state.cls.sub(renderClasses);

  // ── shape family + facing chips ─────────────────────────────────────────────

  const shapeRow = el("div", { className: "class-row shape-row" });
  for (let i = 0; i < SHAPE_FAMILIES.length; i++) {
    const family = SHAPE_FAMILIES[i];
    const b = el(
      "button",
      { type: "button", className: "chip", title: family.label },
      family.label,
    );
    b.onclick = () => state.family.set(i);
    state.family.sub((id) => b.classList.toggle("active", id === i));
    shapeRow.append(b);
  }

  // Facing picker, shown only while an oriented family is active. Labels differ
  // between axis (arrows) and diagonal (corners) families, so chips re-render on
  // family change; "Auto" faces away from the camera.
  const facingRow = el("div", { className: "class-row facing-row" });
  const renderFacings = (): void => {
    const family = SHAPE_FAMILIES[state.family()];
    const oriented = family.orientations.length > 1;
    facingRow.classList.toggle("facing-row-hidden", !oriented);

    facingRow.textContent = "";
    if (!oriented) return;

    const labels = ["Auto", ...(family.orientationLabels ?? [])];
    const hints = ["Faces away from the camera", ...(family.orientationHints ?? [])];
    for (let i = 0; i < labels.length; i++) {
      const value = i - 1; // -1 = auto, else orientation index
      const b = el("button", { type: "button", className: "chip", title: hints[i] }, labels[i]);
      if (state.facing() === value) b.classList.add("active");
      b.onclick = () => state.facing.set(value);
      facingRow.append(b);
    }
  };
  state.family.sub(renderFacings);
  state.facing.sub(renderFacings);

  let hue = 0;
  let sat = 1;
  let val = 1;
  let fromPicker = false;

  const sv = el("canvas", { className: "sv-canvas", width: 168, height: 128 });
  const hueStrip = el("canvas", { className: "hue-canvas", width: 168, height: 14 });
  const svCtx = ctx2d(sv);
  const hueCtx = ctx2d(hueStrip);

  const drawSv = (): void => {
    const w = sv.width;
    const h = sv.height;
    svCtx.fillStyle = `hsl(${hue * 360}, 100%, 50%)`;
    svCtx.fillRect(0, 0, w, h);
    const white = svCtx.createLinearGradient(0, 0, w, 0);
    white.addColorStop(0, "rgba(255,255,255,1)");
    white.addColorStop(1, "rgba(255,255,255,0)");
    svCtx.fillStyle = white;
    svCtx.fillRect(0, 0, w, h);
    const black = svCtx.createLinearGradient(0, 0, 0, h);
    black.addColorStop(0, "rgba(0,0,0,0)");
    black.addColorStop(1, "rgba(0,0,0,1)");
    svCtx.fillStyle = black;
    svCtx.fillRect(0, 0, w, h);
    svCtx.beginPath();
    svCtx.arc(sat * w, (1 - val) * h, 5, 0, Math.PI * 2);
    svCtx.strokeStyle = val > 0.5 ? "#000" : "#fff";
    svCtx.lineWidth = 2;
    svCtx.stroke();
  };

  const drawHue = (): void => {
    const w = hueStrip.width;
    const h = hueStrip.height;
    const g = hueCtx.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60}, 100%, 50%)`);
    hueCtx.fillStyle = g;
    hueCtx.fillRect(0, 0, w, h);
    hueCtx.strokeStyle = "#fff";
    hueCtx.lineWidth = 2;
    hueCtx.strokeRect(clamp01(hue) * (w - 4) + 0.5, 0.5, 3, h - 1);
  };

  const applyHsv = (): void => {
    fromPicker = true;
    state.color.set(hsvToRgb(hue, sat, val));
    fromPicker = false;
    drawSv();
    drawHue();
  };

  const dragPick = (canvas: HTMLCanvasElement, pick: (e: PointerEvent) => void): void => {
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      pick(e);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.buttons & 1) pick(e);
    });
  };
  dragPick(sv, (e) => {
    const r = sv.getBoundingClientRect();
    sat = clamp01((e.clientX - r.left) / r.width);
    val = 1 - clamp01((e.clientY - r.top) / r.height);
    applyHsv();
  });
  dragPick(hueStrip, (e) => {
    const r = hueStrip.getBoundingClientRect();
    hue = clamp01((e.clientX - r.left) / r.width);
    applyHsv();
  });

  const picker = el("div", { className: "pop picker-pop" }, sv, hueStrip);
  const chip = el("button", { type: "button", className: "current-chip", title: "Color picker" });
  chip.onclick = () => togglePopover(panel, picker);
  const colorWrap = el("div", { className: "color-wrap" }, chip, picker);

  const hexInput = el("input", {
    className: "hex-input",
    type: "text",
    maxLength: 7,
    spellcheck: false,
  });
  const commitHex = (): void => {
    const digits = /^#?([0-9a-fA-F]{6})$/.exec(hexInput.value.trim())?.[1];
    if (digits !== undefined) state.color.set(parseInt(digits, 16));
    else hexInput.value = hexString(state.color());
  };
  hexInput.addEventListener("change", commitHex);
  hexInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commitHex();
  });

  const swatchGrid = el("div", { className: "swatch-grid" });
  const swatchBtns: HTMLButtonElement[] = [];
  const markCurrent = (): void => {
    const cur = state.color();
    for (const b of swatchBtns) b.classList.toggle("current", Number(b.dataset.rgb) === cur);
  };
  state.swatches.sub((swatches) => {
    swatchGrid.textContent = "";
    swatchBtns.length = 0;
    for (const rgb of swatches) {
      const b = el("button", { type: "button", className: "swatch", title: hexString(rgb) });
      b.dataset.rgb = String(rgb);
      b.style.background = hexString(rgb);
      b.onclick = () => state.color.set(rgb);
      swatchBtns.push(b);
      swatchGrid.append(b);
    }
    markCurrent();
  });

  const recentsRow = el("div", { className: "recents-row" });
  const recentsSection = el(
    "div",
    { className: "panel-section recents-section empty" },
    el("div", { className: "section-label" }, "Recent"),
    recentsRow,
  );
  state.recents.sub((recents) => {
    recentsRow.textContent = "";
    for (const rgb of recents) {
      const b = el("button", { type: "button", className: "swatch recent", title: hexString(rgb) });
      b.style.background = hexString(rgb);
      b.onclick = () => state.color.set(rgb);
      recentsRow.append(b);
    }
    recentsSection.classList.toggle("empty", recents.length === 0);
  });

  state.color.sub((rgb) => {
    if (!fromPicker) {
      const [h, s, v] = rgbToHsv(rgb);
      if (s > 0 && v > 0) hue = h;
      sat = s;
      val = v;
      drawSv();
      drawHue();
    }
    const hex = hexString(rgb);
    chip.style.background = hex;
    chip.title = `Color picker — ${hex}`;
    if (document.activeElement !== hexInput) hexInput.value = hex;
    markCurrent();
  });

  const section = (label: string, ...children: HTMLElement[]): HTMLElement =>
    el(
      "div",
      { className: "panel-section" },
      el("div", { className: "section-label" }, label),
      ...children,
    );

  panel.append(
    section("Shape", shapeRow, facingRow),
    section("Material", classRow),
    section("Color", el("div", { className: "color-row" }, colorWrap, hexInput), swatchGrid),
    recentsSection,
  );
  return panel;
};
