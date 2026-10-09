# AI Knowledge Web · 知识库工作台

## 当前同步（2026-10-09）

本版包含 Wiki 建设工作台、新版模型设置与可选 DB-GPT 知识问答。后端启用 Agent 时，问答显示真实检索/阅读进度、停止、原文引用与维护建议；明确关闭时保留普通综合问答。启动仍为 `npm run dev:workspace`，后端连接见 [API说明](docs/API_CONNECTION.md)。

Wiki 单份 TXT 已完成真实模型/Milvus的编译、采纳、两版历史及重启回读；Agent 当前仅完成本机协议替身联调。完整前端回归存在时序失败，原记录保留，不称生产就绪。本次仅同步代码、不部署，见 [0042结果](docs/changes/0042-wiki-live-workspace/REVIEW.md)与 [0043结果](docs/changes/0043-dbgpt-knowledge-agent/REVIEW.md)。

## Wiki 真实工作台（0042）

已接Java0055/0056：原始资料上传/解析/索引、文件正文查找、知识页编译提案/审阅/版本、来源阅读、综合问答与服务器草稿、共同来源关系和检索设置。启动 `npm run dev:workspace`，默认 `http://127.0.0.1:18090/` → Java18091。没有演示数据fallback；模型设置使用新版独立`#/models`，`/classic/`仅保留旧完整资料维护功能的兼容入口。

本机验收用后端 `bash scripts/run-wiki-integration.sh` 新建隔离Java/SQLite及模型/向量HTTP替身，不读取私密配置、不调用真实云模型。原始资料仍是问答证据，Wiki正文与草稿不冒充原文。依据负责人最新意见，常驻页面只保留业务内容/状态/操作；索引和模型编译点击直接执行，不弹费用确认，处理中防重复，删除草稿仍确认。

[规格](docs/changes/0042-wiki-live-workspace/spec.md) · [实际联调及边界](docs/changes/0042-wiki-live-workspace/verification.md)。本地协议验证不代表真实模型语义质量或生产发布。

## Wiki 前端确认版（0041）

历史独立纯静态确认版仍保留回归，`npm run dev:wiki`（默认也占18090，不能与真实工作台同时启动）。需要 Node 22+，不需要模型、Java 或向量库。当前用户入口使用上方 `dev:workspace`，不要误开静态版。

包含知识总览、独立知识页 / 原始资料详情、文件查找、示例问答与引用、关系浏览、更新审阅、预览检索设置。全部为明确标注的合成内容；草稿与审阅等修改只存当前浏览器，导入仅记录文件名和大小。此入口没有 API 转发，也不修改现有 `npm run dev` / 生产入口。

参考 LLM Wiki 的信息架构，使用原创 HTML/CSS/ES Modules，不复制第三方源码。[规格与边界](docs/changes/0041-wiki-workspace-preview/spec.md) · [验证记录](docs/changes/0041-wiki-workspace-preview/verification.md) · [待确认的后端接入需求](docs/changes/0041-wiki-workspace-preview/backend-handoff.md)。前端确认不等于真实检索、知识编译或生产验收。

## 既有业务版本与阶段记录

当前产品合同为[0039登录后共享全库](docs/changes/0039-shared-workspace/spec.md)，配套后端0053：保留登录、组织内成员共用全部资料，不分角色/逐资料权限；问答与召回固定全库，不再提供所选范围。普通问答由检索原文综合回复，不宣称已独立核验；点击来源仍回读真实版本/页码/时间与原件SHA。问题无前端字数上限，统一引用无32条门槛，资源边界及本地492项验证见[记录](docs/changes/0039-shared-workspace/verification.md)。未发布/真实验收；下方阶段说明保留历史，不覆盖新合同。

当前增量[0037统一知识问答](docs/changes/0037-unified-knowledge-answers/spec.md)：产品操作说明并入`#/answers`默认综合问答，不再单列功能。后端检索文档与视频文字证据后由大模型综合回复，前端显示最终答案及按页码/时间定位的混合引用；不自行调用模型或把候选片段当生成答案。需后端0049的`knowledge_answers`能力；实际实现、页面和未验证范围见[0037记录](docs/changes/0037-unified-knowledge-answers/REVIEW.md)，不以历史测试认证新增功能。

2026-10-04当前主线：网页可保存嵌入/重排/生成配置、手动连接测试、明确应用及召回预览；逐角色provider、生成/重排切换、嵌入模型全库重建、同资料原文件更新、已配置媒体接网页有效文字配置及当前页批量文本重建已实现。最新交付为工作区`.tools/batch-text-reindex-mainline`，01:32:29 +08仅后端skiptests package成功，未运行测试/检查、未部署，页面由用户验收。使用[模型配置](docs/MODEL_SETUP_AND_RETRIEVAL.md)、[媒体配置](docs/MANAGED_MEDIA_SETUP.md)和[批量重建](docs/BATCH_TEXT_REINDEX.md)；下方历史测试结果不认证新增源码。

2026-10-03当前0025前端本机验证：[已有媒体向量资料的文本重建](docs/changes/0025-reindex-vector-continuation/verification.md)。新text_reindex_with_vectors与原能力及服务器资格一起开放行/详情入口；明确文字模型/向量服务费用，已有图片/音频向量完整核对后继续使用，不重新生成媒体向量或ASR。合法旧发布在重建任务中及失败/取消后可读，成功仅在授权回读新publication后清旧来源并提示重查，保留问题、完整范围与整理草稿。实际10DOM旧产品8FAIL/2PASS→同10GREEN，12模块是实现后补测；472完整/check通过，65输入稳定，旧450身份/断言保留。后端0036门禁与最终交接尚待root，未部署，用户验收页面，0新增真实provider，完整目标ACTIVE。下方保留历史记录。

2026-10-03当前0024：[保存材料重建](docs/changes/0024-saved-source-reindex/verification.md)。已发布资料可明确重建保存的完整文本索引，处理期间旧索引可用，成功才切换；失败、取消和重启中断保留旧版本。入口核对真实能力及当前资格，成功后提示重新查询，保留问题、范围与整理草稿。模型配置、逐角色测试、明确应用和召回测试继续沿既有流程。首切不支持已有独立图片/音频向量的资料及真正嵌入/投影迁移；后续receipt迁移与原文件版本替换继续保留。未部署，页面用户验收，0新增真实provider调用，完整目标ACTIVE。

2026-10-03当前基础修复[0023召回范围](docs/changes/0023-retrieval-scope/verification.md)：仅启用文字召回时，资料行、完整多选及详情均可进入指定范围测试；明确点击才切全库，文字模式保持，正式生成仍禁用。四项实际RED→GREEN、435全量和syntax通过，旧431完整保留；后端1032输入/JAR一致，明确复用0034实跑。未部署，页面用户验收，0真实provider调用；完整开发目标继续。下方保留历史记录。

2026-10-03前端0022/后端0034已本机修复角色切换后的旧图片、视频/OCR/字幕来源打开。新媒体问答关闭时，已校验来源仍可读取；身份、版本和SHA校验保持。实际431前端/syntax、3075 Java及六Native各1和原门禁通过，见[0022验证](docs/changes/0022-media-role-switch-sources/verification.md)。新补丁在0030公开副本实际应用并核对完整27文件；交接以工作区`.tools/media-role-switch-handoff`manifest为准，现网fork未适配、未部署、页面用户验收。目标active，继续基础召回范围入口及原重建/版本更新范围。下方为历史记录。

2026-10-03当前基础修复0033：已有文字索引后，仅更换生成或重排模型可以保存、单独测试并明确应用；嵌入配置及投影不变时不重建资料索引。实际新角色与新trace、原索引/旧来源、连续切换及重启均已本机验证；真正嵌入或投影变化仍拒绝，legacy媒体按实际完整profile判定。最终3058 Java、1013格式、原LINE/BRANCH双80与架构、六Native各1通过；1029后端输入相同、761生产class稳定。前端64及后端18 Node/static输入字节不变，430/check与73明确复用此前实跑证据。新交接.tools/model-role-switch-handoff以实际manifest/VALIDATION为准；未部署、0新增真实provider调用、页面用户验收、真实ASR未宣称修复，目标active。历史记录保留。

2026-10-03当前本机主线：[模型配置与召回测试](docs/MODEL_SETUP_AND_RETRIEVAL.md)已接通保存草稿、逐角色连接测试、明确应用、完整范围召回预览与同版本来源；无模型可启动，应用丢响应后显式读取能恢复索引/召回入口。资料清理及取消后清理恢复一并整合。实际3011 Java、1004格式、原LINE/BRANCH双80%、430前端/check、73后端Node及六Native各1通过；1020/64执行输入相同，759完整生产class与最终JAR一致，旧2640/370用例身份多重性保留。详见[0021验证](docs/changes/0021-model-setup-retrieval-test/verification.md)。交接工作区`.tools/model-setup-handoff`以实际manifest/VALIDATION为准；未部署、0新增真实provider调用、页面用户验收，原ASR质量未宣称解决，目标active、usage/计费取消。下方保留历史记录。

2026-10-03本机门禁通过：[0019原视频参考查询](docs/changes/0019-video-av-query/verification.md)。独立`video_av_query_attachments`能力下，VISUAL/AUDIO/JOINT三模式可携1..3个原视频辅助检索；同次File SHA、完整组receipt、迟到隔离与整批拒答已接。370前端/check及57输入前后绑定通过，旧344用例含重复次数保留；后端0030最终2640 Java/894格式/73 Node、原双80%和六条Native通过，全部668生产class与最终JAR一致。交接预定工作区`.tools/video-av-query-handoff`，尚不宣称冻结，以实际manifest/审计为准。本切未部署、未浏览器验收、0真实模型调用；当前已核部署仍voice-tags，页面用户验收，目标active，usage/计费取消。下方保留历史记录。

2026-10-03本机门禁通过：[0018原视频音画](docs/changes/0018-video-audiovisual/verification.md)。原视频保存/详情显式建立、三模式完整文字问题、精确nested事实与时间来源、完整SHA原视频播放器及两个代理已接。344前端/syntax和55输入绑定、旧324用例保留；后端0029最终2567/878格式/原双80%及六项Native通过。交接入口工作区`.tools/video-audiovisual-handoff`，以实际manifest/validation/审计为准；未部署，网页用户验收、无真实模型/Git写入，usage/计费取消，目标active。下方为历史记录。

新增[0016原声向量入口](docs/changes/0016-audio-vector-retrieval/verification.md)：已索引音频详情可显式建立全部可引用语音分段的原声向量，携参考音频按服务器完整授权范围召回，再打开库内原音频时间来源。独立音频状态保留整理草稿；显示调用费用说明，停止后须明确刷新服务器状态。299项与语法检查通过，后端0027配套，默认关闭。本增量未部署；当前仍20261003-voice-tags，完整页面由用户验收，真实ASR及非语音事实仍未完成。下方为历史快照。

新增[0015原图向量入口](docs/changes/0015-image-vector-retrieval/verification.md)：已索引图片详情可显式建立原图向量；原图模式携参考图片按服务器完整授权范围检索，再打开库内原图来源。独立状态读取/构建保留整理草稿，停止仅结束本地等待，须刷新核对服务器结果。后端0026配套，默认关闭。本增量未部署；当前20261003-voice-tags已部署含标签/语音，入口只读结果已核对，完整页面由用户验收，真实ASR质量仍未通过。下方发布状态均属历史快照。

新增[语音提问](docs/changes/0014-voice-questions/spec.md)：上传单个音频→转成完整文字→编辑核对→明确替换问题→按原范围和模式提问，随后打开库内来源。确认前保留手工问题，转录不会自动发起问答或加入附件。[275项验证](docs/changes/0014-voice-questions/verification.md)已通过；标签与语音尚待发布。当前部署20261003-scanned-pdf已含附件、摘要和PDF来源；页面完整流程由用户验收。下方发布状态为历史快照。

新增[摘要建议标签](docs/changes/0013-tag-suggestions/spec.md)：从已保存摘要推荐短术语/主题，勾选后追加保存，保留现有标签。有未保存整理草稿时先处理草稿。需要tag_suggestions/file_synopsis/synopsis_sources能力及当前有效摘要；本轮没有新模型调用或部署。

新增[PDF按页来源](docs/changes/0012-pdf-sources/intent.md)：文字问答的PDF引用可打开或下载同版本原PDF，并按服务器页码导航。原文件完整性校验后才展示；扫描件摘录明确标记为机器OCR。服务启用`pdf_ocr_upload`时，上传面板说明逐页OCR处理。当前增量尚未发布，页面由用户验收。

新增[0011文件摘要网页](docs/changes/0011-file-synopsis/intent.md)：已索引资料详情可读取概览、主题、术语和媒体时间线，并打开各条原始依据。生成需要服务声明`file_synopsis/synopsis_sources`及当前编辑权限，显式确认后创建任务；读取已有摘要不生成新内容。任务失败不影响索引，摘要只作浏览导航。当前为本地开发增量，发布和用户页面验收待完成。

新增[0010查询附件网页](docs/changes/0010-query-attachments/intent.md)：服务启用`query_attachments`后，可在文字问题旁添加图片、音频或视频，最多3个、合计20MiB（单张图片10MiB）。先选择附件类型，再选择原文件；MP4/WebM可明确作为音频或视频处理。附件辅助检索库内资料，不入库、不生成附件引用，答案沿用原有来源核验。页面显示每份附件的处理状态及视觉采样说明；离开问答或切换身份清空选择。当前是本地开发增量，尚未发布或完成用户页面验收。

2026-10-02当前本地稳定点：[0008音视频网页](docs/changes/0008-audio-video-library/verification.md)与[认证外部入口整合](docs/changes/deployment-external-entry/integration.md)。文档、图片、音频、视频均已接上传/处理/索引、显式证据模式、来源回读；音视频原文件SHA校验后支持按引用时间播放/下载，视频原帧另校验。真实本机Java/FFmpeg/Tesseract与前端Module、JWT入口七条正常链路通过；模型和向量均为loopback替身，不代表真实质量或公网完成。0007/0008及入口当前为未提交工作树，Git写入归专门任务。

0006文本闭环已交接推送；下方本机浏览器记录属于0006历史，本轮图片/音视频使用当前页面函数与Module/HTTP集成验证。

本机浏览器已走通合成PDF上传→索引发布→选中资料提问→650元证据答案→同版本来源回读。运行的是当前Java源码编译的隔离Spring/SQLite服务，模型与向量服务为loopback协议夹具；这证明功能闭环，不认证真实provider语义质量、真实Milvus整链或生产。完整证据与未验证项见[0006验证](docs/changes/0006-grounded-answers/verification.md)。

配套 [AI Knowledge Java](https://github.com/LingBengYing/ai-knowledge) 的独立原生 HTML / CSS / JavaScript 前端。

顶部导航为资料库、处理任务、知识问答、设置，分别具有hash地址；保留列表筛选、分页、目录、标签、批量整理和详情草稿。任务页只显示当前授权资料页的任务，不代表全部历史。新问答代码仅在本仓库，不自动同步Java内置静态页面。

知识问答支持全库或完整所选资料范围；引用展示编号、原文件名、页码、摘录和版本，点击后按当前身份向Java重新校验。无证据时展示服务器拒答原因。答案与摘录为纯文本；取消仅停止本地等待，不宣称取消服务器处理。旧管理接口的can_answer=false不隐藏入口：入口只是选择范围，能否使用资料证据由Java验证。

保留[0005本地文件预览](docs/changes/0005-media-preview/verification.md)：图片缩放/旋转、音视频播放、PDF与纯文本阅读，文件留在浏览器，不上传或关联库内记录。库内多模态上传和typed来源由0007/0008接入，查询附件网页由0010接入，持久摘要网页由0011接入。此本地预览与库内来源是独立功能。

For AI agents: this repository contains the standalone native JavaScript knowledge workbench, including capability-gated grounded text answers and current-authorized source rereads. Java owns retrieval, models, ACL and evidence verification. Start with [0006 change artifacts](docs/changes/0006-grounded-answers/), [AI_CONTEXT](docs/AI_CONTEXT.md), [AGENTS](AGENTS.md), and [API_CONNECTION](docs/API_CONNECTION.md). Multimodal web entry points are implemented; current browser acceptance, real-provider quality and production remain pending.

## 本地运行

需要 Node.js 22+。没有第三方 npm 依赖、无需 `npm install`、无需前端构建或模型 API key。

先按 [Java 仓库快速开始](https://github.com/LingBengYing/ai-knowledge#快速开始) 启动独立 Java 服务，默认 `http://127.0.0.1:18084`。开发演示身份须在 Java 端显式启用 `RAG_AUTH_MODE=development_headers`；空库显示空状态，合成资料由 Java 的显式 seed 工具创建，前端不会生成或自动导入业务资料。

需要真实文本上传时，使用支持`0003-text-ingestion`的Java版本，在独立本机数据目录启动并显式设置`RAG_INGESTION_ENABLED=true`。该能力默认关闭且只允许loopback；前端必须看到Java的`text_upload`与`ingestions`两个capability才开启按钮。旧后端仍可用于资料管理，但不会自动获得上传能力；不要为此直接复用或替换其他服务的数据目录。

索引入口要求Java显式启用`RAG_INDEXING_ENABLED=true`并返回`text_index/indexings`，且当前资料行允许索引。管理员可在设置页保存、手动测试并应用文字provider配置；独立Milvus连接和媒体资源由服务端提供，参见[模型设置](docs/MODEL_SETUP_AND_RETRIEVAL.md)。点击“建立索引”或“重试索引”先说明外部处理与调用费用，确认后才发送请求。parsed终态自动回读授权列表取得索引权限，indexed终态回读服务器发布版本；前端不会自行设置active证据版本。

文本问答还要求Java显式设置`RAG_ANSWERS_ENABLED=true`并同时返回`answers/sources`。在“知识问答”问全库，或从资料行/批量工具进入完整所选范围；所选范围不会过滤未发布资料，也不在空范围或错误时回退全库。Java负责范围与证据可用性，配置及质量验收见后端项目文档。

然后在本仓库根目录执行：

```bash
npm run dev
```

打开 [前端工作台](http://127.0.0.1:18085/)。必须使用 `127.0.0.1`，不要改成 `localhost`。页面通过同源开发代理连接 Java；Java 未启动时页面会显示安全连接错误，不返回假数据。

```bash
RAG_WEB_BACKEND_ORIGIN=http://127.0.0.1:18084 RAG_WEB_PORT=18085 npm run dev
```

配置仅接受字面量 `127.0.0.1` 的 HTTP origin 与合法端口；前端端口禁止80，避免浏览器省略默认端口导致同源身份歧义。不能填公网域名、用户信息、路径、查询或 fragment。[.env.example](.env.example) 没有密钥，程序也不自动加载 `.env`。`NODE_ENV=production` 拒绝启动。

JWT 模式使用 Java 的 `/v1/session` 交换 HttpOnly Cookie，输入提交后清空，不写入 localStorage / sessionStorage。本仓库没有令牌签发或刷新服务；模型和 JWT 签名密钥只能留在后端。浏览器 Cookie 按主机而非端口隔离，详见 [SECURITY](SECURITY.md)。

## 范围与运行方式

| 内容 | 当前状态 |
| --- | --- |
| `public/` 工作台 | 独立原生静态页面；0006不自动同步Java资产，历史导出来源见PROVENANCE |
| ACL、目录、标签、持久化、审计 | 由 Java 服务实现，前端不替代权限检查 |
| Node 开发服务 | 仅静态文件 + loopback 同源适配，无业务数据库 |
| PDF / TXT / MD上传与任务 | 后端capability启用后可用；原始文件1字节至20MiB，最多3次attempt |
| 文本索引任务与发布状态 | 显式能力、当前权限与确认框门禁；解析/索引终态回读服务器列表 |
| 文本证据问答与来源 | answers/sources启用后可用；本机浏览器闭环已检查，真实provider/Milvus质量待验 |
| 图片/音频/视频网页 | 已接入现有Java合同并通过本机正常链路；真实模型与公网待验 |
| 查询附件网页 | 0010接入临时图片/音频/视频，需Java显式query_attachments与所选模式能力；页面及真实模型待验 |
| 文件摘要网页 | 0011接入任务、结构化摘要及八类原始依据；需Java显式能力与摘要模型，页面/真实质量待验 |
| 生产发布 | 未验收；不能把开发代理暴露公网或套反向代理使用 |

外部预发布使用独立`node scripts/external-server.mjs`、JWT及同机TLS终止，见[EXTERNAL_ENTRY](docs/EXTERNAL_ENTRY.md)。开发代理仍仅loopback；Java内置旧静态资源不自动同步。

上传后查看解析任务面板；queued/processing约每1.5秒刷新，终态停止。索引使用独立任务，可从列表或详情重新查看，按服务器允许取消/重试。切换身份、筛选或分页会清空当前任务显示，但不会取消后台任务。网络错误会暂停轮询，不自动重发写请求；上传或索引写请求响应丢失时先刷新列表/任务核对。开发代理最多两个上传请求同时在途，超出返回429。

代理的普通请求期限为10秒，文本上传为30秒，只有精确POST `/v1/answers`为180秒；来源GET仍为10秒。问答不是SSE，也不自动重试。身份或范围切换、新问题会清除旧答案和来源，404/401来源不保留旧摘录为当前验证成功。

## 验证与文档

```bash
npm run check
npm test
npm run check:secrets
```

`check:secrets` 要求 Git 仓库，检查已暂存文件、对应工作树和所有可达提交历史。新增未跟踪文件须先暂存再扫描；不能把空 index 的扫描当作完整发布验证。

- [AI_CONTEXT](docs/AI_CONTEXT.md)：AI 检索入口与能力边界
- [ARCHITECTURE](docs/ARCHITECTURE.md)：Module、信任边界与源码地图
- [API_CONNECTION](docs/API_CONNECTION.md)：实际转发路由、认证与连接诊断
- [VERIFICATION](docs/VERIFICATION.md)：测试证据与未验证项
- [PROVENANCE](docs/PROVENANCE.md)：导出版本、文件摘要与测试来源
- [SECURITY](SECURITY.md)、[CONTRIBUTING](CONTRIBUTING.md)、[llms.txt](llms.txt)

本仓库尚未指定开源许可证；公开可读不等于已授予 MIT / Apache 等许可。AI 导航不保证搜索引擎或模型自动收录。
