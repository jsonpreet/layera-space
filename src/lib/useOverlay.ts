import { useEffect } from "react";
import { useApp } from "../store/app";

/**
 * Marks a popover, menu or modal as open for as long as it is mounted.
 *
 * Native child webviews (the browser preview pane) are OS-level layers painted
 * above the whole React tree, so anything that floats over the page would be
 * invisible while one is on screen. Panes watch this count and hide themselves.
 */
export function useOverlay() {
  useEffect(() => {
    const { pushOverlay, popOverlay } = useApp.getState();
    pushOverlay();
    return popOverlay;
  }, []);
}

/**
 * Renders nothing; marks an overlay as open for as long as it stays mounted.
 * For popovers whose open state lives inside a component that must keep
 * rendering while closed: `{open && <OverlayMark />}`.
 */
export function OverlayMark() {
  useOverlay();
  return null;
}
