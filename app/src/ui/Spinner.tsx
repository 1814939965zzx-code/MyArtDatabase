import { LoaderCircle } from "lucide-react";
import { cn } from "./cn";

export type SpinnerProps = {
  size?: number;
  /** 可访问文案；提供时不再 aria-hidden。 */
  label?: string;
  className?: string;
};

export function Spinner({ size = 16, label, className }: SpinnerProps) {
  return (
    <LoaderCircle
      size={size}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      className={cn("animate-spin", className)}
    />
  );
}
