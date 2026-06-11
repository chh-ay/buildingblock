let current: { wrap: HTMLElement; pop: HTMLElement } | null = null;

/** Closes the currently open popover, if any. */
export const closePopovers = (): void => {
  if (!current) return;
  current.pop.classList.remove("open");
  current = null;
};

/**
 * Toggles `pop` (closing any other popover first); `wrap` is the anchor subtree that
 * outside-click dismissal treats as "inside". Returns true when the popover opened.
 */
export const togglePopover = (wrap: HTMLElement, pop: HTMLElement): boolean => {
  if (current?.pop === pop) {
    closePopovers();
    return false;
  }
  closePopovers();
  current = { wrap, pop };
  pop.classList.add("open");
  return true;
};

/** Installs the document-level outside-click dismisser. Call once from initUi. */
export const installPopoverDismiss = (): void => {
  document.addEventListener("pointerdown", (e) => {
    if (current && e.target instanceof Node && !current.wrap.contains(e.target)) closePopovers();
  });
};
