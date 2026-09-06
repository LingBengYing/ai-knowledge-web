# Architecture

```text
Browser http://127.0.0.1:18085
  public/app.js → api.mjs → same-origin /v1/*
       │
  workbench-state.mjs + notices.mjs
       ↓
Node local Dev Transport Module
  exact Host/Origin/fetch-site check → route/method/header allowlist
  bounded body → trusted loopback Java origin (no redirects/retry)
       ↓
Java Authentication / Management / Text Ingestion Modules → Java-owned SQLite
```

## Modules 与职责

- **Browser State Module**：`WorkbenchState` Interface 管理身份 epoch、读取票据、当前页选择、写锁和一个当前任务。任务身份与attempt校验、双向列表快照合并：旧结果不能回退，较新attempt/状态和动作权限须更新面板；不能把任务文档补入服务器未返回的授权页面。详情按钮通过`taskForDocument`重新解析当前授权行，不使用闭包里的旧任务，也不重绘未保存的编辑表单。基线20项UI回归与新增11项上传/任务回归观察行为。
- **Browser API Module**：`createApi` Interface 仅使用相对 `/v1/`、同源 Cookie、安全错误；开发头只在后端明确返回 `development_headers` 时发送。`validateUpload`在网络前校验文件范围，上传原始File不转JSON。没有凭据持久化或自动重试。
- **Dev Transport Module**：`startDevServer` Interface 绑定字面量 loopback；HTTP Adapter 连接真正 Java 或测试 HTTP stub。它只做传输约束，不复制 Java 业务规则。`readConfiguration` 集中验证环境配置。
- **Java backend**：外部系统，负责身份、ACL、分页统计、目录、标签、原文件持久化、异步解析任务与审计；前端禁用按钮不能代替后端授权。Java 源码没有复制进本仓库。前端仅根据两项显式capability开放文本上传，parsed任务不变成ready或答案。

## 传输安全边界

请求 Host 必须是实际绑定端口的 `127.0.0.1`；所有携 Origin 请求都必须精确同源，任何写请求必须携 Origin。`Sec-Fetch-Site` 存在时只允许 same-origin / none，拒绝 same-site / cross-site。仅校验通过后，转发的 Origin 才变为固定 Java origin；不接收任意目标、绝对 URL 或 forwarded 代理身份。

只转发 Accept、identity 编码、生成的 request ID、JSON或精确上传binary Content-Type、显式开发身份头和单个 `rag_session` Cookie。任何 Authorization 头直接400拒绝，不得静默丢弃后退回Cookie；其他Cookie、其他身份/转发头不会传递。浏览器JWT通过会话POST body交换；这不是通用Bearer API网关，Bearer CLI应直接调用Java接口。

静态文件只有六文件 allowlist；拒绝 symlink、非普通文件、超1MiB文件与符号链接根目录。目录 listing、README、配置、脚本、数据库不公开；不提供 SPA 任意路径 fallback。

普通API请求体128KiB、从接收请求到读完上游响应总计10秒。只有精确文本上传POST允许20MiB/30秒，最多两个上传exchange在途（超出429）；header仍10秒，所有后端响应仍4MiB。测试只能向小方向配置限值。该deadline不包含向慢浏览器排空响应的时间。请求/响应先完整限长再转发/提交，无流式大文件、SSE、WebSocket；不跟随3xx、不重试。只转发响应Content-Type、WWW-Authenticate和限定会话Cookie；不转发Location、CORS、其他Cookie或内部头。安全错误不含内部异常、原文、凭据。

本机 HTTP 不等于生产安全：没有 TLS、用户签发/撤销、限流、分布式代理、进程沙箱和生产运维门禁。Cookie 不按端口隔离；同机用户/恶意本机服务不在此开发工具的隔离保证内。详见 [SECURITY](../SECURITY.md)。
