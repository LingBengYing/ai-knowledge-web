# Intent：模型设置与独立召回测试

状态：IMPLEMENTED_LOCAL_ROOT_VERIFY_PENDING。对应后端 [0032 intent](../../../../ai-knowledge/docs/changes/0032-model-setup-retrieval-test/intent.md) 与 [spec](../../../../ai-knowledge/docs/changes/0032-model-setup-retrieval-test/spec.md)。先在工作区 `.tools/model-configuration-preparation/frontend-draft` 编写并验证隔离草稿；协调方保留0031完整证据并开放前端源码后，13个明确产品/测试文件已整合，逐文件SHA与已验证草稿一致。等待协调方最终正式输入复验。

用户要求优先补齐基本操作：在设置里填写此前指定的硅基流动三个文字角色，明确保存、测试与应用的区别，再从已索引资料测试召回并继续问答。页面不要求重新申请开发权限，不引入新供应商、账号、真实模型调用或额外高级索引方案。

本切交付两条相连但独立的用户流程：管理员管理模型草稿/应用状态；已认证用户用完整问题和完整资料范围检查真实文字/OCR召回片段。召回预览不生成答案，不把排序分数称为正确率或事实置信度。原资料管理、上传、任务、问答与来源继续沿既有授权和版本合同。

本切不部署、不进行浏览器验收、不访问真实模型/Milvus/凭据；页面最终由用户验收。usage/计费仍取消，通用重建与版本切换不借本切补入。
