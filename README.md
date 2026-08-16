# artDatabase

艺术素材数据库项目。

## 状态

项目管理、图片上传、维度预览和自由画板核心功能已完成。应用已重构为单个原生 Node.js 服务（`app/`）：React 前端 + 全部 API + SQLite 数据库 + 本地图片存储，不依赖 Cloudflare Worker / D1 / ResourceSpace。

## 文档

- [需求文档（现状事实 + 现阶段需求 + 更新记录）](./requirements/需求文档.md)
- [历史版本存档索引](./requirements/README.md)
- [构建与服务器部署指南](./BUILD.md)

## 开始使用

本地启动应用：

```bash
cd app
npm install
npm run dev
```

然后访问 `http://localhost:3000`。数据库（SQLite）与图片文件保存在 `app/data/` 下。

> 服务器每次拉取新代码后都必须进入 `app/` 重新执行 `npm run build`，然后重启 `app/server/index.js`。完整流程见[构建与服务器部署指南](./BUILD.md)。
