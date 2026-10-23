"use client";

import {
  AlertTriangle,
  Check,
  ChevronRight,
  ImageIcon,
  Info,
  LoaderCircle,
  Palette,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";

const colorTokens = [
  { name: "Ink", token: "--ink", className: "ink" },
  { name: "Muted", token: "--muted", className: "muted" },
  { name: "Accent", token: "--accent", className: "accent" },
  { name: "Sage", token: "--sage", className: "sage" },
  { name: "Paper", token: "--paper", className: "paper" },
  { name: "Surface", token: "--surface", className: "surface" },
];

const icons = [
  { label: "创建", Icon: Plus },
  { label: "搜索", Icon: Search },
  { label: "素材", Icon: ImageIcon },
  { label: "智能", Icon: Sparkles },
  { label: "提示", Icon: Info },
  { label: "删除", Icon: Trash2 },
];

function Specimen({
  index,
  eyebrow,
  title,
  description,
  children,
}: {
  index: string;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="component-specimen">
      <div className="component-specimen-heading">
        <span>{index}</span>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <div className="component-specimen-body">{children}</div>
    </section>
  );
}

export function VisualComponentsPage() {
  const [activeTag, setActiveTag] = useState("编辑精选");
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="components-page">
      <header className="components-hero">
        <div>
          <p className="eyebrow">ART DATABASE / VISUAL LANGUAGE</p>
          <h2>视觉组件</h2>
          <p>当前产品界面中正在使用的色彩、排版、控件与反馈模式。此页面直接复用生产样式，用作设计与开发对照。</p>
        </div>
        <div className="components-hero-mark" aria-hidden="true">
          <Palette size={24} />
          <span>UI</span>
        </div>
      </header>

      <div className="components-index" aria-label="组件页面目录">
        <span>01 基础</span>
        <span>02 操作</span>
        <span>03 输入</span>
        <span>04 反馈</span>
        <span>05 内容</span>
      </div>

      <div className="components-grid">
        <Specimen index="01" eyebrow="FOUNDATIONS" title="色彩与排版" description="低饱和中性色承载内容，橙色用于关键动作，鼠尾草绿用于筛选与确认。">
          <div className="token-grid">
            {colorTokens.map((color) => (
              <div className="color-token" key={color.token}>
                <span className={`color-swatch ${color.className}`} />
                <strong>{color.name}</strong>
                <code>{color.token}</code>
              </div>
            ))}
          </div>
          <div className="type-scale">
            <div><span>Display / Serif</span><strong>视觉素材工作台</strong></div>
            <div><span>Heading / Sans</span><h3>整理、比较与发现</h3></div>
            <div><span>Body / Sans</span><p>素材保存在全局数据库中，并通过项目、标签和维度建立关联。</p></div>
            <div><span>Label / Uppercase</span><p className="eyebrow">ASSET METADATA</p></div>
          </div>
        </Specimen>

        <Specimen index="02" eyebrow="ACTIONS" title="按钮与图标" description="动作层级保持克制：主操作只保留一个，次级与图标操作使用轻量边界。">
          <div className="component-row">
            <button className="primary-button" type="button"><Plus size={15} />主操作</button>
            <button className="secondary-button" type="button">次级操作</button>
            <button className="secondary-button" type="button" disabled>不可用</button>
            <button className="icon-button component-icon-button" type="button" aria-label="关闭"><X size={17} /></button>
            <button className="component-danger-button" type="button"><Trash2 size={14} />删除</button>
          </div>
          <div className="icon-catalog">
            {icons.map(({ label, Icon }) => (
              <div key={label}><span><Icon size={18} /></span><small>{label}</small></div>
            ))}
          </div>
        </Specimen>

        <Specimen index="03" eyebrow="FILTERS & STATUS" title="标签与状态" description="圆角胶囊用于筛选和短状态，紧凑标签用于描述素材属性。">
          <div className="component-tag-demo">
            {["编辑精选", "品牌视觉", "摄影", "三维"].map((tag) => (
              <button
                className={activeTag === tag ? "active" : ""}
                type="button"
                key={tag}
                onClick={() => setActiveTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
          <div className="component-badge-row">
            <span className="component-status success"><Check size={12} />已完成</span>
            <span className="component-status warning"><AlertTriangle size={12} />需关注</span>
            <span className="component-status neutral">草稿</span>
            <span className="tag-usage-badge">12 次使用</span>
            <span className="tag-source-badge ai">AI</span>
          </div>
        </Specimen>

        <Specimen index="04" eyebrow="FORM CONTROLS" title="表单控件" description="输入控件保持白色表面与清晰焦点，帮助文字紧随对应字段。">
          <form className="modal-form component-form" onSubmit={(event) => event.preventDefault()}>
            <label>
              素材名称
              <input defaultValue="秋季品牌摄影" aria-label="素材名称示例" />
            </label>
            <label>
              项目说明
              <textarea defaultValue="用于记录项目背景、筛选标准和协作说明。" rows={3} aria-label="项目说明示例" />
            </label>
            <label className="announcement-toggle">
              <input type="checkbox" defaultChecked />
              启用团队共享
            </label>
            <p className="form-hint">辅助信息使用低对比度文字，不与主要内容竞争。</p>
          </form>
        </Specimen>

        <Specimen index="05" eyebrow="FEEDBACK" title="反馈与进度" description="状态反馈按语义区分，不只依赖颜色；长任务同时提供文本和进度。">
          <div className="component-feedback-stack">
            <div className="ai-config-message"><Check size={15} />配置已保存，团队成员现在可以使用。</div>
            <div className="form-error"><AlertTriangle size={15} />请检查必填项后再继续。</div>
            <div className="component-info-message"><Info size={15} />素材只保存一份，项目中创建的是引用。</div>
            <div className="component-progress-block">
              <div><span><LoaderCircle className="spin" size={14} />正在处理素材</span><strong>64%</strong></div>
              <span className="upload-progress"><span /></span>
            </div>
          </div>
        </Specimen>

        <Specimen index="06" eyebrow="CONTENT SURFACES" title="内容卡片与弹层" description="卡片用于可浏览内容，弹层用于需要用户集中注意力的短流程。">
          <div className="component-card-demo">
            <article className="component-asset-card">
              <div className="component-asset-preview"><ImageIcon size={28} /><span>01</span></div>
              <div>
                <strong>产品材质研究</strong>
                <p>自然材质与暖色调参考</p>
                <span className="tag-row"><i>摄影</i><i>材质</i><i>暖色</i></span>
              </div>
            </article>
            <div className="component-panel-demo">
              <p className="eyebrow">DIALOG</p>
              <h3>需要集中确认的操作</h3>
              <p>弹层保留明确标题、简短说明和右对齐操作。</p>
              <button className="secondary-button" type="button" onClick={() => setModalOpen(true)}>
                查看弹层示例<ChevronRight size={14} />
              </button>
            </div>
          </div>
        </Specimen>
      </div>

      {modalOpen ? (
        <div className="modal-backdrop">
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="component-modal-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">COMPONENT PREVIEW</p>
                <h2 id="component-modal-title">弹层示例</h2>
                <p>用于创建、编辑或确认一个范围明确的任务。</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setModalOpen(false)} aria-label="关闭">
                <X size={18} />
              </button>
            </div>
            <div className="modal-form">
              <label>示例字段<input defaultValue="视觉组件" /></label>
              <div className="modal-actions">
                <button className="secondary-button" type="button" onClick={() => setModalOpen(false)}>取消</button>
                <button className="primary-button" type="button" onClick={() => setModalOpen(false)}>确认</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
