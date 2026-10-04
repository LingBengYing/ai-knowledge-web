# API Connection

## 产品使用帮助（0036 / Java 0048）

`product_help`能力对应精确`POST /v1/product-help/search`，无query。请求为question、可选完整document_ids、top_k（每类1–10、默认5）、rerank（默认true）。省略范围为全库，空数组不得改写。返回search_id/configuration_version/status/reason/scope_count/score_kind/matches；match包含category、evidence_kind、原document/revision/SHA、text/text_sha256、nullable页码/码点或start_ms/end_ms/time_precision，以及精确原件content_url。检索结果不是answer trace，不访问旧答案来源路径。

两代理只为该精确POST复用已有retrieval期限/限额；原件继续既有metadata及按revision内容路由，完整身份/SHA核对后Blob阅读/播放，不转发任意URL或Range。前端无模型密钥，无自动重试，当前停测与真实模型验证边界见[0036记录](changes/0036-product-help/REVIEW.md)。

2026-10-03当前基础修复0033：已有文字索引后，仅更换生成或重排模型可以保存、单独测试并明确应用；嵌入配置及投影不变时不重建资料索引。实际新角色与新trace、原索引/旧来源、连续切换及重启均已本机验证；真正嵌入或投影变化仍拒绝，legacy媒体按实际完整profile判定。最终3058 Java、1013格式、原LINE/BRANCH双80与架构、六Native各1通过；1029后端输入相同、761生产class稳定。前端64及后端18 Node/static输入字节不变，430/check与73明确复用此前实跑证据。新交接.tools/model-role-switch-handoff以实际manifest/VALIDATION为准；未部署、0新增真实provider调用、页面用户验收、真实ASR未宣称修复，目标active。历史记录保留。

0021新增`model_configuration`与`retrieval_test`实际能力：设置中的GET/PUT `/v1/model-configuration`、POST同路径`/test`及`/activate`采用独立配置Session；POST `/v1/retrieval-tests`采用完整范围和片段SHA校验。写结果未知后只读核对，不自动重发；读取已应用版本后同身份刷新能力/授权行并保留整理草稿。角色测试单次请求，召回不生成；同版本原文件沿既有完整SHA校验打开。流程与失败恢复见[MODEL_SETUP_AND_RETRIEVAL](MODEL_SETUP_AND_RETRIEVAL.md)及[0021合同](changes/0021-model-setup-retrieval-test/spec.md)。

0016新增`audio_vector_retrieval`能力及精确GET/POST `/v1/documents/{id}/audio-vector`，均无query/body。响应精确十字段status/document_id/publication_id/source_revision_id/source_sha256/profile_fingerprint/model_revision/dimensions/vector_generation_id/manifest_sha256；missing最后两项为null，available必须完整绑定，维度2..3072。当前editor显式POST，reader只GET；停止后明确GET核对，任何写操作不自动重试。AUDIO附件完整scope缺receipt显示`audio_vector_required`，query附件预算与typed原音频来源不变。

0014新增能力voice_questions与精确POST /v1/voice-questions（无query），请求仅filename/media_type/content_base64单音频；响应必须精确八字段transcript/transcript_sha256/source_sha256/decoder_revision/model_revision/compiler_revision/duration_ms/policy_revision。核对full SHA和java-voice-question-v1后显示完整≤65536 UTF8字节预览；确认沿旧4096字节问题约束，随后仍发原问答端点与完整document_ids。独立28MiB/180秒/2在途，默认关闭且需当前证据模式answers/sources，不要求query_attachments。

0013新增GET /v1/documents/{id}/tag-suggestions及POST同路径/apply；能力tag_suggestions与file_synopsis/synopsis_sources共同有效且摘要available才显示建议流程。响应绑定当前摘要身份，POST只发suggestion_fingerprint和ordinals，成功返回既有资料行；409/404后显式刷新，不自动重发。普通JSON体积和期限保持。

0012 PDF引用：文字模式且document_originals启用时，先GET原sources验证引用，再GET `/v1/documents/{id}/original`并匹配引用document_id/revision_id/filename/source_sha256。只接受document/application/pdf及精确pinned内容URL、1..20MiB；完整MIME/大小/SHA通过后以服务器page设置本地Blob `#page`。无新API/代理/限额，读取失败不能保留旧校验来源；`pdf_ocr_upload`只是后端0023实际逐页OCR上传能力，普通文本路径保持。

## 文件摘要（0011）

`file_synopsis`与`synopsis_sources`同时启用时，真实已发布资料详情自动GET `/v1/documents/{id}/synopsis`。当前编辑者显式确认模型处理后可POST同一路径，不发送body/query；返回202任务（task_id/document_id/publication_id/state/error_code/created_at/updated_at）。queued/processing约1.5秒GET `/v1/synopsis-tasks/{id}`，available后读取持久摘要，unavailable/cancelled终止；网络错误暂停待手动刷新。不自动重试写请求，不制造取消/重试路由。

摘要绑定document/publication/revision/source_sha256，并含overview/topic/term/timeline、最多32条及每条1..8个原始依据。专用GET `/v1/synopsis-sources/{synopsisId}/{entryOrdinal}/{sourceOrdinal}`采用一基编号；支持text/image_ocr/image/audio_transcript/video_frame/video_transcript/video_ocr/video_subtitle。网页核对身份、引用SHA、服务器页/CP/微秒时间及精确content/frame路径，重新读取完整原文件并核对摘要的源SHA；文字和video_frame另核对各自证据SHA。video_ocr帧由专用授权接口提供，当前HTTP未含其独立帧SHA，客户端不声称独立验证该哈希。

新元数据/任务路由与其GET/POST无query/body，普通10秒/128KiB请求/4MiB JSON响应；只有精确`/content`允许20MiB原文件、`/frame`允许10MiB PNG/JPEG，完整200，不转发Range。来源可打开/下载、PDF按页显示、图片/OCR词框、音视频按时间播放、视频原帧和字幕轨定位。切换详情、身份、发布版本或离开资料页停止轮询/播放并撤销URL；刷新摘要保留整理草稿。Java配置及完整长文件生成见后端0015/0016，部署开关仍默认关闭，本轮不改变配置。

## 查询附件（0010）

Java声明`query_attachments`且当前证据模式的answers/sources启用时，可添加最多3个原始图片/音频/视频，总计20MiB（图片单文件10MiB）。`POST /v1/attachment-answers`无query，JSON为原`question`、完整可选`document_ids`、`mode`和`attachments:[{filename,media_type,content_base64}]`。原问题不改写，显式空scope不回退全库；附件仅辅助检索，不能充当库内引用。网页显式选择附件类型，MP4/WebM不猜测模态。

证据模式：网页`text/visual/audio/video-visual/video-transcript/video-joint/video-ocr/video-subtitle`映射到`text/image/audio/video_visual/video_transcript/video_joint/video_ocr/video_subtitle`。响应`mode/result/query_attachments`逐项核对ordinal、media_kind、prepared/failed、visual_sampled及稳定reason，`result`再经过原typed答案校验。来源仍走旧sources路径与SHA核验。无附件使用原四入口，不改变旧JSON。

开发与外部代理只给此精确POST独立28MiB请求、180秒总期限及最多2个在途；JSON响应4MiB，其他JSON请求128KiB、普通请求10秒、资料上传30秒保持。读取文件开始即防重复，取消或上下文改变使旧读取/请求失效，不自动重试。离页或身份改变清空临时选择。Java开关默认关闭，配置依赖及hash-only审计见后端`docs/QUERY_ATTACHMENTS.md`；这次网页接线不代替部署者启用配置或真实质量验收。

0009原文件详情：基础能力`document_originals`提供精确GET `/v1/documents/{id}/original`（八字段metadata）及其pinned `/v1/documents/{id}/revisions/{revision}/content`。当前详情身份、版本、文件名、类型、MIME、SHA、大小及URL均校验，完整原字节SHA通过后才创建Blob URL；1..20MiB、普通10秒，不能使用query/Range或任意文件路径。PDF原生预览/打开/下载、TXT/MD纯文本、图片显示、音视频播放/下载；关闭与离开资料页停止媒体、取消请求、撤销URL。解析/索引或问答关闭不影响真实保存原文件读取。两个代理只增精确GET和静态Module，认证边界保持。导航到问答/设置清除旧详情，取消脏表单离开不改变问答scope；任务页既有草稿行为保留。详见[0009验证](changes/0009-document-originals/verification.md)。

0008当前音视频合同：明确audio/video上传类型。音频WAV/MP3/FLAC/OGG/M4A/MP4/WebM用octet-stream；视频MP4/MOV/WebM/MKV用严格匹配video MIME；1..20MiB，图片仍10MiB。精确POST `/v1/audio-answers`、`/v1/video-answers`（mode=visual/transcript/joint/ocr/subtitle），GET对应`/{answer_id}/{1..32}` sources、`/content`以及video `/frame`。四种answers POST180秒，metadata/content/frame10秒；JSON4MiB、图片/帧10MiB、原音视频20MiB。完整原文件SHA校验后Blob本地seek，不转发HTTP Range。external-server同步以上合同并增加GET session、JWT会话保护和精确HTTPS Origin，内部health不对外。详见[外部入口](EXTERNAL_ENTRY.md)。下方0006/0007为对应阶段合同，认证/完整scope/拒答保持。

0007当前图片合同：上传在image_text_upload或visual_image_upload与ingestions启用时允许PNG/JPEG，octet-stream、1..10MiB，后台校验1200万像素；文本仍20MiB。新增POST `/v1/visual-answers`、GET `/v1/visual-sources/{answer_id}/{1..32}`及图片两类来源的精确`/content`。视觉POST180秒，metadata/content10秒；仅content响应10MiB，其余JSON4MiB。OCR原图读取还要求source_image_content。点击来源后当前身份回读metadata与原图，匹配SHA后显示/下载；不公开自由文件路径、不支持图像Range。下方0006只解释文本的条款由本条图片增量扩展，认证/Host/Origin/限额和不重试保持。


## 连接契约

浏览器只访问前端 origin 的相对路径；Node 开发服务默认绑定 `127.0.0.1:18085` 并转发至显式可信的 `http://127.0.0.1:18084`。后端必须由你单独启动，不自动发现、不复用其他数据库、不代理 Python 业务。

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| `/v1/config` | GET | Java 能力、固定 workspace、认证模式 |
| `/v1/session` | POST、DELETE | Java JWT → HttpOnly Cookie / 清除 Cookie |
| `/v1/documents?filename=<encoded>` | POST | 原始PDF/TXT/MD，Content-Type严格application/octet-stream，1..20MiB，202返回任务 |
| `/v1/ingestions/{id}` | GET | 当前授权解析任务 |
| `/v1/ingestions/{id}/cancel`、`/retry` | POST | 无请求体；权限与状态由Java检查，返回更新任务 |
| `/v1/documents/{id}/index` | POST | 无query/body，确认后建立索引，要求Java显式能力与当前can_index |
| `/v1/indexings/{id}` | GET | 无query/body，当前授权索引任务 |
| `/v1/indexings/{id}/cancel`、`/retry` | POST | 无query/body，按服务器权限取消或有界重试 |
| `/v1/answers` | POST | 0006新增；无query，JSON问题及完整所选范围，独立180秒期限 |
| `/v1/sources/{answer_id}/{1..32}` | GET | 0006新增；无query/body，当前身份重新校验文本引用 |
| `/v1/management/documents` | GET | 授权分页、筛选、排序 |
| `/v1/management/documents/{id}` | PATCH | 展示元数据整理；详情使用当前授权列表行，没有独立GET详情接口 |
| `/v1/management/document-actions` | POST | 批量移动／追加标签及逐项回执 |
| `/v1/management/folders` | GET、POST | 授权目录列表／创建 |
| `/v1/management/folders/{id}` | PATCH、DELETE | 目录改名／删除 |
| `/v1/management/tags` | GET | 当前身份可见标签 |
| `/health/live`、`/health/ready` | GET | 原样传递 Java 健康状态，ready503不会伪装成200 |

代理路径中的ID仅接受1–128位ASCII字母、数字、下划线与连字符；JSON所选document_ids另遵循下方Java合同。具体body/query/ACL和错误语义见 [Java API](https://github.com/LingBengYing/ai-knowledge/blob/main/docs/API.md)。新增后端路由不会自动穿透前端开发代理；必须在新的变更中明确加入方法与路由回归。

## 文本任务

Java的`RAG_INGESTION_ENABLED=true`为显式本机开关，默认关闭；页面同时检查`text_upload`和`ingestions`。filename是唯一query参数，不允许路径、控制字符、超过255字符或不支持的扩展名。浏览器用原始File，不使用multipart/base64/JSON包装。只有这一精确上传接口享有20MiB、30秒和最多两个在途请求。JSON仍128KiB，普通请求10秒、精确POST answers另为180秒，所有响应仍4MiB。Cookie和同源要求与管理操作相同。

任务安全shape：`task_id/document_id/revision_id/state/attempt/error_code/can_cancel/can_retry`。state为queued、processing、parsed、failed、cancelled；attempt为1..3，retry沿用任务与解析版本，增加attempt。界面不显示正文、chunk或原始异常。`parsed`是解析终态，不能单凭它推定是否已索引；任务revision不冒充文档active revision。parsed终态自动回读当前授权列表取得服务器can_index，详情只读字段刷新保留未保存表单。

轮询只在当前身份/任务的queued或processing执行，约1.5秒；终态停止，网络或数据错误暂停等待手动刷新。切换身份或列表上下文会中止读取并清除任务，不取消服务器任务。POST不自动重试：若上传/取消/重试响应丢失，应先查询列表/任务确认是否已经生效。

## 索引任务

对应Java0004。Java必须显式启用`RAG_INDEXING_ENABLED=true`且同时声明`text_index/indexings`；前端还验证当前授权行`can_index=true`、parsed、非合成资料、无active和已有索引任务。默认能力缺失时不显示索引入口。创建与重试都先显示确认框，说明解析文本会发送到服务器配置的嵌入模型和Milvus以及可能的调用费用。

索引任务使用同一安全字段白名单，但状态是queued/processing/indexed/failed/cancelled；`checkedIndexTask`拒绝parsed，解析校验拒绝indexed。`state.indexTask`、`indexing`读票据与解析链独立；单任务面板按kind切换，保留任务/资料/revision身份、attempt和终态单调性。详情按钮只从当前授权列表行重开，旧详情闭包或旧列表不能回退进度，也不能把任务资料插入当前无权访问的页面。

列表的解析`status`保持parsed，另有`index_status`（默认not_indexed）、`latest_index_job`、`index_publication_id`、`can_index`。任务poll只写前两个索引状态字段；active_revision_id和publication只能由服务器列表返回。indexed后刷新授权列表，详情只读证据字段更新时保留未保存表单；发布后的资料与其解析任务不再显示未索引。旧管理can_answer=false是兼容占位，不能作为新问答入口资格；入口只指定范围，Java问答接口校验全部所选资料的ACL、active版本和可用性。ready503仍原样保留。

四条索引路由拒绝任何query（包括空问号）与body；创建和任务动作无Content-Type要求，不获得上传预算。保留普通10秒deadline、128KiB读取上限、4MiB响应、原鉴权/Origin/Host/Cookie限制和错误不重试。Node回归与HTTP替身结果不认证真实Java、provider/Milvus或浏览器。

## 文本证据问答与来源（0006）

Java须显式设置`RAG_ANSWERS_ENABLED=true`并同时返回`answers/sources`；页面才启用问答。全库发送`{"question":"问题"}`，不带document_ids；所选范围发送`{"question":"问题","document_ids":["doc-1","doc-2"]}`，完整保留顺序与集合。显式`[]`仍为空所选范围，不能回退全库；任一所选项不可用时显示Java错误，不删除该项后重试。问题非空、最多4096 UTF-8字节，允许换行和Tab，拒绝其他C0控制字符、DEL及不合法Unicode。所选ID最多128个、唯一，符合Java的`[A-Za-z0-9][A-Za-z0-9._:-]{0,99}`。

POST仅发送一次，无SSE或自动重试。页面防重复并允许取消本地等待，不能据此宣称后台处理已取消。身份、范围或新问题使旧响应失效；答案、文件名和quote都用纯文本显示，不渲染模型HTML或自由链接。

答案shape为`answer_id/status/answer/reason/citations`。HTTP200 `answered`显示证据答案，`abstained`显示服务器原因；后者不是网络错误。全库empty_scope提示先导入并索引可访问资料，显式空所选范围则提示重新选择。每条文本引用含`number/document_id/revision_id/source_sha256/parser_revision/filename/page/start/end/quote/quote_sha256/source_url`；page为服务器整数页码，start/end为Unicode码点半开区间，不是浏览器UTF-16字符串下标。

引用source_url只能为当前答案的精确`/v1/sources/{answer_id}/{1..32}`。点击后以当前身份GET，返回`{"answer_id":"...","citation":{...}}`；Module复核答案、编号及全部文本引用字段，回读开始就清除旧来源。404、401或身份/版本不匹配不保留旧摘录为当前验证成功，401复用现有身份清除。Java可附带image，但本切只显示文本citation，不请求媒体内容。

代理只增加精确POST answers和GET sources，不接受query（含空问号）、编码ID、额外动作或自由URL。POST answers要求application/json、原128KiB请求及4MiB响应上限，独立180秒总期限；来源GET仍10秒、无body。原Host/Origin/fetch-site、Authorization拒绝、开发身份/Cookie白名单均保持，不能把180秒推广给普通请求或上传。

## 认证

开发演示：Java 必须显式开启 `development_headers`，页面根据 `/v1/config` 展示本机身份输入。Node 只转发这些明确头；Java 仍做角色/组织与操作权限校验。

JWT：由可信签发方提供现有合法 JWT；页面 POST `/v1/session`，Java 返回 Host-only、HttpOnly、SameSite=Strict、Path=/ Cookie。开发代理只允许此会话响应 Cookie；不存在浏览器 localStorage 或 Node token store。退出会话不吊销已签发 JWT；本仓库没有自动刷新。任何Authorization头都400拒绝，不会静默丢弃并退回Cookie；Bearer CLI应直接调用Java API。

## 常见诊断

- 首页可打开但提示连接失败：确认 Java 服务启动、目标端口和认证配置；检查 `GET /health/live`，没有假后端 fallback。
- ready 503：当前 Java 完整迁移门禁有意保持关闭，不是由前端改成200的理由。
- 403 host/origin：地址必须使用 `http://127.0.0.1:<端口>`；禁止 localhost 别名、跨域嵌入或公网反向代理。
- 脚本写API收到403：开发代理的写操作也必须提交精确同源 Origin 和正常身份；不删除Origin校验来方便工具。
- 404/405：路由或方法不在当前 allowlist；并不意味着未来RAG已经提供。
- 413/502/504：分别可能是请求限长、后端失败/重定向/响应超限、总deadline；不重试写操作，先确认后端结果。
- 429：本地代理或Java已有两个上传请求在途；稍后显式重试，不放大并发限额。Java持久任务/原文件总量配额则返回409，应先核对后端安全错误。

生产同源托管、TLS和 Cookie Secure 需要单独验收。不要把该开发Node代理放到公网后声称原认证边界仍成立。


## 0005 预览边界

本地文件预览没有新增业务API，只增加preview.mjs静态资源与本地blob媒体CSP。库内记录不能仅凭filename生成媒体src；通用库内预览和Java typed媒体来源尚未接入本前端。历史[后端需求](changes/0005-media-preview/backend-integration.md)与当前文本sources是不同合同，不能把本地File预览或文本摘录回读当作远程媒体预览。
