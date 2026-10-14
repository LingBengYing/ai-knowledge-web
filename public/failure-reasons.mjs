import { escapeHtml as e } from './api.mjs';

/**
 * The single frontend table that turns server failure codes into plain Chinese guidance.
 * Codes come from the Java backend (ingestion/indexing/synopsis/cleanup/model-test/auto-index
 * failure sets) and the knowledge agent. Unknown codes fall back to a generic message; the raw
 * code is kept only as small support detail (title attribute), never as the primary text.
 */
const taskMessages = Object.freeze({
  // Parsing (IngestionService.ERRORS)
  unsupported_document: '文件格式或内容暂不支持解析。请确认文件未损坏、未加密，或另存为 PDF、TXT、Markdown 后重新导入。',
  parser_failed: '文件解析失败，可能是文件损坏、加密或内容无法识别。可以重试；多次失败请更换文件后重新导入。',
  parser_timeout: '文件解析超时，文件可能过大或页数过多。可以稍后重试，或拆分文件后重新导入。',
  parser_output_invalid: '解析结果未通过完整性核对（处理期间资料可能已更新），请重试解析。',
  pdf_ocr_failed: 'PDF 文字识别失败，扫描件可能不清晰或识别服务暂不可用。可以稍后重试。',
  worker_interrupted: '处理过程被服务重启或停止打断，可以重新提交处理。',
  text_configuration_required: '尚未完成模型配置，请先完成并应用模型配置，再重新处理。',
  media_text_configuration_mismatch: '媒体处理与文字模型配置不一致，请检查模型配置后重试。',
  // Indexing (IndexingService.ERRORS)
  indexing_failed: '建立索引失败，请检查模型与向量库配置后重试。',
  indexing_timeout: '建立索引超时，请稍后重试。',
  indexing_output_invalid: '索引结果未通过完整性核对，请重试。',
  authorization_changed: '处理期间权限或资料状态发生了变化，请刷新后核对。',
  index_configuration_changed: '处理期间索引配置发生了变化，请确认当前模型配置后重试。',
  // Automatic indexing admission
  indexing_unavailable: '当前索引模型不可用，请检查模型配置后到资料维护中处理。',
  parsing_incomplete: '原文件尚未解析成功，请先在处理任务中检查解析结果。',
  indexing_interrupted: '索引处理已中断，请到资料维护中检查处理状态。',
  // File synopsis (SynopsisLibraryService.ERRORS)
  synopsis_failed: '摘要生成失败，可以稍后重新生成。',
  model_failure: '模型服务调用失败，请检查模型配置或稍后重试。',
  model_refused: '模型拒绝处理这份资料，暂时无法生成摘要。',
  unsupported_claims: '模型生成的内容无法对应到原文依据，已丢弃，可以重新生成。',
  incomplete_evidence: '摘要依据不完整，已丢弃，可以重新生成。',
  input_capacity_exceeded: '资料内容超出单次处理上限，暂时无法生成摘要。',
  configuration_changed: '处理期间模型配置发生了变化，请确认当前配置后重新提交。',
  source_changed: '处理期间资料版本发生了变化，请基于最新版本重新生成。',
  processing_interrupted: '处理过程被打断，可以重新生成。',
  processing_timeout: '处理超时，请稍后重新生成。',
  // Document cleanup
  cleanup_wiki_content_retained: '关联知识页内容仍保留，尚未完成全部内容清理。',
  cleanup_execution_failed: '清理执行失败，请刷新后继续清理。',
  cleanup_incomplete: '清理尚未全部完成，请刷新后继续清理。',
  cleanup_remote_unverified: '远端索引的清理结果尚未确认，请稍后刷新。',
  cleanup_temporaries_unverified: '临时文件的清理结果尚未确认，请稍后刷新。',
  cleanup_backups_unknown: '受控备份的清理结果尚未确认，请联系管理员核对。',
  cleanup_inventory_unknown: '远端资源清单尚未核对完成，请稍后刷新。',
  cleanup_target_unknown: '清理目标尚未确认，请联系管理员核对。',
  cleanup_projection_busy: '索引正在使用中，暂时无法清理，请稍后继续。',
  cleanup_projection_failed: '索引清理失败，请稍后继续清理。',
  cleanup_request_too_large: '一次选择的资料过多，请减少数量后再清理。',
  document_busy: '资料正在处理中，请等待处理结束后再操作。',
  not_found: '资料不存在或已被移除，请刷新列表。',
  // Model connection tests (TextModelConnectionProbe)
  model_authentication_failed: '模型服务密钥无效或无权限，请检查密钥。',
  model_rate_limited: '模型服务请求过于频繁或额度不足，请稍后再试。',
  model_timeout: '模型服务响应超时，请检查网络或稍后再试。',
  model_interrupted: '模型连接测试被中断，请重新测试。',
  model_invalid_response: '模型服务返回的内容格式不正确，请检查服务地址和模型名称。',
  model_invalid_configuration: '模型配置不完整或填写有误，请检查服务商、模型名称和密钥。',
  model_unreachable: '无法连接模型服务，请检查网络或服务地址。',
  model_test_refused: '模型拒绝了测试请求，请检查模型是否支持该用途。',
  projection_configuration_required: '尚未配置向量库，请联系服务管理员配置。',
  projection_authentication_failed: '向量库认证失败，请联系服务管理员检查凭据。',
  projection_rate_limited: '向量库请求过于频繁，请稍后再试。',
  projection_timeout: '向量库响应超时，请稍后再试。',
  projection_interrupted: '向量库连接测试被中断，请重新测试。',
  projection_invalid_response: '向量库返回的内容格式不正确，请联系服务管理员。',
  projection_invalid_configuration: '向量库配置有误，请联系服务管理员。',
  projection_unreachable: '无法连接向量库，请联系服务管理员检查服务状态。',
});

/** Knowledge-agent run failures (agent-service codes); also used to validate run records. */
export const agentFailureMessages = Object.freeze({
  agent_interrupted: '服务重启中断了这条任务，原有对话已保留。',
  agent_context_compaction_failed: '历史上下文整理未完成，原始对话已保留，本次未继续调用问答模型。',
  agent_unavailable: '知识助手服务暂时无法连接，请检查服务状态。',
  agent_failed: '任务异常结束，请提供任务编号以便排查。',
  agent_invalid_response: '知识助手返回的结果格式或来源校验未通过，请提供任务编号排查。',
  agent_timeout: '任务超过等待时间，请查看最后完成的步骤后再决定是否重新提交。',
  agent_limit_exceeded: '本次任务超出可处理范围，请缩小问题范围。',
  agent_callback_failed: '知识助手回调未完成，暂未确认具体原因，请提供任务编号排查。',
  agent_callback_invalid: '模型或资料接口返回格式不正确，请提供任务编号排查。',
  agent_model_tool_required: '模型未返回必需的工具调用，查阅已停止，请检查生成模型的工具调用兼容性。',
  agent_model_invalid: '模型返回的工具调用格式或参数无效，查阅已停止，请提供任务编号排查。',
  agent_model_unavailable: '生成模型服务暂不可用，查阅已停止，请检查模型配置或服务状态。',
  agent_model_timeout: '生成模型响应超时，查阅已停止，请稍后再提交。',
  agent_invalid_action: '模型未按工具调用格式执行，尚未完成查阅，请检查模型兼容性。',
  agent_invalid_tool_input: '模型生成的查阅参数不正确，请提供任务编号排查。',
  agent_tool_failed: '查阅工具执行失败，请结合最后完成的步骤排查。',
  agent_invalid_result: '最终结果未通过来源校验或格式校验，未作为有据回答展示。',
  agent_result_invalid_json: '模型提交的最终结果不是有效 JSON，回答未能确认。',
  agent_result_invalid_schema: '模型提交的最终结果字段格式不正确，回答未能确认。',
  agent_result_no_search: '模型未完成资料检索就提交了结果，回答未能确认。',
  agent_result_missing_statements: '模型声明可以回答，但没有提交回答内容。',
  agent_result_no_read: '模型未阅读原始资料就提交了回答，来源未能确认。',
  agent_result_blank_statement: '模型提交的回答含空白段落，回答未能确认。',
  agent_result_unread_evidence: '回答引用了本次未阅读的来源，未作为有据回答展示。',
  agent_result_unknown_suggestion_document: '资料补充建议引用了本次未阅读的文件，结果未能确认。',
  agent_step_limit: '知识助手达到本次查阅步数，请将问题拆成更具体的任务。',
  agent_execution_failed: '知识助手执行中断，请提供任务编号排查执行过程。',
  agent_cancelled: '知识助手连接已中断，本次任务未完成。',
  agent_busy: '知识助手正在处理其他任务，请稍后再提交。',
  scope_changed: '任务期间资料范围发生变化，请核对资料后重新提交。',
  configuration_changed: '任务期间模型配置发生变化，请确认当前配置后重新提交。',
  evidence_changed: '任务引用的资料版本发生变化，请核对最新资料后重新提交。',
});

export const UNKNOWN_FAILURE = '处理未完成，原因暂未识别。可以重试；如果反复失败，请把错误代码提供给管理员。';
const code = value => typeof value === 'string' && value ? value : '';

/** Plain-language explanation for a failure code; `fallback` replaces the generic unknown-code text. */
export function failureReason(value, fallback = UNKNOWN_FAILURE) {
  const key = code(value);
  return (Object.hasOwn(taskMessages, key) ? taskMessages[key] : Object.hasOwn(agentFailureMessages, key) ? agentFailureMessages[key] : null) ?? fallback;
}

/** Error notice whose visible text is the explanation; the raw code stays in the title for support. */
export function failureNotice(value, { prefix = '失败原因：', fallback } = {}) {
  const key = code(value);
  return `<p class="notice error" role="alert"${key ? ` title="错误代码：${e(key)}"` : ''}>${e(prefix + failureReason(key, fallback))}</p>`;
}
