import "./ui.css";
import type { AppActions, AppState } from "../state";
import { buildColorPanel } from "./color";
import { errMsg } from "./el";
import { buildHelp } from "./help";
import { buildHud } from "./hud";
import { buildMenu } from "./menu";
import { installPopoverDismiss } from "./popover";
import { buildToast } from "./toast";
import { buildToolbar } from "./toolbar";

/** Mounts the editor overlay UI into `root` and wires it to state signals and actions. */
export const initUi = (root: HTMLElement, state: AppState, actions: AppActions): void => {
  root.classList.add("ui");
  const report = (err: unknown): void => state.toast.set(errMsg(err));
  root.append(
    buildHud(state),
    buildToolbar(state),
    buildColorPanel(state),
    buildMenu(state, actions, report),
    buildToast(state),
    buildHelp(state),
  );
  installPopoverDismiss();
  root.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)
      e.stopPropagation();
  });
};
