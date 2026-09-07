# Spec

1. 必须同时有`text_index`、`indexings`两个服务capability且当前授权行`can_index=true`，才显示建立索引入口。真实资料必须为parsed、无已有索引任务和active版本；合成资料不参与。已有任务打开当前行的索引任务，失败或取消仅按服务器can_retry重试，不重复创建。
2. 建立及重试索引使用现有dialog，说明文本会发送到配置的嵌入模型和Milvus、可能产生费用以及问答仍不可用；用户明确确认后才POST。浏览器没有模型key，不直接调用provider或Milvus。
3. POST `/v1/documents/{id}/index`、GET `/v1/indexings/{id}`、POST `/v1/indexings/{id}/cancel`及`/retry`均无query/body。代理仅增加这些精确路由，ASCII ID与现有128位约束相同；不允许编码ID、尾部路径或其他动作。普通10秒deadline、128KiB读取上限、4MiB响应、鉴权/Origin/Host/Cookie边界均不放宽；写操作不自动重试。
4. 解析`task`与索引`indexTask`独立；状态校验不混用parsed/indexed，read ticket kind不能跨链。索引任务只允许queued/processing/indexed/failed/cancelled，attempt为1..3，字段严格白名单。单面板按kind切换，约1.5秒轮询当前pending任务，终态停止；身份/列表上下文变化或切换任务使旧票据失效。
5. 两链均保持任务/资料/revision身份校验、attempt与终态单调、列表和面板双向合并。详情重开从当前授权行查任务，不读取闭包里的旧attempt，不插入服务器未返回的资料。索引创建前捕获的旧列表在同一解析版本下也不能隐藏已知任务。
6. 索引poll只写`index_status/latest_index_job`，不修改解析status/latest_job，不自行设置active_revision_id/index_publication_id/can_answer。两链accepted poll同步刷新当前授权详情的只读字段，包括failed/cancelled；indexed后重新读授权列表取得发布信息。取消/重试成功后的列表刷新也保留未保存表单，授权页移除和身份变化仍立即清除详情。已发布资料与其解析任务不能显示“未索引”；问答始终禁用。
7. 六静态文件与Java内置页面显式同步。保留既有回归，增加状态、能力、详情、发布标签、精确proxy与失败不重试验证。Node测试不认证真实Java/provider/Milvus、浏览器、RAG golden或生产。
