# AI Context

2026-10-03当前0024：[保存材料重建](changes/0024-saved-source-reindex/verification.md)。已发布资料可明确重建保存的完整文本索引，处理期间旧索引可用，成功才切换；失败、取消和重启中断保留旧版本。入口核对真实能力及当前资格，成功后提示重新查询，保留问题、范围与整理草稿。模型配置、逐角色测试、明确应用和召回测试继续沿既有流程。首切不支持已有独立图片/音频向量的资料及真正嵌入/投影迁移；后续receipt迁移与原文件版本替换继续保留。未部署，页面用户验收，0新增真实provider调用，完整目标ACTIVE。

2026-10-03当前0023已让retrieval_test独立开放单份/完整多份/详情范围入口，明确切全库，当前文字召回模式保持；不生成回答、不自动请求、不删未发布所选项。实际同4 RED→GREEN及完整435/syntax通过，旧431原字节/身份保留。后端/JAR与0034一致，回归证据明确复用；未部署、用户页面验收、0真实调用，目标active。详见[验证](changes/0023-retrieval-scope/verification.md)。旧记录保留。

当前0022配合后端0034修复文字角色切换后的旧媒体来源打开；新媒体问答仍受原能力门禁，来源仍核对身份、版本与完整SHA。实际431前端/syntax、3075 Java与六Native通过，见[验证](changes/0022-media-role-switch-sources/verification.md)。交接以`.tools/media-role-switch-handoff`实际manifest为准；未部署、真实模型未验、页面用户验收，目标active。下一基础缺口为retrieval-only的单选/多选/详情及全库范围入口，原重建/版本更新范围保留。下方为历史记录。

2026-10-03当前基础修复0033：已有文字索引后，仅更换生成或重排模型可以保存、单独测试并明确应用；嵌入配置及投影不变时不重建资料索引。实际新角色与新trace、原索引/旧来源、连续切换及重启均已本机验证；真正嵌入或投影变化仍拒绝，legacy媒体按实际完整profile判定。最终3058 Java、1013格式、原LINE/BRANCH双80与架构、六Native各1通过；1029后端输入相同、761生产class稳定。前端64及后端18 Node/static输入字节不变，430/check与73明确复用此前实跑证据。新交接.tools/model-role-switch-handoff以实际manifest/VALIDATION为准；未部署、0新增真实provider调用、页面用户验收、真实ASR未宣称修复，目标active。历史记录保留。

2026-10-03当前本机主线：[模型配置与召回测试](MODEL_SETUP_AND_RETRIEVAL.md)已接通保存草稿、逐角色连接测试、明确应用、完整范围召回预览与同版本来源；无模型可启动，应用丢响应后显式读取能恢复索引/召回入口。资料清理及取消后清理恢复一并整合。实际3011 Java、1004格式、原LINE/BRANCH双80%、430前端/check、73后端Node及六Native各1通过；1020/64执行输入相同，759完整生产class与最终JAR一致，旧2640/370用例身份多重性保留。详见[0021验证](changes/0021-model-setup-retrieval-test/verification.md)。交接工作区`.tools/model-setup-handoff`以实际manifest/VALIDATION为准；未部署、0新增真实provider调用、页面用户验收，原ASR质量未宣称解决，目标active、usage/计费取消。下方保留历史记录。

当前本机[0016原声向量入口](changes/0016-audio-vector-retrieval/verification.md)：独立AudioVectorSession读取/显式构建当前audio十字段receipt并严格绑定publication/source/profile，保留整理草稿；reader不构建、停止仅取消本地等待且结果未知后不自动重发。音频与图片面板各按实际类型显示，AUDIO参考音频沿旧完整scope问答，缺receipt提示为全范围音频建立向量。299项/语法通过，后端0027及真实Spring/FFmpeg合成正常链验证；未部署，页面用户验收，无真实模型调用。下方为历史快照。

当前[0015原图向量入口](changes/0015-image-vector-retrieval/spec.md)使用独立ImageVectorSession读取/显式构建当前图片receipt，严格核对document/publication/source与模型、投影profile；保留整理草稿，reader不构建，取消后刷新确认服务器状态。原图问答携参考图片沿现有附件和完整scope，image_vector_required提示为全范围图片建立向量。287项/语法通过，后端0026配套，实际证据见[verification](changes/0015-image-vector-retrieval/verification.md)。本切未部署；当前voice-tags已部署含标签/语音，用户验收完整页面，真实ASR/provider仍开放。下方状态为历史记录。

0014语音提问以独立VoiceQuestionSession准备临时输入，复用现有音频文件校验/编码及AnswerSession。核对完整原字节与全文SHA后显示可编辑预览，确认才明确替换问题框，保留完整scope/mode且不自动提问/追加附件。换文件、身份、范围、模式、问题或离页使迟到操作失效。当前部署PDF版，标签与语音本机待发布；完整验证见[0014记录](changes/0014-voice-questions/verification.md)，页面用户验收。

当前[0013摘要建议标签](changes/0013-tag-suggestions/spec.md)通过独立Session实现当前摘要身份校验、显式选择和原子追加；保存只发fingerprint/ordinals。原资料表单和草稿生命周期保持，成功刷新列表与标签。新增模块及两个精确代理路由使用普通JSON/期限，不能整包覆盖现网open-access定制。

当前增量为[0012 PDF来源](changes/0012-pdf-sources/intent.md)：AnswerSession的canReadOriginal由document_originals控制，PDF来源metadata先沿原答案回读，再匹配已有原文件metadata及完整SHA。复用精确GET原文件接口，无新代理路由；来源生命周期与原问答epoch共用。后端0023提供默认关闭的逐页PDF OCR，前端只声明实际capability。

最新增量为[0011文件摘要网页](changes/0011-file-synopsis/intent.md)。资料详情使用file_synopsis/synopsis_sources门禁，显式生成持久任务→轮询→读取当前publication摘要→专用来源/原文件/时间/帧。file-synopsis.mjs独立Session隐藏任务与Blob生命周期；task error不影响索引，读取不调用生成。八类引用的文本/图像SHA区别明确，原文件使用摘要source_sha256，video_ocr专用frame响应没有独立帧SHA字段，不宣称客户端独立核对该帧SHA。用户页面验收和部署仍未执行，无新增真实模型调用。

最新开发增量为[0010查询附件网页](changes/0010-query-attachments/intent.md)：query-attachments.mjs隐藏全批次校验、原字节base64及安全响应包络；AnswerSession沿用原问题/完整scope/typed结果和来源，app提供选择/移除/处理反馈。精确附件POST独立28MiB/180秒/2在途，无附件保持旧四入口。用户负责网页验收，本轮无真实模型调用或发布。后端0022数字完整性修复已有独立部署报告，ASR识别偏差仍待真实复验；旧“待发布”为当时记录。usage/计费继续取消。

2026-10-03当前入口：[0009原文件与导航修复](changes/0009-document-originals/verification.md)。资料详情在保存身份/initial revision/完整原字节SHA核对后显示PDF/文本/图片/音视频并可打开/下载；详情进入问答后返回资料库再开新文件不会遗留旧详情或scope。185项前端及当前Java/精确代理五种原文件HTTP通过；独立免登录发布版两项外部复测通过，PDF内嵌像素尚未检查。后端0022数字完整性已独立冻结待发布，ASR识别偏差仍未通过，前端播放不代表识别质量。用户已取消新增usage/计费开发，没有该项代码/迁移/验证/发布；不把它加回本主线。下方0006–0008“未接/未发布/下一步”仅描述各历史阶段，不能用于覆盖当前实现和证据。

当前入口为[0008音视频验证](changes/0008-audio-video-library/verification.md)与[外部入口整合](changes/deployment-external-entry/integration.md)。图片、音频、视频网页及typed来源已接入；当前JWT入口与真实Java/native四类正常链路通过，模型/Milvus仍为loopback替身。下方0006/0007“多模态未接/未提交”仅描述历史阶段。当前未提交图片/音视频/入口，0006已推送；公网四类和真实质量未验收。

当前入口为[0007图片切片](changes/0007-image-library/verification.md)：图片上传和OCR/视觉模式已接，typed metadata→原图SHA→Blob展示/下载与词框可用，实际Java/前端Module正常路径通过。下方文本阶段“不解释image/多模态未接入”由本条更新。音频、视频检索和时间来源网页属于下一主线；四类真实检索及公网原素材访问尚未完成。


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
