import { ApiError } from './api.mjs';
import { answerRequest, checkedKnowledgeAnswer } from './answers.mjs';

const identifier = /^[A-Za-z0-9_-]{1,128}$/u;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const statuses = ['running', 'completed', 'failed', 'cancelled'];
const events = Object.freeze({ running: '任务已开始', planning: '整理任务', searching: '检索知识库', reading: '阅读原始资料', completed: '任务已完成', failed: '任务未完成', cancelled: '任务已取消' });
const errorCodes = ['agent_unavailable', 'agent_failed', 'agent_invalid_response', 'agent_timeout', 'agent_limit_exceeded', 'scope_changed', 'configuration_changed', 'evidence_changed'];
const invalid = () => new ApiError(502, '智能体返回的任务记录不完整，请刷新状态核对。');
const inputError = () => new ApiError(422, '智能体请求参数无效，请重新发起。');
const validText = value => typeof value === 'string' && !!value.trim();
const failure = error => new ApiError(error?.status ?? 502, error?.status === 401 ? '当前会话不可用，请重新连接。' : '任务状态未能确认，请刷新状态核对；没有自动重发。');
const checkedId = value => { if (typeof value !== 'string' || !identifier.test(value)) throw inputError(); return value; };

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
  if (value.status === 'failed' ? !value.error || !errorCodes.includes(value.error.code) || !validText(value.error.message) : value.error !== null) throw invalid();
  const suggestions = value.suggestions.map(item => {
    if (!item || !validText(item.title) || !validText(item.reason) || !Array.isArray(item.document_ids)
      || !item.document_ids.length || item.document_ids.some(id => typeof id !== 'string' || !identifier.test(id))
      || new Set(item.document_ids).size !== item.document_ids.length) throw invalid();
    return Object.freeze({ title: item.title, reason: item.reason, document_ids: Object.freeze([...item.document_ids]) });
  });
  return Object.freeze({ id: value.id, status: value.status, events: Object.freeze(safeEvents), result: value.result === null ? null : await checkedKnowledgeAnswer(value.result),
    suggestions: Object.freeze(suggestions), error: value.error === null ? null : Object.freeze({ code: value.error.code, message: '智能体任务未完成，请重新发起。' }) });
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
  #publish(phase, run = this.value.run, error = null) { this.value = Object.freeze({ phase, run, error }); this.#onChange(this.value); }
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
