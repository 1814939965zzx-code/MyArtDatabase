import { useEffect, useRef, useState } from "react";
import { ChevronDown, KeyRound, LogOut, Megaphone, Palette, UserCog, Users } from "lucide-react";
import { MenuItem, MenuPanel, MenuSeparator } from "../../ui";

export type UserMenuAction = "account" | "tokens" | "members" | "announcement" | "components" | "logout";

/** 顶部用户菜单：触发器 + 下拉项；点击外部与 Esc 关闭。 */
export function UserMenu({
  displayName,
  role,
  onAction,
}: {
  displayName: string;
  role: "admin" | "member" | "guest";
  onAction: (action: UserMenuAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", closeOnClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function pick(action: UserMenuAction) {
    setOpen(false);
    onAction(action);
  }

  return (
    <div className="relative flex-none" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-9.5 items-center gap-2 rounded-md border border-line bg-surface px-2.5 transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="grid size-6.5 flex-none place-items-center rounded-full bg-accent text-sm font-semibold text-white" aria-hidden>
          {displayName.slice(0, 1).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-col items-start leading-[1.15]">
          <strong className="max-w-[110px] truncate text-sm font-semibold text-ink">{displayName}</strong>
          <small className="text-2xs text-muted">{role === "admin" ? "管理员" : role === "guest" ? "游客（只读）" : "成员"}</small>
        </span>
        <ChevronDown size={14} className="text-muted" aria-hidden />
      </button>

      {open ? (
        <MenuPanel>
          {role !== "guest" ? (
            <>
              <MenuItem icon={<UserCog size={15} aria-hidden />} onClick={() => pick("account")}>
                账号设置
              </MenuItem>
              <MenuItem icon={<KeyRound size={15} aria-hidden />} onClick={() => pick("tokens")}>
                插件令牌
              </MenuItem>
            </>
          ) : null}
          {role === "admin" ? (
            <>
              <MenuItem icon={<Users size={15} aria-hidden />} onClick={() => pick("members")}>
                成员管理
              </MenuItem>
              <MenuItem icon={<Megaphone size={15} aria-hidden />} onClick={() => pick("announcement")}>
                登录页公告
              </MenuItem>
              <MenuItem icon={<Palette size={15} aria-hidden />} onClick={() => pick("components")}>
                视觉组件
              </MenuItem>
            </>
          ) : null}
          <MenuSeparator />
          <MenuItem danger icon={<LogOut size={15} aria-hidden />} onClick={() => pick("logout")}>
            退出登录
          </MenuItem>
        </MenuPanel>
      ) : null}
    </div>
  );
}
