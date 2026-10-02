# AI Context

## 项目是什么

`ai-knowledge-web` 是 [ai-knowledge](https://github.com/LingBengYing/ai-knowledge) Java知识库的独立工作台源码仓库。技术栈为原生 HTML/CSS/ES modules；Node 22 内建服务仅用于开发静态资源与同源 HTTP 转发，没有 Express、React、Vue、数据库或模型 SDK。

Implemented: document-management list, filtering, pagination, folders, rename, tags, batch feedback, permission-aware UI, session exchange and stale-response/identity isolation; capability-gated raw PDF/TXT/MD upload, parsing/indexing tasks and server-authoritative publication refresh; grounded text answers for the full library or complete selected scope, explicit abstention and current-authorized citation rereads. Java remains the authorization, file storage, retrieval, model, task and evidence authority.

Current workspace increment: [0006 grounded text answers](changes/0006-grounded-answers/intent.md), implemented locally, not committed, pushed or deployed. A real browser has exercised synthetic PDF upload, parsing, index publication, selected-scope questioning and same-version source reread against an isolated Spring/SQLite runtime compiled from current Java sources. Models and vector search were loopback protocol fixtures, not cloud providers or real Milvus. Details and final verification status belong to the [0006 record](changes/0006-grounded-answers/verification.md).

Not connected here: multimodal upload/answer views and typed media-source playback, persistent file summaries, query attachments and production deployment. Real-provider semantic quality and real-Milvus end-to-end acceptance remain unverified. A parsed task alone does not establish an indexed or answerable document. Embedding, reranking, generation and Milvus configuration/calls stay in Java; no model credentials enter the browser.

## 阅读与检索入口

| 主题 / Keywords | Source |
| --- | --- |
| UI layout, empty/error/read-only states | [index.html](../public/index.html)、[styles.css](../public/styles.css)、[app.js](../public/app.js) |
| Same-origin API, session cookie, safe errors | [api.mjs](../public/api.mjs)、[API_CONNECTION](API_CONNECTION.md) |
| Identity epoch, stale reads, selection, mutation lock | [workbench-state.mjs](../public/workbench-state.mjs)、[UI tests](../ui-tests/) |
| Raw File upload, parsing attempt, cancel/retry, terminal polling | [api.mjs](../public/api.mjs)、[app.js](../public/app.js)、[ingestion tests](../ui-tests/ingestion.test.mjs) |
| Index task, publication status, capability and confirmation gates | [workbench-state.mjs](../public/workbench-state.mjs)、[app.js](../public/app.js)、[index tests](../ui-tests/indexing.test.mjs) |
| Grounded text answer, full selected scope, abstention, source identity and epoch | [answers.mjs](../public/answers.mjs)、[app.js](../public/app.js)、[answer tests](../ui-tests/answers.test.mjs) |
| Late failure notice and safe rendering | [notices.mjs](../public/notices.mjs)、[app.js](../public/app.js) |
| Local proxy, Host/Origin validation, bounded HTTP | [dev-server.mjs](../scripts/dev-server.mjs)、[HTTP tests](../tests/dev-server.test.mjs) |
| Secret prevention, full Git history | [check-secrets.mjs](../scripts/check-secrets.mjs)、[SECURITY](../SECURITY.md) |

先读当前 [intent](changes/0006-grounded-answers/intent.md) → [spec](changes/0006-grounded-answers/spec.md) → [plan](changes/0006-grounded-answers/plan.md) → [REVIEW](changes/0006-grounded-answers/REVIEW.md)，再读 [README](../README.md)、本文件、[ARCHITECTURE](ARCHITECTURE.md)、[API_CONNECTION](API_CONNECTION.md)。0001–0005为历史工件，保留其当时验证与Git状态；旧“尚未推送”不认证当前工作树。当前验证见 [VERIFICATION](VERIFICATION.md)及0006记录。

## 不可误读

- `image/audio/video` 筛选仅是资料分类；不是媒体理解、转写或摘要。
- 合成 ready 元数据不是可检索的文档证据；前端不会初始化数据库或生成 mock 资料。
- 上传默认禁用；必须由loopback Java显式启用RAG_INGESTION_ENABLED并返回text_upload/ingestions。真实上传文档synthetic_fixture=false；未发布时active_revision_id=null，解析版本不冒充active证据版本。索引另需RAG_INDEXING_ENABLED及text_index/indexings；parsed终态刷新授权列表取得can_index，indexed终态刷新active/publication。前端poll不自行设置证据指针。
- 问答另需RAG_ANSWERS_ENABLED及answers/sources两项capability。旧管理can_answer=false是兼容占位，不作为新入口的资格判定。资料行/批量入口只指定完整范围，未发布或不可用项仍原样传给Java；空范围或错误绝不扩大为全库。全库empty_scope提示先导入/建立索引，显式空所选范围提示重新选择。
- 服务器answer_id、引用编号、版本、哈希、原文偏移和摘录是权威定位。点击引用重新GET精确来源，核对相同引用身份；不解析模型HTML/自由链接，不从JS字符串偏移自造来源。来源失效或身份改变即清除旧验证结果。
- Java `/health/ready` 返回 503 表示完整迁移门禁未齐；前端转发这个结果，不把它改成成功。
- 开发 header 是显式本机演示身份，不是 SSO 或公网认证；Node 代理不签发任何用户身份。
- 分仓不意味着跨域认证。浏览器仍请求相对 `/v1/`；后端地址只供本地 Node 服务读取，不注入网页。
- [PROVENANCE](PROVENANCE.md) 是本次来源记录，不代表未来两个仓库会自动同步。


Current frontend navigation extends the historical [0004 workflow](changes/0004-workflow-navigation/intent.md) with `#/answers`; library, tasks, answers and settings have distinct hash routes. Modal detail editing, progressive filters, conditional batch tools and draft-aware navigation preserve the existing contract. Changes are frontend-only and intentionally not synchronized into Java assets. Existing0003–0005 sources were pushed separately; current0006 remains an uncommitted workspace increment, not a production release.


0005 adds a local File viewer, not remote corpus preview. preview.mjs supports bounded local images/audio/video/PDF/text; no upload, fetch or corpus association. Native PDF needs browser support. Generic corpus-file preview remains unconnected in this frontend; current0006 source API integration is text excerpts only and does not connect Java's typed media-source routes. The historical preview integration proposal is changes/0005-media-preview/backend-integration.md.
