import { ApiError } from './api.mjs';

const roles = ['embedding', 'rerank', 'generation'];
const modelName = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const version = value => Number.isSafeInteger(value) && value >= 0;
const invalid = () => new ApiError(502, '模型配置状态不完整，请重新读取状态。');
const idle = () => ({ phase: 'idle', configuration: null, dirty: false, tests: Object.freeze({}), error: null });
const busy = value => ['loading', 'saving', 'testing', 'activating'].includes(value.phase);
const knownFailure = error => [400, 401, 403, 404, 409, 413, 415, 422].includes(error?.status);
const errorMessages = {
  configuration_conflict: '配置版本已改变，请重新读取后编辑。',
  configuration_busy: '当前仍有操作执行，请等待结束后再明确应用。',
  model_rebuild_required: '模型目标与已有索引不兼容，当前配置保持有效；需要另行完成重建与版本切换。',
  text_configuration_required: '请先保存并应用文字模型配置。',
};
const safeError = error => {
  const result = new ApiError(Number.isInteger(error?.status) ? error.status : 0,
    errorMessages[error?.errorCode] ?? (error?.status === 401 ? '身份已失效，请重新登录。' : error?.status === 422 ? '输入不符合要求，请检查所标字段。' : '操作未完成，请读取当前状态后核对。'));
  if (Object.hasOwn(errorMessages, error?.errorCode)) result.errorCode = error.errorCode;
  if (typeof error?.field === 'string' && /^(?:request|base_version|version|role|(?:embedding|rerank|generation)\.(?:model|dimensions|revision|api_key))$/u.test(error.field)) result.field = error.field;
  return result;
};

export const modelConfigurationEnabled = config => config?.capabilities?.includes('model_configuration') === true;

export function checkedModelConfiguration(value) {
  if (!keys(value, ['version', 'active_version', 'state', 'can_edit', 'provider', 'embedding', 'rerank', 'generation', 'projection'])
    || !(value.version === null || version(value.version)) || !(value.active_version === null || version(value.active_version))
    || !['unconfigured', 'draft', 'active'].includes(value.state) || typeof value.can_edit !== 'boolean' || value.provider !== 'siliconflow'
    || (value.active_version !== null && (value.version === null || value.active_version > value.version))
    || (value.state === 'active' && (value.active_version === null || value.active_version !== value.version))
    || (value.state === 'draft' && (value.version === null || value.active_version === value.version))
    || (value.state === 'unconfigured' && (value.active_version !== null || ![null, 0].includes(value.version)))) throw invalid();
  const empty = value.state === 'unconfigured';
  for (const role of roles) {
    const item = value[role], expected = role === 'embedding' ? ['model', 'dimensions', 'revision', 'has_key'] : ['model', 'has_key'];
    if (!keys(item, expected) || typeof item.has_key !== 'boolean' || (empty ? item.model !== null || item.has_key : !modelName.test(item.model ?? ''))) throw invalid();
    if (role === 'embedding' && (empty ? item.dimensions !== null || item.revision !== null
      : !Number.isSafeInteger(item.dimensions) || item.dimensions < 2 || item.dimensions > 8192 || typeof item.revision !== 'string' || !item.revision || item.revision.length > 160)) throw invalid();
  }
  if (!keys(value.projection, ['configured', 'dimension', 'can_test']) || typeof value.projection.configured !== 'boolean' || typeof value.projection.can_test !== 'boolean'
    || !(value.projection.dimension === null || Number.isSafeInteger(value.projection.dimension) && value.projection.dimension >= 2 && value.projection.dimension <= 8192)) throw invalid();
  return Object.freeze({ ...value, ...Object.fromEntries([...roles, 'projection'].map(role => [role, Object.freeze({ ...value[role] })])) });
}

function command(draft, configuration) {
  if (!keys(draft, roles)) throw new ApiError(422, '请填写三个文字模型角色。');
  const result = { base_version: configuration.version };
  for (const role of roles) {
    const item = draft[role], expected = role === 'embedding' ? ['model', 'dimensions', 'revision'] : ['model'];
    if (!item || !keys(item, [...expected, ...(Object.hasOwn(item, 'api_key') ? ['api_key'] : [])]) || !modelName.test(item.model ?? '')) throw new ApiError(422, '模型名称不符合要求。');
    if (role === 'embedding' && (!Number.isSafeInteger(item.dimensions) || item.dimensions < 2 || item.dimensions > 8192
      || typeof item.revision !== 'string' || !item.revision.trim() || item.revision.length > 160 || /[\u0000-\u001f\u007f]/u.test(item.revision) || /^(latest|default|unknown)$/iu.test(item.revision))) throw new ApiError(422, '请填写有效的嵌入维度与明确版本。');
    if (Object.hasOwn(item, 'api_key') ? typeof item.api_key !== 'string' || !/^[\x21-\x7e][\x20-\x7e]{0,4095}$/u.test(item.api_key) : !configuration[role].has_key) throw new ApiError(422, '首次配置须填写该角色密钥；更新时留空保留已保存密钥。');
    result[role] = { ...item };
  }
  return result;
}

/** Only safe summaries and role test outcomes are retained. Write-only keys remain single-call input. */
export class ModelConfigurationSession {
  #request; #change; #clear; #auth; #serial = 0; #controller = null; #operation = null;
  value = Object.freeze(idle());
  constructor(request, { onChange = () => {}, onClearSecrets = () => {}, onAuthenticationFailure = () => {} } = {}) {
    this.#request = request; this.#change = onChange; this.#clear = onClearSecrets; this.#auth = onAuthenticationFailure;
  }
  #emit(value) { this.value = Object.freeze(value); this.#change(this.value); }
  close() { this.#serial++; this.#controller?.abort(); this.#controller = null; this.#operation = null; this.#clear(); this.#emit(idle()); }
  stop() {
    const write = ['saving', 'activating'].includes(this.#operation);
    this.#serial++; this.#controller?.abort(); this.#controller = null; this.#operation = null; this.#clear();
    this.#emit({ ...this.value, phase: write ? 'unknown' : 'ready', error: null });
  }
  edit() {
    if (busy(this.value) || !this.value.configuration?.can_edit) return false;
    this.#emit({ ...this.value, dirty: true, tests: Object.freeze({}), error: null }); return true;
  }
  async load() {
    if (busy(this.value)) return null;
    return this.#perform('loading', '/v1/model-configuration', undefined, result => {
      const configuration = checkedModelConfiguration(result);
      if (this.value.configuration) this.#clear();
      return { configuration, dirty: false, tests: Object.freeze({}) };
    });
  }
  async save(draft) {
    if (busy(this.value) || this.value.phase === 'unknown' || !this.value.configuration?.can_edit) return null;
    let body;
    try { body = command(draft, this.value.configuration); } finally { this.#clear(); }
    const prior = this.value.configuration;
    return this.#perform('saving', '/v1/model-configuration', body, result => {
      const checked = checkedModelConfiguration(result);
      if (checked.version !== (prior.version ?? 0) + 1 || checked.active_version !== prior.active_version || checked.state !== 'draft') throw invalid();
      return { configuration: checked, dirty: false, tests: Object.freeze({}) };
    });
  }
  async test(role) {
    const saved = this.value.configuration;
    if (busy(this.value) || this.value.phase === 'unknown' || this.value.dirty || !saved?.can_edit || saved.state === 'unconfigured'
      || ![...roles, 'projection'].includes(role) || role === 'projection' && !saved.projection.can_test) return null;
    const tests = { ...this.value.tests };
    delete tests[role];
    this.#emit({ ...this.value, tests: Object.freeze(tests) });
    return this.#perform('testing', '/v1/model-configuration/test', { version: saved.version, role }, result => {
      if (!keys(result, ['version', 'role', 'status', 'error_code']) || result.version !== saved.version || result.role !== role
        || !['passed', 'failed'].includes(result.status) || (result.status === 'passed' ? result.error_code !== null : typeof result.error_code !== 'string' || !/^[a-z][a-z0-9_]{0,95}$/u.test(result.error_code))) throw invalid();
      return { tests: Object.freeze({ ...this.value.tests, [role]: Object.freeze({ ...result }) }) };
    });
  }
  async activate() {
    const saved = this.value.configuration;
    if (busy(this.value) || this.value.phase === 'unknown' || this.value.dirty || !saved?.can_edit || saved.state === 'unconfigured') return null;
    return this.#perform('activating', '/v1/model-configuration/activate', { version: saved.version }, result => {
      const checked = checkedModelConfiguration(result);
      if (checked.version !== saved.version || checked.active_version !== saved.version || checked.state !== 'active') throw invalid();
      return { configuration: checked, dirty: false };
    });
  }
  async #perform(phase, path, body, validate) {
    const wasUnknown = this.value.phase === 'unknown';
    const serial = ++this.#serial; const controller = new AbortController(); this.#controller = controller; this.#operation = phase;
    this.#emit({ ...this.value, phase, error: null });
    try {
      const response = await this.#request(path, { method: phase === 'loading' ? 'GET' : phase === 'saving' ? 'PUT' : 'POST', ...(body === undefined ? {} : { body }), signal: controller.signal });
      if (serial !== this.#serial) return null;
      this.#emit({ ...this.value, ...validate(response), phase: 'ready', error: null }); return response;
    } catch (error) {
      if (serial !== this.#serial) return null;
      if (error?.status === 401) { this.close(); this.#auth(error); return null; }
      this.#emit({ ...this.value, phase: wasUnknown || ['saving', 'activating'].includes(phase) && !knownFailure(error) ? 'unknown' : 'error', error: safeError(error) });
      if (phase !== 'loading') throw this.value.error;
      return null;
    } finally { if (serial === this.#serial) { this.#controller = null; this.#operation = null; } }
  }
}
