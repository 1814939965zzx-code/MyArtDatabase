"use client";

import { Info } from "lucide-react";
import { useEffect, useRef } from "react";
import { formatDuration, isVideoMime, videoStatusOf } from "../../assetMedia";
import { cn, IconButton } from "../../ui";

/** 详情右上角“i”里展示的只读信息：文件名、上传者与系统生成的元数据。 */
export type AssetDetailInfo = {
  fileName: string;
  createdByName?: string;
  width: number;
  height: number;
  fileSize: number;
  mimeType: string;
  duration: number;
  transcodeStatus: string | null;
};

function formatFileSize(bytes: number) {
  return bytes ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : "大小未知";
}

/**
 * 素材详情的“i”信息入口：与收藏、关闭按钮并排放在标题栏右上角，
 * hover / 键盘聚焦时在图标下方弹出只读预览；面板本身也参与 hover，
 * 指针从图标移到面板上不会立即收起（关闭有 120ms 缓冲）。
 *
 * open / onOpenChange 由详情面板控制：面板打开信息卡时同时铺一层遮罩压暗下方内容，
 * 避免悬浮卡与下面的表单字段叠在一起看不清。
 */
export function AssetDetailInfoTrigger({
  asset,
  open,
  onOpenChange,
  className,
}: {
  asset: AssetDetailInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}) {
  const closeTimer = useRef<number | null>(null);

  function cancelClose() {
    if (closeTimer.current === null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function show() {
    cancelClose();
    onOpenChange(true);
  }

  function hide() {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      onOpenChange(false);
    }, 120);
  }

  useEffect(() => () => cancelClose(), []);

  const video = isVideoMime(asset.mimeType);
  const dimensions = video
    ? videoStatusOf(asset.mimeType, asset.transcodeStatus) === "ready"
      ? formatDuration(asset.duration)
      : "转码中"
    : asset.width && asset.height
      ? `${asset.width} × ${asset.height}`
      : "尺寸未知";

  const facts = [dimensions, formatFileSize(asset.fileSize), asset.mimeType || "image"];

  return (
    <div
      className={cn("asset-info", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hide();
      }}
    >
      <IconButton
        label="查看素材信息"
        title="查看素材信息"
        aria-expanded={open}
        onClick={() => (open ? hide() : show())}
        className="asset-info-trigger"
      >
        <Info size={17} aria-hidden />
      </IconButton>
      {open ? (
        <div className="asset-info-popover" role="dialog" aria-label="素材信息">
          <div className="asset-info-block">
            <small>文件名</small>
            <span>{asset.fileName || "—"}</span>
          </div>
          <div className="asset-info-block">
            <small>上传者</small>
            <span>{asset.createdByName || "未知"}</span>
          </div>
          <div className="asset-info-facts">
            {facts.map((fact) => <span key={fact}>{fact}</span>)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
