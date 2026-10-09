import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../public/api.mjs';
import { CleanupSession, cleanupEnabled, canRequestCleanup, cleanupLabel, checkedCleanup } from '../public/document-cleanup.mjs';

const kinds = ['database_payload','database_file','managed_backups','managed_temporaries','remote_inventory','remote_logical_rows','remote_write_terminal','remote_physical_storage','restore_barrier'];
const receipt = (id = 'doc-one', status = 'pending') => ({ document_id: id, cleanup_id: status === 'not_requested' ? null : 'cleanup-one', status: status === 'completed' ? 'deleted' : 'deleting', cleanup_status: status,
  requested_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:00:00Z', completed_at: status === 'completed' ? '2026-10-03T00:01:00Z' : null,
  error_code: ['blocked','failed'].includes(status) ? 'cleanup_blocked' : null, resources: status === 'not_requested' ? [] : kinds.map(kind => ({kind,status: status === 'completed' ? 'completed' : 'pending'})) });

test('cleanup uses its own actual capability and current writer eligibility, never can_delete', () => {
  assert.equal(cleanupEnabled({capabilities:['document_removal','document_delete']}), false);
  assert.equal(cleanupEnabled({capabilities:['document_cleanup']}), true);
  assert.equal(canRequestCleanup({document_id:'doc-one',can_edit:true,can_delete:false}), true);
  for (const row of [null, {document_id:'../one',can_edit:true}]) assert.equal(canRequestCleanup(row), false);
});
test('accepted, blocked, failed and unadopted withdrawals never claim completed deletion', () => {
  for (const status of ['not_requested','pending','running','blocked','failed','completed']) assert.equal(checkedCleanup(receipt('doc-one',status),'doc-one').cleanup_status,status);
  assert.match(cleanupLabel(receipt()), /待完成/u);
  assert.match(cleanupLabel(receipt('doc-one','blocked')), /受阻/u);
  assert.match(cleanupLabel(receipt('doc-one','failed')), /失败/u);
  assert.match(cleanupLabel(receipt('doc-one','completed')), /已完成/u);
});
test('cleanup receipt rejects mismatched identity, partial resources and false completion', () => {
  for (const change of [{document_id:'other'}, {cleanup_id:null}, {status:'deleted'}, {completed_at:'2026-10-03T00:00:00Z'}, {resources:[]}, {resources:[...receipt().resources.slice(1),receipt().resources[1]]}, {unexpected:true}, {error_code:'secret path /tmp/x'}]) assert.throws(() => checkedCleanup({...receipt(),...change},'doc-one'), ApiError);
  assert.throws(() => checkedCleanup({...receipt('doc-one','completed'),resources:receipt().resources},'doc-one'));
  assert.throws(() => checkedCleanup({...receipt('doc-one','blocked'),error_code:null},'doc-one'));
});
test('single cleanup has no body and accepted state survives ordinary document disappearance', async () => {
  const calls=[]; const session=new CleanupSession(async (path,options)=>{calls.push({path,options});return receipt();});
  await session.requestOne('doc-one');
  assert.equal(calls[0].path,'/v1/documents/doc-one/cleanup'); assert.equal(calls[0].options.method,'POST'); assert.equal(calls[0].options.body,undefined);
  assert.equal(session.value.records[0].cleanup_status,'pending'); assert.equal(session.value.phase,'ready');
});
test('batch captures every selected ID in order and distinguishes accepted, busy and hidden', async () => {
  const ids=['doc-one','doc-busy','doc-hidden'], calls=[];
  const result={items:[{document_id:ids[0],status:'accepted',cleanup:receipt(),error_code:null},{document_id:ids[1],status:'busy',cleanup:null,error_code:'document_busy'},{document_id:ids[2],status:'not_found',cleanup:null,error_code:'not_found'}],total:3};
  const session=new CleanupSession(async(path,options)=>{calls.push({path,options});return result;});
  const actual=await session.requestBatch(ids); assert.deepEqual(actual,result); assert.deepEqual(calls[0].options.body,{document_ids:ids});
  assert.equal(session.value.records.length,1); assert.equal(session.value.batch.items.length,3); assert.equal(session.value.records[0].status,'deleting');
  assert.equal(await session.requestBatch(['doc-one','doc-one']),null); assert.equal(calls.length,1);
});
test('partial or reordered batch response becomes unknown and cannot silently retry', async () => {
  let calls=0;const session=new CleanupSession(async()=>{calls++;return {items:[{document_id:'doc-one',status:'accepted',cleanup:receipt(),error_code:null}],total:1};});
  await assert.rejects(session.requestBatch(['doc-one','doc-two'])); assert.equal(session.value.phase,'unknown'); assert.deepEqual(session.value.unknownIds,['doc-one','doc-two']);
  assert.equal(await session.requestOne('doc-one'),null); assert.equal(calls,1);
});
test('network write uncertainty refreshes only and 404 never establishes completion', async () => {
  const calls=[];const session=new CleanupSession(async(path,options)=>{calls.push(options.method);throw new ApiError(options.method==='POST'?504:404,'safe');});
  await assert.rejects(session.requestOne('doc-one')); await session.load('doc-one');
  assert.deepEqual(calls,['POST','GET']); assert.deepEqual(session.value.unknownIds,['doc-one']); assert.equal(session.value.records.length,0);
  assert.equal(await session.requestOne('doc-one'),null);
});
test('a current authorized refresh resolves uncertainty without creating a new request', async () => {
  let calls=0;const session=new CleanupSession(async()=>{if(++calls===1)throw new ApiError(502,'safe');return receipt('doc-one','completed');});
  await assert.rejects(session.requestOne('doc-one')); await session.load('doc-one'); assert.deepEqual(session.value.unknownIds,[]); assert.equal(session.value.records[0].cleanup_status,'completed'); assert.equal(calls,2);
});
test('stop cancels local waiting only, suppresses late writes and leaves an explicit unknown record', async () => {
  let deliver,signal;const session=new CleanupSession((_path,options)=>new Promise(resolve=>{deliver=resolve;signal=options.signal;}));
  const pending=session.requestOne('doc-one'); session.stop(); assert.equal(signal.aborted,true); deliver(receipt('doc-one','completed')); assert.equal(await pending,null);
  assert.equal(session.value.phase,'unknown'); assert.deepEqual(session.value.unknownIds,['doc-one']); assert.equal(session.value.records.length,0);
});
test('identity reset isolates late reads and accepted writes from a new actor', async () => {
  for (const method of ['load','requestOne']) { let deliver;const session=new CleanupSession(()=>new Promise(resolve=>{deliver=resolve;}));const pending=session[method]('doc-one');session.close();deliver(receipt());await pending;assert.equal(session.value.phase,'idle');assert.deepEqual(session.value.records,[]);assert.deepEqual(session.value.unknownIds,[]); }
});
test('authorized records paging validates the whole page and uses only GET', async () => {
  const calls=[];const session=new CleanupSession(async(path,options)=>{calls.push({path,options});return {items:[receipt()],total:21,page:2,page_size:20};});
  await session.loadPage(2);assert.equal(calls[0].path,'/v1/management/document-cleanups?page=2&page_size=20');assert.equal(calls[0].options.method,'GET');assert.equal(session.value.total,21);
  const invalid=new CleanupSession(async()=>({items:[receipt(),receipt()],total:2,page:1,page_size:20}));await invalid.loadPage();assert.equal(invalid.value.phase,'error');assert.deepEqual(invalid.value.records,[]);
});
test('duplicate in-flight control is suppressed and authentication loss clears retained records', async () => {
  let deliver,calls=0;const session=new CleanupSession(()=>{calls++;return new Promise(resolve=>{deliver=resolve;});});const first=session.requestOne('doc-one');assert.equal(await session.requestOne('doc-two'),null);deliver(receipt());await first;assert.equal(calls,1);
  let failures=0;const expired=new CleanupSession(async()=>{throw new ApiError(401,'expired');},{onAuthenticationFailure:()=>failures++});await expired.loadPage();assert.equal(failures,1);
});

test('revoked or inconsistent single status never keeps a stale completed receipt visible', async () => {
  for (const next of [new ApiError(404,'not found'), {...receipt('doc-one','completed'),cleanup_id:'other-task'}]) {
    let count=0;const session=new CleanupSession(async()=>{if(++count===1)return receipt('doc-one','completed');if(next instanceof Error)throw next;return next;});
    await session.load('doc-one');assert.equal(session.value.records.length,1);await session.load('doc-one');assert.deepEqual(session.value.records,[]);assert.deepEqual(session.value.unknownIds,['doc-one']);assert.equal(await session.requestOne('doc-one'),null);
  }
});

test('an accepted write must contain a stable requested cleanup task rather than old withdrawal status',async()=>{
  const unrequested=new CleanupSession(async()=>receipt('doc-one','not_requested'));await assert.rejects(unrequested.requestOne('doc-one'));assert.equal(unrequested.value.phase,'unknown');assert.deepEqual(unrequested.value.records,[]);
  let calls=0;const changed=new CleanupSession(async()=>++calls===1?receipt():{...receipt(),cleanup_id:'different-task'});await changed.load('doc-one');await assert.rejects(changed.requestOne('doc-one'));assert.equal(changed.value.phase,'unknown');assert.equal(changed.value.records[0].cleanup_id,'cleanup-one');
});
