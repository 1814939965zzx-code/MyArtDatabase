import { useId } from "react";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { Search, X } from "lucide-react";
import { cn } from "./cn";

/* ────────────────────────────── Field ────────────────────────────── */

const LABEL = "block text-sm font-medium text-ink-label";
const HINT = "mt-1.5 text-xs text-muted";
const ERROR = "mt-1.5 flex items-center gap-1 text-xs text-danger";

export type FieldProps = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
};

export function Field({ label, hint, error, required, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <label className={LABEL} htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-0.5 text-danger">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className={ERROR} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className={HINT}>{hint}</p>
      ) : null}
    </div>
  );
}

/* ────────────────────────────── Input ────────────────────────────── */

const CONTROL_BASE =
  "w-full rounded-sm border bg-white text-sm text-ink transition-colors placeholder:text-faint " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted";

const CONTROL_SIZE = { sm: "h-8 px-2.5", md: "h-9.5 px-2.5" } as const;

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: keyof typeof CONTROL_SIZE;
  invalid?: boolean;
  /** 左侧图标；带图标时改用包裹布局。 */
  icon?: ReactNode;
  /** 右侧动作（如密码显示/隐藏）。 */
  trailing?: ReactNode;
};

export function Input({ size = "md", invalid = false, icon, trailing, className, disabled, ...rest }: InputProps) {
  const border = invalid ? "border-danger-border" : "border-line-strong";
  const ring = invalid ? "focus-within:outline-danger" : "focus-within:outline-accent";

  if (!icon && !trailing) {
    return (
      <input
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={cn(CONTROL_BASE, CONTROL_SIZE[size], border, invalid && "focus-visible:outline-danger", className)}
        {...rest}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex w-full items-center gap-2 rounded-sm border bg-white px-2.5 text-faint transition-colors",
        "focus-within:outline-2 focus-within:outline-offset-2",
        CONTROL_SIZE[size],
        border,
        ring,
        disabled && "cursor-not-allowed bg-surface-muted",
        className,
      )}
    >
      {icon ? <span className="flex flex-none items-center">{icon}</span> : null}
      <input
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-ink outline-none placeholder:text-faint disabled:cursor-not-allowed"
        {...rest}
      />
      {trailing ? <span className="flex flex-none items-center">{trailing}</span> : null}
    </div>
  );
}

/* ────────────────────────────── Textarea ────────────────────────────── */

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export function Textarea({ invalid = false, className, ...rest }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_BASE,
        "min-h-[72px] resize-y px-2.5 py-2",
        invalid ? "border-danger-border focus-visible:outline-danger" : "border-line-strong",
        className,
      )}
      {...rest}
    />
  );
}

/* ────────────────────────────── SearchInput ────────────────────────────── */

export type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "onChange"> & {
  onValueChange?: (value: string) => void;
  onClear?: () => void;
  invalid?: boolean;
  size?: "sm" | "md";
};

const SEARCH_SIZE = { sm: "h-8", md: "h-9.5" } as const;

export function SearchInput({ value, onValueChange, onClear, invalid = false, size = "md", className, placeholder = "搜索", ...rest }: SearchInputProps) {
  const id = useId();
  return (
    <div
      className={cn(
        "flex w-full items-center gap-2 rounded-md border bg-surface px-3 text-faint transition-colors",
        SEARCH_SIZE[size],
        invalid ? "border-danger-border" : "border-line focus-within:border-line-strong",
        className,
      )}
    >
      <Search size={16} aria-hidden className="flex-none" />
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        aria-label={rest["aria-label"] ?? placeholder}
        onChange={(event) => onValueChange?.(event.target.value)}
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-ink outline-none placeholder:text-faint"
        {...rest}
      />
      {(value ?? "") !== "" && onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="清除搜索"
          className="grid size-4 flex-none place-items-center rounded-full text-faint hover:bg-line-soft hover:text-ink"
        >
          <X size={12} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
