/** Modal featured-build gallery: browse curated scenes and pick one to load. */
import "./gallery.css";

export interface GalleryEntry {
  id: string;
  name: string;
  blurb: string;
  voxels: number;
  sx: number;
  sy: number;
  sz: number;
  bytes: number;
  thumb: string;
}

export interface GalleryPick {
  entry: GalleryEntry;
  data: Uint8Array;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Modal scene browser; resolves null on dismiss (ESC or backdrop click). baseUrl ends with "/". */
export const openGallery = (baseUrl: string): Promise<GalleryPick | null> => {
  const { promise, resolve } = Promise.withResolvers<GalleryPick | null>();

  const overlay = document.createElement("div");
  overlay.className = "gallery-overlay";
  const card = document.createElement("div");
  card.className = "gallery-card";
  overlay.appendChild(card);

  const head = document.createElement("div");
  head.className = "gallery-head";
  const heading = document.createElement("h2");
  heading.textContent = "Gallery";
  const hint = document.createElement("p");
  hint.className = "gallery-hint";
  hint.textContent = "Loads into a fresh world; your autosave is untouched until you build.";
  head.append(heading, hint);
  card.appendChild(head);

  const body = document.createElement("div");
  body.className = "gallery-body";
  card.appendChild(body);

  const finish = (pick: GalleryPick | null): void => {
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
    resolve(pick);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") finish(null);
  };
  document.addEventListener("keydown", onKeyDown);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) finish(null);
  });

  const status = document.createElement("p");
  status.className = "gallery-status";
  status.textContent = "Loading gallery…";
  body.appendChild(status);

  /** Unrecoverable state (index fetch failed): error text plus an explicit Close. */
  const showFatal = (message: string): void => {
    body.replaceChildren();
    const error = document.createElement("p");
    error.className = "gallery-status gallery-error";
    error.textContent = message;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "gallery-close";
    close.textContent = "Close";
    close.addEventListener("click", () => finish(null));
    body.append(error, close);
  };

  const buildGrid = (entries: GalleryEntry[]): void => {
    body.replaceChildren();
    const inlineError = document.createElement("p");
    inlineError.className = "gallery-status gallery-error gallery-hidden";
    const grid = document.createElement("div");
    grid.className = "gallery-grid";
    body.append(inlineError, grid);

    const buttons: HTMLButtonElement[] = [];
    const setBusy = (busy: boolean): void => {
      for (const button of buttons) button.disabled = busy;
    };

    const pick = async (entry: GalleryEntry, button: HTMLButtonElement): Promise<void> => {
      inlineError.classList.add("gallery-hidden");
      setBusy(true);
      button.classList.add("gallery-busy");
      try {
        const resp = await fetch(`${baseUrl}gallery/${entry.id}.bbk.gz`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        // Some servers (vite dev) transparently gunzip .gz responses; sniff the magic instead of assuming.
        let bytes = new Uint8Array(await resp.arrayBuffer());
        if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
          const buf = await new Response(
            new Blob([bytes as Uint8Array<ArrayBuffer>])
              .stream()
              .pipeThrough(new DecompressionStream("gzip")),
          ).arrayBuffer();
          bytes = new Uint8Array(buf);
        }
        finish({ entry, data: bytes });
      } catch (err) {
        button.classList.remove("gallery-busy");
        setBusy(false);
        inlineError.textContent = `Couldn't load “${entry.name}”: ${errorMessage(err)}`;
        inlineError.classList.remove("gallery-hidden");
      }
    };

    for (const entry of entries) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "gallery-item";

      const thumbWrap = document.createElement("div");
      thumbWrap.className = "gallery-thumb";
      const img = document.createElement("img");
      img.src = `${baseUrl}gallery/${entry.thumb}`;
      img.loading = "lazy";
      img.alt = entry.name;
      img.addEventListener("error", () => {
        const placeholder = document.createElement("div");
        placeholder.className = "gallery-thumb-fallback";
        img.replaceWith(placeholder);
      });
      thumbWrap.appendChild(img);

      const name = document.createElement("strong");
      name.textContent = entry.name;
      const blurb = document.createElement("span");
      blurb.className = "gallery-blurb";
      blurb.textContent = entry.blurb;
      const meta = document.createElement("span");
      meta.className = "gallery-meta";
      meta.textContent = `${entry.voxels.toLocaleString()} voxels · ${Math.ceil(entry.bytes / 1024)} KiB`;

      item.append(thumbWrap, name, blurb, meta);
      item.addEventListener("click", () => void pick(entry, item));
      grid.appendChild(item);
      buttons.push(item);
    }
  };

  const loadIndex = async (): Promise<void> => {
    try {
      const resp = await fetch(`${baseUrl}gallery/index.json`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const entries = (await resp.json()) as GalleryEntry[];
      buildGrid(entries);
    } catch (err) {
      showFatal(`Couldn't load gallery: ${errorMessage(err)}`);
    }
  };
  void loadIndex();

  document.body.appendChild(overlay);
  return promise;
};
