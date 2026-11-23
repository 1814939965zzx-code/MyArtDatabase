import assert from "node:assert/strict";
import test from "node:test";
import { autoAssetScaleForViewport, parsePreviewScalePreference, PREVIEW_SCALE_AUTO_MAX, PREVIEW_SCALE_MAX, PREVIEW_SCALE_MIN } from "../src/previewScale.ts";

const AUTO = { mode: "auto", value: 1 };

test("auto scale follows the window breakpoints", () => {
  assert.equal(autoAssetScaleForViewport(1366, 768), .7);
  assert.equal(autoAssetScaleForViewport(1280, 800), .7);
  assert.equal(autoAssetScaleForViewport(1600, 900), 1);
  assert.equal(autoAssetScaleForViewport(1440, 900), 1);
  assert.equal(autoAssetScaleForViewport(1920, 1080), 1.5);
  assert.equal(autoAssetScaleForViewport(2560, 1440), 1.5);
  assert.equal(autoAssetScaleForViewport(1920, 850), 1);
  assert.equal(autoAssetScaleForViewport(0, 0), 1);
  assert.equal(autoAssetScaleForViewport(Number.NaN, 900), 1);
});

test("auto scale stays inside the documented range", () => {
  for (const [width, height] of [[800, 600], [1366, 768], [1600, 900], [1920, 1080], [3840, 2160]]) {
    const scale = autoAssetScaleForViewport(width, height);
    assert.ok(scale >= PREVIEW_SCALE_MIN && scale <= PREVIEW_SCALE_AUTO_MAX);
    assert.ok(scale <= PREVIEW_SCALE_MAX);
  }
});

test("scale preference prefers v2 and migrates v1", () => {
  assert.deepEqual(parsePreviewScalePreference(null, null), AUTO);
  assert.deepEqual(parsePreviewScalePreference(null, "1"), AUTO);
  assert.deepEqual(parsePreviewScalePreference(null, "1.0"), AUTO);
  assert.deepEqual(parsePreviewScalePreference(null, "0.7"), { mode: "manual", value: .7 });
  assert.deepEqual(parsePreviewScalePreference(JSON.stringify({ mode: "manual", value: 1.35 }), "0.7"), { mode: "manual", value: 1.35 });
  assert.deepEqual(parsePreviewScalePreference(JSON.stringify({ mode: "manual", value: 1 }), "0.7"), { mode: "manual", value: 1 });
  assert.deepEqual(parsePreviewScalePreference(JSON.stringify({ mode: "auto", value: 1 }), "0.7"), AUTO);
  assert.deepEqual(parsePreviewScalePreference("not-json", "0.7"), { mode: "manual", value: .7 });
  assert.deepEqual(parsePreviewScalePreference(JSON.stringify({ mode: "manual", value: 5 }), "0.7"), { mode: "manual", value: .7 });
  assert.deepEqual(parsePreviewScalePreference(JSON.stringify({ mode: "manual", value: .2 }), null), AUTO);
  assert.deepEqual(parsePreviewScalePreference(JSON.stringify({ mode: "unknown" }), null), AUTO);
});
