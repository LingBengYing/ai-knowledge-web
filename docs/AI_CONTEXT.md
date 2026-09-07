# AI Context

## 项目是什么

`ai-knowledge-web` 是 [ai-knowledge](https://github.com/LingBengYing/ai-knowledge) Java 管理纵切的独立前端源码仓库。技术栈为原生 HTML/CSS/ES modules；Node 22 内建服务仅用于开发静态资源与同源 HTTP 转发，没有 Express、React、Vue、数据库或模型 SDK。

Implemented: document-management list, filtering, pagination, folders, rename, tags, batch feedback, permission-aware UI, session exchange, stale-response/identity state isolation; capability-gated raw PDF/TXT/MD upload and asynchronous parsing task polling/cancel/retry. Java remains the authorization, file storage and task-state authority.

Current workspace increment: [0003 text index publication UI](changes/0003-text-index-publication/intent.md), status IMPLEMENTATION, not committed or published. It adds capability-gated index creation, a separate indexing task state, explicit confirmation before creation/retry, and server-authoritative publication display. Paired Java0004 integration and browser acceptance remain unverified in this frontend subtask.

Not connected here: authorized Milvus retrieval, reranker, generation, evidence-grounded answers, summaries, source API, multimodal processing, production deployment. A parsed task alone does not establish an indexed or answerable document. Embedding/Milvus configuration and calls stay in Java; no model credentials enter the browser.

## 阅读与检索入口

| 主题 / Keywords | Source |
| --- | --- |
| UI layout, empty/error/read-only states | [index.html](../public/index.html)、[styles.css](../public/styles.css)、[app.js](../public/app.js) |
| Same-origin API, session cookie, safe errors | [api.mjs](../public/api.mjs)、[API_CONNECTION](API_CONNECTION.md) |
| Identity epoch, stale reads, selection, mutation lock | [workbench-state.mjs](../public/workbench-state.mjs)、[UI tests](../ui-tests/) |
| Raw File upload, parsing attempt, cancel/retry, terminal polling | [api.mjs](../public/api.mjs)、[app.js](../public/app.js)、[ingestion tests](../ui-tests/ingestion.test.mjs) |
| Index task, publication status, capability and confirmation gates | [workbench-state.mjs](../public/workbench-state.mjs)、[app.js](../public/app.js)、[index tests](../ui-tests/indexing.test.mjs) |
| Late failure notice and safe rendering | [notices.mjs](../public/notices.mjs)、[app.js](../public/app.js) |
| Local proxy, Host/Origin validation, bounded HTTP | [dev-server.mjs](../scripts/dev-server.mjs)、[HTTP tests](../tests/dev-server.test.mjs) |
| Secret prevention, full Git history | [check-secrets.mjs](../scripts/check-secrets.mjs)、[SECURITY](../SECURITY.md) |

先读 [README](../README.md)、本文件、[ARCHITECTURE](ARCHITECTURE.md)、[API_CONNECTION](API_CONNECTION.md)，然后当前 [intent](changes/0003-text-index-publication/intent.md) → [spec](changes/0003-text-index-publication/spec.md) → [plan](changes/0003-text-index-publication/plan.md) → [REVIEW](changes/0003-text-index-publication/REVIEW.md)。0001/0002为历史基线，验证以 [VERIFICATION](VERIFICATION.md) 为准。

## 不可误读

- `image/audio/video` 筛选仅是资料分类；不是媒体理解、转写或摘要。
- 合成 ready 元数据不是可检索的文档证据；前端不会初始化数据库或生成 mock 资料。
- 上传默认禁用；必须由loopback Java显式启用RAG_INGESTION_ENABLED并返回text_upload/ingestions。真实上传文档synthetic_fixture=false；未发布时active_revision_id=null，解析版本不冒充active证据版本。索引另需RAG_INDEXING_ENABLED及text_index/indexings，完整验证后的active/publication由服务器列表给出；前端poll不自行设置指针，can_answer仍为false。
- Java `/health/ready` 返回 503 表示完整迁移门禁未齐；前端转发这个结果，不把它改成成功。
- 开发 header 是显式本机演示身份，不是 SSO 或公网认证；Node 代理不签发任何用户身份。
- 分仓不意味着跨域认证。浏览器仍请求相对 `/v1/`；后端地址只供本地 Node 服务读取，不注入网页。
- [PROVENANCE](PROVENANCE.md) 是本次来源记录，不代表未来两个仓库会自动同步。


Current frontend UI: [0004 workflow navigation](changes/0004-workflow-navigation/intent.md), local implementation verified, unpublished. Library, processing tasks and settings have separate hash routes. Modal detail editing, progressive filters, conditional batch tools and draft-aware navigation preserve the existing API contract. Changes are frontend-only and intentionally not synchronized into Java assets. See the current [verification](changes/0004-workflow-navigation/verification.md).


0005 adds a local File viewer, not remote corpus preview. preview.mjs supports bounded local images/audio/video/PDF/text; no upload, fetch, corpus association or answers. Native PDF needs browser support. The current Java edition still has no original-file read API; see changes/0005-media-preview/backend-integration.md.
