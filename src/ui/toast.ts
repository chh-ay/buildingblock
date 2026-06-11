import type { AppState } from "../state";
import { el } from "./el";

/** Builds the bottom-center toast pill; shows `state.toast` for 2.4s then clears it. */
export const buildToast = (state: AppState): HTMLElement => {
  const pill = el("div", { className: "toast" });
  let timer = 0;
  state.toast.sub((msg) => {
    window.clearTimeout(timer);
    timer = 0;
    if (!msg) {
      pill.classList.remove("show");
      return;
    }
    pill.textContent = msg;
    pill.classList.add("show");
    timer = window.setTimeout(() => state.toast.set(""), 2400);
  });
  return pill;
};
