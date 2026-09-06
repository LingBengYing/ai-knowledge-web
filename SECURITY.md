# Security

本仓库是本地开发源码，不是生产网关或安全隔离产品。发现问题可通过仓库维护者的可用私密渠道报告；不要在公开 Issue、PR 或聊天中粘贴真实凭据、JWT、会话、私钥或业务数据。若凭据已暴露，先在对应平台撤销/轮换。

## 防止误上传

- 前端和 Node 服务都不需要 provider key 或 JWT 签名密钥。它们只能由 Java 后端环境/secret store 管理，不能放进 `public/`、构建参数或浏览器存储。
- `.env.example` 只包含非敏感开发默认值；程序不自动加载 `.env`。`.gitignore` 排除密钥、私钥、数据库、运行日志和浏览器 storage state。
- 提交前显式暂存应发布文件，然后 `npm run check:secrets`；检查当前 index、对应工作树及所有可达提交历史，删除旧文件不能消除历史中的泄漏。
- 检查器复制自 Java 发布基线，11项原回归保留，不给整个测试目录豁免。三条既有 exact-path/field/value 合成fixture白名单保留，其中两条Java测试路径当前并不存在；它们不是可使用的真实secret。
- 检查器失败输出只有文件、commit、行和类型，不显示命中值；完整历史不可读、shallow或非普通对象失败关闭。它不扫描未跟踪文件；不能把未暂存新文件或空index扫描说成检查完成。
- 规则扫描只是防御层，不能保证识别所有编码、拆分、加密或未知格式的秘密。代码/文件范围人工审查和平台secret scanning仍有价值。

## 本地代理边界

只绑定字面量 `127.0.0.1`，只连接配置的字面量loopback HTTP端口。精确Host/Origin、fetch-site、方法和路径allowlist在传递身份前验证；Origin仅在验证后改写。开发header不是公网认证，不允许将此服务暴露公网、隧道或未验收反向代理。

API有请求/响应大小和总deadline限制；拒绝重定向、绝对目标和自动重试。静态文件allowlist拒绝symlink；不公开任意项目文件。Cookie请求只保留单一`rag_session`，响应只接受会话路径的Host-only、HttpOnly、SameSite=Strict、Path=/值，不改写Domain或去除Secure。

浏览器Cookie不按端口隔离：相同`127.0.0.1`上的其他服务可能收到同名cookie或覆盖它。同一用户的其他本机程序也能构造请求。只在可信本机和独立浏览器配置中使用；此代理不保护已被本机程序或XSS控制的环境。

JWT由Java验证，此仓库不签发/刷新/吊销JWT。清除会话不使已签发Bearer失效。当前本机HTTP、无生产TLS/SSO/会话撤销表/限流或全链路审计；不得据此宣布生产就绪。Java权限、版本和证据边界始终为权威。
