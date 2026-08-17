# artDatabase

面向团队的图片素材库。素材保存在全局库中，项目通过引用、项目维度和自由画板组织素材。

应用位于 `app/`，由一个 Node.js 进程同时提供 React 页面、API、SQLite 数据库和本地图片存储。

## 本地启动

```bash
cd app
npm install
npm run dev
```

然后访问 `http://localhost:3000`。数据库（SQLite）与图片文件保存在 `app/data/` 下。

## 文档入口

- Agent 开始工作：[AGENTS.md](./AGENTS.md)
- 当前有效需求：[requirements/CURRENT.md](./requirements/CURRENT.md)
- 需求变化索引：[requirements/CHANGELOG.md](./requirements/CHANGELOG.md)
- 构建与部署：[BUILD.md](./BUILD.md)

`requirements/archive/` 仅用于历史追溯，不代表当前需求。
