# API Connection

## 连接契约

浏览器只访问前端 origin 的相对路径；Node 开发服务默认绑定 `127.0.0.1:18085` 并转发至显式可信的 `http://127.0.0.1:18084`。后端必须由你单独启动，不自动发现、不复用其他数据库、不代理 Python 业务。

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| `/v1/config` | GET | Java 能力、固定 workspace、认证模式 |
| `/v1/session` | POST、DELETE | Java JWT → HttpOnly Cookie / 清除 Cookie |
| `/v1/documents?filename=<encoded>` | POST | 原始PDF/TXT/MD，Content-Type严格application/octet-stream，1..20MiB，202返回任务 |
| `/v1/ingestions/{id}` | GET | 当前授权解析任务 |
| `/v1/ingestions/{id}/cancel`、`/retry` | POST | 无请求体；权限与状态由Java检查，返回更新任务 |
| `/v1/management/documents` | GET | 授权分页、筛选、排序 |
| `/v1/management/documents/{id}` | PATCH | 展示元数据整理；详情使用当前授权列表行，没有独立GET详情接口 |
| `/v1/management/document-actions` | POST | 批量移动／追加标签及逐项回执 |
| `/v1/management/folders` | GET、POST | 授权目录列表／创建 |
| `/v1/management/folders/{id}` | PATCH、DELETE | 目录改名／删除 |
| `/v1/management/tags` | GET | 当前身份可见标签 |
| `/health/live`、`/health/ready` | GET | 原样传递 Java 健康状态，ready503不会伪装成200 |

ID 仅接受1–128位 ASCII 字母、数字、下划线与连字符。具体 body/query/ACL 和错误语义见 [Java API](https://github.com/LingBengYing/ai-knowledge/blob/main/docs/API.md)。新增后端路由不会自动穿透前端开发代理；必须在新的变更中明确加入方法与路由回归。

## 文本任务

Java的`RAG_INGESTION_ENABLED=true`为显式本机开关，默认关闭；页面同时检查`text_upload`和`ingestions`。filename是唯一query参数，不允许路径、控制字符、超过255字符或不支持的扩展名。浏览器用原始File，不使用multipart/base64/JSON包装。只有这一精确上传接口享有20MiB、30秒和最多两个在途请求；其他JSON接口仍128KiB/10秒，所有响应仍4MiB。Cookie和同源要求与管理操作相同。

任务安全shape：`task_id/document_id/revision_id/state/attempt/error_code/can_cancel/can_retry`。state为queued、processing、parsed、failed、cancelled；attempt为1..3，retry沿用任务与解析版本，增加attempt。界面不显示正文、chunk或原始异常。`parsed`是终态但未索引；任务revision不是文档active revision，不允许问答。

轮询只在当前身份/任务的queued或processing执行，约1.5秒；终态停止，网络或数据错误暂停等待手动刷新。切换身份或列表上下文会中止读取并清除任务，不取消服务器任务。POST不自动重试：若上传/取消/重试响应丢失，应先查询列表/任务确认是否已经生效。

## 认证

开发演示：Java 必须显式开启 `development_headers`，页面根据 `/v1/config` 展示本机身份输入。Node 只转发这些明确头；Java 仍做角色/组织与操作权限校验。

JWT：由可信签发方提供现有合法 JWT；页面 POST `/v1/session`，Java 返回 Host-only、HttpOnly、SameSite=Strict、Path=/ Cookie。开发代理只允许此会话响应 Cookie；不存在浏览器 localStorage 或 Node token store。退出会话不吊销已签发 JWT；本仓库没有自动刷新。任何Authorization头都400拒绝，不会静默丢弃并退回Cookie；Bearer CLI应直接调用Java API。

## 常见诊断

- 首页可打开但提示连接失败：确认 Java 服务启动、目标端口和认证配置；检查 `GET /health/live`，没有假后端 fallback。
- ready 503：当前 Java 完整迁移门禁有意保持关闭，不是由前端改成200的理由。
- 403 host/origin：地址必须使用 `http://127.0.0.1:<端口>`；禁止 localhost 别名、跨域嵌入或公网反向代理。
- 脚本写API收到403：开发代理的写操作也必须提交精确同源 Origin 和正常身份；不删除Origin校验来方便工具。
- 404/405：路由或方法不在当前 allowlist；并不意味着未来RAG已经提供。
- 413/502/504：分别可能是请求限长、后端失败/重定向/响应超限、总deadline；不重试写操作，先确认后端结果。
- 429：本地代理或Java已有两个上传请求在途；稍后显式重试，不放大并发限额。Java持久任务/原文件总量配额则返回409，应先核对后端安全错误。

生产同源托管、TLS和 Cookie Secure 需要单独验收。不要把该开发Node代理放到公网后声称原认证边界仍成立。
