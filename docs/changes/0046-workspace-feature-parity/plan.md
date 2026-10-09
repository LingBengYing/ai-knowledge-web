# 并行执行

- retrieval worker：仅wiki-retrieval.mjs及对应新测试，复用召回/原件模块，输出mount接口。
- maintenance worker：仅wiki-maintenance.mjs及对应新测试，负责documents/tasks/目录及旧资料辅助操作完整迁移，输出mount接口。
- diagnostics worker：仅knowledge-agent.mjs及其测试，Java/Python0060安全错误码。
- root：wiki-workspace路由/导航/Agent详情、精确静态模块注册、统一CSS/集成测试/实际浏览器证据与工件。

先各自RED→GREEN，再统一前端检查/回归和Java直接相关验证。本机联调用合成新数据或受控替身，不触发真实模型。旧失败保留不降低门槛；不把开发构建和局部测试称为生产/真实质量验收。
