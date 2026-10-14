import { ApiError } from './api.mjs';

const taskNames = { queued: '等待解析', processing: '正在解析', parsed: '已解析 · 未索引', failed: '解析失败', cancelled: '已取消' };
const indexTaskNames = { queued: '等待索引', processing: '正在索引', indexed: '已索引', failed: '索引失败', cancelled: '索引已取消' };

export function taskLabel(state, item) { return state === 'parsed' && item ? documentStatusLabel({ ...item, status: 'parsed' }) : taskNames[state] ?? '未知任务状态'; }
export function indexTaskLabel(state) { return indexTaskNames[state] ?? '未知索引状态'; }
export function taskPending(task) { return task?.state === 'queued' || task?.state === 'processing'; }

export function canStartIndexing(config, item) {
  return Array.isArray(config?.capabilities) && config.capabilities.includes('text_index') && config.capabilities.includes('indexings')
    && item?.can_index === true && item.status === 'parsed' && !item.synthetic_fixture && !item.active_revision_id && !item.latest_index_job;
}

export function documentStatusLabel(item) {
  if (item.status !== 'parsed') return item.status === 'ready' ? '演示就绪' : taskLabel(item.status);
  if (!item.synthetic_fixture && item.active_revision_id && item.index_publication_id) {
    if (taskPending(item.latest_index_job)) return `已解析 · 已索引 · ${item.latest_index_job.state === 'queued' ? '等待重建' : '正在重建'}`;
    return '已解析 · 已索引';
  }
  const indexState = item.index_status ?? 'not_indexed';
  return `已解析 · ${indexState === 'not_indexed' ? '未索引' : indexTaskLabel(indexState)}`;
}

export function checkedTask(value) {
  return checkedTaskShape(value, taskNames);
}

/** An exhausted, never-published index task may still be retried: the server restarts it as a new task. */
export function checkedIndexTask(value) {
  return checkedTaskShape(value, indexTaskNames, true);
}

function checkedTaskShape(value, names, restartable = false) {
  const validId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id);
  if (!value || !validId(value.task_id) || !validId(value.document_id) || !validId(value.revision_id)
    || !Object.hasOwn(names, value.state) || !Number.isInteger(value.attempt) || value.attempt < 1 || value.attempt > 3
    || typeof value.can_cancel !== 'boolean' || typeof value.can_retry !== 'boolean'
    || !(value.error_code === null || (typeof value.error_code === 'string' && /^[A-Za-z0-9_:-]{1,100}$/u.test(value.error_code)))
    || (value.can_cancel && !taskPending(value))
    || (value.can_retry && (!['failed', 'cancelled'].includes(value.state) || (!restartable && value.attempt >= 3)))) throw new Error('invalid task response');
  return Object.freeze({ task_id: value.task_id, document_id: value.document_id, revision_id: value.revision_id,
    state: value.state, attempt: value.attempt, error_code: value.error_code, can_cancel: value.can_cancel, can_retry: value.can_retry });
}

export function batchFeedback(ids, results) {
  const items = ids.map(id => {
    const matches = Array.isArray(results) ? results.filter(item => item.document_id === id) : [];
    if (matches.length !== 1 || typeof matches[0].ok !== 'boolean') {
      return { document_id: id, ok: false, error_code: 'missing_result', detail: '未收到有效结果，请刷新后核对本项。' };
    }
    const item = matches[0];
    return { document_id: id, ok: item.ok, error_code: item.error_code ?? '', detail: item.detail ?? (item.ok ? '操作成功。' : '操作未完成。') };
  });
  const succeeded = items.filter(item => item.ok).length;
  return { items, succeeded, failed: items.length - succeeded };
}

export function parseTags(value) {
  return [...new Set(value.split(/[,，\n]/u).map(tag => tag.trim()).filter(Boolean))];
}

const invalidTransition = () => new ApiError(502, '资料或任务状态不一致，请刷新后核对。');
/** Same permission gate the tasks page uses: the task capability plus the server's can_cancel/can_retry flag. */
export function taskOperationAllowed(config, kind, task, operation) {
  return ['cancel', 'retry'].includes(operation) && config?.capabilities?.includes(kind === 'indexing' ? 'indexings' : 'ingestions') === true
    && task?.[operation === 'cancel' ? 'can_cancel' : 'can_retry'] === true;
}
export const taskOperationPath = (kind, task, operation) => `/v1/${kind === 'indexing' ? 'indexings' : 'ingestions'}/${encodeURIComponent(task.task_id)}/${operation}`;

/** Validates a task read or cancel/retry receipt against the task it replaces; throws when identities or attempts drift. */
export function checkedTaskTransition(before, kind, value, actionName) {
  const next = kind === 'indexing' ? checkedIndexTask(value) : checkedTask(value);
  const restarted = kind === 'indexing' && actionName === 'retry' && next.task_id !== before.task_id;
  if (restarted && (next.document_id !== before.document_id || next.attempt !== 1 || next.state !== 'queued')) throw invalidTransition();
  if (!restarted && (next.task_id !== before.task_id || next.document_id !== before.document_id || next.revision_id !== before.revision_id
    || next.attempt < before.attempt || (actionName && next.attempt !== before.attempt + (actionName === 'retry' ? 1 : 0))
    || (next.attempt === before.attempt && (!taskPending(before) && next.state !== before.state || before.state === 'processing' && next.state === 'queued')))) throw invalidTransition();
  return next;
}
/** The row as the tasks page shows it after a task update: latest task replaced and its status field following the task state. */
export const rowWithTask = (row, kind, next) => ({ ...row, [kind === 'indexing' ? 'latest_index_job' : 'latest_job']: next, [kind === 'indexing' ? 'index_status' : 'status']: next.state });

