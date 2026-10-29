import { useEffect, useRef, type RefObject } from "react";
import { bindViewportGestures, type ViewportGestureHandlers } from "./viewportGestures";

export function useViewportGestures(
  viewport: RefObject<HTMLElement | null>,
  mountKey: unknown,
  handlers: ViewportGestureHandlers,
) {
  const current = useRef(handlers);
  current.current = handlers;
  useEffect(() => {
    if (!viewport.current) return;
    return bindViewportGestures(viewport.current, {
      onPan: (dx, dy) => current.current.onPan(dx, dy),
      onZoom: (factor, x, y) => current.current.onZoom(factor, x, y),
    });
  }, [viewport, mountKey]);
}
