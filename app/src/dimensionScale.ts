import type { CSSProperties } from "react";

const clampStoredValue = (value: number) => Math.max(0, Math.min(1000, value));

export function displayDimensionValue(value: number) {
  return Math.round((clampStoredValue(value) - 500) / 5);
}

export function centeredRangeStyle(value: number) {
  const position = clampStoredValue(value) / 10;
  return {
    "--range-fill-start": `${Math.min(50, position)}%`,
    "--range-fill-end": `${Math.max(50, position)}%`,
  } as CSSProperties;
}
