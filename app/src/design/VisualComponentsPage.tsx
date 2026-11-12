import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Check, Palette, Plus, Trash2 } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  Field,
  IconButton,
  InlineMessage,
  Input,
  Modal,
  SearchInput,
  Spinner,
  Textarea,
  Toast,
  cn,
} from "../ui";
import type { ButtonSize, ButtonVariant, IconButtonSize, IconButtonVariant, InlineMessageTone } from "../ui";
import { AccountSettingsSpecimen, AnnouncementSpecimen, AuthSpecimen } from "./specimens/auth";
import { SidebarSpecimen, TagAndTabsSpecimen, TagFilterSpecimen, TopbarSpecimen, UserMenuSpecimen } from "./specimens/layout";
import { AssetCardSpecimen, ProjectCardSpecimen, TrashSpecimen } from "./specimens/library";
import { MetadataSpecimen, ReplacementSpecimen, UploadStateSpecimen } from "./specimens/detail";
import { AccountModalsSpecimen } from "./specimens/account";
import { DimensionControlsSpecimen } from "./specimens/dimensions";

/* ────────────────────────────── Token 数据 ────────────────────────────── */

type ColorToken = { name: string; value: string; usage: string };

const COLOR_GROUPS: { title: string; note: string; items: ColorToken[] }[] = [
  {
    title: "中性",
    note: "页面底色、边框、文字层级",
    items: [
      { name: "ink", value: "--color-ink", usage: "主文字" },
      { name: "ink-soft", value: "--color-ink-soft", usage: "深色区分隔" },
      { name: "ink-panel", value: "--color-ink-panel", usage: "侧栏 / toast 底" },
      { name: "ink-hover", value: "--color-ink-hover", usage: "侧栏 hover" },
      { name: "ink-deep", value: "--color-ink-deep", usage: "气泡 / 浮层底" },
      { name: "ink-popover", value: "--color-ink-popover", usage: "浮动工具条底" },
      { name: "ink-label", value: "--color-ink-label", usage: "表单标签" },
      { name: "muted", value: "--color-muted", usage: "次级文字" },
      { name: "faint", value: "--color-faint", usage: "占位 / 弱提示" },
      { name: "line", value: "--color-line", usage: "常规边框" },
      { name: "line-soft", value: "--color-line-soft", usage: "弱分隔" },
      { name: "line-strong", value: "--color-line-strong", usage: "输入 / 卡片边框" },
      { name: "paper", value: "--color-paper", usage: "页面底" },
      { name: "surface", value: "--color-surface", usage: "卡片底" },
      { name: "surface-muted", value: "--color-surface-muted", usage: "次级块底" },
      { name: "surface-sunken", value: "--color-surface-sunken", usage: "凹陷块底" },
      { name: "white", value: "--color-white", usage: "纯白" },
    ],
  },
  {
    title: "遮罩",
    note: "弹窗与抽屉的背景层",
    items: [
      { name: "scrim", value: "--color-scrim", usage: "弹窗遮罩" },
      { name: "scrim-strong", value: "--color-scrim-strong", usage: "详情抽屉遮罩" },
    ],
  },
  {
    title: "品牌",
    note: "主操作、筛选与强调",
    items: [
      { name: "accent", value: "--color-accent", usage: "品牌主色" },
      { name: "accent-strong", value: "--color-accent-strong", usage: "hover / 可读文字" },
      { name: "accent-soft", value: "--color-accent-soft", usage: "品牌浅底" },
      { name: "accent-border", value: "--color-accent-border", usage: "品牌浅边框" },
      { name: "accent-light", value: "--color-accent-light", usage: "深底上的品牌色" },
      { name: "sage", value: "--color-sage", usage: "筛选 / 确认" },
      { name: "sage-strong", value: "--color-sage-strong", usage: "hover" },
      { name: "sage-deep", value: "--color-sage-deep", usage: "深字" },
      { name: "sage-soft", value: "--color-sage-soft", usage: "浅底" },
      { name: "sage-wash", value: "--color-sage-wash", usage: "极浅底" },
    ],
  },
  {
    title: "语义",
    note: "成功 / 警告 / 危险 / 选择",
    items: [
      { name: "success", value: "--color-success", usage: "成功文字" },
      { name: "success-soft", value: "--color-success-soft", usage: "成功底" },
      { name: "success-border", value: "--color-success-border", usage: "成功边框" },
      { name: "warning", value: "--color-warning", usage: "警告文字" },
      { name: "warning-soft", value: "--color-warning-soft", usage: "警告底" },
      { name: "warning-border", value: "--color-warning-border", usage: "警告边框" },
      { name: "danger", value: "--color-danger", usage: "危险" },
      { name: "danger-soft", value: "--color-danger-soft", usage: "危险底" },
      { name: "danger-border", value: "--color-danger-border", usage: "危险边框" },
      { name: "selection", value: "--color-selection", usage: "画板选择框 / 辅助线" },
    ],
  },
];

const TYPE_SCALE: { token: string; className: string; sample: string }[] = [
  { token: "text-2xs · 10/14", className: "text-2xs", sample: "徽标与极次要信息" },
  { token: "text-xs · 11/16", className: "text-xs", sample: "辅助说明与计数" },
  { token: "text-sm · 12/18", className: "text-sm", sample: "界面正文与控件（主力）" },
  { token: "text-base · 13/20", className: "text-base", sample: "稍大的正文" },
  { token: "text-md · 14/22", className: "text-md", sample: "正文强调、坐标气泡" },
  { token: "text-lg · 16/24", className: "text-lg", sample: "区块标题" },
  { token: "text-xl · 20/28", className: "text-xl", sample: "页面标题" },
  { token: "text-2xl · 24/32", className: "text-2xl", sample: "大标题" },
  { token: "text-3xl · 26/34", className: "text-3xl", sample: "弹窗标题" },
];

const RADIUS = [
  { name: "radius-xs", value: "--radius-xs" },
  { name: "radius-sm", value: "--radius-sm" },
  { name: "radius-md", value: "--radius-md" },
  { name: "radius-lg", value: "--radius-lg" },
  { name: "radius-xl", value: "--radius-xl" },
  { name: "radius-full", value: "--radius-full" },
];

const SHADOWS = [
  { name: "shadow-sm", value: "--shadow-sm" },
  { name: "shadow-md", value: "--shadow-md" },
  { name: "shadow-lg", value: "--shadow-lg" },
  { name: "shadow-xl", value: "--shadow-xl" },
  { name: "shadow-panel", value: "--shadow-panel" },
];

const Z_LAYERS = [
  { name: "sticky", value: "--z-sticky", usage: "吸顶栏" },
  { name: "sidebar", value: "--z-sidebar", usage: "侧栏" },
  { name: "focus", value: "--z-focus", usage: "专注模式" },
  { name: "drawer", value: "--z-drawer", usage: "详情抽屉" },
  { name: "popover", value: "--z-popover", usage: "下拉菜单" },
  { name: "overlay", value: "--z-overlay", usage: "拖拽遮罩" },
  { name: "modal", value: "--z-modal", usage: "弹窗" },
  { name: "modal-nested", value: "--z-modal-nested", usage: "嵌套弹窗" },
  { name: "toast", value: "--z-toast", usage: "轻提示" },
  { name: "toast-urgent", value: "--z-toast-urgent", usage: "撤销条" },
];

const BREAKPOINTS = [
  { name: "sm", value: "--breakpoint-sm" },
  { name: "md", value: "--breakpoint-md" },
  { name: "lg", value: "--breakpoint-lg" },
  { name: "xl", value: "--breakpoint-xl" },
];

const SPACING_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12];

const ALL_VARS = [
  ...COLOR_GROUPS.flatMap((group) => group.items.map((item) => item.value)),
  ...RADIUS.map((item) => item.value),
  ...SHADOWS.map((item) => item.value),
  ...Z_LAYERS.map((item) => item.value),
  ...BREAKPOINTS.map((item) => item.value),
];

/* ────────────────────────────── 颜色工具 ────────────────────────────── */

function parseColor(value: string): [number, number, number] | null {
  const text = value.trim();
  if (text.startsWith("#")) {
    const hex = text.slice(1);
    const full = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex.slice(0, 6);
    if (full.length !== 6) return null;
    const parsed = Number.parseInt(full, 16);
    if (Number.isNaN(parsed)) return null;
    return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
  }
  const rgb = text.match(/rgba?\(([^)]+)\)/);
  if (!rgb) return null;
  const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null;
  return [parts[0], parts[1], parts[2]];
}

function luminance([red, green, blue]: [number, number, number]) {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrastRatio(foreground: string, background: string) {
  const a = parseColor(foreground);
  const b = parseColor(background);
  if (!a || !b) return null;
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function readVars(vars: string[]) {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(vars.map((name) => [name, styles.getPropertyValue(name).trim()]));
}

/* ────────────────────────────── 页面局部组件 ────────────────────────────── */

function Section({ id, index, title, description, children }: { id: string; index: string; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <header className="mb-5 flex items-end justify-between gap-4 border-b border-line pb-3">
        <div>
          <p className="text-2xs font-bold uppercase tracking-[.18em] text-accent">{index}</p>
          <h2 className="mt-1 font-display text-2xl font-medium text-ink">{title}</h2>
        </div>
        <p className="max-w-[520px] text-right text-sm text-muted">{description}</p>
      </header>
      {children}
    </section>
  );
}

function Specimen({ title, note, children, className }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-line bg-surface", className)}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
        <h3 className="text-md font-semibold text-ink">{title}</h3>
        {note ? <p className="text-xs text-muted">{note}</p> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Swatch({ item, resolved, paper }: { item: ColorToken; resolved: Record<string, string>; paper: string }) {
  const value = resolved[item.value] ?? "";
  const ratio = contrastRatio(value, paper);
  const aa = ratio !== null && ratio >= 4.5;
  return (
    <div className="min-w-0">
      <div className="h-14 rounded-sm border border-line" style={{ background: value || undefined }} />
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <strong className="truncate text-xs font-semibold text-ink">{item.name}</strong>
        {ratio !== null ? (
          <span className={cn("flex-none rounded-full px-1.5 py-0.5 text-2xs", aa ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
            {ratio.toFixed(2)}
          </span>
        ) : null}
      </div>
      <p className="truncate text-2xs text-muted">{item.usage}</p>
      <code className="block truncate text-2xs text-faint">{value || "—"}</code>
    </div>
  );
}

/* ────────────────────────────── 页面 ────────────────────────────── */

export function VisualComponentsPage() {
  const [vars, setVars] = useState<Record<string, string>>({});
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 0 : window.innerWidth));
  const [formOpen, setFormOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<{ tone: "default" | "success" | "error"; text: string; action?: { label: string; onClick: () => void } } | null>(null);
  const [search, setSearch] = useState("");
  const [size, setSize] = useState<ButtonSize>("md");

  useEffect(() => {
    setVars(readVars(ALL_VARS));
  }, []);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const paper = vars["--color-paper"] ?? "";
  const activeBreakpoint = BREAKPOINTS.reduce((matched, item) => {
    const px = Number.parseFloat(vars[item.value] ?? "0");
    return px > 0 && width >= px ? item.name : matched;
  }, "base");

  const tokenCount =
    COLOR_GROUPS.reduce((total, group) => total + group.items.length, 0) +
    TYPE_SCALE.length +
    RADIUS.length +
    SHADOWS.length +
    Z_LAYERS.length +
    BREAKPOINTS.length +
    SPACING_STEPS.length;

  return (
    <div className="mx-auto w-full max-w-[1180px] px-8 pb-24 pt-8">
      <header className="rounded-xl bg-ink-panel px-8 py-9 text-white">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div className="min-w-0">
            <p className="text-2xs font-bold uppercase tracking-[.2em] text-accent-light">ART DATABASE / DESIGN SYSTEM</p>
            <h1 className="mt-2 font-display text-hero font-medium leading-none">视觉组件</h1>
            <p className="mt-3 max-w-[620px] text-base text-white/70">
              设计系统的唯一验收入口：Token、通用控件与各模块控件都在这里以真实组件呈现。页面本身只使用 token 与 ui/ 原语，不引用任何旧样式类。
            </p>
          </div>
          <div className="flex gap-2">
            {[
              { label: "Token", value: tokenCount },
              { label: "通用控件", value: 9 },
              { label: "模块控件", value: "7 / 7" },
            ].map((item) => (
              <div key={item.label} className="min-w-[92px] border border-white/15 px-3 py-2">
                <p className="text-2xs uppercase tracking-[.12em] text-white/50">{item.label}</p>
                <strong className="mt-1 block text-lg font-semibold text-white">{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </header>

      <nav className="sticky top-[67px] z-10 -mx-2 mt-4 flex flex-wrap items-center gap-1 rounded-md border border-line bg-surface/95 px-2 py-1.5 backdrop-blur">
        {[
          { href: "#tokens", label: "01 Token" },
          { href: "#controls", label: "02 通用控件" },
          { href: "#modules", label: "03 各模块控件" },
        ].map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="rounded-sm px-2.5 py-1 text-sm text-muted transition-colors hover:bg-line-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {item.label}
          </a>
        ))}
        <span className="ml-auto pr-1 text-xs text-muted">
          当前宽度 {width}px · 命中 <strong className="text-ink">{activeBreakpoint}</strong>
        </span>
      </nav>

      <div className="mt-10 flex flex-col gap-14">
        <Section id="tokens" index="01 / FOUNDATIONS" title="Token" description="颜色、字号、圆角、阴影、层级与间距都集中定义在 styles/tokens.css；本区直接读取 CSS 变量，保证与产品一致。">
          <div className="flex flex-col gap-6">
            {COLOR_GROUPS.map((group) => (
              <Specimen key={group.title} title={`颜色 · ${group.title}`} note={group.note}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {group.items.map((item) => (
                    <Swatch key={item.value} item={item} resolved={vars} paper={paper} />
                  ))}
                </div>
              </Specimen>
            ))}

            <div className="grid gap-6 lg:grid-cols-2">
              <Specimen title="字号阶" note="覆盖 Tailwind 默认档位；12px 为主力">
                <div className="flex flex-col gap-2">
                  {TYPE_SCALE.map((item) => (
                    <div key={item.className} className="flex items-baseline justify-between gap-4 border-b border-line-soft pb-1.5 last:border-0 last:pb-0">
                      <span className={cn("truncate text-ink", item.className)}>{item.sample}</span>
                      <code className="flex-none text-2xs text-faint">{item.token}</code>
                    </div>
                  ))}
                </div>
              </Specimen>

              <div className="flex flex-col gap-6">
                <Specimen title="圆角" note="5px 与 7px 是最常用的档位">
                  <div className="flex flex-wrap items-end gap-3">
                    {RADIUS.map((item) => (
                      <div key={item.name} className="flex flex-col items-center gap-1.5">
                        <div className="size-12 border border-line-strong bg-surface-muted" style={{ borderRadius: `var(${item.value})` }} />
                        <code className="text-2xs text-faint">{vars[item.value] ?? "—"}</code>
                      </div>
                    ))}
                  </div>
                </Specimen>
                <Specimen title="阴影" note="浮层用 lg / xl，卡片用 md">
                  <div className="flex flex-wrap gap-4">
                    {SHADOWS.map((item) => (
                      <div key={item.name} className="flex flex-col items-center gap-1.5">
                        <div className="size-12 border border-line bg-white" style={{ boxShadow: `var(${item.value})` }} />
                        <code className="text-2xs text-faint">{item.name.replace("shadow-", "")}</code>
                      </div>
                    ))}
                  </div>
                </Specimen>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Specimen title="间距" note="4px 基准，p-1 = 4px">
                <div className="flex flex-col gap-1.5">
                  {SPACING_STEPS.map((step) => (
                    <div key={step} className="flex items-center gap-3">
                      <code className="w-10 text-right text-2xs text-faint">p-{step}</code>
                      <span className="h-3 rounded-xs bg-sage/70" style={{ width: `${step * 4}px` }} />
                      <span className="text-2xs text-muted">{step * 4}px</span>
                    </div>
                  ))}
                </div>
              </Specimen>

              <div className="flex flex-col gap-6">
                <Specimen title="层级" note="弹窗/抽屉/toast 的固定契约">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {Z_LAYERS.map((item) => (
                      <div key={item.name} className="flex items-baseline justify-between gap-2 border-b border-line-soft pb-1">
                        <span className="truncate text-xs text-ink">{item.name}</span>
                        <code className="flex-none text-2xs text-faint">{vars[item.value] ?? "—"}</code>
                      </div>
                    ))}
                  </div>
                </Specimen>
                <Specimen title="断点" note="沿用现有 max-width 语义">
                  <div className="flex flex-wrap gap-2">
                    {BREAKPOINTS.map((item) => (
                      <span
                        key={item.name}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs",
                          activeBreakpoint === item.name ? "border-sage bg-sage text-white" : "border-line text-muted",
                        )}
                      >
                        {item.name} ≥ {vars[item.value] ?? "—"}
                      </span>
                    ))}
                  </div>
                </Specimen>
              </div>
            </div>
          </div>
        </Section>

        <Section id="controls" index="02 / PRIMITIVES" title="通用控件" description="按钮、输入、弹窗、反馈。所有控件来自 app/src/ui，页面只做组合；交互状态可直接切换。">
          <div className="flex flex-col gap-6">
            <Specimen title="按钮" note="variant × size；含禁用与加载">
              <div className="flex flex-col gap-3">
                {(["primary", "secondary", "ghost", "danger"] as ButtonVariant[]).map((variant) => (
                  <div key={variant} className="flex flex-wrap items-center gap-2">
                    <code className="w-20 flex-none text-xs text-muted">{variant}</code>
                    {(["xs", "sm", "md", "lg"] as ButtonSize[]).map((item) => (
                      <Button key={item} variant={variant} size={item}>
                        {item.toUpperCase()} 按钮
                      </Button>
                    ))}
                    <Button variant={variant} disabled>
                      禁用
                    </Button>
                    <Button variant={variant} loading>
                      加载
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
                  <code className="w-20 flex-none text-xs text-muted">icon</code>
                  <Button variant="primary" icon={<Plus size={14} aria-hidden />}>
                    新建项目
                  </Button>
                  <Button variant="secondary" icon={<Check size={14} aria-hidden />}>
                    已选择
                  </Button>
                  <Button variant="danger" icon={<Trash2 size={14} aria-hidden />}>
                    删除
                  </Button>
                </div>
              </div>
            </Specimen>

            <Specimen title="图标按钮" note="必须带 label；active 表示当前选中">
              <div className="flex flex-col gap-3">
                {(["ghost", "solid", "danger"] as IconButtonVariant[]).map((variant) => (
                  <div key={variant} className="flex flex-wrap items-center gap-2">
                    <code className="w-20 flex-none text-xs text-muted">{variant}</code>
                    {(["sm", "md", "lg"] as IconButtonSize[]).map((item) => (
                      <IconButton key={item} variant={variant} size={item} label={`${variant}-${item}`}>
                        <Palette size={item === "sm" ? 14 : item === "md" ? 16 : 18} aria-hidden />
                      </IconButton>
                    ))}
                    <IconButton variant={variant} label={`${variant}-active`} active>
                      <Palette size={16} aria-hidden />
                    </IconButton>
                    <IconButton variant={variant} label={`${variant}-disabled`} disabled>
                      <Palette size={16} aria-hidden />
                    </IconButton>
                  </div>
                ))}
              </div>
            </Specimen>

            <div className="grid gap-6 lg:grid-cols-2">
              <Specimen title="输入与表单" note="Field 统一 label / hint / error 的间距">
                <div className="flex flex-col gap-4">
                  <Field label="素材名称" hint="上传时会作为默认名称" htmlFor="ds-name">
                    <Input id="ds-name" defaultValue="秋季品牌摄影" />
                  </Field>
                  <Field label="来源链接" error="只允许 http:// 或 https://" htmlFor="ds-url">
                    <Input id="ds-url" invalid defaultValue="ftp://example.com" />
                  </Field>
                  <Field label="备注">
                    <Textarea placeholder="补充说明（可空）" />
                  </Field>
                  <Field label="禁用字段" hint="不可编辑">
                    <Input disabled defaultValue="由系统生成" />
                  </Field>
                </div>
              </Specimen>

              <Specimen title="搜索与尺寸" note="SearchInput 支持清除；按钮尺寸可切换">
                <div className="flex flex-col gap-4">
                  <SearchInput value={search} onValueChange={setSearch} onClear={() => setSearch("")} placeholder="搜索名称、文件或标签" />
                  <p className="text-xs text-muted">当前输入：{search || "（空）"}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">尺寸</span>
                    {(["xs", "sm", "md", "lg"] as ButtonSize[]).map((item) => (
                      <Button key={item} size="xs" variant={size === item ? "primary" : "secondary"} onClick={() => setSize(item)}>
                        {item}
                      </Button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <SearchInput size="sm" className="max-w-[220px]" placeholder="紧凑搜索" />
                    <Input size="sm" className="max-w-[120px]" defaultValue="小输入" />
                  </div>
                </div>
              </Specimen>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Specimen title="弹窗" note="portal + 滚动锁 + Esc + 焦点还原">
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => setFormOpen(true)}>
                    打开表单弹窗
                  </Button>
                  <Button variant="danger" onClick={() => setConfirmOpen(true)}>
                    打开危险确认
                  </Button>
                </div>
                <p className="mt-3 text-xs text-muted">打开后按 Esc、点遮罩或点关闭都能退出；关闭后焦点回到触发按钮。</p>
              </Specimen>

              <Specimen title="反馈" note="Toast / 内联提示 / 加载">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setToast({ tone: "success", text: "已保存到项目「品牌视觉」" })}>
                      成功提示
                    </Button>
                    <Button size="sm" onClick={() => setToast({ tone: "error", text: "AI 打标失败：未配置服务" })}>
                      错误提示
                    </Button>
                    <Button size="sm" onClick={() => setToast({ tone: "default", text: "已删除 1 个素材", action: { label: "撤销", onClick: () => setToast(null) } })}>
                      撤销条
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setToast({ tone: "success", text: "这条提示会在 2.4 秒后自动消失" });
                        window.setTimeout(() => setToast(null), 2400);
                      }}
                    >
                      自动消失
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {(["success", "error", "warning", "info"] as InlineMessageTone[]).map((tone) => (
                      <InlineMessage key={tone} tone={tone}>
                        {tone === "success" ? "配置已保存，团队成员可以使用。" : tone === "error" ? "请检查必填项后再继续。" : tone === "warning" ? "该维度会在 5 秒后删除。" : "素材只保存一份，项目中创建的是引用。"}
                      </InlineMessage>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 border-t border-line-soft pt-3 text-xs text-muted">
                    <Spinner size={14} />
                    加载中
                    <Spinner size={18} />
                    <Spinner size={22} />
                  </div>
                </div>
              </Specimen>
            </div>
          </div>
        </Section>

        <Section id="modules" index="03 / MODULES" title="各模块控件" description="按计划批次逐步验收：B2 已用真实模块组件替换占位卡，其余模块完成后同样替换。">
          <div className="flex flex-col gap-6">
            <Specimen title="认证与账号 · 登录 / 初始化" note="AuthCard / LoginForm / SetupForm">
              <AuthSpecimen />
            </Specimen>

            <div className="grid gap-6 xl:grid-cols-2">
              <Specimen title="账号设置" note="AccountSettingsFields">
                <AccountSettingsSpecimen />
              </Specimen>
              <Specimen title="登录页公告" note="AnnouncementFields">
                <AnnouncementSpecimen />
              </Specimen>
            </div>

            <Specimen title="框架与导航 · 侧栏" note="SidebarNavItem / BrandMark">
              <div className="overflow-x-auto">
                <SidebarSpecimen />
              </div>
            </Specimen>

            <Specimen title="顶栏与用户菜单" note="TopbarTitle / TopbarTabs / SearchInput / UserMenu">
              <TopbarSpecimen />
            </Specimen>

            <div className="grid gap-6 xl:grid-cols-2">
              <Specimen title="标签筛选" note="TagFilterBar / Tag">
                <TagFilterSpecimen />
              </Specimen>
              <Specimen title="用户菜单（点击头像展开）" note="UserMenu / MenuPanel">
                <UserMenuSpecimen />
              </Specimen>
            </div>

            <Specimen title="页签与标签原语" note="Tabs / Tag（可点击 chip）/ TagLabel（只读标签）">
              <TagAndTabsSpecimen />
            </Specimen>

            <Specimen title="内容浏览 · 项目卡" note="ProjectCard">
              <ProjectCardSpecimen />
            </Specimen>

            <Specimen title="素材卡（网格 / 卡片宽度 / 状态）" note="AssetCard / AssetCardWidthControl">
              <AssetCardSpecimen />
            </Specimen>

            <Specimen title="回收站" note="AssetCard 选中态 / EmptyState">
              <TrashSpecimen />
            </Specimen>

            <Specimen title="上传 · 状态与字段" note="ProgressBar / InlineMessage / Field；弹窗需真实文件，在应用内验收">
              <UploadStateSpecimen />
            </Specimen>

            <Specimen title="素材详情 · Metadata" note="AssetMetadataEditor（真实组件）">
              <MetadataSpecimen />
            </Specimen>

            <Specimen title="替换素材" note="AssetImageReplacement（真实入口）">
              <ReplacementSpecimen />
            </Specimen>

            <Specimen title="账号与标签弹窗" note="TagManager / UserManager / TokenSettings / AiConfig（真实弹窗）">
              <AccountModalsSpecimen />
            </Specimen>

            <Specimen title="维度位置控件" note="DimensionControlsEditor / RangeSlider">
              <DimensionControlsSpecimen />
            </Specimen>

            <Specimen title="自由画板" note="BoardView（全屏工作区，应用内验收）">
              <p className="m-0 max-w-[720px] text-sm leading-relaxed text-muted">
                画板工具条、Page 页签、素材托盘、标记工具、文本格式面板、右键菜单与 Frame 删除确认已迁移为原语；画板是全屏工作区，请在项目内打开「自由画板」验收。
              </p>
            </Specimen>
          </div>
        </Section>
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        eyebrow="COMPONENT PREVIEW"
        title="新建项目"
        description="弹层保留明确标题、简短说明和右对齐操作；表单使用同一套 Field。"
        footer={
          <>
            <Button onClick={() => setFormOpen(false)}>取消</Button>
            <Button variant="primary" onClick={() => setFormOpen(false)} icon={<Plus size={14} aria-hidden />}>
              创建
            </Button>
          </>
        }
      >
        <Field label="项目名称" required htmlFor="ds-project">
          <Input id="ds-project" placeholder="如：2026 秋季品牌" />
        </Field>
        <Field label="说明" hint="可留空">
          <Textarea rows={3} placeholder="项目背景、筛选标准或协作说明" />
        </Field>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
        tone="danger"
        title="删除 3 个素材？"
        description="素材会先进入回收站；彻底删除才会移除原文件。"
        confirmText="删除"
      />

      {toast ? <Toast open tone={toast.tone} action={toast.action} onClose={() => setToast(null)}>{toast.text}</Toast> : null}
    </div>
  );
}
