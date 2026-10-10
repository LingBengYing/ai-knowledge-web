# Architecture

2026-10-10当前入口：唯一页面为 `wiki-workspace.html` + `wiki-workspace.mjs`（按需加载 wiki-retrieval.mjs / wiki-maintenance.mjs，问答经 knowledge-agent.mjs）。dev-server、wiki-workspace-server 与 external-server 的根路径 `/` 都返回该页面；旧经典页（index.html、app.js、styles.css、preview.mjs、notices.mjs、voice-question.mjs）及 `/classic/` 已删除。下文提到 app.js 的段落为历史。

0039共享工作区：AnswerSession和RetrievalSession只构造问题/检索参数，不再保存或发送文档范围；app的资料选择仅服务正常批量维护。前端不以reader/can_edit隐藏动作，仍核对会话、服务capability、当前资料/任务/版本状态。Java0053负责组织边界、一次原文综合与真实来源。统一知识引用代理接受任意正整数编号，仍精确匹配相对路由；来源身份/版本/SHA及取消清理保持。以下旧范围/角色描述为历史。

0016新增`audio-vectors.mjs`隐藏十字段验证、独立GET/POST、身份/资料/权限epoch、忙碌与停止后的结果未知状态。app以当前indexed audio及实际audio能力装配独立详情panel，刷新保留整理form/草稿，图片与音频panel分别匹配资料类型。两个代理仅增加精确模块资产和audio-vector GET/POST，POST180秒、GET普通期限，原信任和上传预算保持。问答仍由旧附件/AnswerSession发送完整scope和打开服务器库内来源。

0014新增voice-question.mjs，Session隐藏文件读取、编码、原字节/全文SHA、独立POST、取消和预览。app只接显式控件并在确认后调用旧answerRequest验证，填入问题后由原AnswerSession完成问答/来源；语音准备和问答互斥。dev/external代理分别为voice精确路由维持独立大小/期限/容量，不扩大普通请求预算，后端0025只依赖现有AudioCompilationService。

0013新增tag-suggestions.mjs控制读取/选择/保存，候选和合并由Java authority拥有。app详情只安全渲染文本、检查当前摘要/权限与草稿，迟到响应不更新新资料。dev/external代理增加一个静态模块和两个精确GET/POST路由，无新依赖或长请求例外。

[0012 PDF来源](changes/0012-pdf-sources/spec.md)复用AnswerSession的source生命周期和现有原文件路由；只有先通过答案来源、document/revision/filename/SHA及MIME/大小/全字节校验，才生成可撤销Blob URL。app仅用服务器页码设置PDF片段，机器OCR文本不是PDF字符坐标。原后端权限/完整scope/无证拒答不变。

0011文件摘要增量：`file-synopsis.mjs`的`SynopsisSession`提供open/create/refresh/readSource/close，隐藏独立持久任务轮询、当前文档/publication/revision/SHA检查、typed来源及Blob释放。`app.js`只在详情独立区域显示，任务刷新不重建整理表单，离页/身份/版本变化停止旧请求。创建复用Java已有显式POST，不使用答案trace或入库接口。`api.mjs`与两个Node代理仅新增精确摘要元数据/任务/来源路由，原文件20MiB/帧10MiB，普通10秒不变。

0010查询附件增量：`query-attachments.mjs`负责临时File全批次校验、完整有界base64、证据模式映射及附件处理说明校验；`AnswerSession`复用原问题/scope、epoch与typed结果校验。附件读取纳入loading，取消或上下文变化后不POST；无附件仍用旧四入口。app仅持有当前问答选择，离页/身份变化释放，不持久化或自行证明答案。两个代理各自新增精确`/v1/attachment-answers`，该入口28MiB/180秒/2在途，普通JSON与来源预算保持。

0008当前结构：api.mjs负责明确音频/视频上传MIME和有界二进制读取；media-sources.mjs校验typed时间/帧/转录/OCR/字幕；AnswerSession校验完整来源身份与原媒体/帧SHA，维护Blob生命周期；app.js提供模式和引用播放器。external-server.mjs为独立JWT外部入口，显式HTTPS Origin握手与会话回读，保留开发代理原边界。四类合同/限额见[API_CONNECTION](API_CONNECTION.md)，本机证据见[整合验证](changes/deployment-external-entry/integration.md)。下方未接媒体或全部响应4MiB为历史文字阶段。

0007当前增量：api.mjs支持能力门禁的10MiB图片原始上传与精确content二进制有界读取；answers.mjs增加显式visual模式、typed来源和SHA校验/Blob URL生命周期；app.js绘制整图与服务器归一化OCR词框。开发代理增加visual-answers/visual-sources与两类content；content独享10MiB响应，普通JSON仍4MiB，视觉POST复用180秒期限。下方0006“所有响应4MiB/不解释image”描述只适用于原文本合同。


当前0006已实现文本证据问答网页闭环，未提交、推送或部署。前端独立演进，不自动同步Java内置资产。浏览器已核对隔离Spring/SQLite与loopback模型/向量夹具的正常路径，不能据此认证真实provider/Milvus质量、多模态网页或生产。

```text
Browser http://127.0.0.1:18085
  public/wiki-workspace.mjs → api.mjs → same-origin /v1/*
       │
  workbench-state.mjs + answers.mjs + knowledge-agent.mjs
       ↓
Node local Dev Transport Module
  exact Host/Origin/fetch-site check → route/method/header allowlist
  bounded body → trusted loopback Java origin (no redirects/retry)
       ↓
Java Authentication / Management / Text Ingestion / Text Indexing / Answer Modules → Java-owned SQLite
  Indexing / Answer → configured models + isolated Java Milvus collection
  Answer trace → current-authorized SourceResult
```

## Modules 与职责

- **Browser State Module**：`WorkbenchState` Interface 管理身份epoch、读取票据、当前页选择、写锁、独立解析task与indexTask。单面板按kind切换，两链校验、read ticket与终态彼此独立；任务身份与attempt校验、双向列表快照合并阻止旧结果回退，并接受当前动作权限。不能把任务文档补入服务器未返回的授权页面。详情通过`taskForDocument/indexTaskForDocument`解析当前授权行，不用旧闭包；parsed终态回读授权列表取得can_index，indexed终态回读发布信息，只更新详情只读字段并保留未保存表单。新增索引UI回归见[indexing.test.mjs](../ui-tests/indexing.test.mjs)。
- **Browser API Module**：`createApi` Interface 仅使用相对 `/v1/`、同源 Cookie、安全错误；开发头只在后端明确返回 `development_headers` 时发送。`validateUpload`在网络前校验文件范围，上传原始File不转JSON。没有凭据持久化或自动重试。
- **Answer Module**：`answersEnabled`、`answerRequest`和`AnswerSession`为小Interface，隐藏完整范围请求、文本响应/来源身份校验、AbortController与epoch。生产Adapter复用createApi，测试Adapter为明确的异步请求替身；没有DOM、模型客户端或新的权限体系。页面只渲染纯文本和可观察状态，来源必须来自当前答案的精确服务器URL；取消只停止本地等待，身份/范围/新问题清除旧结果。
- **Dev Transport Module**：`startDevServer` Interface 绑定字面量 loopback；HTTP Adapter 连接真正 Java 或测试 HTTP stub。它只做传输约束，不复制 Java 业务规则。`readConfiguration` 集中验证环境配置。
- **Java backend**：外部系统，负责身份、ACL、分页统计、目录、标签、原文件持久化、异步解析/索引任务、完整发布、检索/重排/生成、无证拒答、trace及来源审计。前端禁用按钮不能代替后端授权；Java源码没有复制进本仓库。文本上传要求text_upload/ingestions，索引另要求text_index/indexings与当前行can_index且确认外部处理，文本问答另要求answers/sources；浏览器不持有模型key。parsed不变成ready或答案，index poll只更新index_status/latest_index_job，active/publication只能从授权列表读取。旧管理can_answer=false为兼容占位；问答入口只固定全量范围，Java才决定每个所选项是否有权且已发布。

## 传输安全边界

请求 Host 必须是实际绑定端口的 `127.0.0.1`；所有携 Origin 请求都必须精确同源，任何写请求必须携 Origin。`Sec-Fetch-Site` 存在时只允许 same-origin / none，拒绝 same-site / cross-site。仅校验通过后，转发的 Origin 才变为固定 Java origin；不接收任意目标、绝对 URL 或 forwarded 代理身份。

只转发 Accept、identity 编码、生成的 request ID、JSON或精确上传binary Content-Type、显式开发身份头和单个 `rag_session` Cookie。任何 Authorization 头直接400拒绝，不得静默丢弃后退回Cookie；其他Cookie、其他身份/转发头不会传递。浏览器JWT通过会话POST body交换；这不是通用Bearer API网关，Bearer CLI应直接调用Java接口。

静态allowlist为脚本中精确列出的工作台页面、模块、CSS与PDF资源（根路径 `/` 即 wiki-workspace.html）；拒绝 symlink、非普通文件、超1MiB文件与符号链接根目录。目录 listing、README、配置、脚本、数据库不公开；不提供 SPA 任意路径 fallback。

JSON请求体128KiB、普通请求从接收请求到读完上游响应总计10秒。精确文本上传POST允许20MiB/30秒，最多两个上传exchange在途（超出429）；精确POST `/v1/answers`独立180秒，GET文本来源仍为10秒。header仍10秒，所有后端响应仍4MiB。测试只能向小方向配置限值。该deadline不包含向慢浏览器排空响应的时间。问答和来源拒绝query、编码ID、自由URL与额外动作；来源GET无body。请求/响应先完整限长再转发/提交，无流式大文件、SSE、WebSocket；不跟随3xx、不重试。只转发响应Content-Type、WWW-Authenticate和限定会话Cookie；不转发Location、CORS、其他Cookie或内部头。安全错误不含内部异常、原文、凭据。

本机 HTTP 不等于生产安全：没有 TLS、用户签发/撤销、限流、分布式代理、进程沙箱和生产运维门禁。Cookie 不按端口隔离；同机用户/恶意本机服务不在此开发工具的隔离保证内。详见 [SECURITY](../SECURITY.md)。


## 工作流程界面

仅独立前端，不同步Java页面。Navigation Module位于app.js，showView/navigate作为视图切换Interface，和WorkbenchState身份/授权状态独立；0004既有#/documents、#/tasks、#/settings，0006新增#/answers及精确问答/来源API。资料详情由原生dialog提供焦点约束与模态层，跨任务/问答页保留表单，返回恢复；进入设置或丢弃编辑时确认。筛选/翻页在确认前不改变上下文，认证失效仍无条件清除授权内容。

任务列表从state.items当前授权页读取两类任务，并调用原有任务Interface；刷新不会扩展资料范围、生成active版本或启用问答。没有后台全局任务历史接口，所以页面明确限定资料页范围。

正常路径：原始文件上传→解析任务parsed→授权列表刷新显示索引入口→确认外部处理→索引任务indexed→服务器active/publication刷新→全库或完整所选范围提问→answered/abstained→当前身份来源回读。问答显示和来源状态独立，来源失败不会被旧摘录冒充当前成功；来源页码与偏移不由前端推算。


## 0005 本地文件预览

独立preview.mjs为Preview Module：inspectFile验证类型和大小，PreviewResource管理Blob URL/异步代次，mountPreview绑定独立dialog。没有fetch或业务API调用，不关联库内record。身份重置发knowledge-context-reset事件释放资源。仅静态allowlist增加preview.mjs；CSP新增本地blob图片/媒体和签名检查PDF对象，不开放远程资源或新业务路由。PDF依赖浏览器原生支持，当前内置浏览器走兼容回退。远程读取必须另建授权Source Adapter并冻结契约。

本地Preview Module与0006文本Source Adapter不是同一能力。当前不转发Java typed媒体来源或content接口，不把本地Blob预览、OCR文本摘录、音视频类型筛选说成库内多模态网页已完成。持久摘要、查询附件、真实质量和生产按后续主线推进。
