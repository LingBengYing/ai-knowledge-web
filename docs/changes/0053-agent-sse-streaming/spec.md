# 前端合同

- 对接后端0072 GET /v1/knowledge-agent/runs/{id}/events；snapshot/terminal 帧的 data={revision,run}，run.preview 是未确认的累计回答。
- fetch SSE 保持同源 Cookie/身份；解码分片 UTF-8、跨块事件和注释心跳，按 revision 更新，不重复 POST 问题。
- 思考仅实际模型输出，运行时可展开且尊重手动折叠；正文预览显示生成中，来源及保存草稿仅来自终态正式 result。失败/取消移除临时回答。
- 创建/取消继续普通 HTTP；刷新先读取会话/任务并附着同一流。断线不自动重新执行问题，允许只读恢复，不保留定时轮询 fallback。
- dev-server 与 external-server 精确 SSE 路由逐块转发/背压/flush，no-cache 与 X-Accel-Buffering:no；其他代理鉴权、路径和限额不扩展。
- 不把模型输出作为 HTML 或任意链接执行，保持现有转义、详情展开和焦点状态。历史无增量字段记录仍可正常阅读。
- 本机真实 HTTP/页面首块必须早于上游结束；不以单测或合成模型宣称生产/真实模型质量通过。
