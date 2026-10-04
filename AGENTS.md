# AI Knowledge Web：智能体工作约定

2026-10-04 23:41 +08 最新0037：资料库选择合成PDF+成功视频→批量提问→默认综合问答/已选2份→实际发送一次正常问题，后端返回unsupported_question拒答。无引用/播放验收；本轮前端生产源码未改。后端已定位普通操作问题和编号原文不符旧证明合同，累计12/20、本批4/6已halt，独立后端及模型入口停，不能自动重试。两仓库当前为可构建实现停写点，不是统一问答验收通过；自动化测试/检查/审计继续停止，实际记录见[0037 REVIEW](docs/changes/0037-unified-knowledge-answers/REVIEW.md)及后端0049/provider-run.md。

2026-10-04最新0037页面入口验收：root在本机18087预览tab4从设置点击知识问答成功，默认“综合问答 · 文档与视频文字”，主导航仅知识问答/资料库/设置，页面正常且无错误提示。此前实际页面暴露的两处初始化错误已修：恢复误删的renderRetrieval及普通检索/模型设置绑定；移除renderControls残留renderProductHelp()调用。原tab3用户“你好”草稿保留。此轮未提交新统一问答，综合回答、混合来源回读与播放仍未验，不能将入口通过写成闭环完成。模型累计8/20、转发halted、无新增请求；自动化测试/检查/审计继续停止。过程与截图状态见[0037记录](docs/changes/0037-unified-knowledge-answers/REVIEW.md)，下方保留阶段历史。

2026-10-04当前主线[0037统一知识问答](docs/changes/0037-unified-knowledge-answers/intent.md)：负责人要求“产品使用帮助”只是知识问答的一种场景，不单列功能。默认问答应取服务器综合答案、混合文档/视频typed引用，撤下独立产品导航与专门资料动作，完整scope及原件SHA保持。0048实际星辰ASR/两份新资料索引成功，页面查询本地v4读取失败后总8/20已停止；新综合生成/引用播放未验，云预算不自动恢复。自动化测试/检查/审计继续停止，无旧数据/线上变更或提交推送。

2026-10-04 22:38 +08当前0036：已补齐可先写问题、配置/导入常显入口和返回只读刷新，真实页面已应用模型配置。PDF新样本parsed且原件身份/字节可读，原生PDF渲染未验；视频首次VLM超时、后端v4文字模式续作又ASR60秒超时，总计3/20、剩余17已停止。尚无双类查询/结果卡/播放验收，不自动用剩余额度。后端22:36:19跳过全部测试构建成功，独立18086/前端18087运行，旧服务/数据未改，无推送部署；自动化测试/检查/审计保持停止。详见[0036记录](docs/changes/0036-product-help/REVIEW.md)，下方首版空配置是历史。

2026-10-04 0036首版源码已实现，18087的`#/product-help`已实际打开并保留预览：导航、文档/视频分组空态、范围与参数展开和未配置模型提示可见。Java0048独立18086已启动；本轮未提交检索，真实结果、原件阅读/视频播放及质量未验。自动化测试/检查/审计继续停止，云0、未推送部署、旧数据不动；[0036记录](docs/changes/0036-product-help/REVIEW.md)是当前证据，下条IMPLEMENTATION为本轮开始状态。

2026-10-04当前新增[0036产品使用帮助](docs/changes/0036-product-help/intent.md) intent→spec→plan→REVIEW，配后端0048。独立`#/product-help`入口、完整所选/全库范围、文档/视频两组原文候选和真实页码/时间原件读取。不混装旧AnswerSession的typed答案，不用caption/摘要代替原证据。型号版本先沿现有目录/标签和完整选择，不造产品主数据；未选择整个目录时不暗示范围完整覆盖产品。当前IMPLEMENTATION，root统一构建与实际页面观察；全部自动化测试/检查/审计继续停止，无新增云调用、Git写入或部署。真实检索和质量未验不能记通过。

2026-10-04当前交付与页面验收：后端 `20261004-video-answer` 已于08:46:07 +08实际部署，含0045安全视频失败阶段日志；前端0033准确model_failure文案已冻结。08:44:46 +08仅skip-all-tests package成功，用时3.796秒。前端0032静态于08:36:04 +08部署，reload后audio、visual、text、video-visual四种单份入口及完整1份scope实际正确。

root按用户授权使用新合成资料验收：0042中文TXT三个事实及PDF预算回答、来源回读，图片视觉回答及原图回读，0044音频启动日期回答与0–6815ms来源、播放通过。视频第2次解析及索引、此前视觉回答与原帧及0–40ms播放通过；期间同视频两次model_failure真实失败已记录，原因未定位，不宣称模型服务已修复。最新唯一新VIDEO_VISUAL请求 `b9b5d6bf-240f-4665-a9b5-8e276f0c7e0a` 已答“The background is white”，对应原版本 `90149f4f-dd40-4340-8949-2a4e22db1820`、0–40ms；新来源及0032实际提示回读通过，明确提示“视频画面引用定位到原始解码帧及服务器画面区间，请结合下方原帧核对。”原SHA `5a864fd106866cdfffc7c82cf944d5b78ab34aad71dfa0676b037417989d74bf`、原帧、machine_vlm/group_interval及0–40ms一致；root已保存实际页面截图page-proof.jpg并完成RESULTS结论。

PDF Blob打开仍被Browser Use策略禁止，未绕过、打开未认证；ASR把budget识别为But的保存文本未篡改，预算拒答合理，初次视频parser_failed具体原因未认证。全部自动化测试、检查及审计继续停止，无Git写入、全库重建或旧数据变更。实际记录由root维护 `.tools/page-acceptance-20261004/RESULTS.md`，完整目标继续ACTIVE；以下同日旧状态保留为历史，以本条当前状态为准。


2026-10-04最新页面验收记录：用户已授权“页面你自己验收再给我”，由root使用新合成资料实际操作。前端0031单份提问默认模式及后端0042/0043已随`20261004-page-fixes`于08:15:27 +08实际部署。已通过中文项目名称、计划日期、预算三个事实问答及预算来源回读，PDF分行预算问答及第1页引用回读，图片视觉问答及原图回读；新视频第2次解析及索引已完成。PDF Blob打开被Browser Use策略拒绝，保留此页面访问限制，不能写成PDF预览已通过。

后端0044源码及运行包已完成，08:17:52 +08仅跳过全部测试package成功，正在部署；音频/视频问答与来源尚未认证，完整目标继续ACTIVE，不能据上述局部结果宣称全部完成。所有自动化测试、检查及审计仍停止。持续实测记录由root维护工作区`.tools/page-acceptance-20261004/RESULTS.md`；下方历史部署和“页面用户验收”条目保留历史，不覆盖本条最新授权与实际状态。

2026-10-03负责人最新指令：停止全部自动化测试，优先让正常功能主线继续走通。当前全量 Maven 已按用户要求中断；不启动新的全量、Native、边界用例或审计支线。继续模型配置→应用→导入→索引→召回/问答→来源的实际产品工作，可构建运行包但不得把未完成验证写成通过。下方历史测试门禁不构成本轮重新启动测试的授权。

2026-10-04用户最新授权：“页面你自己验收再给我”；实际页面验收改由root进行，自动化测试仍停止。用户明确允许通知“部署知识库”更新最新包。现已部署20261004-batch-reindex，root仅用新合成资料走实际页面；进度在工作区 .tools/page-acceptance-20261004/RESULTS.md。不得继续沿用下方历史“页面用户验收”作为本轮限制，也不得因此重启测试或审计支线。

2026-10-04当前0030：[批量重建选中文本索引](docs/changes/0030-batch-text-reindex/REVIEW.md)已补齐当前页确认、准确发布版本请求、逐项后台任务回执与原任务入口，失败/未提交选择、问题范围及整理草稿保留。后端0041于01:32:29 +08仅skiptests package成功；未运行前端测试/检查/审计/浏览器/真实模型或部署。交付 `.tools/batch-text-reindex-mainline`，页面用户验收，整体目标ACTIVE；后续以实际部署和用户页面验收为准，不增加测试支线。

2026-10-04当前0029：[媒体操作说明](docs/changes/0029-managed-media-setup/REVIEW.md)已补充网页文字配置与服务端独立媒体配置的分工，后端0040实际资源接网页当前文字snapshot。本轮无前端产品改动，01:21:20 +08仅后端skiptests package成功；未运行前端测试/检查/浏览器/真实模型或部署。交付 `.tools/managed-media-mainline`，页面用户验收，完整目标ACTIVE。

2026-10-04当前0028：[重建索引并应用](docs/changes/0028-model-index-rebuild/REVIEW.md)已实现保存后真实资格、唯一明确入口、后台批次数量/进度、离页恢复及成功后配置和资料回读；问题、范围与整理草稿保留。后端0039于01:03:40 +08跳过全部测试package成功；未运行前端测试/语法/浏览器或真实模型，未部署，页面用户验收。当前交付 `.tools/model-index-rebuild-mainline`，完整目标继续ACTIVE。

2026-10-04当前0027已实现[详情更新原文件](docs/changes/0027-document-replacements/REVIEW.md)：同资料上传候选版本、独立任务状态、明确建立新索引，授权回读新发布后才切换来源；保留整理草稿与问题范围，连续更新使用当前版本。后端0038运行包已构建，测试源码未编译、测试未运行；未做语法检查、浏览器验收或真实模型调用，未部署，页面由用户验收。工作区交付目录`.tools/document-replacement-mainline`，旧测试与旧交接不认证本轮修改，完整目标继续ACTIVE。

当前0026已完成[模型服务商选择](docs/changes/0026-model-providers/spec.md)：生成可选DeepSeek官方或硅基流动，同服务商留空保留密钥，换服务商必须重填。保留缺向量库提示与“去导入资料”入口，后端0037运行包已构建。未运行自动化测试、未部署、页面用户验收；工作区交付`.tools/model-provider-mainline`，旧测试和旧交接不认证当前四个前端修改。目标继续ACTIVE，后续正常功能优先。

2026-10-03当前0025前端本机验证：[已有媒体向量资料的文本重建](docs/changes/0025-reindex-vector-continuation/verification.md)。新text_reindex_with_vectors与原能力及服务器资格一起开放行/详情入口；明确文字模型/向量服务费用，已有图片/音频向量完整核对后继续使用，不重新生成媒体向量或ASR。合法旧发布在重建任务中及失败/取消后可读，成功仅在授权回读新publication后清旧来源并提示重查，保留问题、完整范围与整理草稿。实际10DOM旧产品8FAIL/2PASS→同10GREEN，12模块是实现后补测；472完整/check通过，65输入稳定，旧450身份/断言保留。后端0036门禁与最终交接尚待root，未部署，用户验收页面，0新增真实provider，完整目标ACTIVE。下方保留历史记录。

2026-10-03当前0024：[保存材料重建](docs/changes/0024-saved-source-reindex/verification.md)。已发布资料可明确重建保存的完整文本索引，处理期间旧索引可用，成功才切换；失败、取消和重启中断保留旧版本。入口核对真实能力及当前资格，成功后提示重新查询，保留问题、范围与整理草稿。模型配置、逐角色测试、明确应用和召回测试继续沿既有流程。首切不支持已有独立图片/音频向量的资料及真正嵌入/投影迁移；后续receipt迁移与原文件版本替换继续保留。未部署，页面用户验收，0新增真实provider调用，完整目标ACTIVE。

2026-10-03当前0023[召回范围基础修复](docs/changes/0023-retrieval-scope/verification.md)本机验证：app.js仅调整范围导航资格、文字mode和提示；新增4 DOM原文追加，旧431测试bytes/身份完整保留，实际435与syntax通过。完整selected含未发布项，null/[]不混，dirty取消与迟到失效保持；生成/附件/来源门禁和Session/代理未改。0034旧交接及独立审计只读；本切后端1032输入与JAR不变，3075/6Native/73明确复用不重跑。当前前端交接`.tools/retrieval-scope-handoff`以实际manifest为准；Git/部署由原责任方、页面用户验收、0真实provider、目标active。继续原重建/投影迁移及同资料版本更新范围；usage/计费取消。下方为历史记录。

2026-10-03当前0022/后端0034已本机修复旧媒体来源回读，见[验证](docs/changes/0022-media-role-switch-sources/verification.md)。app.js仅视觉canReadImage改为来源cap判断，新问答资格和完整SHA不变；实际431/syntax与64输入稳定，后端3075和六Native通过。Git/部署/真实provider及页面用户验收边界保持，旧失败/冻结包只读。交接以`.tools/media-role-switch-handoff`实际manifest为准；目标active，下一只推进retrieval-only资料范围入口，不混入重建、版本更新或新功能。下方为历史记录。

2026-10-03当前基础修复0033：已有文字索引后，仅更换生成或重排模型可以保存、单独测试并明确应用；嵌入配置及投影不变时不重建资料索引。实际新角色与新trace、原索引/旧来源、连续切换及重启均已本机验证；真正嵌入或投影变化仍拒绝，legacy媒体按实际完整profile判定。最终3058 Java、1013格式、原LINE/BRANCH双80与架构、六Native各1通过；1029后端输入相同、761生产class稳定。前端64及后端18 Node/static输入字节不变，430/check与73明确复用此前实跑证据。新交接.tools/model-role-switch-handoff以实际manifest/VALIDATION为准；未部署、0新增真实provider调用、页面用户验收、真实ASR未宣称修复，目标active。历史记录保留。

2026-10-03当前本机主线：[模型配置与召回测试](docs/MODEL_SETUP_AND_RETRIEVAL.md)已接通保存草稿、逐角色连接测试、明确应用、完整范围召回预览与同版本来源；无模型可启动，应用丢响应后显式读取能恢复索引/召回入口。资料清理及取消后清理恢复一并整合。实际3011 Java、1004格式、原LINE/BRANCH双80%、430前端/check、73后端Node及六Native各1通过；1020/64执行输入相同，759完整生产class与最终JAR一致，旧2640/370用例身份多重性保留。详见[0021验证](docs/changes/0021-model-setup-retrieval-test/verification.md)。交接工作区`.tools/model-setup-handoff`以实际manifest/VALIDATION为准；未部署、0新增真实provider调用、页面用户验收，原ASR质量未宣称解决，目标active、usage/计费取消。下方保留历史记录。

2026-10-03本机门禁通过：[0019原视频参考查询](docs/changes/0019-video-av-query/verification.md)。独立`video_av_query_attachments`能力下，VISUAL/AUDIO/JOINT三模式可携1..3个原视频辅助检索；同次File SHA、完整组receipt、迟到隔离与整批拒答已接。370前端/check及57输入前后绑定通过，旧344用例含重复次数保留；后端0030最终2640 Java/894格式/73 Node、原双80%和六条Native通过，全部668生产class与最终JAR一致。交接预定工作区`.tools/video-av-query-handoff`，尚不宣称冻结，以实际manifest/审计为准。本切未部署、未浏览器验收、0真实模型调用；当前已核部署仍voice-tags，页面用户验收，目标active，usage/计费取消。下方保留历史记录。

2026-10-03本机门禁通过：[0018原视频音画](docs/changes/0018-video-audiovisual/verification.md)。原视频保存/详情显式建立、三模式完整文字问题、精确nested事实与时间来源、完整SHA原视频播放器及两个代理已接。344前端/syntax和55输入绑定、旧324用例保留；后端0029最终2567/878格式/原双80%及六项Native通过。交接入口工作区`.tools/video-audiovisual-handoff`，以实际manifest/validation/审计为准；未部署，网页用户验收、无真实模型/Git写入，usage/计费取消，目标active。下方为历史记录。

2026-10-03当前本机稳定增量：[0017独立声音理解](docs/changes/0017-sound-library/verification.md)。sound完整能力、原声音保存、详情显式构建、typed事实/样本时间来源和播放器、两个精确代理接通；最终324项及语法通过，49输入无变、旧299用例身份多重性保持。完整合法事实UTF8/JSON SHA/LF预算误拒已有真实RED→GREEN修复。registered_revision_id支持无转录原文件，纯声音publication不误触发旧speech向量/摘要。后端0028完整2268/原门禁及5Native通过；交接入口工作区`.tools/sound-library-handoff`，冻结/独立审计按实际manifest/validation/sidecar读取，本切未部署。页面用户验收、无真实模型/Git写入，后续原视频音画检索，usage/计费取消，目标active。

2026-10-03当前本机稳定增量：[0016原声向量入口](docs/changes/0016-audio-vector-retrieval/verification.md)。独立AudioVectorSession/实际详情panel、完整分段费用说明、十字段身份绑定/reader权限/停止后显式刷新、AUDIO完整scope提示与精确代理已实现；299前端及语法通过，后端0027真实Spring/FFmpeg与原链验证通过。未部署，页面用户验收，真实ASR/非语音事实尚未完成；无模型/Git/旧服务器或数据操作，usage/计费取消。

2026-10-03当前增量：[0015原图向量入口](docs/changes/0015-image-vector-retrieval/spec.md)。image-vectors.mjs独立Session绑定完整详情与十字段模型/投影身份；编辑者显式构建，reader只读，整理草稿不重建。仅精确POST获得180秒，GET普通期限，无自动补建/重试；取消后状态未知须刷新，身份/离页隔离迟到结果。287项前端完整回归与语法已通过，44个构建输入绑定。后端0026配套，本image增量未部署；现网voice-tags已含标签/语音（报告只读核对），完整网页用户验收，真实ASR失败保留。无新真实调用，Git/部署归原责任方，usage/计费取消。下方历史快照。

2026-10-03当前增量：[0014语音提问](docs/changes/0014-voice-questions/spec.md)。voice-question.mjs独立Session核对完整文件/转录SHA，显式转录→可编辑全文→明确确认只填问题；保留scope/mode，旧问答与库内来源保持。两个代理精确POST独立28MiB/180秒/2在途，普通限额/身份信任边界保持。275项全量及语法通过，42个前端源码输入绑定未变，后端0025配套，零新增真实调用。当前已部署20261003-scanned-pdf，标签/语音未发布；用户页面验收，usage/计费取消，Git/部署归原责任方。下方为历史快照。

2026-10-03当前增量：[0013摘要建议标签](docs/changes/0013-tag-suggestions/spec.md)。当前可用摘要→读取短标签→勾选→确认原子合并→列表/标签筛选刷新；TagSuggestionSession绑定完整详情/摘要身份并隔离迟到读取/写入。保护整理草稿，不自动保存/重试；不增加模型调用。后端0024配套，页面仍由用户验收，尚未部署。

2026-10-03当前增量：[0012 PDF来源](docs/changes/0012-pdf-sources/intent.md)。PDF答案来源复用已授权sources和document_originals，核对相同document/revision/filename/SHA及完整原字节后按服务器页码打开/下载；java-pdf-ocr-v1明确机器OCR文本，页面不伪造字符框。pdf_ocr_upload启用时提示逐页识别。245项前端回归通过，后端0023与合成扫描PDF本机验收单列；尚未部署，页面验收由用户负责且未执行；前后端冻结交接为工作区`.tools/scanned-pdf-handoff`，部署方选择对应基线补丁并保留open-access定制。

2026-10-03当前开发：[0011文件摘要网页](docs/changes/0011-file-synopsis/intent.md)。已索引真实资料在file_synopsis/synopsis_sources启用时自动读取当前摘要；当前编辑者显式确认后创建独立持久任务。概览/主题/术语/时间线及八类原始依据使用专用摘要来源，不伪造答案trace。新SynopsisSession管理任务轮询、身份/publication、来源SHA与Blob生命周期；刷新不丢整理草稿，离页停止。创建无body，普通10秒；原文件20MiB/帧10MiB。详情与服务器继续按既有权限边界，本轮无真实模型/浏览器/部署/Git写入。

2026-10-03当前开发：[0010查询附件网页](docs/changes/0010-query-attachments/intent.md)。原文字问题可携最多3个临时图片/音频/视频附件，合计20MiB；只辅助检索，库内证据/完整scope/typed来源仍由Java负责。`query_attachments`显式门禁，精确附件POST独享28MiB/180秒/2在途；无附件保持旧入口。身份变更和离开问答释放选择，取消读取不得发送请求。验证进度见对应工件；网页由用户验收，本轮不访问网页或真实模型，不改部署配置/Git写入。usage/计费开发已取消。

2026-10-03当前本机稳定点：[0009原文件与导航修复](docs/changes/0009-document-originals/verification.md)。详情可读保存PDF/文本/图片/音视频并打开/下载，身份/版本/完整SHA通过后展示；详情进入问答/设置清除旧资料，取消脏表单离开保持scope。185项前端与当前Java/精确代理五种原文件贯通通过，公网由用户验收。新交接`.tools/document-originals-handoff`提供最小补丁，独立部署者须保留免登录调整；真实音频质量仍待修复。下方0008等保留历史证据，Git与部署权限边界不变。

2026-10-02当前本地稳定点：[0008音视频网页](docs/changes/0008-audio-video-library/verification.md)与[认证外部入口整合](docs/changes/deployment-external-entry/integration.md)。文档、图片、音频、视频均已接上传/处理/索引、显式证据模式、来源回读；音视频原文件SHA校验后支持按引用时间播放/下载，视频原帧另校验。真实本机Java/FFmpeg/Tesseract与前端Module、JWT入口七条正常链路通过；模型和向量均为loopback替身，不代表真实质量或公网完成。0007/0008及入口当前为未提交工作树，Git写入归专门任务。

用户最新验收目标：文档、图片、音频、视频都要导入/处理/索引→检索匹配→打开对应原文件或来源，并按既有设计提供页码或时间片段；音视频网页属于主线。当前图片只是稳定切片，不能把文本问答、接口存在或loopback结果写成四类整体完成。用户要求先完成主线，保留必要构建与针对性功能验证，完整评测后置，不新增付费实验或检查任务。外部部署使用另一任务的隔离快照，不改本工作树；公网四类真实验收由协调任务负责。

每次先按顺序读对应变更的 intent、spec、plan、REVIEW，再读 [README](README.md)、[AI_CONTEXT](docs/AI_CONTEXT.md)、[ARCHITECTURE](docs/ARCHITECTURE.md) 和 [API_CONNECTION](docs/API_CONNECTION.md)。当前对应0008及deployment-external-entry；0001–0006工件保留各阶段历史，旧“未提交/推送”不代表当前Git状态。既有0003–0005源码已由独立Git任务推送，不等于生产发布。底层索引合同仍见 [0003-text-index-publication](docs/changes/0003-text-index-publication/)。工件和实际路由是 source of truth。

- 每轮只推进一条具名业务主线，正常路径先跑通；非阻塞权限增强、异常组合、性能和通用抽象记录到backlog。复用已有鉴权、ACL、服务器引用校验和无证拒答，不绕过它们，也不因后置增强阻止正常路径交付。进度按用户可实际完成的步骤汇报，不以测试数替代产品进展。
- PDF/TXT/MD上传仍要求text_upload/ingestions，索引要求text_index/indexings；parsed不是indexed/ready。文本问答要求answers/sources同时启用。类型筛选、本地文件预览与合成元数据不代表多模态知识库或生产完成。
- `public/` 导出来源见 [PROVENANCE](docs/PROVENANCE.md)。修改功能必须新建变更工件并保留完整 UI 回归；不要静默覆盖另一仓库的对应文件。
- 小 Interface 隐藏复杂 Implementation。Java 负责身份、ACL、事务与证据；前端不能放宽它们。开发代理不得引入任意目标地址、通配 CORS、任意转发头、无校验 Origin 重写或生产身份声明。
- 不持久保存 JWT，不在浏览器内放 provider key；文档、错误和日志不得含凭据、正文、私钥、数据库、真实主机或私人路径。`.env` 不提交；仅使用明确合成 fixtures。
- 文件 ownership 先明确，共享工作树不回退其他修改；先失败用例或可复现验证，再实现，再完整回归，禁止删/跳过/放宽失败测试求绿。
- `apply_patch`必须匹配完整物理行；段落即使视觉换行也不能只用前缀作上下文。匹配失败后先重新读取相关完整行再修补，不重复提交截断上下文。
- 必跑 `npm run check`、`npm test`；发布时先暂存明确文件，再跑 `npm run check:secrets`、`git diff --check`。扫描器覆盖 index/对应工作树与可达历史，不扫描尚未跟踪文件；shallow 历史失败关闭。
- 浏览器导航或 reload 后读取新状态，旧 refs 不复用；首个失败停止操作序列并重新读取。单测、HTTP stub 和历史截图不替代本次浏览器或生产验收。
- 交付记录 spec 对应行为、红绿证据、测试命令、相关 acceptance、偏离及未验证项。纯导出没有 RAG 行为，RAG acceptance 记不适用而非通过。
- 后续 RAG invariant 保留：文档是数据、ACL 先于模型上下文、完整 selected set 不扩成全库、服务端来源校验、无证拒答、整理不改变证据身份；这些不是本次新增功能。
- 上传仅原始File、1..20MiB、固定精确路由；任务只显示安全字段，不显示正文。单任务轮询必须有epoch/attempt保护并在终态停止；写操作不得自动重试。扩大上传限额不得扩大JSON、Origin、Host、Authorization或Cookie信任边界。
- 索引入口要求text_index/indexings及当前授权行can_index；创建/重试先确认外部嵌入模型与Milvus处理。解析task与indexTask独立，poll只更新各自状态，不自行设置active或问答能力。parsed和indexed终态回读当前授权列表，前者取得服务器can_index，后者核对发布版本；详情只读证据刷新时保留未保存表单。
- 问答必须逐个发送完整所选集合，不能过滤未发布项、吞掉错误或把显式空范围改为全库。旧管理接口can_answer=false是兼容占位，不是新问答入口的资格判定；行/批量入口只固定范围，不宣称该资料已可回答，最终ACL/active与范围由Java校验。
- 问答与来源用纯文本展示，来源只允许服务器精确`/v1/sources/{answer_id}/{1..32}`并复核答案、编号、版本、定位与摘录身份。取消只停止本地等待；身份/范围/新问题使旧响应失效。代理仅POST answers获得180秒期限，普通请求10秒、文本上传30秒；不扩展其他限额或自动重试。
