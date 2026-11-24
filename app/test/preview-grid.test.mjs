import assert from "node:assert/strict";
import test from "node:test";
import { gridCell, gridCellKey, gridClusterCell, gridClusterKey, gridDivisionsForView, gridMinimumSpacing, gridTicksFor, orderByViewDepth, orderLikedFirst, orderStackGrid, orderStackMembers, PREVIEW_DIVISION_LADDER, PREVIEW_STACK_VISIBLE, previewAssetAspectRatio, stackPreviewMembers, stackScreenOverhang, zoomPanAtPointer } from "../src/previewGrid.ts";

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

test("half divisions use the fixed ladder and keep the cell spacing at least M", () => {
  const cases = [
    [1000, .35, 130, 1],
    [1000, .5, 130, 1],
    [1000, 1, 130, 3],
    [1000, 2, 130, 6],
    [1000, 2.8, 130, 10],
    [1000, 1, 220, 2],
    [1000, 1, 85, 5],
  ];
  for (const [scene, zoom, spacing, expected] of cases) {
    assert.equal(gridDivisionsForView(scene, zoom, spacing), expected);
    const cell = (100 / expected) * (scene * zoom / 200);
    assert.ok(cell >= spacing);
  }
  assert.equal(gridDivisionsForView(750 * .55, 1, gridMinimumSpacing([], 2, 1.35, .55)), 1);
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
  assert.equal(gridDivisionsForView(1000, .35, 1000), 1);
  assert.equal(gridDivisionsForView(100000, 2.8, 1), 256);
  assert.equal(gridDivisionsForView(0, 1, 130), 1);
  assert.equal(gridDivisionsForView(1000, 0, 130), 1);
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

test("density is a pure function of the current view, not the zoom history", () => {
  const zooms = [.35, .5, 1, 2, 2.8];
  const forward = zooms.map((zoom) => gridDivisionsForView(1000, zoom, 130));
  const backward = [...zooms].reverse().map((zoom) => gridDivisionsForView(1000, zoom, 130)).reverse();
  assert.deepEqual(forward, [1, 1, 3, 6, 10]);
  assert.deepEqual(backward, forward);
  // Reaching 100% from below or from above both give the same n.
  assert.equal(gridDivisionsForView(1000, 1, 130), 3);
  // Image-scale round trip returns to the initial n.
  const initial = gridDivisionsForView(1000, 1, gridMinimumSpacing([], 2, 1));
  const large = gridDivisionsForView(1000, 1, gridMinimumSpacing([], 2, 2));
  const restored = gridDivisionsForView(1000, 1, gridMinimumSpacing([], 2, 1));
  assert.equal(initial, 3);
  assert.equal(large, 2);
  assert.equal(restored, initial);
});

test("half divisions change only at ladder boundaries and quantize zoom to 1%", () => {
  assert.equal(gridDivisionsForView(1000, 1.004, 130), gridDivisionsForView(1000, 1, 130));
  assert.equal(gridDivisionsForView(1000, 1.006, 130), gridDivisionsForView(1000, 1.01, 130));
  const base = gridDivisionsForView(1000, 1, 130);
  for (const delta of [-.004, -.003, -.002, -.001, 0, .001, .002, .003, .004]) {
    assert.equal(gridDivisionsForView(1000, 1 + delta, 130), base);
  }
  // A larger change crosses the ladder boundary and moves n.
  assert.notEqual(gridDivisionsForView(1000, 1.2, 130), base);
});

test("large resize changes can jump multiple ladder levels without carrying history", () => {
  const small = gridDivisionsForView(620, 1, 130);
  const large = gridDivisionsForView(2600, 1, 130);
  assert.equal(small, 2);
  assert.equal(large, 10);
  assert.ok(large - small > 1);
  assert.equal(gridDivisionsForView(620, 1, 130), small);
  for (const scene of [620, 1000, 2600]) {
    const n = gridDivisionsForView(scene, 1, 130);
    const cell = (100 / n) * (scene / 200);
    if (n > 1 && n < 256) assert.ok(cell >= 130);
  }
});

test("half divisions always come from the fixed ladder and stay within 1..256", () => {
  const ladder = new Set(PREVIEW_DIVISION_LADDER);
  for (const scene of [0, 1, 200, 620, 800, 1000, 1300, 2000, 5000]) {
    for (const zoom of [.35, .5, 1, 1.37, 2, 2.8]) {
      for (const spacing of [1, 85, 130, 144, 220, 400]) {
        const n = gridDivisionsForView(scene, zoom, spacing);
        assert.ok(ladder.has(n));
        assert.ok(n >= 1 && n <= 256);
        if (scene > 0) {
          const quantizedZoom = Math.round(zoom * 100) / 100;
          const ppu = scene * quantizedZoom / 200;
          const target = 100 * ppu / spacing;
          if (target >= 1 && n < 256) {
            const cell = (100 / n) * ppu;
            assert.ok(cell >= spacing - 1e-9, `cell ${cell} < M ${spacing} (scene ${scene}, zoom ${zoom})`);
          }
        }
      }
    }
  }
});

test("collapsed stacks keep a stable thumbnail subset while the camera rotates", () => {
  const members = ["a", "b", "c", "d", "e"];
  assert.equal(PREVIEW_STACK_VISIBLE, 1);
  assert.deepEqual(stackPreviewMembers(members), ["a"]);
  // The helper never consults view depth, so repeated calls with the same member order stay identical.
  assert.deepEqual(stackPreviewMembers(members), stackPreviewMembers([...members]));
  assert.deepEqual(stackPreviewMembers(["a", "b"]), ["a"]);
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
  const normal = gridDivisionsForView(1000, 1, spacing(1));
  const large = gridDivisionsForView(1000, 1, spacing(2));
  const small = gridDivisionsForView(1000, 1, spacing(.5));
  assert.equal(normal, 3);
  assert.equal(large, 1);
  assert.equal(small, 5);
  assert.ok(small > normal && normal > large);
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


test("Like priority chooses the cover and preserves spatial/depth order within each group", () => {
  const members = [{ id: "a", x: 10, y: 10 }, { id: "b", x: 20, y: 10, liked: true },
    { id: "c", x: 30, y: 20 }, { id: "d", x: 40, y: 20, liked: true }];
  const base = orderStackGrid(members, 2, (m) => m.x, (m) => m.y);
  const liked = orderLikedFirst(base);
  assert.deepEqual(liked.map((m) => m.id), ["b", "d", "a", "c"]);
  assert.equal(stackPreviewMembers(liked)[0].id, "b");
  assert.deepEqual(base.map((m) => m.id), ["a", "b", "c", "d"], "priority must not mutate the spatial order");
  const unliked = members.map((m) => ({ ...m, liked: false }));
  assert.deepEqual(orderLikedFirst(unliked).map((m) => m.id), ["a", "b", "c", "d"]);
  const depth = orderByViewDepth(members, (m) => m.x);
  assert.deepEqual(orderLikedFirst(depth).map((m) => m.id), ["d", "b", "c", "a"]);
});


test("fan stack spacing reserves its visible edges across image and scene scales", () => {
  const assets = [{ width: 100, height: 100 }, { width: 100, height: 100 }];
  for (const scale of [.5, .7, 1, 1.5, 2]) {
    for (const zoom of [.25, .5, 1, 2, 4]) {
      assert.ok(gridMinimumSpacing(assets, 2, scale, zoom) >= 90 * scale + 2 * stackScreenOverhang(scale) + 24);
    }
  }
});


test("portrait fan stacks reserve height as well as width", () => {
  const assets = [{ width: 3, height: 4 }, { width: 1, height: 1 }];
  for (const scale of [.5, .7, 1, 1.5, 2]) {
    assert.ok(gridMinimumSpacing(assets, 2, scale) >= 120 * scale + 2 * stackScreenOverhang(scale) + 24);
  }
});

test("ratings choose a stable cover across regrouping and break ties by explicit scoring order", () => {
  const members = [{ id: "a", likeRating: 4, likeOrder: 8 }, { id: "b", likeRating: 5, likeOrder: 2 },
    { id: "c", likeRating: 5, likeOrder: 9 }, { id: "d", likeRating: 0, likeOrder: 99 }];
  const original = [...members];
  for (const base of [members, [...members].reverse(), [members[2], members[0], members[3], members[1]]]) {
    assert.deepEqual(orderLikedFirst(base).map((m) => m.id), ["c", "b", "a", "d"]);
    assert.equal(stackPreviewMembers(orderLikedFirst(base))[0].id, "c");
  }
  assert.deepEqual(members, original);
  assert.deepEqual(orderLikedFirst(members.filter((m) => m.id !== "c")).map((m) => m.id), ["b", "a", "d"]);
});
