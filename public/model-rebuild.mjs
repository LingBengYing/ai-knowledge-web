import { ApiError } from './api.mjs';

const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const code = value => value === null || typeof value === 'string' && /^[a-z][a-z0-9_]{0,95}$/u.test(value);
const invalid = () => new ApiError(502, '重建状态不完整，请刷新批次状态核对。');
const idle = () => ({ phase: 'idle', status: null, error: null });
const messages = {
  configuration_required: '请先填写并保存模型配置。',
  no_rebuild_required: '当前草稿可直接应用，无需重建索引。',
  authorization_changed: '当前组织或资料状态已变化，请刷新后核对。',
  tasks_pending: '请等待已有解析、索引、原文件更新或清理任务结束，再刷新重建资格。',
  rebuild_in_progress: '已有重建批次正在处理，旧配置和已发布资料仍可使用。',
  model_rebuild_in_progress: '已有模型重建批次正在处理，请等待完成或刷新批次状态；旧配置和已发布资料仍可使用。',
  model_rebuild_failed: '本次模型重建未完成，旧配置和旧资料保持可用。请刷新状态，核对原因后再明确发起。',
  source_unavailable: '本次所需的保存材料不完整，请核对资料处理状态。',
  projection_configuration_required: '请先由服务管理员配置向量库。',
  model_configuration_unavailable: '模型配置暂不可用，请读取当前配置后核对。',
  configuration_conflict: '配置版本已改变，请重新读取配置。',
  configuration_busy: '当前有操作正在执行，请稍后刷新状态。',
  indexing_failed: '索引建立失败，旧配置和旧资料保持可用。',
  indexing_timeout: '索引处理超时，旧配置和旧资料保持可用。',
  indexing_output_invalid: '新索引未通过完整核对，旧配置和旧资料保持可用。',
  worker_interrupted: '批次处理已中断，旧配置和旧资料保持可用。',
  index_configuration_changed: '处理期间索引配置已变化，请重新读取配置和资格。',
};

export const modelRebuildEnabled = config => config?.capabilities?.includes('model_index_rebuild') === true;
export const modelRebuildPending = job => ['queued', 'running', 'applying'].includes(job?.state);
export const modelRebuildReason = reason => reason === null ? '' : messages[reason] ?? '当前操作未完成，请刷新状态并核对配置或资料。';

function checked(value) {
  if (!keys(value, ['target_version', 'active_version', 'required', 'can_start', 'reason', 'total_documents', 'job'])
    || !integer(value.target_version) || !(value.active_version === null || integer(value.active_version))
    || typeof value.required !== 'boolean' || typeof value.can_start !== 'boolean' || !code(value.reason)
    || !integer(value.total_documents)) throw invalid();
  if (value.job !== null) {
    const job = value.job;
    if (!keys(job, ['id', 'base_active_version', 'target_version', 'state', 'total_documents', 'completed_documents', 'error_code', 'created_at', 'updated_at'])
      || typeof job.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(job.id)
      || !(job.base_active_version === null || integer(job.base_active_version)) || !integer(job.target_version)
      || !['queued', 'running', 'applying', 'completed', 'failed'].includes(job.state)
      || !integer(job.total_documents) || !integer(job.completed_documents) || job.completed_documents > job.total_documents
      || !code(job.error_code) || (job.state === 'failed' ? job.error_code === null : job.error_code !== null)
      || !['created_at', 'updated_at'].every(key => typeof job[key] === 'string' && job[key].length <= 64 && Number.isFinite(Date.parse(job[key])))) throw invalid();
    if (value.can_start && modelRebuildPending(job)) throw invalid();
  }
  return Object.freeze({ ...value, job: value.job === null ? null : Object.freeze({ ...value.job }) });
}

/** One server-owned batch. Stopping a page read never cancels or recreates its work. */
export class ModelRebuildSession {
  constructor(request, { onChange = () => {}, onAuthenticationFailure = () => {}, onCompleted = async () => false,
    setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = timer => clearTimeout(timer) } = {}) {
    this.request = request; this.onChange = onChange; this.onAuthenticationFailure = onAuthenticationFailure;
    this.onCompleted = onCompleted; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.value = idle(); this.serial = 0; this.controller = null; this.timer = null; this.confirmedId = null;
  }
  emit(value) { this.value = Object.freeze(value); this.onChange(); }
  pause() {
    this.serial++; this.controller?.abort(); this.controller = null; this.clearTimer(this.timer); this.timer = null;
    this.emit({ ...this.value, phase: this.value.phase === 'starting' || this.value.phase === 'unknown' ? 'unknown' : this.value.status ? 'ready' : 'idle' });
  }
  close() { this.pause(); this.confirmedId = null; this.emit(idle()); }
  async load() { return this.perform(); }
  async start(version) {
    const status = this.value.status;
    if (this.controller || this.value.phase !== 'ready' || !status?.can_start || status.target_version !== version || modelRebuildPending(status.job)) return null;
    return this.perform(version);
  }
  async perform(version) {
    if (this.controller) return null;
    const write = version !== undefined, wasUnknown = this.value.phase === 'unknown', serial = ++this.serial, controller = new AbortController();
    this.clearTimer(this.timer); this.timer = null; this.controller = controller;
    this.emit({ ...this.value, phase: write ? 'starting' : 'loading', error: null });
    let status;
    try {
      const result = await this.request('/v1/model-configuration/rebuild', {
        method: write ? 'POST' : 'GET', ...(write ? { body: { version } } : {}), signal: controller.signal,
      });
      if (serial !== this.serial) return null;
      status = checked(result);
      if (write && (status.target_version !== version || status.job?.target_version !== version)) throw invalid();
      this.emit({ phase: 'ready', status, error: null });
    } catch (error) {
      if (serial !== this.serial) return null;
      if (error?.status === 401) { this.close(); this.onAuthenticationFailure(error); return null; }
      const failure = new ApiError(Number.isInteger(error?.status) ? error.status : 0,
        error?.status === 403 ? '当前身份不能发起此重建，请使用配置管理员身份。' : modelRebuildReason(error?.errorCode ?? 'unknown'));
      this.emit({ ...this.value, phase: write || wasUnknown ? 'unknown' : 'error', error: failure });
      return null;
    } finally { if (serial === this.serial) this.controller = null; }
    if (serial !== this.serial) return null;
    if (modelRebuildPending(status.job)) {
      this.timer = this.setTimer(() => { this.timer = null; if (serial === this.serial) this.load(); }, 1500);
    } else if (status.job?.state === 'completed' && status.target_version === status.job.target_version && this.confirmedId !== status.job.id) {
      const confirmed = await this.onCompleted(status.job);
      if (serial === this.serial && confirmed) this.confirmedId = status.job.id;
    }
    return status;
  }
}
