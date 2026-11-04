import { ApiError, isNonNegativeInteger } from './api.mjs';
import { UUID_PATTERN, checkedAgentRun } from './knowledge-agent.mjs';

const invalid = () => new ApiError(422, '对话参数不正确，请重新选择。');
const inconsistent = () => new ApiError(502, '对话记录不完整，请刷新核对。');
const checkedConversationId = value => { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw invalid(); return value; };
const checkedTitle = value => { if (typeof value !== 'string' || !value.trim() || value.trim().length > 200 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw invalid(); return value.trim(); };
function checkedConversation(value, expectedId) {
  if (!value || !UUID_PATTERN.test(value.id ?? '') || expectedId && value.id !== expectedId
    || typeof value.title !== 'string' || !value.title.trim() || [...value.title].length > 200
    || !isNonNegativeInteger(value.created_at) || !isNonNegativeInteger(value.updated_at) || !isNonNegativeInteger(value.turn_count)
    || value.active_run_id !== null && !UUID_PATTERN.test(value.active_run_id ?? '')
    || !['idle', 'compressing', 'compressed', 'failed'].includes(value.compression?.status)
    || !isNonNegativeInteger(value.compression?.covered_turn_count) || value.compression.covered_turn_count > value.turn_count
    || !isNonNegativeInteger(value.compression?.summary_characters)) throw inconsistent();
  return Object.freeze({ id: value.id, title: value.title, created_at: value.created_at, updated_at: value.updated_at,
    turn_count: value.turn_count, active_run_id: value.active_run_id,
    compression: Object.freeze({ status: value.compression.status, covered_turn_count: value.compression.covered_turn_count, summary_characters: value.compression.summary_characters }) });
}

/** Only public questions, answers and operation records; never private summaries or tool payloads. */
export async function checkedConversationDetail(value, expectedId) {
  const conversation = checkedConversation(value?.conversation, expectedId);
  if (!Array.isArray(value.turns) || value.turns.length !== conversation.turn_count) throw inconsistent();
  const seen = new Set();
  const turns = [];
  for (const [index, turn] of value.turns.entries()) {
    if (!turn || turn.ordinal !== index + 1 || !UUID_PATTERN.test(turn.run_id ?? '') || seen.has(turn.run_id)
      || typeof turn.question !== 'string' || !turn.question.trim()
      || !['running', 'completed', 'failed', 'cancelled'].includes(turn.status)
      || !isNonNegativeInteger(turn.created_at) || !isNonNegativeInteger(turn.updated_at)
      || turn.result === null && turn.status !== 'running') throw inconsistent();
    const result = turn.result === null ? null : await checkedAgentRun(turn.result, turn.run_id);
    if (result && result.status !== turn.status) throw inconsistent();
    seen.add(turn.run_id);
    turns.push(Object.freeze({ ordinal: turn.ordinal, run_id: turn.run_id, question: turn.question, status: turn.status,
      result, created_at: turn.created_at, updated_at: turn.updated_at }));
  }
  const running = turns.filter(turn => turn.status === 'running');
  if (running.length > 1 || (running[0]?.run_id ?? null) !== conversation.active_run_id) throw inconsistent();
  return Object.freeze({ conversation, turns: Object.freeze(turns) });
}

export function createKnowledgeConversationsApi(api) {
  const base = '/v1/knowledge-conversations';
  return Object.freeze({
    async listConversations({ offset = 0, limit = 30, signal } = {}) {
      if (!isNonNegativeInteger(offset) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw invalid();
      const value = await api(`${base}?limit=${limit}&offset=${offset}`, { signal });
      if (!Array.isArray(value?.items) || value.offset !== offset || value.limit !== limit || value.items.length > limit) throw inconsistent();
      const items = value.items.map(item => checkedConversation(item));
      if (new Set(items.map(item => item.id)).size !== items.length) throw inconsistent();
      return Object.freeze({ items: Object.freeze(items), offset, limit });
    },
    async createConversation(command = {}, { signal } = {}) {
      return checkedConversation(await api(base, { method: 'POST', body: command.title === undefined ? {} : { title: checkedTitle(command.title) }, signal }));
    },
    async getConversation(conversationId, { signal } = {}) {
      const path = `${base}/${checkedConversationId(conversationId)}`, turns = [];
      let total, conversation;
      for (;;) {
        signal?.throwIfAborted();
        const offset = turns.length;
        const page = await api(`${path}${offset ? `?offset=${offset}&limit=20` : ''}`, { signal });
        conversation = checkedConversation(page?.conversation, conversationId);
        if (!Array.isArray(page.turns) || page.offset !== offset || page.limit !== 20 || typeof page.has_more !== 'boolean'
          || page.turns.length > 20 || total !== undefined && total !== conversation.turn_count
          || offset + page.turns.length > conversation.turn_count
          || page.has_more !== (offset + page.turns.length < conversation.turn_count)
          || page.has_more && !page.turns.length) throw inconsistent();
        total = conversation.turn_count; turns.push(...page.turns);
        if (!page.has_more) return checkedConversationDetail({ conversation, turns }, conversationId);
      }
    },
    async renameConversation(conversationId, value, { signal } = {}) {
      return checkedConversation(await api(`${base}/${checkedConversationId(conversationId)}`, { method: 'PATCH', body: { title: checkedTitle(value) }, signal }), conversationId);
    },
    deleteConversation: (conversationId, { signal } = {}) => api(`${base}/${checkedConversationId(conversationId)}`, { method: 'DELETE', signal }),
  });
}
