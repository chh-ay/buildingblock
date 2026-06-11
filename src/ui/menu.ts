import type { AppActions, AppState, SaveMeta, Signal } from "../state";
import { armable, el, type Report } from "./el";
import { closePopovers, togglePopover } from "./popover";

const menuItem = (
  label: string,
  pop: HTMLElement,
): { wrap: HTMLElement; btn: HTMLButtonElement } => {
  const btn = el("button", { type: "button", className: "menu-btn" }, label);
  const wrap = el("div", { className: "menu-item" }, btn, pop);
  btn.onclick = () => togglePopover(wrap, pop);
  return { wrap, btn };
};

const checkRow = (label: string, sig: Signal<boolean>): HTMLElement => {
  const input = el("input", { type: "checkbox" });
  input.onchange = () => sig.set(input.checked);
  sig.sub((v) => {
    input.checked = v;
  });
  return el("label", { className: "check-row" }, input, label);
};

const choiceRow = <T extends string | number>(
  label: string,
  sig: Signal<T>,
  options: readonly { value: T; label: string }[],
): HTMLElement => {
  const sel = el("select");
  for (const o of options) sel.append(el("option", { value: String(o.value) }, o.label));
  sel.onchange = () => {
    const found = options.find((o) => String(o.value) === sel.value);
    if (found) sig.set(found.value);
  };
  sig.sub((v) => {
    sel.value = String(v);
  });
  return el("label", { className: "set-row" }, el("span", {}, label), sel);
};

const sliderRow = (
  label: string,
  sig: Signal<number>,
  min: number,
  max: number,
  step: number,
  suffix: string,
): HTMLElement => {
  const input = el("input", {
    type: "range",
    min: String(min),
    max: String(max),
    step: String(step),
  });
  const value = el("span", { className: "slider-value" });
  input.oninput = () => sig.set(Number(input.value));
  sig.sub((v) => {
    input.value = String(v);
    value.textContent = `${v}${suffix}`;
  });
  return el("label", { className: "set-row slider-row" }, el("span", {}, label), input, value);
};

const selectRow = (label: string, sig: Signal<number>, options: readonly number[]): HTMLElement => {
  const sel = el("select");
  for (const o of options) sel.append(el("option", { value: String(o) }, String(o)));
  sel.onchange = () => sig.set(Number(sel.value));
  sig.sub((v) => {
    sel.value = String(v);
  });
  return el("label", { className: "select-row" }, el("span", {}, label), sel);
};

const saveRow = (
  meta: SaveMeta,
  actions: AppActions,
  report: Report,
  refresh: () => void,
): HTMLElement => {
  const load = el("button", { type: "button", className: "accent" }, "Load");
  load.onclick = () => {
    closePopovers();
    actions.load(meta.name).catch(report);
  };
  const del = armable("Delete", "Delete?", () => {
    actions.deleteSave(meta.name).then(refresh).catch(report);
  });
  return el(
    "div",
    { className: "save-row" },
    el(
      "div",
      { className: "save-info" },
      el("div", { className: "save-name" }, meta.name),
      el(
        "div",
        { className: "save-meta" },
        `${new Date(meta.updatedAt).toLocaleString()} · ${(meta.bytes / 1024).toFixed(1)} KB`,
      ),
    ),
    load,
    del,
  );
};

/** Builds the top-right menu area: peers pill + New, Save, Load, Export, Import, Share, Settings, Help. */
export const buildMenu = (state: AppState, actions: AppActions, report: Report): HTMLElement => {
  const bar = el("div", { className: "panel menubar" });

  const newBtn = armable("New", "New?", () => actions.newWorld());
  newBtn.classList.add("menu-btn");

  const nameInput = el("input", { type: "text", placeholder: "world name", value: "world" });
  const savePop = el("div", { className: "pop menu-pop save-pop" });
  const save = menuItem("Save", savePop);
  const okBtn = el("button", { type: "button", className: "accent" }, "OK");
  okBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) return;
    closePopovers();
    actions.save(name).catch(report);
  };
  const cancelBtn = el("button", { type: "button" }, "Cancel");
  cancelBtn.onclick = closePopovers;
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") okBtn.click();
  });
  savePop.append(nameInput, el("div", { className: "pop-actions" }, okBtn, cancelBtn));
  save.btn.onclick = () => {
    if (togglePopover(save.wrap, savePop)) {
      nameInput.focus();
      nameInput.select();
    }
  };

  const list = el("div", { className: "save-list" });
  const loadPop = el("div", { className: "pop menu-pop load-pop" }, list);
  const load = menuItem("Load", loadPop);
  const refresh = (): void => {
    list.textContent = "";
    list.append(el("div", { className: "pop-note" }, "Loading…"));
    actions
      .listSaves()
      .then((saves) => {
        list.textContent = "";
        if (saves.length === 0) {
          list.append(el("div", { className: "pop-note" }, "No saves yet"));
          return;
        }
        for (const meta of saves) list.append(saveRow(meta, actions, report, refresh));
      })
      .catch(report);
  };
  load.btn.onclick = () => {
    if (togglePopover(load.wrap, loadPop)) refresh();
  };

  const exportPop = el("div", { className: "pop menu-pop export-pop" });
  const exp = menuItem("Export", exportPop);
  const exportItems: readonly { label: string; run: () => Promise<void> }[] = [
    { label: "World (.bbk.gz)", run: () => actions.exportFile() },
    { label: "MagicaVoxel (.vox)", run: () => actions.exportVox() },
    { label: "Mesh (.glb)", run: () => actions.exportGlb() },
    { label: "Screenshot (.png)", run: () => actions.screenshot() },
  ];
  for (const item of exportItems) {
    const b = el("button", { type: "button", className: "pop-item" }, item.label);
    b.onclick = () => {
      closePopovers();
      item.run().catch(report);
    };
    exportPop.append(b);
  }

  const fileInput = el("input", { type: "file", accept: ".bbk,.gz,.vox", className: "file-input" });
  fileInput.onchange = () => {
    const file = fileInput.files?.[0];
    if (file) actions.importFile(file).catch(report);
    fileInput.value = "";
  };
  const importBtn = el("button", { type: "button", className: "menu-btn" }, "Import");
  importBtn.onclick = () => {
    closePopovers();
    fileInput.click();
  };

  const settingsPop = el(
    "div",
    { className: "pop menu-pop settings-pop" },
    checkRow("Grid", state.grid),
    checkRow("Shadows", state.shadows),
    checkRow("Bloom", state.bloom),
    checkRow("Perf HUD", state.hud),
    selectRow("Pixel ratio cap", state.dprCap, [1, 1.5, 2]),
    choiceRow("Shadow quality", state.shadowRes, [
      { value: 1024, label: "Low" },
      { value: 2048, label: "Medium" },
      { value: 4096, label: "High" },
      { value: 8192, label: "Ultra" },
    ]),
    choiceRow("FPS limit", state.fpsCap, [
      { value: 30, label: "30" },
      { value: 60, label: "60" },
      { value: 120, label: "120" },
    ]),
    choiceRow("Renderer", state.renderer, [
      { value: "auto", label: "Auto" },
      { value: "webgl", label: "WebGL2" },
      { value: "webgpu", label: "WebGPU" },
    ]),
    choiceRow("Sun", state.sunMode, [
      { value: "time", label: "Follow time" },
      { value: "manual", label: "Manual" },
    ]),
    sliderRow("Sun angle", state.sunAzimuth, 0, 360, 5, "°"),
    sliderRow("Sun height", state.sunElevation, 10, 85, 1, "°"),
  );
  const settings = menuItem("Settings", settingsPop);

  const shareBtn = el("button", { type: "button", className: "menu-btn" }, "Share");
  shareBtn.onclick = () => {
    closePopovers();
    actions.share().catch(report);
  };

  const helpBtn = el("button", { type: "button", className: "menu-btn" }, "Help");
  helpBtn.onclick = () => {
    closePopovers();
    state.helpOpen.set(!state.helpOpen());
  };

  bar.append(
    newBtn,
    save.wrap,
    load.wrap,
    exp.wrap,
    importBtn,
    fileInput,
    shareBtn,
    settings.wrap,
    helpBtn,
  );

  const pill = el("div", { className: "peers-pill hidden" });
  const renderPill = (): void => {
    const count = state.peers();
    pill.classList.toggle("hidden", count < 0);
    if (count < 0) return;
    pill.textContent = "";
    for (const peer of state.roster()) {
      const dot = el("span", { className: "peer-dot", title: peer.name });
      dot.style.background = peer.color;
      pill.append(dot);
    }
    pill.append(`${count} ${count === 1 ? "peer" : "peers"}`);
    pill.title = state
      .roster()
      .map((peer) => peer.name)
      .join(", ");
  };
  state.peers.sub(renderPill);
  state.roster.sub(renderPill);

  return el("div", { className: "menu-area" }, pill, bar);
};
