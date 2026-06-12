/** Minimal centered yes/no dialog; ESC and backdrop dismissal resolve false. */
import { el } from "./el";

export interface ConfirmOpts {
  title: string;
  body?: string;
  yes: string;
  no: string;
}

export const confirmDialog = (opts: ConfirmOpts): Promise<boolean> => {
  const { promise, resolve } = Promise.withResolvers<boolean>();

  const overlay = el("div", { className: "size-picker confirm-overlay" });
  const card = el("div", { className: "size-card" });
  overlay.appendChild(card);
  card.appendChild(el("h2", {}, opts.title));
  if (opts.body) card.appendChild(el("p", {}, opts.body));

  const finish = (answer: boolean): void => {
    overlay.remove();
    window.removeEventListener("keydown", onKey, true);
    resolve(answer);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      finish(false);
    }
  };
  window.addEventListener("keydown", onKey, true);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) finish(false);
  });

  const yesBtn = el("button", { type: "button", className: "confirm-yes" }, opts.yes);
  yesBtn.onclick = () => finish(true);
  const noBtn = el("button", { type: "button", className: "confirm-no" }, opts.no);
  noBtn.onclick = () => finish(false);
  card.appendChild(el("div", { className: "confirm-actions" }, yesBtn, noBtn));

  document.body.appendChild(overlay);
  yesBtn.focus();
  return promise;
};
