import assert from "node:assert/strict";
import test from "node:test";
import { gridCell, gridCellKey, gridStepFor, gridTicksFor } from "../src/previewGrid.ts";

test("density adapts to both zoom and viewport size", () => {
  assert.deepEqual([.35, .5, 1, 2, 2.8].map((zoom) => gridStepFor(1000 * zoom / 200)), [40, 40, 20, 10, 5]);
  assert.equal(gridStepFor(2000 / 200), gridStepFor(1000 * 2 / 200));
});

test("zoom thresholds have hysteresis, including exact thresholds", () => {
  assert.equal(gridStepFor(7, 20), 20);
  assert.equal(gridStepFor(7.01, 20), 10);
  assert.equal(gridStepFor(6.99, 10), 10);
  assert.equal(gridStepFor(5, 10), 10);
  assert.equal(gridStepFor(4.99, 10), 20);
  assert.equal(gridStepFor(0, 10), 10);
});

test("large resize changes can cross multiple levels at once", () => {
  const step = gridStepFor(40, 80);
  assert.equal(step, 2.5);
  assert.equal(gridStepFor(.5, step), 80);
});

test("boundaries belong to one cell, with +100 in the final cell", () => {
  assert.equal(gridCell(99, 20).index, 0);
  assert.equal(gridCell(100, 20).index, 1);
  assert.equal(gridCell(1000, 20).index, 9);
  assert.equal(gridCell(1000, 40).center, 900);
  const edge = gridCell(1000, 80);
  assert.deepEqual(edge, { index: 2, min: 800, max: 1000, center: 900 });
});

test("finer cells never join assets from separate parent cells, in 1D/2D/3D", () => {
  for (const coarse of [80, 40, 20, 10, 5, 2.5]) {
    const parents = new Map();
    for (let value = 0; value <= 1000; value++) {
      for (const values of [[value], [value, 1000 - value], [value, 1000 - value, (value * 7) % 1001]]) {
        const child = values.length + ":" + gridCellKey(values, coarse / 2);
        const parent = gridCellKey(values, coarse);
        if (parents.has(child)) assert.equal(parents.get(child), parent);
        parents.set(child, parent);
      }
    }
  }
});

test("nearby chains cannot bridge separate grid cells; unused axes do not participate", () => {
  assert.equal(gridCellKey([501], 20), gridCellKey([599], 20));
  assert.notEqual(gridCellKey([599], 20), gridCellKey([601], 20));
  assert.notEqual(gridCellKey([550, 599], 20), gridCellKey([550, 601], 20));
  assert.notEqual(gridCellKey([550, 550, 599], 20), gridCellKey([550, 550, 601], 20));
});

test("tick boundaries exactly bound every cell, including partial edge cells", () => {
  for (const step of [80, 40, 20, 10, 5, 2.5, 1.25]) {
    const ticks = gridTicksFor(step);
    assert.equal(ticks[0], 0);
    assert.equal(ticks.at(-1), 1000);
    for (let value = 0; value <= 1000; value++) {
      const cell = gridCell(value, step);
      assert.equal(ticks[cell.index], cell.min);
      assert.equal(ticks[cell.index + 1], cell.max);
      assert.ok(cell.center >= cell.min && cell.center <= cell.max);
    }
  }
});
