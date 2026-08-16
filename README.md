# artDatabase

艺术素材数据库项目。

## 状态

项目管理、图片上传、维度预览和自由画板核心功能已完成。应用运行在 Cloudflare Worker 上，结构化业务数据与元数据保存在 D1（SQLite）；原图与缩略图当前由 ResourceSpace 存储（Metadata 双写）。后端图片存储去 ResourceSpace 重构处于需求澄清中。

## 需求文档

- [需求文档（现状事实 + 现阶段需求 + 更新记录）](./requirements/需求文档.md)
- [历史版本需求文档存档](./requirements/README.md)

## 开始使用

本地启动应用：

```bash
cd apps/web
npm install
npm run dev
```

然后访问 `http://localhost:3000`。结构化业务数据保存在应用的本地 D1 开发数据库中。
