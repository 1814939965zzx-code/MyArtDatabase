"use client";

import { Eye, EyeOff, KeyRound } from "lucide-react";
import { InputHTMLAttributes, useState } from "react";

/** 带“显示/隐藏”小眼睛的密码输入框（auth-input 样式）。 */
export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="auth-input">
      <KeyRound size={15} />
      <input type={visible ? "text" : "password"} {...props} />
      <button
        type="button"
        className="password-eye"
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? "隐藏密码" : "显示密码"}
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </span>
  );
}
