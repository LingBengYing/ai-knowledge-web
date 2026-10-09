# 0043 行为合同

- 进入问答读取 GET `/v1/knowledge-agent/config`。明确 `enabled:false` 保留现有 `knowledge-answers`；开启后创建 Agent run，不因配置读取或运行失败静默回退。
- POST `/v1/knowledge-agent/runs` 仅发送 `question,request_id`，request_id 为新 UUID；GET `/{id}` 只读轮询，终态停止。POST `/{id}/cancel` 发送 `{}`，只在服务器确认 cancelled 后称已取消。写请求不自动重发。
- run 含 `id,status,events,result,suggestions,error`。状态 running/completed/failed/cancelled；事件仅展示 Java 安全操作类型 running/planning/searching/reading/completed/failed/cancelled，不显示模型思维链或任意扩展字段。
- 运行时显示进度与停止；完成/失败/取消终态的完整事件列表放入默认折叠的“查阅过程”，最终答案优先呈现。
- 最终 result 必须通过现有统一知识答案与引用校验，来源阅读和存为草稿复用原功能。维护建议独立默认折叠，仅显示 title/reason/document_ids，不自动创建、编译或采纳。
- 重复提交、新会话、离页、取消采用当前运行与异步票据隔离。请求结果未知时显式只读刷新，不自动重发。问答轮询更新不打断问题输入。
- 两个代理仅开放四条精确 API 路由与新静态模块，保留现有 Session/Origin/Host/JSON 限额、普通期限；拒绝 query、扩展路径、内部回调。

真实 DB-GPT/Java/浏览器联调由 root 记录；前端协议与 DOM 测试不认证真实模型质量。
