# artDatabase

艺术素材数据库项目。

## 状态

项目管理、图片上传、维度预览和自由画板核心功能已完成；新上传素材的原图、缩略图与 Metadata 已切换到 ResourceSpace，结构化项目数据继续由应用数据库保存。

## 文档

- [需求与验证文档索引](./requirements/README.md)
- [当前需求说明](./requirements/2026-08-14_v0.1_需求说明.md)
- [当前技术验证计划](./requirements/2026-08-14_v0.2_技术验证计划.md)
- [第一批功能实现记录](./requirements/2026-08-14_v0.3_第一批功能实现记录.md)
- [维度规则澄清](./requirements/2026-08-14_v0.4_维度规则澄清.md)
- [上传、预览与画板实现记录](./requirements/2026-08-14_v0.5_上传预览与画板实现记录.md)
- [三维预览交互修订](./requirements/2026-08-14_v0.6_三维预览交互修订.md)
- [三维视角范围修订](./requirements/2026-08-14_v0.7_三维视角范围修订.md)
- [视图布局与导航修订](./requirements/2026-08-14_v0.8_视图布局与导航修订.md)
- [视图专注模式修订](./requirements/2026-08-14_v0.9_视图专注模式修订.md)
- [XY 网格、拖动与俯仰范围修订](./requirements/2026-08-14_v0.10_XY网格拖动与俯仰范围修订.md)
- [XY 网格正方形修订](./requirements/2026-08-14_v0.11_XY网格正方形修订.md)
- [水平视角拖动方向修订](./requirements/2026-08-14_v0.12_水平视角拖动方向修订.md)
- [俯仰角区间修订](./requirements/2026-08-14_v0.13_俯仰角区间修订.md)
- [平面指针穿透修订](./requirements/2026-08-14_v0.14_平面指针穿透修订.md)

## 开始使用

本地启动应用：

```bash
cd apps/web
npm install
npm run dev
```

然后访问 `http://localhost:3000`。结构化业务数据保存在应用的本地 D1 开发数据库中。
