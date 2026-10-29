import assert from "node:assert/strict";
import test from "node:test";
import { centeredGridStepFor, gridCell, gridCellKey, gridClusterCell, gridClusterKey, gridMinimumSpacing, gridStepFor, gridTicksFor, previewAssetAspectRatio, usesCenteredGrid, zoomPanAtPointer } from "../src/previewGrid.ts";

test("negative, zero and positive assets never share a cluster, even in the center cell", () => {
  for (const centered of [false, true]) {
    for (const step of [320, 100, 80, 40, 20, 5]) {
      const keys = [499, 500, 501].map((value) => gridClusterKey([value], step, centered));
      assert.equal(new Set(keys).size, 3);
      assert.equal(gridClusterKey([496], step, centered), gridClusterKey([499], step, centered));
      assert.equal(gridClusterKey([501], step, centered), gridClusterKey([504], step, centered));
    }
  }
});

test("2D quadrants and 3D octants cluster independently along every chosen axis", () => {
  for (const centered of [false, true]) {
    for (const mode of [2, 3]) {
      const values = Array.from({ length: 2 ** mode }, (_, mask) =>
        Array.from({ length: mode }, (_, axis) => mask & (1 << axis) ? 501 : 499));
      const keys = values.map((point) => gridClusterKey(point, 100, centered));
      assert.equal(new Set(keys).size, 2 ** mode);
      for (let axis = 0; axis < mode; axis++) {
        const zero = Array(mode).fill(501);
        zero[axis] = 500;
        assert.ok(!keys.includes(gridClusterKey(zero, 100, centered)));
      }
    }
  }
});

test("stack positions and drop-target keys stay on their respective side of zero", () => {
  assert.equal(gridClusterCell(499, 100, true).center, 375);
  assert.equal(gridClusterCell(500, 100, true).center, 500);
  assert.equal(gridClusterCell(501, 100, true).center, 625);
  assert.equal(gridClusterKey([501, 510], 100, true), gridClusterKey([520, 530], 100, true));
  assert.notEqual(gridClusterKey([499, 510], 100, true), gridClusterKey([501, 510], 100, true));
  for (const centered of [false, true]) {
    for (const step of [320, 100, 80, 40, 20, 5]) {
      for (let value = 0; value <= 1000; value++) {
        const cell = gridClusterCell(value, step, centered);
        assert.ok(cell.min <= value && cell.max >= value);
        if (value < 500) assert.ok(cell.max <= 500 && cell.center < 500);
        if (value > 500) assert.ok(cell.min >= 500 && cell.center > 500);
        if (value === 500) assert.equal(cell.center, 500);
      }
    }
  }
  assert.deepEqual(gridTicksFor(100, true), [0, 250, 750, 1000]);
});

test("the actual 55% scene / 135% picture view centers its coarse grid without max sliders", () => {
  const step = gridStepFor(750 / .55 * .55 / 200, gridMinimumSpacing([], 2, 1.35, .55));
  assert.equal(step, 80);
  assert.equal(usesCenteredGrid(step, .55, 1.35), true);
  assert.deepEqual(gridTicksFor(step, usesCenteredGrid(step, .55, 1.35)), [0, 250, 750, 1000]);
  assert.equal(usesCenteredGrid(160, .35, .5), true);
  assert.equal(usesCenteredGrid(40, 1, 1), false);
  assert.equal(usesCenteredGrid(20, 2.8, 1), true);
  assert.equal(usesCenteredGrid(40, 1, 2), true);
});

test("maximum zoom centers a complete cell on zero with symmetric boundaries", () => {
  assert.deepEqual(gridTicksFor(40, true), [0, 125, 375, 625, 875, 1000]);
  for (const step of [320, 160, 80, 40, 20, 10, 5, 2.5]) {
    const ticks = gridTicksFor(step, true);
    assert.ok(!ticks.includes(500));
    assert.deepEqual(ticks, ticks.map((tick) => 1000 - tick).reverse());
    const centerCell = gridCell(500, step, true);
    assert.equal(centerCell.center, 500);
    assert.ok(centerCell.min < 500 && centerCell.max > 500);
    for (let value = 0; value <= 1000; value++) {
      const cell = gridCell(value, step, true);
      assert.ok(ticks.includes(cell.min));
      assert.ok(ticks.includes(cell.max));
      assert.ok(value >= cell.min && value <= cell.max);
    }
  }
});

test("coarse maximum zoom matches the reference center band at -50/+50", () => {
  assert.equal(centeredGridStepFor(320), 100);
  assert.equal(centeredGridStepFor(80), 100);
  assert.deepEqual(gridTicksFor(320, true), [0, 250, 750, 1000]);
  assert.deepEqual(gridCell(500, 320, true), { index: 0, min: 250, max: 750, center: 500 });
  assert.deepEqual(gridCell(0, 320, true), { index: -1, min: 0, max: 250, center: 125 });
  assert.deepEqual(gridCell(1000, 320, true), { index: 1, min: 750, max: 1000, center: 875 });
  assert.equal(gridCellKey([499], 320, true), gridCellKey([500], 320, true));
  assert.notEqual(gridCellKey([249], 320, true), gridCellKey([250], 320, true));
});

test("pointer zoom preserves the underlying coordinate after panning, in both directions", () => {
  for (const pan of [{ x: 0, y: 0 }, { x: 123, y: -75 }]) {
    for (const pointer of [{ x: 0, y: 0 }, { x: 220, y: -130 }]) {
      for (const [current, next] of [[1, 2], [2, .35], [2.7, 2.8]]) {
        const after = zoomPanAtPointer(pan, pointer, current, next);
        assert.ok(Math.abs((pointer.x - pan.x) / current - (pointer.x - after.x) / next) < 1e-9);
        assert.ok(Math.abs((pointer.y - pan.y) / current - (pointer.y - after.y) / next) < 1e-9);
        const restored = zoomPanAtPointer(after, pointer, next, current);
        assert.ok(Math.abs(restored.x - pan.x) < 1e-9);
        assert.ok(Math.abs(restored.y - pan.y) < 1e-9);
      }
    }
  }
  assert.deepEqual(zoomPanAtPointer({ x: 12, y: -3 }, { x: 200, y: 50 }, 2.8, 2.8), { x: 12, y: -3 });
});

test("ordinary zoom retains the existing edge-anchored ticks and cell assignments", () => {
  assert.deepEqual(gridTicksFor(40), [0, 200, 400, 600, 800, 1000]);
  assert.deepEqual(gridTicksFor(320), [0, 1000]);
  assert.equal(gridCellKey([499], 320), gridCellKey([500], 320));
});

test("density adapts to both zoom and viewport size using the image footprint", () => {
  assert.deepEqual([.35, .5, 1, 2, 2.8].map((zoom) => gridStepFor(1000 * zoom / 200, 130)), [80, 80, 40, 20, 10]);
  assert.equal(gridStepFor(2000 / 200, 130), gridStepFor(1000 * 2 / 200, 130));
});

test("zoom thresholds keep a full image footprint after splitting and have hysteresis", () => {
  assert.equal(gridStepFor(12, 100, 20), 20);
  assert.equal(gridStepFor(12.01, 100, 20), 10);
  assert.equal(gridStepFor(11.99, 100, 10), 10);
  assert.equal(gridStepFor(10, 100, 10), 10);
  assert.equal(gridStepFor(9.99, 100, 10), 20);
  assert.equal(gridStepFor(0, 100, 10), 10);
});

test("large resize changes can cross multiple levels at once", () => {
  const step = gridStepFor(40, 144, 80);
  assert.equal(step, 5);
  assert.equal(gridStepFor(.5, 144, step), 320);
});

test("normal image proportions and stack overhang determine spacing, including scale", () => {
  const portrait = [{ width: 900, height: 1600 }];
  assert.equal(previewAssetAspectRatio(portrait[0]), "3 / 4");
  assert.equal(previewAssetAspectRatio({ width: 1600, height: 900 }), "4 / 3");
  assert.equal(previewAssetAspectRatio({}), "1 / 1");
  assert.equal(gridMinimumSpacing(portrait, 1, 1), 130);
  assert.equal(gridMinimumSpacing(portrait, 2, .5), 85);
  assert.equal(gridMinimumSpacing(portrait, 2, 1), 144);
  assert.equal(gridMinimumSpacing(portrait, 3, 2), 264);
  assert.equal(gridMinimumSpacing([{ width: 1600, height: 900 }], 2, 1), 130);
  assert.equal(gridMinimumSpacing([{}], 2, 1), 130);
  assert.equal(gridMinimumSpacing([{}], 2, .5, 2), 101);
  assert.equal(gridMinimumSpacing([{}], 2, 2, .5), 212);
});

test("larger pictures coarsen the grid and smaller pictures allow finer cells", () => {
  const portrait = [{ width: 3, height: 4 }];
  const spacing = (scale) => gridMinimumSpacing(portrait, 2, scale);
  const normal = gridStepFor(10, spacing(1));
  const large = gridStepFor(10, spacing(2), normal);
  const small = gridStepFor(10, spacing(.5), large);
  assert.equal(normal, 20);
  assert.equal(large, 40);
  assert.equal(small, 20);
  assert.ok(small < large);
});

test("chosen density respects the footprint throughout resize and slider changes", () => {
  let previous;
  for (const minimum of [84, 144, 264, 144, 84]) {
    for (const pixels of [1, 2, 5, 10, 20, 40, 20, 10, 5, 2, 1]) {
      const step = gridStepFor(pixels, minimum, previous);
      assert.ok(step * pixels >= minimum);
      assert.ok(step * pixels <= minimum * 2.4);
      previous = step;
    }
  }
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
  for (const coarse of [320, 160, 80, 40, 20, 10, 5, 2.5]) {
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
  for (const step of [320, 160, 80, 40, 20, 10, 5, 2.5, 1.25]) {
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
