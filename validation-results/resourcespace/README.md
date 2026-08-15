# ResourceSpace 验证结果

本目录保存第一阶段验证生成的非敏感证据与结果摘要。

- `fixtures/`：由脚本生成的 A、B、C 测试图片及完整 SHA-256。

## 2026-08-14 执行结果

- ResourceSpace 与 MariaDB 已完成初始化，重启后健康检查均为 `healthy`。
- 已创建专用 API 账号 `artdatabase-service`；账号密钥仅保存在忽略提交的 `.env.validation`。
- 签名调用 `get_system_status` 通过，响应总状态为 `OK`；服务重启后复验仍通过。
- A 与 B 的 SHA-256 相同，C 不同，测试样本断言通过。
- ResourceSpace 管理员登录验证通过。
- artDatabase 当前实例已切换：新上传原图与 Metadata 写入 ResourceSpace，D1 仅保存 ResourceSpace 引用和项目关系。
- 经真实端到端验证，上传、原图读取、缩略图读取、Metadata 更新、移入回收站、恢复和彻底删除均通过。
- 人为触发 D1 写入失败后，已确认新建的 ResourceSpace 记录会被补偿删除，不遗留空素材。

验证一已通过。旧 R2 素材保留兼容读取；后续上传不再向 R2 写入图片字节。
