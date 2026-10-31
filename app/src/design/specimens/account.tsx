import { useState } from "react";
import { AiConfigModal } from "../../AiConfigModal";
import { Button } from "../../ui";
import { TagManager } from "../../TagManager";
import { TokenSettingsModal } from "../../TokenSettingsModal";
import { UserManagerModal } from "../../UserManagerModal";

type OpenModal = "tags" | "members" | "tokens" | "ai" | null;

/** B6 · 账号与标签弹窗：直接挂载真实弹窗（读取真实数据，仅用于管理员验收）。 */
export function AccountModalsSpecimen() {
  const [open, setOpen] = useState<OpenModal>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setOpen("tags")}>标签管理</Button>
        <Button onClick={() => setOpen("members")}>成员管理</Button>
        <Button onClick={() => setOpen("tokens")}>插件令牌</Button>
        <Button onClick={() => setOpen("ai")}>AI 服务配置</Button>
      </div>
      <p className="m-0 text-xs text-muted">点击打开的是生产环境同一份弹窗，会读取真实标签/成员/令牌/配置；关闭后不影响数据。</p>
      {open === "tags" ? <TagManager onClose={() => setOpen(null)} onChanged={() => {}} /> : null}
      {open === "members" ? <UserManagerModal meId="design-system-preview" onClose={() => setOpen(null)} onChanged={() => {}} /> : null}
      {open === "tokens" ? <TokenSettingsModal onClose={() => setOpen(null)} /> : null}
      {open === "ai" ? <AiConfigModal onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
