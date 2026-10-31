import { useEffect, useId, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { cn } from "./cn";

const SIZE = {
  sm: "max-w-[400px]",
  md: "max-w-[480px]",
  lg: "max-w-[560px]",
  xl: "max-w-[860px]",
} as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let scrollLocks = 0;
let previousBodyOverflow = "";

function lockScroll() {
  if (scrollLocks === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLocks += 1;
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = previousBodyOverflow;
}

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  size?: keyof typeof SIZE;
  footer?: ReactNode;
  children?: ReactNode;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  bodyClassName?: string;
};

/**
 * 统一弹窗：portal 到 body、锁定页面滚动、Esc 关闭、打开时移入焦点、关闭后还原焦点。
 * 关闭逻辑由调用方提供（onClose），不要在页面里再各自监听 keydown。
 */
export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  description,
  size = "md",
  footer,
  children,
  closeOnBackdrop = true,
  closeOnEsc = true,
  initialFocusRef,
  className,
  bodyClassName,
}: ModalProps) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockScroll();
    const panel = panelRef.current;
    const target =
      initialFocusRef?.current ??
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    target?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !closeOnEsc) return;
      event.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      unlockScroll();
      previousActive?.focus({ preventScroll: true });
    };
    // initialFocusRef 只在打开时读取一次，避免父组件重渲染时反复抢焦点。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closeOnEsc]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-modal grid place-items-center overflow-y-auto bg-scrim p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && closeOnBackdrop) onClose();
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className={cn("relative my-auto w-full bg-surface p-6 shadow-xl focus:outline-none", SIZE[size], className)}
      >
        <div className="mb-[22px] flex items-start justify-between gap-4">
          <div className="min-w-0">
            {eyebrow ? <p className="mb-1.5 text-2xs font-bold uppercase tracking-[.15em] text-accent">{eyebrow}</p> : null}
            <h2 id={titleId} className="m-0 font-display text-3xl font-medium leading-tight">
              {title}
            </h2>
            {description ? <p className="mt-[7px] text-sm text-muted">{description}</p> : null}
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={18} aria-hidden />
          </IconButton>
        </div>
        <div className={cn("flex flex-col gap-4", bodyClassName)}>{children}</div>
        {footer ? <div className="mt-1.5 flex justify-end gap-2">{footer}</div> : null}
      </section>
    </div>,
    document.body,
  );
}

/* ────────────────────────────── ConfirmDialog ────────────────────────────── */

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmText?: ReactNode;
  cancelText?: ReactNode;
  tone?: "default" | "danger";
  busy?: boolean;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  tone = "default",
  busy = false,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} onClick={onClose} disabled={busy}>
            {cancelText}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmText}
          </Button>
        </>
      }
    />
  );
}
