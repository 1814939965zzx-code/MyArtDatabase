import assert from "node:assert/strict";
import test from "node:test";
import { bindViewportGestures } from "../src/viewportGestures.ts";

function setup() {
  const element = new EventTarget();
  element.clientHeight = 600;
  const pans = [];
  const zooms = [];
  const cleanup = bindViewportGestures(element, {
    onPan: (...args) => pans.push(args),
    onZoom: (...args) => zooms.push(args),
  });
  const send = (type, props = {}) => {
    const event = new Event(type, { cancelable: true });
    const values = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, clientX: 240, clientY: 180, ...props };
    for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value });
    element.dispatchEvent(event);
    return event;
  };
  return { pans, zooms, send, cleanup };
}

test("two-finger horizontal, vertical and momentum scroll pan without zooming", () => {
  const { pans, zooms, send } = setup();
  for (const [deltaX, deltaY] of [[12.5, 0], [0, -8.2], [3, 4], [.2, .1]]) {
    assert.equal(send("wheel", { deltaX, deltaY }).defaultPrevented, true);
  }
  assert.deepEqual(pans, [[12.5, 0], [0, -8.2], [3, 4], [.2, .1]]);
  assert.equal(zooms.length, 0);
});

test("Chromium pinch zooms around its pointer, never pans or zooms the browser", () => {
  const { pans, zooms, send } = setup();
  const event = send("wheel", { ctrlKey: true, deltaY: -10 });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(zooms, [[Math.exp(.1), 240, 180]]);
  assert.equal(pans.length, 0);
  send("wheel", { metaKey: true, deltaY: 10 });
  assert.ok(zooms[1][0] < 1);
});

test("ordinary mouse wheels zoom without requiring modifiers, including line and page mode", () => {
  const { pans, zooms, send } = setup();
  send("wheel", { deltaY: 100, wheelDeltaY: -120 });
  send("wheel", { deltaY: -100, wheelDeltaY: 120 });
  send("wheel", { deltaMode: 1, deltaX: 2, deltaY: -3 });
  send("wheel", { deltaMode: 2, deltaY: 1 });
  assert.equal(pans.length, 0);
  assert.ok(zooms[0][0] < 1);
  assert.ok(zooms[1][0] > 1);
  assert.equal(zooms[2][0], Math.exp(48 * .0014));
  assert.equal(zooms[3][0], Math.exp(-600 * .0014));
});

test("small mouse notches stay zoom, fast trackpad swipes stay pan", () => {
  const { pans, zooms, send } = setup();
  send("wheel", { deltaY: 3, wheelDeltaY: -120 });
  send("wheel", { deltaY: 200, wheelDeltaY: -600 });
  assert.equal(zooms.length, 1);
  assert.deepEqual(pans, [[0, 200]]);
});

test("trackpad inertia remains pan but an explicit mouse event switches immediately", () => {
  const { pans, zooms, send } = setup();
  send("wheel", { deltaY: 5, timeStamp: 0 });
  send("wheel", { deltaY: 120, timeStamp: 16 });
  send("wheel", { deltaY: 100, wheelDeltaY: -120, timeStamp: 20 });
  send("wheel", { deltaY: 100, timeStamp: 21 });
  send("wheel", { deltaY: 6, wheelDeltaY: -18, timeStamp: 30 });
  assert.deepEqual(pans, [[0, 5], [0, 120], [0, 6]]);
  assert.equal(zooms.length, 2);
});

test("ambiguous large pixel wheel events default to zoom after the gesture expires", () => {
  const { pans, zooms, send } = setup();
  send("wheel", { deltaY: 1, timeStamp: 0 });
  send("wheel", { deltaY: 100, timeStamp: 250 });
  assert.deepEqual(pans, [[0, 1]]);
  assert.equal(zooms.length, 1);
});

test("Safari cumulative pinch scales are applied incrementally and duplicate wheel is suppressed", () => {
  const { pans, zooms, send } = setup();
  assert.equal(send("gesturestart", { scale: 1, timeStamp: 0 }).defaultPrevented, true);
  send("gesturechange", { scale: 1.1, timeStamp: 10 });
  send("wheel", { ctrlKey: true, deltaY: -10, timeStamp: 15 });
  send("gesturechange", { scale: 1.2, timeStamp: 20 });
  send("wheel", { deltaX: 5, timeStamp: 25 });
  send("gestureend", { timeStamp: 30 });
  send("wheel", { ctrlKey: true, deltaY: -10, timeStamp: 40 });
  assert.equal(zooms.length, 2);
  assert.ok(Math.abs(zooms[0][0] * zooms[1][0] - 1.2) < 1e-9);
  assert.equal(pans.length, 0);
  send("wheel", { ctrlKey: true, deltaY: -10, timeStamp: 200 });
  assert.equal(zooms.length, 3);
  send("wheel", { deltaY: 5, timeStamp: 210 });
  assert.deepEqual(pans, [[0, 5]]);
});

test("invalid native scales are ignored and unmount removes every listener", () => {
  const { pans, zooms, send, cleanup } = setup();
  send("gesturestart", { scale: 1 });
  send("gesturechange", { scale: 0 });
  send("gesturechange", { scale: NaN });
  assert.equal(zooms.length, 0);
  cleanup();
  assert.equal(send("wheel", { deltaY: 1 }).defaultPrevented, false);
  send("gesturestart", { scale: 1 });
  send("gesturechange", { scale: 2 });
  send("gestureend");
  assert.equal(zooms.length, 0);
  assert.equal(pans.length, 0);
});
