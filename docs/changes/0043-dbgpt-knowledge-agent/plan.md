# 0043 计划

前端 worker 独占 public、tests、ui-tests、精确代理路由及本工件；保留共享工作树已有修改，不改 Java/Python/生产。

1. 新增 Agent JSON/运行生命周期与 DOM/代理失败用例。
2. 复用统一答案校验，接配置、run 轮询/取消与问答进度、折叠建议。
3. 运行直接相关测试、`npm run check`、`npm test`；root 执行整链浏览器验收。
4. 记录本次结果、接口字段及未验证边界。
