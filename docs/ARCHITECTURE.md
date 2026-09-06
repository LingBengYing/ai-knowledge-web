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
Java Authentication / Management Module → Java-owned SQLite
```

## Modules 与职责

- **Browser State Module**：`WorkbenchState` Interface 管理身份 epoch、读取票据、当前页选择和写锁；Implementation 防旧响应恢复过期数据。通过原20项 UI 回归观察行为。
- **Browser API Module**：`createApi` Interface 仅使用相对 `/v1/`、同源 Cookie、安全错误；开发头只在后端明确返回 `development_headers` 时发送。没有凭据持久化或自动重试。
- **Dev Transport Module**：`startDevServer` Interface 绑定字面量 loopback；HTTP Adapter 连接真正 Java 或测试 HTTP stub。它只做传输约束，不复制 Java 业务规则。`readConfiguration` 集中验证环境配置。
- **Java backend**：外部系统，负责身份、ACL、分页统计、目录、标签、持久化与审计；前端禁用按钮不能代替后端授权。Java 源码没有复制进本仓库。

## 传输安全边界

请求 Host 必须是实际绑定端口的 `127.0.0.1`；所有携 Origin 请求都必须精确同源，任何写请求必须携 Origin。`Sec-Fetch-Site` 存在时只允许 same-origin / none，拒绝 same-site / cross-site。仅校验通过后，转发的 Origin 才变为固定 Java origin；不接收任意目标、绝对 URL 或 forwarded 代理身份。

只转发 Accept、identity 编码、生成的 request ID、JSON Content-Type、显式开发身份头和单个 `rag_session` Cookie。任何 Authorization 头直接400拒绝，不得静默丢弃后退回Cookie；其他Cookie、其他身份/转发头不会传递。浏览器JWT通过会话POST body交换；这不是通用Bearer API网关，Bearer CLI应直接调用Java接口。

静态文件只有六文件 allowlist；拒绝 symlink、非普通文件、超1MiB文件与符号链接根目录。目录 listing、README、配置、脚本、数据库不公开；不提供 SPA 任意路径 fallback。

API 请求体128KiB、后端响应4MiB、从上传到读完上游响应总计10秒；测试可向小方向配置限值。响应先完整限长再提交，无流式大文件、SSE、WebSocket；不跟随3xx、不重试。只转发响应 Content-Type、WWW-Authenticate 和限定的会话 Cookie；不转发 Location、CORS、其他 Cookie 或内部头。生成的固定安全错误不含内部异常、原文、凭据。

本机 HTTP 不等于生产安全：没有 TLS、用户签发/撤销、限流、分布式代理、进程沙箱和生产运维门禁。Cookie 不按端口隔离；同机用户/恶意本机服务不在此开发工具的隔离保证内。详见 [SECURITY](../SECURITY.md)。
