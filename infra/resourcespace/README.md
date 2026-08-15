# ResourceSpace 验证环境

这里保存第一阶段技术验证使用的 ResourceSpace 与 MariaDB 容器配置。ResourceSpace 镜像构建内容基于官方仓库：<https://github.com/resourcespace/docker>。

## 启动

```bash
./scripts/validation/resourcespace/start.sh
```

首次启动后打开 <http://localhost:18080>，按页面提示初始化 ResourceSpace。数据库主机填写 `mariadb`，数据库名和账号读取本目录自动生成的 `.env`。

## 配置文件

- `.env`：本机验证密码，自动生成且不提交。
- `runtime/config.php`：ResourceSpace 初始化后写入的配置，自动生成且不提交。
- `.env.validation`：后续 API 验证使用的服务账号和密钥，手工配置且不提交。

创建 API 服务账号后，执行以下命令配置 artDatabase 使用的 Metadata 字段：

```bash
./scripts/validation/resourcespace/configure-metadata.sh
```

## 停止

```bash
docker compose --env-file infra/resourcespace/.env \
  -f infra/resourcespace/docker-compose.yaml down
```

默认保留 MariaDB 和 filestore 命名卷，以便验证服务重启后的持久化。
