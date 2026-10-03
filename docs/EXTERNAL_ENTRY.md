# 认证外部预发布入口

当前独立`node scripts/external-server.mjs`已与图片/音视频主线整合；实证、接口预算和真实配置缺项见[整合记录](changes/deployment-external-entry/integration.md)。源码尚未提交/推送，未部署公网。

拓扑为用户HTTPS→同机TLS终止→loopback Node→loopback Java。匿名仅/login、/login.mjs及会话交换/退出；知识页面与业务API须由Java回读有效JWT会话。令牌仅换成Host-only/HttpOnly/Secure/SameSite=Strict Cookie，不保存在浏览器存储；退出清Cookie，不宣称吊销原JWT。模型密钥只在Java。

Java显式RAG_EXTERNAL_ENTRY_ENABLED=true、RAG_PUBLIC_ORIGIN=精确HTTPS Origin、RAG_AUTH_MODE=jwt，必须绑定loopback。Node启动先读取内部/health/entry-policy与/v1/config核对同一Origin和JWT模式；内部health不对外发布。外部Origin原样校验/透传，不重写成Java本机Origin；拒绝开发身份、Authorization及转发身份头。production门禁/readiness503保持。

Node需要RAG_PUBLIC_ORIGIN、RAG_WEB_BACKEND_ORIGIN（仅http字面127.0.0.1及端口）、RAG_WEB_PORT。Java另需受信JWT issuer/audience/secret、固定workspace、新隔离data目录、已批准的真实模型/Milvus/native工具配置；不得使用示例替身冒充真实服务。既有部署隔离目录的模板仍由部署任务负责，不由此开发任务写服务器。

运行`node scripts/render-entry-config.mjs`可渲染nginx http块include片段。需要RAG_TLS_CERTIFICATE_PATH与RAG_TLS_KEY_PATH两个已批准绝对路径；渲染不读取密钥内容，实际安装前须nginx -t和服务器服务冲突核对。源Origin、证书IP/域名和Host须一致。开发代理仍是另一个仅本机入口，不能直接替代此入口。

验证命令：`npm run check`、`npm test`；当前JAR认证集成另外显式设置RAG_EXTERNAL_ENTRY_JAR后运行`node --test deployment-tests/external-entry-integration.test.mjs`。该测试要求本机Java21和监听权限，随机合成凭据只在内存。真实HTTPS/codec/四类检索质量需后续浏览器验收。
