# Spec: 前端独立仓库

1. `public/` 六个静态文件与 Java 发布基线逐字节相同；20 个 UI 行为测试保留，仅改资源路径。
2. Node 22 内建开发服务默认只绑定 `127.0.0.1:18085`，无安装依赖；Java 后端默认 `http://127.0.0.1:18084`，只接受该字面量 loopback 主机的 HTTP origin，可配置端口，禁止凭据、路径、查询和 fragment。前端拒绝80端口，避免默认端口规范化与精确Host/Origin检查冲突。
3. 仅明确的管理、配置、会话和 health 路由可代理；静态资源仅六文件 allowlist、禁止 symlink 和路径穿越。未知路由不转发，不能成为开放代理。
4. 校验精确 Host；所有带 Origin 请求必须与前端 origin 完全相同，写请求必须有该 Origin；拒绝 cross-site/same-site fetch。通过后才把 Origin 改为后端 origin。不启用 CORS、不信任 forwarded 头。
5. 请求头使用 allowlist，只转发 `rag_session` Cookie；任何Authorization头先400拒绝，禁止丢弃后退回Cookie。只允许后端会话接口响应 Host-only、Path=/、HttpOnly、SameSite=Strict 的会话 Cookie。禁止重定向和隐式重试；请求体128KiB、后端响应4MiB，API从进入handler接收请求体到读完上游响应总限时10秒；这不是慢浏览器收完本机响应的交付时限。错误只返回安全固定文案与request ID。
6. JWT 只交由 Java 会话接口换取浏览器 Cookie；不持久化 JWT、不包含模型密钥、数据库、日志或私人配置。身份和 ACL 仍以 Java 为权威。
7. 测试覆盖真实本机 HTTP stub 的正常代理、安全负例和限制；secret checker 与原11项测试不放宽；CI Node22 完整测试和历史扫描。
8. 上传正常前进远端历史，记录真实验证边界。开发代理不用于生产，RAG acceptance 不适用于此次无 RAG 行为变更的静态导出，不能据此宣称检索/生产完成。
