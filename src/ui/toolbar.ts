import type { AppState, ToolId } from "../state";
import { el, icon } from "./el";

const TOOLS: readonly { id: ToolId; name: string; key: string; d: string }[] = [
  {
    id: "place",
    name: "Place",
    key: "B",
    d: "M12 3 4 7.5v9L12 21l8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9",
  },
  { id: "erase", name: "Erase", key: "E", d: "m13 5 6 6-8 8H7l-3-3 9-11zM9 9l6 6M5 20h15" },
  {
    id: "paint",
    name: "Paint",
    key: "P",
    d: "M12 3s6 7.2 6 11.2a6 6 0 0 1-12 0C6 10.2 12 3 12 3z",
  },
  { id: "box", name: "Box", key: "X", d: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M12 9v6M9 12h6" },
  {
    id: "pick",
    name: "Pick",
    key: "I",
    d: "m14 6 4 4M11 9l4.5-4.5L20 9l-4.5 4.5L10 15l1-6zM10 15l-6 6",
  },
];

/** Builds the left-center vertical tool buttons bound to `state.tool`. */
export const buildToolbar = (state: AppState): HTMLElement => {
  const bar = el("div", { className: "panel toolbar" });
  for (const t of TOOLS) {
    const b = el(
      "button",
      { type: "button", className: "tool-btn", title: `${t.name} (${t.key})` },
      icon(t.d),
    );
    b.onclick = () => state.tool.set(t.id);
    state.tool.sub((id) => b.classList.toggle("active", id === t.id));
    bar.append(b);
  }
  return bar;
};
