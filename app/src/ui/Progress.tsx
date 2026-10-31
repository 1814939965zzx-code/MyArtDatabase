import { cn } from "./cn";

export function ProgressBar({
  value,
  tone = "accent",
  size = "sm",
  className,
}: {
  value: number;
  tone?: "accent" | "sage" | "success";
  size?: "sm" | "md";
  className?: string;
}) {
  const percent = Math.max(0, Math.min(100, value));
  const fill = tone === "sage" ? "bg-sage" : tone === "success" ? "bg-success" : "bg-accent";
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className={cn("block w-full overflow-hidden rounded-full bg-line-soft", size === "sm" ? "h-[3px]" : "h-1.5", className)}
    >
      <span className={cn("block h-full rounded-full transition-[width] duration-300", fill)} style={{ width: `${percent}%` }} />
    </span>
  );
}
