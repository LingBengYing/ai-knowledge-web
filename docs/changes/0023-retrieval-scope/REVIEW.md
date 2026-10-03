# Review：范围入口与问答门禁分离

状态：LOCAL_VERIFIED。A 只读确认 app.js 的 openAnswers、batch-ask、资料行、详情及 answer-all 错把范围导航等同新问答能力；文字模式选项和 RetrievalSession 已独立支持 retrieval_test。因此仅调整这些入口和对应提示即可，无需增加新的召回协议或模型调用。C 合同及 draft 静态复核无阻断。

合同保留 null / 显式 [] / 完整所选集合、服务器整次拒绝及原导航取消语义；不把管理 can_answer 的兼容占位作为范围资格。C 已只读核对 23 份公开合同、实现与测试并绑定 0034 字节：内部 null 省略字段，wire null 返回 422，全部范围取当前授权的 active publications，完整所选集不做前端裁剪；模式或范围变化使迟到结果失效。报告为工作区 `.tools/retrieval-scope-preparation/c-scope-contract-review.json`，SHA ab06f13b9cd644d201f9e0b86088044b2ccfb80acded674ac685544c0d76d629。B 的四项 DOM 断言由 root 原文追加；旧实现实际四项入口/模式断言 RED 后，最小修复令同一测试源码四项 GREEN，全量 435 通过。RED 未到达的全库/迟到断言仅计 GREEN 实际覆盖，不冒充独立 RED；静态审查也不替代执行或页面验收。
