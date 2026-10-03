# 开发接力交接 — 2026-10-02

本文件是原开发任务的安全停点记录，不是生产验收。完整目标仍为单组织、多模态文档/图片/音频/视频RAG实现、真实评测及生产部署；不能缩减为当前文本网页功能。按换机接力协调请求已停止进一步实现，未启动另一台设备。无密钥、私钥或真实业务资料随本交接提交。

## 已完成且可接力的稳定成果

[0006](changes/0006-grounded-answers/verification.md)已实现独立`#/answers`，全库/完整所选范围、单次请求、加载/取消、无证据拒答、服务器引用身份复核及原文回读；修补解析终态列表刷新及旧can_answer=false占位阻断入口。浏览器走通固定合成PDF导入→解析→显式索引→仅所选1份提问→650元答案→同版本原文/页码/码点/SHA；空库业务拒答正确。

最后源码验证为`npm run check`与`npm test`139/139通过，失败/跳过/取消0；详情文件33/33、问答Module17/17、开发代理26/26。独立只读审查未发现文本主线具体阻断。当前源码未改动，交接阶段不重复同一全量。正式发布仍需Git任务对明确暂存集合扫描；旧空index扫描不认证新增文件。

浏览器是当前Java源码编译的RagApplication、真实Spring/SQLite、解析/索引子JVM；模型与向量服务是本机HTTP协议替身。不是旧JAR应用classes，也不证明真实provider语义质量或真实Milvus整链。`/health/ready`仍503 migration_incomplete。源代码、合成数据和截图保留；本轮Java/Node进程已停止，接力时应先验证端口，不复用历史PID/session。

## 图片主线的准确停点

[0007 intent/spec/plan/REVIEW](changes/0007-image-library/)仅四份规划工件；未改生产或测试源码、未写RED用例、未运行图片测试或浏览器流程。Module子任务只读且已停止，没有后台进程；代理任务尚未启动。不要把0006结果写成图片网页已完成。

已核对Java实际合同：

- 新图上传能力为`image_text_upload`或`visual_image_upload`，任务复用`ingestions`；OCR原图回读要求`source_image_content`；索引仍复用`text_index/indexings`，不存在image_index。
- POST `/v1/documents?filename=...`发送原PNG/JPEG，Content-Type严格`application/octet-stream`，1..10MiB、1200万像素；文本仍1..20MiB。同时开启OCR与visual时新图固定走visual，不双编译、不作OCR异常降级。后台验证实际格式。
- OCR问题用POST `/v1/answers`、GET `/v1/sources/{answer_id}/{1..32}`及`/content`；旧12字段文字citation保持，source可附image与相交ocr_word区域，码点区间不是字符级图框。
- 纯视觉问题用独立POST `/v1/visual-answers`、GET `/v1/visual-sources/{answer_id}/{1..32}`及`/content`；image_region整图引用有尺寸/MIME/模型与策略版本，没有page/start/end/quote。caption只召回，不作事实证明。
- 两种metadata/binary读取都重新授权完整当前scope/ACL/active，只能读原回答者来源；不自由生成URL或复制证据位置。原图无Range合同。
- 管理/任务DTO不公开parser revision，因此页面必须显式选文字/OCR或原图视觉模式，不能由当前开关推测旧记录。所选全部ID原样发给Java，`[]`不能变全库。

恢复后的下一步：按0007补RED→分别实现Module/精确代理→页面上传、模式、typed原图与服务器词框→focused/完整回归→实际OCR与纯视觉浏览器闭环→独立审查和项目MD。非阻塞组合异常/权限增强/性能后置；音视频、持久摘要、查询附件网页仍排在后续主线，不从完整范围删除。

## Git范围与边界

交接核对时两个仓库均为main。本仓库HEAD为`2c16abe0e6c451fe4ba7d8400e2f92b92e54ad52`；配套Java HEAD为`26f9c43c6d5173a372fad73e96c088c4eb00caae`且工作树干净。它们是本机快照，本记录不新证远端或未来push成功。

本仓库待Git专门任务处理的稳定范围：

- 16个既有tracked修改：AGENTS.md、CONTRIBUTING.md、README.md、SECURITY.md、docs/AI_CONTEXT.md、docs/API_CONNECTION.md、docs/ARCHITECTURE.md、docs/VERIFICATION.md、llms.txt、public/app.js、public/index.html、public/styles.css、scripts/dev-server.mjs、tests/dev-server.test.mjs、ui-tests/markup.test.mjs、ui-tests/task-detail.test.mjs。
- 新增：0006目录五文件、public/answers.mjs、ui-tests/answers.test.mjs。
- 仅规划/交接新增：0007目录四文件及本HANDOFF.md；不能以功能完成提交描述它们。

Git写入只交由既有专门任务处理。此开发任务没有stage/commit/push/reset/merge，也不动顶层Python工作树、Java内置页面或旧数据。交接后须重新读实际HEAD/status，避免把本段快照当作实时状态。

## 非敏感环境与复现

前端为原生HTML/CSS/ESM、Node22+，无第三方npm依赖或构建步骤。在本仓库运行`npm run dev`，字面loopback前端18085、Java18084；可用RAG_WEB_BACKEND_ORIGIN/RAG_WEB_PORT指定其他合法loopback端口，NODE_ENV=production拒绝启动。前端永不接收provider key。

Java使用JDK21。文本本机联调的最小业务配置为test环境、development_headers、org-main/owner、新的空SQLite目录、ingestion/indexing/answers显式启用，并配置本机生产Client所连接的测试服务。不可直接用私人密钥恢复云模型；新增真实云实验必须具名授权，不挪用旧余额。真实生产不能使用development_headers或开发Node代理。

原机私有联调工件位于工作区根的`.local/mainline-web/`，不在两个Git仓库：完整本机路径/一次性构建说明见该目录HANDOFF-LOCAL.md。现有run目录包含当前Java编译classes、43个已有JAR运行依赖、两个已有public协议fixture、harness及源码/资源/依赖SHA清单。build.sh是一次性脚本且含原机路径，不可在mini直接照抄或覆盖运行classes。另一台机器应核对已安装JDK/Node，使用新目录重建/按清单复制仅合成联调工件，不重新安装全部环境或迁移旧业务数据库。旧RUN.md的PID与“尚未执行”是启动历史，不能据此认定仍在运行。

运行/停止：Java私有harness只接受一个**已经存在且为空**的数据目录，按私有说明在前台启动；前端另一个终端运行npm run dev。结束按Ctrl-C/SIGTERM，确认harness关闭日志和该次实际PID/端口消失后再换制品。不能复用历史exec session或不检查身份就kill端口占用者。默认前端/后端端口当前未监听，本交接没有重启它们。

接力验证命令：`npm run check`、`npm test`；发布时使用显式CommandLineTools Git，准确stage范围再`npm run check:secrets`及`git diff --check`。需要Java默认回归时用独立构建目录、JDK21和仓库`.mvn/settings.xml`，不在运行中的target JAR重打包；没有Java生产改动不重复整个历史验收。浏览器必须核对当次页面状态与实际refs。

## 尚未完成的真实目标

图片/音视频网页、持久摘要与附件问答网页尚未接通；完整真实provider/Milvus质量、同生产镜像验收及目标主机生产发布均未完成。0019音视频真实评测累计6/20、下一具名实验未获自动继续授权，失败即停/无重试、安全样本与金标保持，不因为换机重置台账或复跑。生产gate不解除，不能把本地功能测试、git push或设备环境安装当作上线完成。

## Mac mini 续接：0007图片稳定切片（2026-10-02）

用户已明确继续接力，Air任务停写且最终前端基线f200f0b已同步。上方暂停、0007仅规划、0006待推送为历史；当前只改独立前端，Java基线仍26f9c43c，未改生产Java/Python或旧数据库。

图片切片已实现：PNG/JPEG能力门禁上传→原有解析/索引→显式文字/OCR或原图视觉提问→typed来源→原图字节SHA复核→显示/下载，OCR显示服务器词框，视觉定位整图。当前Java Spring/SQLite及真实Tesseract、前端createApi/AnswerSession/开发代理两条完整链实测通过，模型/Milvus是loopback协议夹具。页面函数回归通过，本轮尚未实际浏览器验收。详见[0007 verification](changes/0007-image-library/verification.md)。本机工具沿用项目根安装，无重装。

用户最终主线验收：四类素材都须导入/处理/索引→检索匹配→打开对应原文件/来源，适用时有页码或时间片段。现状：

| 类型 | 当前实证 | 下一步／未完成 |
| --- | --- | --- |
| 文档 | 0006合成PDF网页问答/页码原文回读 | 真实provider/Milvus和公网检索；不能把文本摘录视作通用原PDF下载 |
| 图片 | 本切真实Java/原生OCR+前端模块OCR及视觉链、原图SHA一致；页面显示回归 | 当前浏览器显示、真实图片检索质量及公网原图访问 |
| 音频 | Java已有audio-answers/audio-sources、服务器时间段与原音频Range | 前端上传/显式音频提问/原媒体播放器与时间定位未接，属于主线 |
| 视频 | Java已有显式视频上传及visual/transcript/joint/ocr/subtitle、typed帧/时间/原视频 | 前端视频模式/检索/帧与原视频播放未接，属于主线 |

按用户最新优先级，先顺序完成图片→音频→视频，保留必要构建/针对性功能验证，全面评测后置，不新增付费实验或检查任务。公网四类真实检索与原素材验收由协调任务浏览器执行。部署任务仅改隔离快照，不能写本live工作树；不触碰其目录。

0007待Git任务处理的稳定文件：AGENTS.md、README.md、docs/AI_CONTEXT.md、docs/ARCHITECTURE.md、docs/API_CONNECTION.md、docs/HANDOFF.md、0007的plan/REVIEW/verification、public/api.mjs、public/answers.mjs、public/app.js、public/index.html、public/styles.css、scripts/dev-server.mjs、tests/dev-server.test.mjs、ui-tests/task-detail.test.mjs、ui-tests/image-answers.test.mjs。验证记录新增，其余0007 intent/spec未更改。无音视频WIP混入。主任务在Git快照完成前暂停写这些live文件，只读核对后续接口；由协调方确认快照后继续，开发任务不执行Git写入。

## 2026-10-02 音视频与认证入口整合稳定点

0008已接音视频上传、显式证据模式、原媒体/帧SHA、播放器片段定位和释放；外部入口已与四类精确路由/预算整合。当前Node173、Java28针对性、JAR认证1项、JWT入口真实Java/native七条正常链通过，详情见[整合验证](changes/deployment-external-entry/integration.md)。上方“音视频未接/只改前端”是历史；本轮后端仅小范围0020入口补丁，Python/旧数据/部署隔离源目录未改，Java静态资源未同步。

本地只读导出依据在项目根.tools/four-type-entry-handoff：完整SOURCE-MANIFEST、变更文件快照与哈希、源补丁导入记录及当前JAR指纹。图片.tools/image-handoff-snapshot和音视频整合前.tools/media-pre-entry-snapshot均保留。导出必须匹配live清单，不以HEAD的旧文本快照代替未提交四类改动；Git任务仍需相应授权/发布扫描，不绕过自动审批拒绝。

真实模型端点/模型名/凭据及embedding维度revision、真实隔离Milvus database/java_集合、服务器native工具、JWT/TLS/公开Origin均尚未注入/验收。没有真实付费调用；公网四类浏览器验收由协调方负责，整体生产未完成。
