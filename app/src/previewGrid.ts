// All public steps use the displayed -100…100 scale; cell coordinates use storage units.
const MIN_STEP = 20 / 64;
const MAX_STEP = 80;

export function gridStepFor(pixelsPerUnit: number, previous?: number): number {
  if (!(pixelsPerUnit > 0) || !Number.isFinite(pixelsPerUnit)) return previous ?? 20;
  let step = previous ?? 20;
  const min = previous === undefined ? 60 : 50;
  const max = previous === undefined ? 120 : 140;
  while (step * pixelsPerUnit > max && step > MIN_STEP) step /= 2;
  while (step * pixelsPerUnit < min && step < MAX_STEP) step *= 2;
  return step;
}

export function gridCell(value: number, step: number) {
  const width = step * 5;
  const count = Math.ceil(1000 / width);
  const index = Math.max(0, Math.min(count - 1, Math.floor(value / width)));
  const min = index * width;
  const max = Math.min(1000, min + width);
  return { index, min, max, center: (min + max) / 2 };
}

export function gridTicksFor(step: number): number[] {
  const width = step * 5;
  const ticks = Array.from({ length: Math.ceil(1000 / width) }, (_, index) => index * width);
  return [...ticks, 1000];
}

export function gridCellKey(values: number[], step: number): string {
  return values.map((value) => gridCell(value, step).index).join(":");
}
