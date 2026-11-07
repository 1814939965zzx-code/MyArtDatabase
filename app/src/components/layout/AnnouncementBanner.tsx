import { Megaphone, Pencil, X } from "lucide-react";

/** 站内全局公告条：显示在顶栏下方，可由用户关闭；关闭状态由上层写入浏览器缓存。 */
export function AnnouncementBanner({
  text,
  canEdit,
  onEdit,
  onDismiss,
}: {
  text: string;
  canEdit: boolean;
  onEdit: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="note"
      className="mx-[42px] mt-3 flex flex-none items-start gap-2.5 rounded-md border border-sage/25 border-l-4 border-l-sage bg-sage-wash px-3.5 py-2.5 text-sage-deep max-md:mx-6"
    >
      <Megaphone size={16} aria-hidden className="mt-0.5 flex-none" />
      <div className="min-w-0 flex-1">
        <strong className="block text-sm font-semibold">公告</strong>
        <p className="mt-0.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>
      </div>
      {canEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="flex flex-none items-center gap-1 rounded-sm px-1.5 py-1 text-xs font-medium text-sage-deep/80 transition-colors hover:bg-sage/10 hover:text-sage-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage"
        >
          <Pencil size={12} aria-hidden />
          编辑
        </button>
      ) : null}
      <button
        type="button"
        aria-label="关闭公告"
        title="关闭公告"
        onClick={onDismiss}
        className="flex size-7 flex-none items-center justify-center rounded-sm text-sage-deep/70 transition-colors hover:bg-sage/10 hover:text-sage-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage"
      >
        <X size={15} aria-hidden />
      </button>
    </div>
  );
}
