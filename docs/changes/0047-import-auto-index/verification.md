# 验证记录

## 范围

- 运行文件仅`public/wiki-workspace.mjs`、`public/wiki-workspace.html`、`public/wiki-maintenance.mjs`：原始资料去除任务卡片与手工索引要求；单次导入由后端0062续接；来源列表批量读取management真实状态；任务菜单恢复自动索引准备/失败。
- `auto_index.pending/dispatching/failed`不伪造索引job、attempt或任务编号；submitted不重复展示。可问状态仍取catalog.answerable，不以解析/派单成功冒充发布。
- 只读轮询在终态/读取错误/离页停止，迟到结果丢弃。未知失败码不回显服务商内容，失败不自动重试。原始资料详情不提供建立索引，历史补建/重建仍在维护详情。
- frontend-dev仅用于沿用已有视觉体系、真实状态与清理行为，未引入新框架/样式/动画。无云模型、生产、数据、提交或推送操作。

## 回归

- 初始来源页用户症状四项真实红测转绿；另一个初始失败来自测试fixture未选择上传类型，已修正fixture而非变更上传校验。原生媒体ready+auto.pending另有独立红→绿，修复错误显示“演示就绪”。
- 自动索引任务菜单三项新测试全部先红后绿：恢复准备→真实任务、失败安全文案、取消迟到读取/读取错误停刷。
- 直接相关workspace/API/maintenance 76/76通过；现有手动维护、重建、失败重试、摘要/媒体/附件协议断言保留。
- 最终完整648项串行回归：646过/2失败，无skip/cancel/todo。两项均为未修改的原测试：external synopsis的30ms请求截止抢先于超大响应检查（504而预期502）；Wiki compilation的25ms普通截止使服务端观察请求3而预期4。本机同时记录load averages 69.11/87.28/63.25，不以负载推断代替失败证据。
- 此前完整645项643过/2失败：dev-server图像向量10ms普通截止返回504而预期200；旧task-detail语音迟到转录测试请求数0而预期1。原始报告保留。最终648中这两项均通过。
- 上述四项按原代码/原断言单列复验：图像向量、synopsis、Wiki compilation三项通过，语音迟到转录仍失败。不是全量全绿，不修改deadline、等待次数或断言洗掉失败。
- 早期沙箱全量因localhost监听EPERM停止；已以单个原有HTTP测试确认是环境权限问题，后续完整回归在仅许可loopback监听条件下运行，不接生产或模型。

## 制品

私有目录`.local/release-0062-20261009/frontend-prep`复用0060真实定制入口基线，仅覆盖上述三文件。227个运行文件中224个字节不变；无配置/数据库/业务文件/日志入包；34个JS语法检查通过；归档regular路径集合和SHA与manifest逐项相等、无AppleDouble。实际定制入口SHA保持`52d3835152f224a31236d81767509e61d8f04b76aae532eb980114301491066d`。

最终实际定制入口299/299通过，归档227项通过，291源码输入在打包前后及验证后一致，模型HTTP0。tar SHA256：`266af68c252df1fe88a5c433887a4a04063614c5c0c6ba004c3c5cef14220ee0`；manifest SHA256：`109d455ba3aafda50aa91cf02f6b737459cb6148c6276d0e88cb91efc9bf9c0d`；源码输入表SHA256：`6ac1359e93a84608cdc2c18e2d76c2ccc0766ebe4693c2554b6862911b38bdfc`。

严格finalizer在完整回归`646 != 648`处拒绝READY，前述身份/入口/归档断言已通过。制品保持PREPARED_NOT_VERIFIED，完整发布门禁未通过；root须单独决定旧失败处理与发布边界。本机前端浏览器、后端真实自动发布、生产尚未由本切验收。
