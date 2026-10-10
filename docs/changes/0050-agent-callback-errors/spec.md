# Spec

- 接收服务端枚举 agent_model_tool_required、agent_model_unavailable、agent_model_timeout，分别解释未按工具协议执行、上游请求不可用、模型等待超时。
- agent_model_invalid 明确为模型响应格式无效；agent_callback_failed 不再断言必然是网络或模型服务宕机。
- 仅显示本地固定文案，不显示服务端原异常、模型正文或任意新增错误码。现有任务编号、阶段、失败停止、防重复及引用校验保持。
- 本地验证不代表线上已更新或真实模型已通过。
