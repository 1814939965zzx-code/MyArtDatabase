export type ViewportGestureHandlers = {
  onPan: (dx: number, dy: number) => void;
  onZoom: (factor: number, clientX: number, clientY: number) => void;
};

type MacGestureEvent = Event & { scale: number; clientX: number; clientY: number };

type WheelInput = Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY"> & { wheelDeltaY?: number };

export function wheelInputKind(event: WheelInput): "trackpad" | "mouse" | "unknown" {
  if (event.deltaMode !== 0) return "mouse";
  // On macOS, Chromium/WebKit expose precise scrolling as wheelDeltaY = -3 * deltaY.
  // Check this before magnitude: a fast swipe can have large deltas, a mouse notch small ones.
  if (event.deltaY && Number.isFinite(event.wheelDeltaY) && event.wheelDeltaY) {
    const ratio = Math.abs(event.wheelDeltaY / event.deltaY);
    return Math.abs(ratio - 3) < .05 ? "trackpad" : "mouse";
  }
  if (event.deltaX !== 0 || !Number.isInteger(event.deltaY) || Math.abs(event.deltaY) < 40) return "trackpad";
  return "unknown";
}

/** Native non-passive listeners keep gestures inside the canvas, including Safari pinch. */
export function bindViewportGestures(element: HTMLElement, handlers: ViewportGestureHandlers): () => void {
  let pinching = false;
  let lastScale = 1;
  let lastPinchEnd = -Infinity;
  let lastTrackpadTime = -Infinity;
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    // Safari can also emit wheel events during a native gesture. Process the pinch once.
    if (pinching || ((event.ctrlKey || event.metaKey) && event.timeStamp - lastPinchEnd < 100)) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;
    if (event.ctrlKey || event.metaKey) {
      handlers.onZoom(Math.exp(-dy * .01), event.clientX, event.clientY);
    } else {
      const kind = wheelInputKind(event);
      const trackpad = kind === "trackpad"
        || (kind === "unknown" && event.timeStamp - lastTrackpadTime < 200);
      if (trackpad) {
        lastTrackpadTime = event.timeStamp;
        handlers.onPan(dx, dy);
      } else {
        lastTrackpadTime = -Infinity;
        handlers.onZoom(Math.exp(-(dy || dx) * .0014), event.clientX, event.clientY);
      }
    }
  };
  const start = (raw: Event) => {
    raw.preventDefault();
    const event = raw as MacGestureEvent;
    pinching = true;
    lastScale = Number.isFinite(event.scale) && event.scale > 0 ? event.scale : 1;
  };
  const change = (raw: Event) => {
    raw.preventDefault();
    const event = raw as MacGestureEvent;
    if (!pinching || !Number.isFinite(event.scale) || event.scale <= 0) return;
    handlers.onZoom(event.scale / lastScale, event.clientX, event.clientY);
    lastScale = event.scale;
  };
  const end = (event: Event) => {
    event.preventDefault();
    pinching = false;
    lastPinchEnd = event.timeStamp;
  };
  element.addEventListener("wheel", wheel, { passive: false });
  element.addEventListener("gesturestart", start, { passive: false });
  element.addEventListener("gesturechange", change, { passive: false });
  element.addEventListener("gestureend", end, { passive: false });
  return () => {
    element.removeEventListener("wheel", wheel);
    element.removeEventListener("gesturestart", start);
    element.removeEventListener("gesturechange", change);
    element.removeEventListener("gestureend", end);
  };
}
