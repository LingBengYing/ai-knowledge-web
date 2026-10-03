# Review

root已完成本轮实现与回归；现有pdf_config实现代理另外只读核对新增`tag-suggestions.mjs`及`app.js`标签建议接线，并对照后端0024的Domain/Compiler/Service合同进行交叉复核，未发现阻断正常闭环的问题。复核没有运行测试或浏览器，也不代表独立制品审计。

- 来源绑定：GET结果逐项匹配当前document/publication/revision/source SHA、synopsis/input fingerprint/model/摘要policy；候选序号、标签字符和长度、去重及建议指纹经过验证。候选集合由服务器基于完整摘要条目确定，与可变existing_tags分开。
- 明确确认：读取和勾选不写资料；仅编辑者选中尚未存在候选后可应用，POST只发送`suggestion_fingerprint`与`ordinals`。不接受界面自造标签正文，不把候选加入问答事实来源。
- 草稿与合并：有未保存的整理草稿时阻止应用并提示先保存或放弃；成功响应核对同一资料/source/revision/publication后刷新列表和标签筛选。实际原子合并和并发新增标签保留由后端Service事务负责，前端不以PATCH替换标签。
- 生命周期：GET通过AbortController与序号隔离取消/迟到响应；POST发送后明确可能已提交，关闭详情或切换身份只丢弃晚到界面结果。错误不自动重发，也不继续启用过期建议。
- 渲染与传输：候选使用textContent渲染，不创建Blob、外链或执行候选内容；只增加两个精确代理路由，保持普通JSON限额和10秒传输期限。

前端相关126项、完整258项及语法检查通过，具体RED/GREEN和夹具修正见[verification](verification.md)。本切尚未部署，网页由用户验收；不认证浏览器像素、云模型效果或任意资料分类质量，真实模型调用为0。
