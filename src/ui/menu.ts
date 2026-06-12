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

/** Builds the top-right menu area: peers pill + File, Gallery, Share, Replay, Settings, Help. */
export const buildMenu = (state: AppState, actions: AppActions, report: Report): HTMLElement => {
  const bar = el("div", { className: "panel menubar" });

  const fileSection = (label: string, ...children: (HTMLElement | string)[]): HTMLElement =>
    el(
      "div",
      { className: "file-section" },
      el("div", { className: "section-label" }, label),
      ...children,
    );

  // World: two-step new-world confirm.
  const newBtn = armable("New world…", "Erase and start over?", () => {
    closePopovers();
    actions.newWorld();
  });
  newBtn.classList.add("pop-item");

  // Save: inline name + confirm.
  const nameInput = el("input", { type: "text", placeholder: "world name", value: "world" });
  const okBtn = el("button", { type: "button", className: "accent" }, "Save");
  okBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) return;
    closePopovers();
    actions.save(name).catch(report);
  };
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") okBtn.click();
  });

  // Saved worlds list, refreshed when the File panel opens.
  const list = el("div", { className: "save-list" });
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

  // Import / export.
  const fileInput = el("input", { type: "file", accept: ".bbk,.gz,.vox", className: "file-input" });
  fileInput.onchange = () => {
    const file = fileInput.files?.[0];
    if (file) actions.importFile(file).catch(report);
    fileInput.value = "";
  };
  const importBtn = el("button", { type: "button", className: "pop-item" }, "Import file…");
  importBtn.onclick = () => {
    closePopovers();
    fileInput.click();
  };
  const exportItems: readonly { label: string; run: () => Promise<void> }[] = [
    { label: ".bbk.gz", run: () => actions.exportFile() },
    { label: ".vox", run: () => actions.exportVox() },
    { label: ".glb", run: () => actions.exportGlb() },
    { label: "PNG", run: () => actions.screenshot() },
  ];
  const exportRow = el("div", { className: "export-row" });
  for (const item of exportItems) {
    const b = el("button", { type: "button" }, item.label);
    b.onclick = () => {
      closePopovers();
      item.run().catch(report);
    };
    exportRow.append(b);
  }

  const filePop = el(
    "div",
    { className: "pop menu-pop file-pop" },
    fileSection("World", newBtn),
    fileSection("Save as", el("div", { className: "save-as-row" }, nameInput, okBtn)),
    fileSection("Saved worlds", list),
    fileSection("Import / Export", importBtn, exportRow),
  );
  const file = menuItem("File", filePop);
  file.btn.onclick = () => {
    if (togglePopover(file.wrap, filePop)) refresh();
  };

  const settingsPop = el(
    "div",
    { className: "pop menu-pop settings-pop" },
    checkRow("Grid", state.grid),
    checkRow("Shadows", state.shadows),
    checkRow("Bloom", state.bloom),
    checkRow("Perf HUD", state.hud),
    checkRow("Sound", state.sound),
    checkRow("Autosave", state.autosave),
    choiceRow("Autosave interval", state.autosaveSec, [
      { value: 30, label: "30s" },
      { value: 60, label: "1m" },
      { value: 120, label: "2m" },
      { value: 300, label: "5m" },
    ]),
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

  const sharePop = el("div", { className: "pop menu-pop share-pop" });
  const share = menuItem("Share", sharePop);
  share.btn.classList.add("menu-cta");
  const shareItems: readonly { label: string; hint: string; run: () => Promise<void> }[] = [
    {
      label: "Build together",
      hint: "live room — friends join this world",
      run: () => actions.share(),
    },
    {
      label: "Copy build link",
      hint: "snapshot — the world travels in the URL",
      run: () => actions.shareBuildLink(),
    },
  ];
  for (const item of shareItems) {
    const button = el(
      "button",
      { type: "button", className: "pop-item share-item" },
      el("strong", {}, item.label),
      el("span", {}, item.hint),
    );
    button.onclick = () => {
      closePopovers();
      item.run().catch(report);
    };
    sharePop.append(button);
  }

  const galleryBtn = el("button", { type: "button", className: "menu-btn" }, "Gallery");
  galleryBtn.onclick = () => {
    closePopovers();
    actions.openGallery().catch(report);
  };

  const replayBtn = el("button", { type: "button", className: "menu-btn" }, "Replay");
  replayBtn.onclick = () => {
    closePopovers();
    actions.startReplay();
  };

  const helpBtn = el("button", { type: "button", className: "menu-btn" }, "Help");
  helpBtn.onclick = () => {
    closePopovers();
    state.helpOpen.set(!state.helpOpen());
  };

  bar.append(file.wrap, fileInput, galleryBtn, share.wrap, replayBtn, settings.wrap, helpBtn);

  // ── peers pill + roster popover ──────────────────────────────────────────

  const peersPop = el("div", { className: "pop menu-pop peers-pop" });
  const renderPeersPop = (): void => {
    peersPop.textContent = "";

    const roster = state.roster();
    if (roster.length === 0) {
      peersPop.append(el("div", { className: "pop-note" }, "No one else yet — send the invite"));
    }
    for (const peer of roster) {
      const dot = el("span", { className: "peer-dot" });
      dot.style.background = peer.color;
      peersPop.append(el("div", { className: "peer-row" }, dot, ` ${peer.name}`));
    }

    const copyBtn = el("button", { type: "button", className: "accent" }, "Copy invite");
    copyBtn.onclick = () => {
      actions.copyInvite().catch(report);
      closePopovers();
    };

    const leaveBtn = el("button", { type: "button" }, "Leave room");
    leaveBtn.onclick = () => {
      closePopovers();
      actions.leaveRoom();
    };

    peersPop.append(el("div", { className: "pop-actions" }, copyBtn, leaveBtn));
  };

  const pill = el("div", { className: "peers-pill hidden" });
  pill.style.pointerEvents = "auto"; // .peers-pill ships pointer-events: none; ours is a button
  pill.style.cursor = "pointer";

  const pillWrap = el("div", { className: "menu-item" }, pill, peersPop);
  pill.onclick = () => {
    if (togglePopover(pillWrap, peersPop)) renderPeersPop();
  };

  // Live-update the roster list while the popover is open (joins/leaves mid-look).
  state.roster.sub(() => {
    if (peersPop.classList.contains("open")) renderPeersPop();
  });

  const renderPill = (): void => {
    const count = state.peers();
    pill.classList.toggle("hidden", count < 0);
    if (count < 0) return;

    pill.textContent = "";
    if (count === 0) {
      pill.append("waiting for friends…");
      return;
    }

    for (const peer of state.roster()) {
      const dot = el("span", { className: "peer-dot", title: peer.name });
      dot.style.background = peer.color;
      pill.append(dot);
    }
    pill.append(String(count));
  };
  state.peers.sub(renderPill);
  state.roster.sub(renderPill);

  return el("div", { className: "menu-area" }, pillWrap, bar);
};
