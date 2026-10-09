import { ApiError } from './api.mjs';

const fields = ['search_method', 'ranking_mode', 'dense_weight', 'top_k', 'score_threshold_enabled', 'score_threshold'];
const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const invalid = () => new ApiError(422, '请核对检索方式、排序策略、0–1 的语义权重、1–20 的 Top K 和有限数值阈值。');
const initial = () => ({ phase: 'idle', settings: null, dirty: false, error: null });
export const retrievalSettingsEnabled = config => config?.capabilities?.includes('retrieval_settings') === true;

export function retrievalSettingsFields(value) {
  const draft = Object.fromEntries(fields.map(name => [name, value?.[name]]));
  if (!['vector', 'full_text', 'hybrid'].includes(draft.search_method) || !['weighted', 'rerank'].includes(draft.ranking_mode)
    || !Number.isFinite(draft.dense_weight) || draft.dense_weight < 0 || draft.dense_weight > 1
    || !Number.isSafeInteger(draft.top_k) || draft.top_k < 1 || draft.top_k > 20
    || typeof draft.score_threshold_enabled !== 'boolean' || !Number.isFinite(draft.score_threshold)) throw invalid();
  return Object.freeze(draft);
}

export function checkedRetrievalOverride(value) {
  if (!exact(value, fields)) throw invalid();
  return retrievalSettingsFields(value);
}

export function checkedRetrievalSettings(value) {
  if (!exact(value, ['version', ...fields]) || !Number.isSafeInteger(value.version) || value.version < 0) throw invalid();
  return Object.freeze({ version: value.version, ...retrievalSettingsFields(value) });
}

export function retrievalScoreKind(settings) {
  return settings.search_method === 'full_text' ? 'bm25' : settings.search_method === 'vector' ? 'vector_similarity'
    : settings.ranking_mode === 'rerank' ? 'rrf' : 'weighted_score';
}

export const retrievalScoreLabel = kind => ({ rrf: 'RRF 召回分', weighted_score: '混合加权分', vector_similarity: '归一化向量分', bm25: 'BM25 分' })[kind] ?? '检索分';
export const retrievalMethodLabel = method => ({ vector: '向量检索', full_text: '全文检索', hybrid: '混合检索' })[method] ?? '检索';
export function retrievalThresholdHelp(settings) {
  if (settings.ranking_mode === 'rerank') return '按服务商原始重排分筛选；分值不保证在 0–1，不能视为事实置信度。';
  if (settings.search_method === 'full_text') return '按原始 BM25 分筛选；没有固定 0–1 范围，不能视为事实置信度。';
  return `按${settings.search_method === 'hybrid' ? '归一化混合加权分' : '归一化向量相似度'}筛选（0–1）；不是事实置信度。`;
}
export function retrievalSettingsSummary(settings) {
  return `${retrievalMethodLabel(settings.search_method)} · ${settings.ranking_mode === 'rerank' ? '模型重排' : settings.search_method === 'hybrid' ? `加权排序（语义 ${settings.dense_weight} / 关键词 ${Number((1 - settings.dense_weight).toFixed(4))}）` : '原检索分排序'} · Top K ${settings.top_k} · ${settings.score_threshold_enabled ? `阈值 ≥ ${settings.score_threshold}` : '阈值关闭'}`;
}

/** Organization settings only: no model testing, activation, indexing or automatic write retry. */
export class RetrievalSettingsSession {
  #request; #change; #auth; #serial = 0; #controller = null;
  value = Object.freeze(initial());
  constructor(request, { onChange = () => {}, onAuthenticationFailure = () => {} } = {}) { this.#request = request; this.#change = onChange; this.#auth = onAuthenticationFailure; }
  #emit(value) { this.value = Object.freeze(value); this.#change(this.value); }
  close() { this.#serial++; this.#controller?.abort(); this.#controller = null; this.#emit(initial()); }
  edit() { if (this.value.settings && !['loading', 'saving', 'unknown', 'conflict'].includes(this.value.phase)) this.#emit({ ...this.value, dirty: true, error: null }); }
  load() { return this.#perform('GET'); }
  save(draft) {
    if (!this.value.settings || !this.value.dirty || ['loading', 'saving', 'unknown', 'conflict'].includes(this.value.phase)) return Promise.resolve(null);
    let body;
    try { body = { version: this.value.settings.version, ...checkedRetrievalOverride(draft) }; }
    catch (error) { this.#emit({ ...this.value, error }); return Promise.resolve(null); }
    return this.#perform('PUT', body);
  }
  async #perform(method, body) {
    if (['loading', 'saving'].includes(this.value.phase)) return null;
    this.#controller?.abort(); const serial = ++this.#serial, controller = new AbortController(), previous = this.value;
    this.#controller = controller;
    this.#emit({ ...previous, phase: method === 'GET' ? 'loading' : 'saving', error: null });
    try {
      const response = await this.#request('/v1/retrieval-settings', { method, ...(body ? { body } : {}), signal: controller.signal });
      if (serial !== this.#serial) return null;
      const settings = checkedRetrievalSettings(response);
      if (method === 'PUT' && (settings.version !== body.version + 1 || fields.some(name => settings[name] !== body[name]))) throw new ApiError(502, 'invalid_settings_reply');
      this.#emit({ phase: 'ready', settings, dirty: false, error: null }); return settings;
    } catch (error) {
      if (serial !== this.#serial) return null;
      if (error?.status === 401) { this.close(); this.#auth(error); return null; }
      const phase = method === 'PUT' ? error?.status === 409 ? 'conflict' : error?.status === 422 ? 'error' : 'unknown'
        : ['unknown', 'conflict'].includes(previous.phase) ? previous.phase : 'error';
      const message = phase === 'conflict' ? '检索设置已被其他成员修改，请重新读取后再编辑；不会覆盖他人的配置。'
        : phase === 'unknown' ? '保存结果尚未确认，请重新读取后核对；不会自动再次提交。'
          : method === 'GET' ? '未能读取检索设置，请手动重新读取。' : '检索设置未保存，请核对输入后再提交。';
      this.#emit({ ...previous, phase, error: new ApiError(error?.status ?? 502, message) }); return null;
    } finally { if (serial === this.#serial) this.#controller = null; }
  }
}
