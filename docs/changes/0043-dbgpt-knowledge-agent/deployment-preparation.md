# 0043 生产前端制品准备

2026-10-09，负责人明确授权生产发布。本文记录前端准备与本机验证；服务器操作、生产切换和最终公网结果由主任务记录，不以本文代替部署成功证据。先前仅本机、不部署的边界在本次发布授权前有效。

## 实际入口与制品

- 核对真实线上 `external-server.mjs`：SHA256 `d47c6fd3e5a01cbafd2095e2b93d801726376d070fc4fcb6455e2336cc3e2ff2`，与0054留存完全一致。发布入口基于这份真实文件，只叠加 Wiki 静态/精确 API、Agent 四条 API、Wiki 限额/期限和首页选择；免登录签名、身份声明及会话逻辑逐块保持原字节。
- 仓库标准 `external-server.mjs` 增加 `RAG_WEB_WIKI_ENTRY=true`（默认false）选择真实 Wiki 首页，仍保留标准会话要求。实际发布定制入口使用同一开关，保留原 `RAG_OPEN_ACCESS_ENABLED`、`RAG_JWT_SECRET`、`RAG_PUBLIC_ORIGIN`、`RAG_WEB_BACKEND_ORIGIN`、`RAG_WEB_PORT` 配置。
- 生产以 `node scripts/external-server.mjs` 启动。根路径为 Wiki，`/classic/` 保留原管理页；不以 `wiki-workspace-server.mjs` 开发入口发布。公开入口继续18443，443属于其他应用，本次不改。
- 独立制品目录：`/private/tmp/knowledge-agent-frontend-0057.qQ1AiH/`。`frontend.tar.gz` 包含225个运行文件，PDF资源保持完整；不含密钥、环境文件、预览假数据或开发server。包内无安装依赖，使用既有Node22运行。
- `frontend.tar.gz` SHA256：`d1417b676c2f8edb6151bef8deb32a7a48e285a8a2162a3730f92e0bff862800`。
- 实际发布入口 SHA256：`63e5375843a41ba6e5d6bea8d5e1780d0c59ed87315230d4a0195c703fb6f6b2`。
- `frontend-files.json` SHA256：`af91c8b547c50dbd31ff3ad713d85439d16e6590fda4faedcd6355dc349db817`，逐文件路径/字节数/摘要；`entry-changes.json`列出10处精确替换，可逆回实际线上基线。去掉原有免登录定制后，发布入口与本轮仓库标准源码逐字节一致，其余制品均与本轮工作树逐字节一致。

## 本机验证

- 生产首页开关两项断言先失败（选项缺失、返回旧首页）；修复后纳入完整串行回归。未改变原默认入口行为或会话要求。
- `PATH=/Library/Developer/CommandLineTools/usr/bin:$PATH npm run check` 通过，日志 `/private/tmp/knowledge-agent-production-check.log`。
- 完整串行命令 `PATH=/Library/Developer/CommandLineTools/usr/bin:$PATH node --test --test-concurrency=1 ui-tests/*.test.mjs tests/*.test.mjs scripts/check-secrets.test.mjs`：586项，585通过/1失败/0跳过，日志 `/private/tmp/knowledge-agent-production-full-serial.log`。唯一失败为旧 `ui-tests/task-detail.test.mjs:1109` 图片来源打开后等待20ms断言可见，实际仍隐藏。该路径先异步核对Blob SHA再显示；没有删改断言、等待时间或校验逻辑。
- 同一完整 `ui-tests/task-detail.test.mjs` 原样独立复验121项为120通过/1失败/0跳过：原图片断言通过，另一个旧原文件导航用例在第306行未取得下载链接；其等待助手只执行5次setImmediate，不保证异步WebCrypto已就绪。该复验结果与计时/就绪敏感一致，但未在失败现场记录终态，不将推断冒称已确定根因。日志 `/private/tmp/knowledge-agent-production-task-detail-recheck.log`。不继续反复重跑挑选全绿，也不以不同轮次拼出完整通过。
- 最后合成Cookie夹具已在并行工作树改成公开占位值；没有改变扫描器。最后完整Wiki传输文件11/11通过，日志 `/private/tmp/knowledge-agent-production-wiki-transport-final.log`。
- 实际待发布入口219项loopback检查通过：匿名Wiki根页/旧管理页、全部Wiki模块和188个PDF资产逐SHA、共享会话、四条Agent API、Wiki查询/编译/草稿CAS/版本来源、Origin/方法/伪造身份边界、拒绝 `/internal` 回调及预览假数据。固定合成内存密钥，无云/模型调用；证据为制品目录 `entry-verification.json`、`entry-verification.log`，验证的是待发布包内入口。
- 主工作树原 `npm run check:secrets` 报告已有index内合成Cookie夹具；当前工作树该行已修正。扫描器主动清除GIT环境变量，因此不用无效的GIT_INDEX_FILE方式。独立本地Git副本复制当前523个tracked文件并暂存副本，保留原10个历史提交身份集合；原扫描器 `--history --repo <副本>` 输出 `[]`。主index未写入。实际225文件制品再经独立Git副本原扫描器输出 `[]`。日志为制品目录 `source-secrets.log`、`runtime-secrets.log`。

## 尚未代表的验证

本机入口替身验证不认证实际模型质量、生产新资料问答或长期稳定性。前端准备过程未连接服务器、未写旧资料、未发收费模型请求；真实生产启动、免登录页面与Agent配置回读由主任务负责。单轮完整前端仍保留上述失败事实。
