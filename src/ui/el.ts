/** Tiny DOM builder: creates `tag`, assigns `props`, appends `children`. */
export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Partial<HTMLElementTagNameMap[K]>,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (props) Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
};

/** Inline 24x24 stroke icon from a path `d` string; styled via CSS `currentColor`. */
export const icon = (d: string): SVGSVGElement => {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
};

/** Two-step confirm button: first click arms (`confirmLabel`, 2s timeout), second click acts. */
export const armable = (
  label: string,
  confirmLabel: string,
  act: () => void,
): HTMLButtonElement => {
  let timer = 0;
  const disarm = (b: HTMLButtonElement): void => {
    timer = 0;
    b.textContent = label;
    b.classList.remove("armed");
  };
  const b = el("button", { type: "button" }, label);
  b.onclick = () => {
    if (timer) {
      window.clearTimeout(timer);
      disarm(b);
      act();
    } else {
      b.textContent = confirmLabel;
      b.classList.add("armed");
      timer = window.setTimeout(() => disarm(b), 2000);
    }
  };
  return b;
};

/** Normalizes an unknown rejection into a human-readable message. */
export const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Signature for the shared toast-reporting error sink. */
export type Report = (err: unknown) => void;
