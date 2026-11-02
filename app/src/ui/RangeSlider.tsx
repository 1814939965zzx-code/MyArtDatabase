import type { InputHTMLAttributes } from "react";
import { cn } from "./cn";

export type RangeSliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value"> & {
  value: number;
  onValueChange: (value: number) => void;
};

export function RangeSlider({ value, onValueChange, className, ...rest }: RangeSliderProps) {
  return (
    <input
      type="range"
      value={value}
      onChange={(event) => onValueChange(Number(event.target.value))}
      className={cn("h-1.5 w-full cursor-pointer accent-sage disabled:cursor-not-allowed", className)}
      {...rest}
    />
  );
}
