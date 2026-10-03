# 执行计划

1. 阅读 Java 0017 合同和现有前端模块，明确ownership，写可复现失败用例。
2. Root负责新query-attachments.mjs、AnswerSession接线、app/markup/styles及对应UI测试。已有实现worker仅负责dev-server/external-server和各自transport测试；不创建额外检查任务。
3. 原始附件校验/编码和响应包络藏在小Module后；AnswerSession复用原scope、取消epoch及typed引用逻辑。UI提供显式媒体类型和临时选择，不新增持久化或模型客户端。
4. 修复定向失败，再串行完整 `npm run check` / `npm test`，记录本机验证和剩余页面/真实模型验收。只冻结相关补丁供既有部署任务接手，保留其免登录分支。Git、服务器、真实调用和用户验收权限边界不变。
