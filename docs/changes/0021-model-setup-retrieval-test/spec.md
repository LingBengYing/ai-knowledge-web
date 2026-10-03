# Spec：设置与召回的页面合同

权威后端合同：[0032 spec](../../../../ai-knowledge/docs/changes/0032-model-setup-retrieval-test/spec.md)。

## 能力与设置

仅实际 `model_configuration` capability 开放模型设置；`retrieval_test` 独立开放召回预览。GET `/v1/config` 保持原六字段，不用旧能力猜测新入口。模型设置 GET 的 `can_edit` 决定控制权限；资料 owner/editor 不自动成为模型管理员。

GET `/v1/model-configuration` 精确九字段：`version/active_version/state/can_edit/provider/embedding/rerank/generation/projection`。provider 固定 `siliconflow`，角色与投影 nested shape 完全按后端合同校验。页面展示已保存与已应用版本，三个角色的 model，embedding dimensions/revision，凭据只展示 `has_key`。Milvus 只显示服务器已配置状态、维度及只读测试入口，不收目标地址/token。

PUT 只发 `base_version/embedding/rerank/generation`。每角色可选 `api_key` 仅用于新建/更新凭据，不把占位文本或空字符串当旧凭据。保存不触发测试或应用；提交时立即清空密钥输入。POST test 只发已保存的 `version/role`，显式逐角色点击，角色限 embedding/rerank/generation/projection。POST activate 只发已保存的 `version`；离线应用不代表模型连接已通过。

独立 `ModelConfigurationSession` 负责安全状态、编辑/操作版本和迟到隔离。密钥仅在当前控件输入和单次请求期间存在，不进入 Session 对外状态、URL、持久存储、日志或错误。编辑使测试状态失效，未保存改动不允许测试/应用。身份改变、离开设置或401清除密钥与编辑草稿，旧响应不得重新填回。保存/应用断网或停止等待记结果未知，仅允许重新GET确认，不自动重发写请求。配置冲突、运行繁忙、需要重建、角色测试失败分别解释；不提示本切不存在的自动重建。

## 召回预览

独立 `RetrievalSession` 复用原完整问题与范围校验：缺 `document_ids` 是全授权库，显式空数组保持空范围；不删除不可用项或回退全库。只支持文字/OCR，携附件或其他证据模式时明确说明当前入口只测试文字，不能悄悄丢附件。请求精确 `question/document_ids?/top_k?/rerank?`，top_k 1..20默认5，rerank默认true。

结果精确七字段 `test_id/configuration_version/status/reason/scope_count/score_kind/matches`；score_kind 仅 rrf。matches 精确十三字段按后端合同，逐条校验身份、页码、Unicode码点区间、全文SHA、rank及有限分数；关闭重排则 rerank_score 必须为null。全部校验成功才显示，任何局部异常清空整批。片段以纯文本显示，RRF与重排分分别解释为排序分而非概率。

编辑问题/范围/身份、发起新测试、离开问答立即清旧命中；取消只结束本地等待。可打开匹配资料详情；只有当前详情与命中的 revision/source SHA/filename一致，才沿既有原文件Module打开完整SHA原件。继续问答复用原问题与完整范围，仍需用户明确发起，预览不是答案来源。

## 精确代理

两代理各增加 GET/PUT `/v1/model-configuration`、POST `/v1/model-configuration/test`、POST `/v1/model-configuration/activate`、POST `/v1/retrieval-tests`，均拒绝query（包括空问号）、额外path与错误方法。普通设置读取/保存/应用128KiB和10s，test仅该route70s，retrieval仅该route180s、128KiB/4MiB。原Host/Origin/Authorization/Cookie/身份白名单、旧限额及无自动重试保持。新静态模块仅精确allowlist。

## 验收

未配置设置可读→管理员保存三角色→密钥立即清空→显式角色测试→应用→实际能力刷新→索引已解析资料→独立召回→生成调用0→同版本原件→保留问题/范围继续问答。Module、实际DOM和两代理合成测试覆盖reader、dirty、迟到/401、unknown、旧版本、全范围、坏SHA/定位、分数解释和route边界。原前端全部旧用例身份与断言保留；测试实际执行后再记录结果，不预报通过。
