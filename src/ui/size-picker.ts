/** Modal world-size chooser shown at first boot and from the New-world flow. */
import { CHUNK_BITS, WORLD_PRESETS, type WorldPreset } from "../core/types";

const formatPreset = (preset: WorldPreset): { dims: string; voxels: string } => {
  const sx = preset.cx << CHUNK_BITS;
  const sy = preset.cy << CHUNK_BITS;
  const sz = preset.cz << CHUNK_BITS;
  const millions = (sx * sy * sz) / 1_000_000;
  return {
    dims: `${sx} × ${sy} × ${sz}`,
    voxels:
      millions >= 1 ? `${millions.toFixed(1)}M voxels` : `${Math.round(millions * 1000)}K voxels`,
  };
};

/** Resolves the chosen preset; null only when cancellable and dismissed. */
export const pickWorldSize = (
  recommendedId: string,
  cancellable: boolean,
  attract = false,
): Promise<WorldPreset | null> => {
  const { promise, resolve } = Promise.withResolvers<WorldPreset | null>();
  const overlay = document.createElement("div");
  overlay.className = attract ? "size-picker attract" : "size-picker";

  const card = document.createElement("div");
  card.className = "size-card";
  overlay.appendChild(card);

  const title = document.createElement("h2");
  title.textContent = attract ? "Welcome to buildingblock" : "World size";
  const subtitle = document.createElement("p");
  subtitle.textContent = attract
    ? "A world is already spinning behind this card. Pick your build area and take over."
    : "Pick the build area. Bigger worlds cost more memory and shadow detail.";
  card.append(title, subtitle);

  const finish = (preset: WorldPreset | null): void => {
    overlay.remove();
    resolve(preset);
  };

  for (const preset of WORLD_PRESETS) {
    const { dims, voxels } = formatPreset(preset);
    const button = document.createElement("button");
    button.type = "button";
    button.className = preset.id === recommendedId ? "size-option recommended" : "size-option";
    const name = document.createElement("strong");
    name.textContent = preset.label;
    const detail = document.createElement("span");
    detail.textContent = `${dims} · ${voxels}`;
    button.append(name, detail);
    button.addEventListener("click", () => finish(preset));
    card.appendChild(button);
  }

  if (cancellable) {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "size-cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => finish(null));
    card.appendChild(cancel);
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) finish(null);
    });
  }

  document.body.appendChild(overlay);
  return promise;
};
