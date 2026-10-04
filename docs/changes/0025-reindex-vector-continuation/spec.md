# Spec：同一重建入口与准确费用确认

状态：CONTRACT_FROZEN。后端源合同见 `github/ai-knowledge/docs/changes/0036-reindex-vector-continuation/spec.md`。

- 新 capability `text_reindex_with_vectors` 与既有 text_index/indexings/text_reindex、服务器 can_reindex 一起判定。新能力支持时，同发布 available 图片/音频 Session 不再永久拒绝；无新能力的旧服务器保留当前否决。不能伪造 server true，raw sound/video、pending、reader、无完整原件等继续按真实资格。
- 保留“重建文本索引”、原严格 JSON、普通期限、明确确认和单一任务。说明文字模型/向量服务可能有费用；已有媒体向量完整核对后继续使用，不重新生成媒体向量、解析、转录或换原件。取消不发送请求，写入不自动重试、不自动媒体 POST。
- 任务中及失败/取消保留旧 publication 和来源。成功后仅授权回读真实新 publication 才清旧答案/来源/召回结果；让旧 Session serial 失效，并通过 GET 读取新 base 的精确身份。允许服务器返回相同独立 generation，不本地改旧 receipt 字段。
- 保留问题、完整范围、附件与未保存整理草稿。迟到回读、身份变更、离页和未知结果沿既有保护；unknown 须明确刷新。成功提示重新测试召回或提问并打开来源，文字召回不冒充媒体 dense 验收。
- 保留原450用例身份和旧无新cap两条可用向量否决断言；新增图片/音频正常操作、授权新pub回读及失败/迟到/资格对照实际 DOM。先旧产品可执行 RED，后 GREEN、npm check 与完整 npm test。
