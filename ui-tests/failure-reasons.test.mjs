import test from 'node:test';
import assert from 'node:assert/strict';
import { failureReason, failureNotice, agentFailureMessages, UNKNOWN_FAILURE } from '../public/failure-reasons.mjs';

test('every backend parsing, indexing and synopsis failure code has a plain explanation', () => {
  const backend = ['unsupported_document', 'text_configuration_required', 'media_text_configuration_mismatch', 'parser_failed', 'parser_timeout', 'parser_output_invalid', 'worker_interrupted',
    'indexing_failed', 'indexing_timeout', 'indexing_output_invalid', 'authorization_changed', 'index_configuration_changed',
    'synopsis_failed', 'input_capacity_exceeded', 'model_failure', 'model_refused', 'unsupported_claims', 'incomplete_evidence', 'configuration_changed', 'source_changed', 'processing_interrupted', 'processing_timeout'];
  for (const code of backend) {
    const text = failureReason(code);
    assert.notEqual(text, UNKNOWN_FAILURE, code); assert.doesNotMatch(text, /[a-z]+_[a-z]+/u, code);
  }
  assert.equal(failureReason('agent_timeout'), agentFailureMessages.agent_timeout);
});

test('unknown codes fall back to generic guidance and the raw code is only support detail', () => {
  assert.equal(failureReason('brand_new_code'), UNKNOWN_FAILURE);
  assert.equal(failureReason(null, '自定义说明'), '自定义说明');
  const html = failureNotice('pdf_ocr_failed');
  assert.match(html, /^<p class="notice error" role="alert" title="错误代码：pdf_ocr_failed">失败原因：PDF 文字识别失败/u);
  assert.doesNotMatch(html.replace(/title="[^"]*"/u, ''), /pdf_ocr_failed/u);
  assert.match(failureNotice('x"><b>'), /title="错误代码：x&quot;&gt;&lt;b&gt;"/u);
});
