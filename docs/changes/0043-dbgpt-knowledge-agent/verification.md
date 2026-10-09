# 0043 前端验证记录

后续负责人已明确授权生产发布；生产external入口、免登录定制保留、最终制品与本轮串行/扫描结果另记 [deployment-preparation.md](deployment-preparation.md)。本页下列“未部署”描述的是先前本机实现阶段。

## 本次实现

- 独立 `knowledge-agent.mjs` 封装配置/运行 JSON、固定安全事件类型、一次写入、只读轮询、取消与迟到响应隔离。统一答案直接复用 `answers.mjs` 的 `checkedKnowledgeAnswer`，仅将该既有函数导出，不改引用验证逻辑。
- Wiki 问答读取明确配置；关闭保留原问答，开启走 Agent，不对配置读取或运行失败静默回退。完成结果复用引用阅读及服务器草稿保存。维护建议默认折叠，仅列真实关联资料入口，不自动生成提案或采纳。
- 更新操作进度只更新会话内容与发送按钮，不重建问题输入框。清空/离页使旧请求失效；已知任务可显式只读刷新。页面没有服务密钥、模型思维链或常驻开发说明。
- 共用 Wiki 精确传输表新增四条 Agent 路由和单一静态模块；dev/external 两个代理复用现有身份、Origin、普通 JSON 限额和普通期限，无 Python/internal 回调透传。

## 红绿与检查

- 新 Agent JSON/生命周期用例首次运行因功能模块尚不存在而失败；实现后 5/5 通过。
- 新问答 DOM 3 项在旧实现全部失败（未调用 Agent、无进度区域）；接线后同 3 项通过，旧断言保留。
- 直接相关命令：`PATH=/Library/Developer/CommandLineTools/usr/bin:$PATH node --test ui-tests/knowledge-agent.test.mjs ui-tests/wiki-workspace.test.mjs ui-tests/wiki-workspace-api.test.mjs tests/wiki-transport.test.mjs`，56/56 通过。HTTP测试只监听 loopback 临时端口；初次沙箱禁止监听产生 EPERM，经授权环境运行后通过，不计产品失败。
- `PATH=/Library/Developer/CommandLineTools/usr/bin:$PATH npm run check` 通过。
- 完整 `PATH=/Library/Developer/CommandLineTools/usr/bin:$PATH npm test`：586 项，579 通过、7 失败。6 项为旧 dev/external/cleanup 代理短期限状态差异，1 项为旧音频播放 DOM 异步未就绪；没有删除/跳过/改断言。日志 `/private/tmp/knowledge-agent-frontend-full.log`。
- 原样完整串行 `PATH=/Library/Developer/CommandLineTools/usr/bin:$PATH node --test --test-concurrency=1 ui-tests/*.test.mjs tests/*.test.mjs scripts/check-secrets.test.mjs`：586 项，585 通过、1 失败；原7项已过，剩余 `tests/external-server.test.mjs:100` 的旧文件摘要 30ms 期限用例，预期响应超限502，实际期限504。日志 `/private/tmp/knowledge-agent-frontend-serial.log`。
- 其他前端测试退出后，原样完整 `tests/external-server.test.mjs` 独立复验 34/34 通过，期限及全部断言未改变。日志 `/private/tmp/knowledge-agent-frontend-external-recheck.log`。这些结果证明旧用例对调度敏感，不构成单轮完整全绿声明。
- root 实际页面反馈完成后事件过长，最后将完成/失败/取消的查阅过程默认折叠，保留所有事件。新增完成态 DOM 断言先 RED；最终完整 `ui-tests/wiki-workspace.test.mjs ui-tests/wiki-workspace-api.test.mjs ui-tests/wiki-model-sessions.test.mjs` 为43/43通过（`/private/tmp/knowledge-agent-frontend-final-ui.log`）。这是低影响渲染修改，按root指示不重复全586项；上述完整结果均发生于此最后渲染修改前。

本轮编辑时系统 `python3` launcher 提示 Xcode license，未接受许可；使用已有 `/Library/Developer/CommandLineTools/usr/bin/python3` 完成编辑，该工具环境报错不计产品失败。

## 边界与偏离

- 前端测试仅证明 JSON/生命周期、DOM和本机 HTTP 代理合同；实际 DB-GPT Python + Java + 浏览器验收由 root 另记，不以这里的协议替身结果认证真实模型质量。云调用 0、未部署、未改旧数据。
- 创建任务响应丢失时，浏览器只有 request_id；后端 run.id 是独立 UUID，尚无按 request_id 只读恢复。页面明确状态未确认，不自动重发 POST。已取得 run.id 后的状态/取消丢响应可 GET 核对。
- 离页、清空会话仅停止本地等待与轮询，不伪称服务器已取消；停止按钮等待服务器返回 cancelled。整页重新加载后的运行恢复尚未新增。
- 维护建议不进入事实证据或自动知识更新，正式版本仍沿现有提案与采纳机制。
