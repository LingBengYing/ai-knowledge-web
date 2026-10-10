import { ApiError } from './api.mjs';
import { answerRequest, checkedKnowledgeAnswer } from './answers.mjs';

const identifier = /^[A-Za-z0-9_-]{1,128}$/u;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const statuses = ['running', 'completed', 'failed', 'cancelled'];
const events = Object.freeze({ running: '任务已开始', planning: '整理任务', searching: '检索知识库', reading: '阅读原始资料', completed: '任务已完成', failed: '任务未完成', cancelled: '任务已取消' });
const failureMessages = Object.freeze({
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
  agent_step_limit: '知识助手达到本次查阅步数，请将问题拆成更具体的任务。',
  agent_execution_failed: '知识助手执行中断，请提供任务编号排查执行过程。',
  agent_cancelled: '知识助手连接已中断，本次任务未完成。',
  agent_busy: '知识助手正在处理其他任务，请稍后再提交。',
  scope_changed: '任务期间资料范围发生变化，请核对资料后重新提交。',
  configuration_changed: '任务期间模型配置发生变化，请确认当前配置后重新提交。',
  evidence_changed: '任务引用的资料版本发生变化，请核对最新资料后重新提交。',
});
const invalid = () => new ApiError(502, '智能体返回的任务记录不完整，请刷新状态核对。');
const inputError = () => new ApiError(422, '智能体请求参数无效，请重新发起。');
const validText = value => typeof value === 'string' && !!value.trim();
const failure = error => new ApiError(error?.status ?? 502, error?.status === 401 ? '当前会话不可用，请重新连接。' : '任务状态未能确认，请刷新状态核对；没有自动重发。');
const checkedId = value => { if (typeof value !== 'string' || !identifier.test(value)) throw inputError(); return value; };
const checkedFailure = value => {
  if (!value || !Object.hasOwn(failureMessages, value.code)) throw invalid();
  return Object.freeze({ code: value.code, message: failureMessages[value.code] });
};

const progressEvents = Object.freeze({ ...events, planning: '分析查阅任务' });
const progressStages = Object.freeze({
  running: ['正在启动知识助手', '任务已启动，等待查阅进度。'],
  planning: ['正在分析查阅任务', '根据问题决定下一步查阅操作。'],
  searching: ['正在检索知识库', '已发起资料检索，等待下一步进度。'],
  reading: ['正在阅读原始资料', '已发起原文阅读，等待下一步进度。'],
});
const progressPhases = Object.freeze({
  submitting: ['正在提交查阅任务', '正在提交本次问题。', '提交中'],
  cancelling: ['正在停止查阅', '正在等待服务器确认停止。', '停止中'],
  unknown: ['任务状态待核对', '未能确认后台进度，可刷新状态核对。', '待核对'],
  paused: ['已停止等待', '已停止等待，后台处理状态尚未确认。', '停止等待'],
  completed: ['查阅完成', '回答已返回，可查看回答记录。', '已完成'],
  failed: ['查阅未完成', '本次查阅未完成，可展开过程查看最后记录。', '未完成'],
  cancelled: ['查阅已取消', '服务器已确认本次任务取消。', '已取消'],
});

/** A view of observed operations only; polling does not create a business stage. */
export function agentProgressView({ phase, run } = {}) {
  const active = ['submitting', 'running', 'reading'].includes(phase);
  const observed = Array.isArray(run?.events) ? run.events.filter(event => event
    && Object.hasOwn(progressEvents, event.type) && Number.isSafeInteger(event.sequence) && event.sequence > 0) : [];
  const entries = observed.map((event, index) => Object.freeze({
    sequence: event.sequence, type: event.type, label: progressEvents[event.type],
    current: active && index === observed.length - 1 && !statuses.slice(1).includes(event.type),
  }));
  let [title, detail, status] = progressPhases[phase] ?? [
    ...(progressStages[observed.at(-1)?.type] ?? ['正在等待查阅进度', '尚未收到新的查阅阶段。']), '处理中',
  ];
  if (phase === 'completed' && run?.result?.status === 'abstained') {
    const insufficientEvidence = ['no_evidence', 'incomplete_evidence'].includes(run.result.reason);
    title = insufficientEvidence ? '查阅结束，证据不足' : '未形成有据回答';
    detail = insufficientEvidence ? '已完成查阅，现有证据不足以形成回答。' : '本次未返回有据回答，请查看回答说明。';
  }
  const searches = observed.filter(event => event.type === 'searching').length;
  const reads = observed.filter(event => event.type === 'reading').length;
  const citations = phase === 'completed' && Array.isArray(run?.result?.citations) ? ` · 引用 ${run.result.citations.length} 条` : '';
  return Object.freeze({ title, detail, active, status, entries: Object.freeze(entries),
    summary: `检索发起 ${searches} 次 · 阅读发起 ${reads} 次${citations}` });
}

export function checkedAgentConfig(value) {
  if (!value || typeof value.enabled !== 'boolean' || value.engine !== 'db-gpt' || value.max_steps !== 8) throw invalid();
  return Object.freeze({ enabled: value.enabled, engine: value.engine, max_steps: value.max_steps });
}

/** Only service-owned operation types become progress labels; model thoughts are never displayed. */
export async function checkedAgentRun(value, expectedId) {
  if (!value || typeof value.id !== 'string' || !uuid.test(value.id) || expectedId && value.id !== expectedId
    || !statuses.includes(value.status) || !Array.isArray(value.events) || !Array.isArray(value.suggestions)) throw invalid();
  const safeEvents = value.events.map((event, index) => {
    if (!event || event.sequence !== index + 1 || !Object.hasOwn(events, event.type) || !validText(event.message)) throw invalid();
    return Object.freeze({ sequence: event.sequence, type: event.type, message: events[event.type] });
  });
  if (value.status === 'completed' ? !value.result || value.error !== null : value.result !== null) throw invalid();
  if (value.status === 'failed' ? !value.error || !Object.hasOwn(failureMessages, value.error.code) || !validText(value.error.message) : value.error !== null) throw invalid();
  const suggestions = value.suggestions.map(item => {
    if (!item || !validText(item.title) || !validText(item.reason) || !Array.isArray(item.document_ids)
      || !item.document_ids.length || item.document_ids.some(id => typeof id !== 'string' || !identifier.test(id))
      || new Set(item.document_ids).size !== item.document_ids.length) throw invalid();
    return Object.freeze({ title: item.title, reason: item.reason, document_ids: Object.freeze([...item.document_ids]) });
  });
  return Object.freeze({ id: value.id, status: value.status, events: Object.freeze(safeEvents), result: value.result === null ? null : await checkedKnowledgeAnswer(value.result),
    suggestions: Object.freeze(suggestions), error: value.error === null ? null : checkedFailure(value.error) });
}

export function createKnowledgeAgentApi(api) {
  return Object.freeze({
    getAgentConfig: async ({ signal } = {}) => checkedAgentConfig(await api('/v1/knowledge-agent/config', { signal })),
    createAgentRun: async (command, { signal } = {}) => {
      if (!uuid.test(command?.request_id ?? '')) throw inputError();
      const body = { ...answerRequest(command.question), request_id: command.request_id };
      return checkedAgentRun(await api('/v1/knowledge-agent/runs', { method: 'POST', body, signal }));
    },
    getAgentRun: async (id, { signal } = {}) => checkedAgentRun(await api(`/v1/knowledge-agent/runs/${checkedId(id)}`, { signal }), id),
    cancelAgentRun: async (id, { signal } = {}) => checkedAgentRun(await api(`/v1/knowledge-agent/runs/${checkedId(id)}/cancel`, { method: 'POST', body: {}, signal }), id),
  });
}

/** One explicit write per action, read-only polling, and a new ticket for cancel/close. */
export class KnowledgeAgentSession {
  #api; #onChange; #pollDelay; #requestId; #epoch = 0; #timer; #controller;
  value = Object.freeze({ phase: 'idle', run: null, error: null });
  constructor(api, { onChange = () => {}, pollDelay = 1200, requestId = () => crypto.randomUUID() } = {}) {
    this.#api = api; this.#onChange = onChange; this.#pollDelay = pollDelay; this.#requestId = requestId;
  }
  #publish(phase, run = this.value.run, error = null) {
    if (run?.error) run = Object.freeze({ ...run, error: checkedFailure(run.error) });
    this.value = Object.freeze({ phase, run, error }); this.#onChange(this.value);
  }
  #begin() { clearTimeout(this.#timer); this.#controller?.abort(); this.#controller = new AbortController(); return ++this.#epoch; }
  #accept(run) {
    const previous = this.value.run;
    if (previous && (previous.id !== run.id || previous.events.length > run.events.length
      || previous.events.some((event, index) => event.sequence !== run.events[index]?.sequence || event.type !== run.events[index]?.type))) throw invalid();
    this.#publish(run.status, run);
    if (run.status === 'running') this.#timer = setTimeout(() => this.refresh(), this.#pollDelay);
  }
  async start(question) {
    if (['submitting', 'running', 'reading', 'cancelling'].includes(this.value.phase)) return this.value;
    const ticket = this.#begin(); this.#publish('submitting', null);
    try {
      const run = await this.#api.createAgentRun({ ...answerRequest(question), request_id: this.#requestId() }, { signal: this.#controller.signal });
      if (ticket === this.#epoch) this.#accept(run);
    } catch (error) { if (ticket === this.#epoch) this.#publish('unknown', null, failure(error)); }
    return this.value;
  }
  async refresh() {
    const id = this.value.run?.id;
    if (!id || ['submitting', 'reading', 'cancelling', 'completed', 'failed', 'cancelled'].includes(this.value.phase)) return this.value;
    const ticket = this.#begin(); this.#publish('reading');
    try { const run = await this.#api.getAgentRun(id, { signal: this.#controller.signal }); if (ticket === this.#epoch) this.#accept(run); }
    catch (error) { if (ticket === this.#epoch) this.#publish('unknown', this.value.run, failure(error)); }
    return this.value;
  }
  async resume(run) {
    this.#begin(); this.#publish('unknown', run);
    return this.refresh();
  }
  async cancel() {
    const id = this.value.run?.id;
    if (!id || !['running', 'reading', 'unknown'].includes(this.value.phase)) return this.value;
    const ticket = this.#begin(); this.#publish('cancelling');
    try { const run = await this.#api.cancelAgentRun(id, { signal: this.#controller.signal }); if (ticket === this.#epoch) this.#accept(run); }
    catch (error) { if (ticket === this.#epoch) this.#publish('unknown', this.value.run, failure(error)); }
    return this.value;
  }
  close() { this.#epoch++; clearTimeout(this.#timer); this.#controller?.abort(); }
}
