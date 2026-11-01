import assert from "node:assert/strict";
import test from "node:test";
import { gridCell, gridCellKey, gridClusterCell, gridClusterKey, gridDivisionsFor, gridMinimumSpacing, gridTicksFor, orderByViewDepth, orderStackGrid, orderStackMembers, PREVIEW_STACK_VISIBLE, previewAssetAspectRatio, stackPreviewMembers, zoomPanAtPointer } from "../src/previewGrid.ts";

test("half-axis divisions start at 1 and grow by +1, so the whole axis always has an even cell count", () => {
  let previous = 1;
  for (let pixels = 1; pixels <= 20; pixels += .05) {
    const divisions = gridDivisionsFor(pixels, 130, previous);
    assert.ok(Number.isInteger(divisions));
    assert.ok(divisions >= 1 && divisions <= 256);
    assert.ok(divisions >= previous && divisions - previous <= 1);
    assert.equal(divisions * 2, (divisions * 2 / 2) * 2);
    previous = divisions;
  }
  for (let pixels = 20; pixels >= 1; pixels -= .05) {
    const divisions = gridDivisionsFor(pixels, 130, previous);
    assert.ok(divisions <= previous && previous - divisions <= 1);
    previous = divisions;
  }
  assert.equal(gridDivisionsFor(1, 130), 1);
  assert.equal(gridDivisionsFor(1000, 130, 256), 256);
});

test("zero is always a grid boundary and every half-axis is divided into n equal cells", () => {
  for (const divisions of [1, 2, 3, 4, 5, 7, 8, 11, 16, 32, 64, 128, 256]) {
    const width = 500 / divisions;
    const ticks = gridTicksFor(divisions);
    assert.equal(ticks.length, divisions * 2 + 1);
    assert.ok(Math.abs(ticks[divisions] - 500) < 1e-9);
    assert.equal(ticks.length - 1, divisions * 2);
    ticks.forEach((tick, index) => assert.ok(Math.abs(tick - index * width) < 1e-9));
    ticks.forEach((tick) => assert.ok(ticks.some((other) => Math.abs(other - (1000 - tick)) < 1e-9)));
    for (let index = 0; index < divisions; index++) {
      const negative = gridCell(index * width + width / 2, divisions);
      const positive = gridCell(500 + index * width + width / 2, divisions);
      const mirrored = gridCell(500 + (divisions - 1 - index) * width + width / 2, divisions);
      assert.ok(Math.abs((negative.max - negative.min) - width) < 1e-9);
      assert.ok(Math.abs((positive.max - positive.min) - width) < 1e-9);
      assert.ok(Math.abs(negative.center - (index + .5) * width) < 1e-9);
      assert.ok(Math.abs(positive.center - (500 + (index + .5) * width)) < 1e-9);
      assert.ok(Math.abs(negative.center - (1000 - mirrored.center)) < 1e-9);
    }
    for (let value = 0; value <= 1000; value += Math.max(.5, width / 2)) {
      const cell = gridCell(value, divisions);
      assert.ok(Math.abs((cell.max - cell.min) - width) < 1e-9);
      assert.ok(cell.min >= 0 && cell.max <= 1000);
      if (value < 500) assert.ok(cell.min < 500 && cell.max <= 500);
      if (value > 500) assert.ok(cell.min >= 500 && cell.max > 500);
    }
  }
});

test("negative, zero and positive assets never share a cluster; zero stays on the axis", () => {
  for (const divisions of [1, 2, 3, 5, 8]) {
    const keys = [499, 500, 501].map((value) => gridClusterKey([value], divisions));
    assert.equal(new Set(keys).size, 3);
    assert.equal(gridClusterKey([496], divisions), gridClusterKey([499], divisions));
    assert.equal(gridClusterKey([501], divisions), gridClusterKey([504], divisions));
    assert.equal(gridClusterCell(500, divisions).center, 500);
  }
});

test("2D quadrants and 3D octants cluster independently along every chosen axis", () => {
  for (const mode of [2, 3]) {
    const values = Array.from({ length: 2 ** mode }, (_, mask) =>
      Array.from({ length: mode }, (_, axis) => mask & (1 << axis) ? 501 : 499));
    const keys = values.map((point) => gridClusterKey(point, 3));
    assert.equal(new Set(keys).size, 2 ** mode);
    for (let axis = 0; axis < mode; axis++) {
      const zero = Array(mode).fill(501);
      zero[axis] = 500;
      assert.ok(!keys.includes(gridClusterKey(zero, 3)));
    }
  }
});

test("stack positions and drop-target keys stay on their respective side of zero", () => {
  assert.equal(gridClusterCell(499, 1).center, 250);
  assert.equal(gridClusterCell(500, 1).center, 500);
  assert.equal(gridClusterCell(501, 1).center, 750);
  assert.ok(Math.abs(gridClusterCell(499, 3).center - (1000 - gridClusterCell(501, 3).center)) < 1e-9);
  assert.equal(gridClusterKey([501, 510], 3), gridClusterKey([520, 530], 3));
  assert.notEqual(gridClusterKey([499, 510], 3), gridClusterKey([501, 510], 3));
  for (const divisions of [1, 2, 3, 5, 8]) {
    for (let value = 0; value <= 1000; value++) {
      const cell = gridClusterCell(value, divisions);
      assert.ok(cell.min <= value && cell.max >= value);
      if (value < 500) assert.ok(cell.max <= 500 && cell.center < 500);
      if (value > 500) assert.ok(cell.min >= 500 && cell.center > 500);
      if (value === 500) assert.equal(cell.center, 500);
    }
  }
  assert.deepEqual(gridTicksFor(1), [0, 500, 1000]);
  assert.deepEqual(gridTicksFor(2), [0, 250, 500, 750, 1000]);
});

test("initial half divisions keep the cell spacing inside the requested band", () => {
  const cases = [
    [1.75, 130, 1], [2.5, 130, 1], [5, 130, 3], [5.145, 130, 3],
    [10, 130, 7], [14.4, 130, 11], [10, 220, 4], [10, 85, 11],
  ];
  for (const [pixels, spacing, expected] of cases) {
    assert.equal(gridDivisionsFor(pixels, spacing), expected);
    const cell = (100 / expected) * pixels;
    assert.ok(cell >= spacing);
    if (expected > 1) assert.ok(cell <= spacing * 2);
  }
  assert.equal(gridDivisionsFor(750 / 200 * .55, gridMinimumSpacing([], 2, 1.35, .55)), 1);
});

test("half divisions stay equal and axis-aligned at every level", () => {
  for (const divisions of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 32, 64, 128, 256]) {
    const ticks = gridTicksFor(divisions);
    assert.ok(ticks.some((tick) => Math.abs(tick - 500) < 1e-9));
    ticks.forEach((tick) => assert.ok(ticks.some((other) => Math.abs(other - (1000 - tick)) < 1e-9)));
    for (let value = 0; value <= 1000; value++) {
      const cell = gridCell(value, divisions);
      assert.ok(ticks.some((tick) => Math.abs(tick - cell.min) < 1e-9));
      assert.ok(ticks.some((tick) => Math.abs(tick - cell.max) < 1e-9));
      assert.ok(value >= cell.min && value <= cell.max);
    }
  }
});

test("the coarsest grid is one cell per half-axis; the finest is 256", () => {
  assert.deepEqual(gridTicksFor(1), [0, 500, 1000]);
  assert.deepEqual(gridCell(500, 1), { index: 0, min: 500, max: 1000, center: 750 });
  assert.deepEqual(gridCell(0, 1), { index: 0, min: 0, max: 500, center: 250 });
  assert.equal(gridDivisionsFor(1000, 130, 256), 256);
  assert.equal(gridTicksFor(256).length, 513);
  assert.ok(Math.abs(gridTicksFor(256)[256] - 500) < 1e-9);
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

test("ordinary zoom uses the same axis-anchored divisions", () => {
  assert.deepEqual(gridTicksFor(1), [0, 500, 1000]);
  assert.deepEqual(gridTicksFor(2), [0, 250, 500, 750, 1000]);
  assert.notEqual(gridCellKey([499], 1), gridCellKey([500], 1));
  assert.equal(gridCellKey([249], 1), gridCellKey([300], 1));
});

test("density adapts to both zoom and viewport size using the image footprint", () => {
  let previous = 1;
  const result = [];
  for (const zoom of [.35, .5, 1, 2, 2.8]) {
    previous = gridDivisionsFor(1000 * zoom / 200, 130, previous);
    result.push(previous);
  }
  assert.deepEqual(result, [1, 1, 2, 4, 5]);
  assert.equal(gridDivisionsFor(1000 / 200, 130, 3), 3);
});

test("half divisions move by one level at a time around the spacing thresholds", () => {
  assert.equal(gridDivisionsFor(5, 100, 5), 5);
  assert.equal(gridDivisionsFor(5.5, 100, 5), 5);
  assert.equal(gridDivisionsFor(12.1, 100, 5), 6);
  assert.equal(gridDivisionsFor(4.9, 100, 5), 4);
  let previous = 5;
  for (const pixels of [5, 6, 7, 8, 9, 10, 11, 12]) {
    const next = gridDivisionsFor(pixels, 100, previous);
    assert.ok(next >= previous && next - previous <= 1);
    previous = next;
  }
});

test("large resize changes can move several levels but stay in the equal grid", () => {
  const divisions = gridDivisionsFor(40, 144, 80);
  assert.equal(divisions, 27);
  assert.equal(gridDivisionsFor(.5, 144, divisions), 1);
  for (const step of [144, 264, 84]) {
    let previous;
    for (const pixels of [1, 2, 5, 10, 20, 40, 20, 10, 5, 2, 1]) {
      const next = gridDivisionsFor(pixels, step, previous);
      const cell = (100 / next) * pixels;
      if (next > 1 && next < 256) {
        assert.ok(cell >= step);
        assert.ok(cell <= step * 2.4);
      }
      previous = next;
    }
  }
});

test("collapsed stacks keep a stable thumbnail subset while the camera rotates", () => {
  const members = ["a", "b", "c", "d", "e"];
  assert.equal(PREVIEW_STACK_VISIBLE, 4);
  assert.deepEqual(stackPreviewMembers(members), ["a", "b", "c", "d"]);
  // The helper never consults view depth, so repeated calls with the same member order stay identical.
  assert.deepEqual(stackPreviewMembers(members), stackPreviewMembers([...members]));
  assert.deepEqual(stackPreviewMembers(["a", "b"]), ["a", "b"]);
  assert.deepEqual(stackPreviewMembers([]), []);
});

test("1D stacks sort by value, 2D stacks sort by a y/x grid, 3D keeps page order", () => {
  const members = [
    { id: "a", x: 80, y: 90 },
    { id: "b", x: 20, y: 10 },
    { id: "c", x: 50, y: 50 },
    { id: "d", x: 10, y: 80 },
    { id: "e", x: 90, y: 10 },
  ];
  const ids = (ordered) => ordered.map((member) => member.id);
  assert.deepEqual(ids(orderStackMembers(members, 1, (member) => member.x, (member) => member.y)), ["d", "b", "c", "a", "e"]);
  // y determines the row (smaller y above); x determines the column (smaller x left).
  assert.deepEqual(ids(orderStackGrid(members, 2, (member) => member.x, (member) => member.y)), ["b", "e", "d", "c", "a"]);
  assert.deepEqual(ids(orderStackMembers(members, 2, (member) => member.x, (member) => member.y)), ["b", "e", "c", "d", "a"]);
  // 3D is unchanged; the expanded plane still orders by view depth when opened.
  assert.deepEqual(ids(orderStackMembers(members, 3, (member) => member.x, (member) => member.y)), ["a", "b", "c", "d", "e"]);
  const ties = [{ id: "a", x: 10, y: 10 }, { id: "b", x: 10, y: 10 }];
  assert.deepEqual(ids(orderStackGrid(ties, 2, (member) => member.x, (member) => member.y)), ["a", "b"]);
});

test("the expanded plane orders members front-to-back only when it opens", () => {
  const members = [
    { id: "a", depth: 10 },
    { id: "b", depth: 30 },
    { id: "c", depth: 20 },
    { id: "d", depth: 30 },
  ];
  // Stable sort: equal depths keep the member order captured when the plane opened.
  assert.deepEqual(
    orderByViewDepth(members, (member) => member.depth).map((member) => member.id),
    ["b", "d", "c", "a"],
  );
  assert.deepEqual(
    orderByViewDepth(members, () => 0).map((member) => member.id),
    ["a", "b", "c", "d"],
  );
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
  const spacing = (scale) => gridMinimumSpacing([{ width: 3, height: 4 }], 2, scale);
  const normal = gridDivisionsFor(10, spacing(1));
  const large = gridDivisionsFor(10, spacing(2), normal);
  const small = gridDivisionsFor(10, spacing(.5), large);
  assert.equal(normal, 6);
  assert.equal(large, 3);
  assert.ok(small > large);
});

test("boundaries belong to one cell, with +100 in the final cell", () => {
  assert.equal(gridCell(499.999, 5).index, 4);
  assert.equal(gridCell(500, 5).index, 0);
  assert.equal(gridCell(599.999, 5).index, 0);
  assert.equal(gridCell(600, 5).index, 1);
  assert.equal(gridCell(1000, 5).index, 4);
  assert.equal(gridCell(1000, 5).max, 1000);
  assert.ok(Math.abs(gridCell(1000, 3).center - 916.6666666666666) < 1e-9);
});

test("nearby chains cannot bridge separate grid cells; unused axes do not participate", () => {
  assert.equal(gridCellKey([501], 5), gridCellKey([599], 5));
  assert.notEqual(gridCellKey([599], 5), gridCellKey([601], 5));
  assert.notEqual(gridCellKey([550, 599], 5), gridCellKey([550, 601], 5));
  assert.notEqual(gridCellKey([550, 550, 599], 5), gridCellKey([550, 550, 601], 5));
});

test("tick boundaries exactly bound every cell and every level keeps an even whole-axis count", () => {
  for (const divisions of [1, 2, 3, 4, 5, 7, 8, 11, 16, 32, 64, 128, 256]) {
    const ticks = gridTicksFor(divisions);
    assert.equal(ticks[0], 0);
    assert.equal(ticks.at(-1), 1000);
    assert.equal(ticks.length, divisions * 2 + 1);
    assert.equal((ticks.length - 1) / 2, divisions);
    for (let value = 0; value <= 1000; value++) {
      const cell = gridCell(value, divisions);
      const offset = value < 500 ? 0 : divisions;
      assert.ok(Math.abs(ticks[offset + cell.index] - cell.min) < 1e-9);
      assert.ok(Math.abs(ticks[offset + cell.index + 1] - cell.max) < 1e-9);
      assert.ok(cell.center >= cell.min && cell.center <= cell.max);
    }
  }
});
