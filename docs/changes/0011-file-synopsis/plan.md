# 执行

1. 读取Java0015/0016真实Controller/VO/Mapper/Service合同和已有详情生命周期，先失败用例。
2. Root独占public/file-synopsis.mjs、app/index/styles、相关UI测试和全部工件。已有worker独占scripts/dev-server.mjs、scripts/external-server.mjs、public/api.mjs、两个transport测试与ui-tests/api.test.mjs；不新增检查任务。
3. SynopsisSession小接口隐藏身份/任务/读写/轮询/Blob生命周期。app只绘制状态、显式确认和实际媒体，不复用伪造答案trace或将摘要当证据。
4. 定向验证后完整npm check/test，冻结输入与日志；以0010冻结前端为基线提供最小补丁。未改Java不重复其全量构建，真实页面仍由用户验收。
