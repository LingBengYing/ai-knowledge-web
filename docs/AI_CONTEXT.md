# AI Context

## 项目是什么

`ai-knowledge-web` 是 [ai-knowledge](https://github.com/LingBengYing/ai-knowledge) Java 管理纵切的独立前端源码仓库。技术栈为原生 HTML/CSS/ES modules；Node 22 内建服务仅用于开发静态资源与同源 HTTP 转发，没有 Express、React、Vue、数据库或模型 SDK。

Implemented: document-management list, filtering, pagination, folders, rename, tags, batch feedback, permission-aware UI, session exchange, stale-response/identity state isolation; capability-gated raw PDF/TXT/MD upload and asynchronous parsing task polling/cancel/retry. Java remains the authorization, file storage and task-state authority.

Not connected here: corpus indexing, Milvus retrieval, embeddings, reranker, generation, evidence-grounded answers, summaries, source API, multimodal processing, production deployment. A parsed task is NOT indexed or answerable. Backend libraries do not automatically create frontend capabilities.

## 阅读与检索入口

| 主题 / Keywords | Source |
| --- | --- |
| UI layout, empty/error/read-only states | [index.html](../public/index.html)、[styles.css](../public/styles.css)、[app.js](../public/app.js) |
| Same-origin API, session cookie, safe errors | [api.mjs](../public/api.mjs)、[API_CONNECTION](API_CONNECTION.md) |
| Identity epoch, stale reads, selection, mutation lock | [workbench-state.mjs](../public/workbench-state.mjs)、[UI tests](../ui-tests/) |
| Raw File upload, parsing attempt, cancel/retry, terminal polling | [api.mjs](../public/api.mjs)、[app.js](../public/app.js)、[ingestion tests](../ui-tests/ingestion.test.mjs) |
| Late failure notice and safe rendering | [notices.mjs](../public/notices.mjs)、[app.js](../public/app.js) |
| Local proxy, Host/Origin validation, bounded HTTP | [dev-server.mjs](../scripts/dev-server.mjs)、[HTTP tests](../tests/dev-server.test.mjs) |
| Secret prevention, full Git history | [check-secrets.mjs](../scripts/check-secrets.mjs)、[SECURITY](../SECURITY.md) |

先读 [README](../README.md)、本文件、[ARCHITECTURE](ARCHITECTURE.md)、[API_CONNECTION](API_CONNECTION.md)，然后当前 [intent](changes/0002-text-ingestion/intent.md) → [spec](changes/0002-text-ingestion/spec.md) → [plan](changes/0002-text-ingestion/plan.md) → [REVIEW](changes/0002-text-ingestion/REVIEW.md)。验证以 [VERIFICATION](VERIFICATION.md) 为准。

## 不可误读

- `image/audio/video` 筛选仅是资料分类；不是媒体理解、转写或摘要。
- 合成 ready 元数据不是可检索的文档证据；前端不会初始化数据库或生成 mock 资料。
- 上传默认禁用；必须由loopback Java显式启用RAG_INGESTION_ENABLED并返回text_upload/ingestions。真实上传文档synthetic_fixture=false、active_revision_id=null、can_answer=false；解析版本只在任务中展示，不冒充active证据版本。
- Java `/health/ready` 返回 503 表示完整迁移门禁未齐；前端转发这个结果，不把它改成成功。
- 开发 header 是显式本机演示身份，不是 SSO 或公网认证；Node 代理不签发任何用户身份。
- 分仓不意味着跨域认证。浏览器仍请求相对 `/v1/`；后端地址只供本地 Node 服务读取，不注入网页。
- [PROVENANCE](PROVENANCE.md) 是本次来源记录，不代表未来两个仓库会自动同步。
