import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Input } from "./Field";
import type { InputProps } from "./Field";

/**
 * 带“显示/隐藏”小眼睛的密码输入框。
 * 小眼睛不抢输入焦点、不触发所在表单提交（与现有交互一致）。
 */
export function PasswordInput(props: InputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      type={visible ? "text" : "password"}
      icon={<KeyRound size={15} aria-hidden />}
      trailing={
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? "隐藏密码" : "显示密码"}
          className="grid place-items-center rounded-sm p-0.5 text-faint transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {visible ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
        </button>
      }
    />
  );
}
