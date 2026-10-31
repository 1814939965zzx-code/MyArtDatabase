import { AlertTriangle, Check, FileImage, Sparkles } from "lucide-react";
import { AssetMetadataEditor } from "../../AssetMetadataEditor";
import { AssetImageReplacement } from "../../AssetImageReplacement";
import { Button, Field, InlineMessage, Input, ProgressBar, Textarea } from "../../ui";

const demoAsset = {
  id: "asset-demo",
  name: "秋季品牌主视觉",
  tags: ["摄影", "暖色", "品牌视觉"],
  description: "自然材质与暖色调参考",
  notes: "用于秋季 campaign 首页",
  sourceUrl: "https://example.com/reference",
  mimeType: "image/jpeg",
  thumbnailUrl: null,
  originalUrl: null,
};

/** B5 · 素材详情 Metadata 编辑器（真实组件）。 */
export function MetadataSpecimen() {
  return (
    <div className="max-w-[520px] rounded-lg border border-line bg-surface px-4">
      <AssetMetadataEditor asset={demoAsset} busy={false} availableTags={["摄影", "暖色", "材质", "自然光"]} onAiTag={() => {}} onSave={async () => {}} />
    </div>
  );
}

/** B5 · 替换素材入口（真实组件，按钮与粘贴提示）。 */
export function ReplacementSpecimen() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <AssetImageReplacement asset={demoAsset} busy={false} onBusyChange={() => {}} onComplete={async () => {}} onMessage={() => {}} />
      <p className="m-0 text-xs text-muted">上传与替换的确认弹窗依赖真实文件，在应用内上传/替换时验收。</p>
    </div>
  );
}

/** B5 · 上传状态：进度、重复提示与字段样式。 */
export function UploadStateSpecimen() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <div className="flex items-center justify-between text-sm text-muted">
          <span className="flex items-center gap-1.5"><FileImage size={15} aria-hidden /> autumn-key-visual.jpg</span>
          <span>64%</span>
        </div>
        <ProgressBar value={64} size="md" />
        <p className="m-0 text-xs text-muted">上传进度显示在弹窗底部，完成后自动加入项目。</p>
        <Field label="素材名称">
          <Input defaultValue="autumn-key-visual" />
        </Field>
        <Field label="描述">
          <Textarea rows={2} placeholder="描述图片内容或使用方向" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button size="sm">取消</Button>
          <Button size="sm" variant="primary" loading>上传中 64%</Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <InlineMessage tone="success">
          <span className="flex items-center gap-1.5"><Check size={14} aria-hidden /> 未发现完全重复素材</span>
        </InlineMessage>
        <div className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-soft p-3 text-sm text-warning">
          <span className="flex items-center gap-2 font-medium"><AlertTriangle size={16} aria-hidden /> 发现完全相同的素材</span>
          <p className="m-0">SHA-256 与“秋季品牌主视觉”一致。</p>
          <div className="flex flex-wrap gap-2">
            <Button size="xs">使用已有素材</Button>
            <Button size="xs" variant="ghost">仍保留为新素材</Button>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-line-soft pt-3">
          <Sparkles size={14} aria-hidden className="text-accent" />
          <span className="text-xs text-muted">AI 打标按钮位于标签输入框右侧，等待时显示 loading。</span>
          <Button size="sm" variant="secondary" className="border-accent-border bg-accent-soft text-accent-strong" loading>
            AI 打标中…
          </Button>
        </div>
      </div>
    </div>
  );
}
