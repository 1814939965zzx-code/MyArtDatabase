import { createPortal } from "react-dom";
import { Heart } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { IconButton, cn } from "./ui";

/** Page 内评分。拖动过程中只预览，松手提交；Esc / 移出条带取消。 */
export function PreviewLikeButton({ rating, onRate, onActivity }: {
  rating: number;
  onRate: (rating: number) => void;
  onActivity?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [preview, setPreview] = useState(rating || 1);
  const strip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = useRef<{ x: number; y: number; long: boolean; value: number | null } | null>(null);
  const suppressClick = useRef(false);
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function cancel() {
    clearTimer();
    press.current = null;
    setOpen(false);
  }
  function move(event: PointerEvent) {
    event.stopPropagation();
    const current = press.current;
    if (!current) return;
    if (!current.long) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) cancel();
      return;
    }
    onActivity?.();
    const rect = strip.current?.getBoundingClientRect();
    if (!rect) return;
    const inside = event.clientX >= rect.left - 16 && event.clientX <= rect.right + 16
      && event.clientY >= rect.top - 24 && event.clientY <= rect.bottom + 24;
    current.value = inside ? Math.max(1, Math.min(5, Math.floor((event.clientX - rect.left - 6) / 28) + 1)) : null;
    setPreview(current.value ?? 0);
  }
  return <span className="preview-like-control" onPointerMove={move}
    onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}
    onPointerEnter={onActivity} onKeyDown={(event) => {
      if (event.key === "Escape" && (open || press.current)) { event.preventDefault(); event.stopPropagation(); cancel(); }
      if (event.key === "Enter" || event.key === " ") event.stopPropagation();
    }}>
    <IconButton size="sm" variant="solid" className={cn("rounded-full shadow-md", rating > 0 && "text-danger")}
      label={rating ? `取消 Like（${rating} 颗心）` : "Like"} aria-pressed={rating > 0}
      title="单击喜欢 / 取消；长按滑动评 1～5 颗心；方向键也可评分"
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        suppressClick.current = true;
        press.current = { x: event.clientX, y: event.clientY, long: false, value: rating || 1 };
        clearTimer();
        const rect = event.currentTarget.getBoundingClientRect();
        timer.current = setTimeout(() => {
          if (!press.current) return;
          press.current.long = true;
          setPreview(rating || 1);
          setPosition({ left: Math.max(8, Math.min(window.innerWidth - 160, rect.left + rect.width / 2 - 6 - ((rating || 1) - .5) * 28)),
            top: Math.max(8, Math.min(window.innerHeight - 62, rect.top + rect.height / 2 - 20)) });
          setOpen(true);
          onActivity?.();
        }, 400);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        const current = press.current;
        clearTimer();
        press.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (current) {
          if (current.long) { if (current.value !== null) onRate(current.value); }
          else onRate(rating > 0 ? 0 : 1);
        }
        setOpen(false);
      }}
      onPointerCancel={cancel} onLostPointerCapture={() => { if (press.current) cancel(); }}
      onClick={(event) => {
        event.stopPropagation();
        if (suppressClick.current && event.detail > 0) { suppressClick.current = false; return; }
        onRate(rating > 0 ? 0 : 1);
      }}
      onKeyDown={(event) => {
        if (["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          onRate(event.key === "Home" ? 0 : event.key === "End" ? 5
            : Math.max(0, Math.min(5, rating + (["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1))));
        }
      }}>
      <Heart size={14} fill={rating > 0 ? "currentColor" : "none"} aria-hidden />
      {rating > 1 ? <span className="preview-like-value">{rating}</span> : null}
    </IconButton>
    {open ? createPortal(<div ref={strip} className="preview-like-strip" style={position} role="status" aria-label={preview ? `${preview} 颗心，松手保存` : "松手取消评分"}>
      {[1, 2, 3, 4, 5].map((value) => <span key={value} className={cn("preview-rating-heart", value <= preview && "is-filled")}>
        <Heart size={20} fill={value <= preview ? "currentColor" : "none"} aria-hidden />
      </span>)}
      <span className="preview-like-hint">{preview ? `${preview} / 5 · 松手保存` : "松手取消"}</span>
    </div>, document.body) : null}
  </span>;
}
