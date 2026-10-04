# Verification：已有媒体向量资料的明确重建

状态：FRONTEND_LOCAL_VERIFIED_BACKEND_PENDING；前端本机验证完成，后端0036完整门禁及整包交接尚待root记录。未部署，页面由用户验收，完整目标ACTIVE。

实际新能力 `text_reindex_with_vectors` 与原 text_index/indexings/text_reindex、服务器 can_reindex 共同控制行和详情“重建文本索引”。同发布的 available 图片/音频状态不再永久否决新能力；无新cap的旧服务仍维持原局部否决。确认说明调用文字嵌入模型和Milvus可能产生费用，已有图片/音频向量完整核对后继续使用，不重新生成媒体向量、解析、转录或替换原件；不自动媒体POST或管理读取。

Session.open 与 canRead 的可选 allowPublishedDuringReindex 默认 false。只有新能力、合法旧active publication、已完成且同资料/版本的解析材料、真实一致的新任务状态时，允许 queued/processing/failed/cancelled 期间读取旧向量。真实row身份和serial保持，不能伪造indexed；原build方法字节保持严格条件，不因读资格扩大媒体写操作。新publication仅在授权管理回读后使旧答案/来源/召回失效；新GET严格核对新base十字段，允许继承原独立generation，迟到旧回执不能恢复。当前问题、完整范围及整理草稿保留。

实际新增10个DOM原产品执行：10 run、8 FAIL、2 PASS、0cancel/skip/todo。8个失败是 available 入口隐藏、失败/取消后旧发布向量Session变idle；新publication/旧迟到隔离两项原产品已PASS，不能称其RED。三个产品文件窄修改后，同一10测试字节全部GREEN；两轮各64执行输入前后相同。随后新增12个模块合同用例覆盖显式读许可、默认严格、queued/processing/failed/cancelled、不扩大build、错误来源/任务身份及错publication回执；它们是实现后的补充覆盖，没有独立产品RED。

root实际完整 npm test：472/472，0fail/cancel/skip/todo；npm run check退出0。完整65执行输入前后及当前相同。实际raw日志复算旧450每个用例身份与多重性完整保留；新增22=10DOM+12模块。35个旧.test.mjs文件中34个字节不变；task-detail仅插入一行VM能力开关seam及末尾追加新用例，去除这两个明确增量可逐字还原旧文件。旧无新cap的image/audio available否决两例全部原断言保留。A的保留核对是源和执行证据检查，不冒称对自己产品的独立Spec审查。

证据位于工作区 `.tools/reindex-receipt-preparation`：

- `frontend-receipt-red-first-result.json` / `.log`，RED日志SHA `303d26e961da9aebce5b41d1ec93c8bfe65f1eff42afd84145aaee03ad18b576`。
- `frontend-receipt-green-first-result.json` / `.log`，GREEN日志SHA `7242a7abdd561c0bcae999dc39ef927e03b5f5be444a8d644e274facd8e2a09c`。
- `frontend-full-first-result.json` / `.log`，完整日志SHA `da5173429cc6eeaa5efc0500d25cfc6f8ab46c6198219057b7eff712bb85e908`；`frontend-syntax-first.log`及完整before/after快照。
- `a-frontend-source-retention-review.json`绑定旧450/current472原始日志、完整身份Counter、35旧测试源码、65输入及实际三产品SHA。

无浏览器、部署或真实provider调用；这是合成DOM/模块/传输回归，不认证真实媒体质量、真实Milvus或页面表现。文字召回测试仅检验保存OCR/转录文字；实际媒体参考查询仍须原能力和完整scope，不能由新重建能力放宽。真正嵌入/投影迁移、原文件版本替换及真实ASR质量继续保留，usage/计费开发取消。本草稿不预写后端GREEN、最终JAR或新交接包已冻结。
