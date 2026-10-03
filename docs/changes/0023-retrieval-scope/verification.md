# Verification：召回范围基本操作

状态：LOCAL_VERIFIED。仅改变 app.js 范围入口资格、当前文字模式保持及能力文案；原 Session、API、代理、生成/附件/来源门禁未改。新增四项测试原文追加，原 431 项测试身份多重性及旧 task-detail 全部字节保持。

实际运行顺序及原记录位于工作区 `.tools/retrieval-scope-preparation`：

- 首次命令输出路径错误，Node 尚未启动；`scope-red-first-command-error.json` 单列，不计业务 RED。
- `frontend-scope-red-second.log` 实际 4 项 / 4 失败，SHA b6254b408b049a9c6a2a33e8c0b19d31e18efe70d8667fa400f824a404566fa6。产品与 0034 字节完全相同，仅增加四项测试；失败为行/批量/详情入口缺失与文字模式误切视觉。后续断言当时未到达。
- 最小修复后，完全相同测试源码的 `frontend-scope-green-first.log` 实际 4 项通过，SHA b797b88159a68da188b3ad47e28c9dbcf898b47955368e1149261aa43bf040ae。单份、包含未发布项的完整多选、错误后无重试、详情取消与确认、明确全库切换后的迟到隔离和文字模式保持全部到达。
- `npm run check` 与 `npm test` 实际 exit 0。`frontend-full-first.log` 共 435 PASS，零失败/取消/跳过/todo，SHA 354ba3b83add5416e4eb5177ed2ab410742aaab3c19244a37bf95f9adca77d1b；执行前后完整 64 个输入相同。原 431 个具名用例逐个保留，只加四项。语法日志 SHA 6c1661f147f54c17396bdacbf3a2bdfab5184b719a7ea08cecaa7d8919676408。

每条 Node/npm 命令均显式使用 CommandLineTools PATH。命名筛选只用于四项 RED/GREEN；全量没有跳过原测试。结果解析助手最初误认 Node 默认 reporter 为 TAP，修正为实际 spec 后重新读取原日志；两次元数据解析错误保留，未改变测试或重跑求绿。

基线为工作区 `.tools/media-role-switch-handoff`，源码及证据已经冻结并独立审核 PASS；本切实际逐字核对完整 1032 个后端执行输入及最终 JAR 不变。后端 3075、六 Native 和 Node 73 均明确复用原实跑证据，本切未重新运行 Maven/原生链。JAR SHA a5a6f00b3197a199e6470a39d6a3fea7e741ed7040bcea4ba44be240c8fbb457。页面由用户验收，真实 provider、浏览器和部署仍 NOT_RUN，目标继续 active。
