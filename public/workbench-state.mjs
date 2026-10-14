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
