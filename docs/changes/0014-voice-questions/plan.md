# Plan

1. 冻结0014正常路径和后端0025传输/结果合同。
2. pdf_config独占新voice-question.mjs和ui-tests/voice-question.test.mjs；root拥有app/index/styles、两个代理/其测试及实际app DOM正常链。
3. 先RED后实现；保留全部有效旧用例。确认只填入文字问题，后续调用既有AnswerSession，保护手工问题和完整scope。
4. 相关GREEN后npm check/test与新交接，页面由用户验收，保留部署open-access定制。

阶段：正常路径与Module/页面/代理实现完成，语法和275项全量通过；42项源码输入在绑定补验前后保持。RED、夹具修正、定向结果及页面/部署边界见verification.md。root继续冻结后端0025与前端0014的新交接，旧包不改。
