import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: ReactNode;
  wrapperClassName?: string;
};

export function Checkbox({ label, className, wrapperClassName, ...rest }: CheckboxProps) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 text-sm font-normal text-muted", wrapperClassName)}>
      <input type="checkbox" className={cn("accent-sage", className)} {...rest} />
      {label}
    </label>
  );
}
