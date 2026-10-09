# 新版工作台补齐验证

2026-10-09，Web0046 / Java-Python0060。本地功能交付，不是生产发布或模型质量验收。

## 用户可见结果

- `#/retrieval` 原生召回测试：真实配置、临时检索方式/排序/权重/Top K/阈值、原始得分、命中版本和同版本 SHA 原件核对。进入不发送查询，显式一次提交，无费用弹窗或重试。
- `#/documents` 与 `#/documents/{id}` 原生列表/独立详情：筛选分页、名称/目录/标签、批量整理/重建/清理、新版本上传、摘要/建议标签以及现有媒体索引 Session。
- `#/directories` 原生目录管理；`#/tasks` 从服务端资料行恢复最新解析/索引任务，支持实际允许的取消/重试。不是完整历史任务列表。
- 原始资料和设置中的整理入口已替换为新路由，详情保留确切 document_id；旧 classic 仅作兼容入口，不再是新版业务链接。
- Agent 固定中文原因说明、任务 UUID 和安全原因码。Java/Python 详细结果见后端0060 `agent-verification.md`。问答算法未修改，旧线上502原因不能恢复。

## 验证

1. 根路由、业务链接、错误详情3项首次 RED；旧代码分别为 missing、classic 链接、丢失原因/任务编号。修复后整个 `wiki-workspace.test.mjs` 39项通过，含真实模块挂载、离页取消和加载失败可刷新。
2. 召回新模块17项通过，含真实本机 HTTP → createApi → RetrievalSession → 同版本原件/二进制 SHA。29项既有依赖回归也通过。
3. 维护新模块15项通过，覆盖正常写入、最新任务重载、已有 Session 接线和离页处理；复用既有模块而非改写其协议。
4. 完整前端在 Git CLI 与 Node 22.23.2 的已核对 PATH 下执行 `node --test --test-reporter=dot ui-tests/*.test.mjs tests/*.test.mjs scripts/check-secrets.test.mjs` 最终 exit 0；语法检查与 diff whitespace 通过。此前中间整轮为627/627，后续维护新增验证后再次完整通过，不能用中间数替代最终用例集合。个人运行路径在公开工件中脱敏。
5. `tests/wiki-transport.test.mjs` 14项通过，实际开发/外部入口精确提供两个新模块，保留认证和路径/方法约束。
6. Agent Java39、Python18、前端6项通过；Java共享OpenAI transport23项完整回归保持。不是Java全仓发布门禁。

## 真实浏览器与HTTP

- 独立临时SQLite + 不可变0059生产JAR（无模型配置）运行于18095，新前端18094。合成TXT上传/解析、目录/整理、原件、候选版本替换、另一个合成清理样本与任务恢复实际HTTP通过；不碰用户旧资料。
- 可复现验收脚本保存在工作区`.local/wiki0046-maintenance/live.mjs`；Node22执行最终exit0，输出上述8项passed/model_calls0。脚本只允许专用新临时数据库，不能对18090/18092/生产运行。首个损坏DOCX样本在上传时已422，未成为失败任务；更换为带PDF头的损坏合成PDF验证解析失败任务，不改生产解析器或降低断言。18094/18095验收完已关闭，临时数据保留。
- 浏览器在18094完成资料改名保存、同版本原件阅读、任务跨页恢复、reload后失败任务UUID/原因保留、目录页读取。发现保存后h1未同步，已修复并再次实际保存验证；表单草稿不被Session刷新覆盖。
- 浏览器18090连接原有18092，读取实际检索配置。显式临时 `full_text + weighted`，Top K5/阈值关闭，执行两次查询；确定该分支不调用嵌入/重排/生成，仅调用Milvus只读BM25。未保存或改变全局检索设置。
- `灯塔` 返回正常 empty，全库1份/0片段；catalog原文确有该词，中文全文召回质量问题仍开放。随后用同一合成原文中的 `Wiki` 验证链路，命中 `fixture-cedar.txt`，BM25=0.2876821，未重排；点“核对同版本原文件”成功显示原文及下载链接。该英文命中不替代中文验收，不把空结果说成成功命中。
- 根因高置信推断：后端`MilvusSchema.java`38–39固定standard、144–151校验相同类型；`MilvusRestProjection.java`118锁定standard-bm25身份。Catalog是子串查找，而BM25依赖分词；[Milvus standard tokenizer文档](https://milvus.io/docs/standard-tokenizer.md)说明连续中文整体成词。尚未对实际部署执行run_analyzer；更换分词涉及索引迁移/重建，不在本切自动修改旧索引。
- 页面截图：`browser-maintenance.png`、`browser-retrieval.png`。本轮未验证PDF像素渲染、真实生成/语义重排或线上Agent故障消失。

## 运行与边界

- 本地18090前端已重启加载新资源，仍接原18092；既有Java/Agent进程及其数据未重启/改写。后端0060诊断源码及测试已完成，但未制作/切换运行包。
- 云模型HTTP 0；没有重发用户失败问题、不使用旧额度、未提交/推送Git、未部署生产。
- 旧Java全仓ACL失败与生产 readiness/真实RAG验收仍按原记录开放。本次不以页面迁移关闭这些事项。
- 后续事项：中文BM25分词/索引行为、完整历史任务接口、真实模型质量及授权发布。若需改变现有索引/重建资料，先明确范围，不在本切自动执行。
