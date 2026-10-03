import { ApiError } from './api.mjs';

const ID = /^[A-Za-z0-9_-]{1,128}$/u;
const KINDS = ['database_payload','database_file','managed_backups','managed_temporaries','remote_inventory','remote_logical_rows','remote_write_terminal','remote_physical_storage','restore_barrier'];
const STATES = ['not_requested','pending','running','blocked','failed','completed'];
const RESOURCE_STATES = ['pending','running','completed','not_applicable','blocked','failed'];
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value,key));
const invalid = () => new ApiError(502,'清理回执不完整或身份不一致，请刷新授权记录。');
const safeTime = value => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const safeError = value => value === null || typeof value === 'string' && /^[a-z][a-z0-9_]{0,95}$/u.test(value);
export const cleanupEnabled = config => config?.capabilities?.includes('document_cleanup') === true;
export const canRequestCleanup = item => ID.test(item?.document_id ?? '') && item?.can_edit === true;
export function cleanupLabel(value) {
  return ({not_requested:'已撤下，尚未请求清理',pending:'已撤下，清理待完成',running:'已撤下，正在清理',blocked:'已撤下，清理受阻，尚未完成',failed:'已撤下，清理失败，尚未完成',completed:'受控清理已完成'})[value?.cleanup_status] ?? '结果未知，请刷新状态';
}
export function checkedCleanup(value, documentId = value?.document_id) {
  if (!keys(value,['document_id','cleanup_id','status','cleanup_status','requested_at','updated_at','completed_at','error_code','resources'])
      || !ID.test(documentId ?? '') || value.document_id !== documentId || !STATES.includes(value.cleanup_status)
      || !safeTime(value.requested_at) || !safeTime(value.updated_at) || !safeError(value.error_code) || !Array.isArray(value.resources)) throw invalid();
  const unrequested=value.cleanup_status==='not_requested', completed=value.cleanup_status==='completed';
  if (value.status !== (completed?'deleted':'deleting') || (unrequested ? value.cleanup_id !== null : !ID.test(value.cleanup_id ?? ''))
      || (completed ? !safeTime(value.completed_at) : value.completed_at !== null)
      || ((completed || unrequested) && value.error_code !== null)
      || (['blocked','failed'].includes(value.cleanup_status) && value.error_code === null)
      || value.resources.length !== (unrequested?0:KINDS.length)) throw invalid();
  const seen=new Set();
  for (const resource of value.resources) {
    if (!keys(resource,['kind','status']) || !KINDS.includes(resource.kind) || seen.has(resource.kind) || !RESOURCE_STATES.includes(resource.status)
        || (completed && !['completed','not_applicable'].includes(resource.status))) throw invalid();
    seen.add(resource.kind);
  }
  return Object.freeze({...value,resources:Object.freeze(value.resources.map(item=>Object.freeze({...item})))});
}
function checkedBatch(value,ids) {
  if (!keys(value,['items','total']) || value.total!==ids.length || !Array.isArray(value.items) || value.items.length!==ids.length) throw invalid();
  const items=value.items.map((item,index)=>{
    if (!keys(item,['document_id','status','cleanup','error_code']) || item.document_id!==ids[index] || !['accepted','busy','not_found'].includes(item.status)) throw invalid();
    if (item.status==='accepted') { if(item.error_code!==null)throw invalid();return Object.freeze({...item,cleanup:checkedCleanup(item.cleanup,ids[index])}); }
    if(item.cleanup!==null || item.error_code!==(item.status==='busy'?'document_busy':'not_found'))throw invalid();
    return Object.freeze({...item});
  });
  return Object.freeze({items:Object.freeze(items),total:value.total});
}
const idle=()=>({phase:'idle',records:[],unknownIds:[],batch:null,total:0,page:1,pageSize:20,error:null});
export class CleanupSession {
  constructor(request,{onChange=()=>{},onAuthenticationFailure=()=>{}}={}) {this.request=request;this.onChange=onChange;this.onAuthenticationFailure=onAuthenticationFailure;this.serial=0;this.controller=null;this.pendingIds=[];this.value=idle();}
  emit(value){this.value=value;this.onChange(value);}
  close(){this.serial++;this.controller?.abort();this.controller=null;this.pendingIds=[];this.emit(idle());}
  stop(){const ids=this.pendingIds;this.serial++;this.controller?.abort();this.controller=null;this.pendingIds=[];this.emit({...this.value,phase:ids.length?'unknown':'ready',unknownIds:[...new Set([...this.value.unknownIds,...ids])],error:null});}
  merge(records){const map=new Map(this.value.records.map(item=>[item.document_id,item]));for(const record of records)map.set(record.document_id,record);return [...map.values()];}
  async load(documentId){
    if(!ID.test(documentId??'') || this.value.phase==='requesting')return null;
    return this.read(`/v1/documents/${documentId}/cleanup`,value=>{
      const checked=checkedCleanup(value,documentId), previous=this.value.records.find(item=>item.document_id===documentId);
      if(previous?.cleanup_id && previous.cleanup_id!==checked.cleanup_id)throw invalid();
      return {records:this.merge([checked]),unknownIds:this.value.unknownIds.filter(id=>id!==documentId)};
    },()=>({records:this.value.records.filter(item=>item.document_id!==documentId),unknownIds:[...new Set([...this.value.unknownIds,documentId])]}));
  }
  async loadPage(page=1,pageSize=20){
    if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100||this.value.phase==='requesting')return null;
    return this.read(`/v1/management/document-cleanups?page=${page}&page_size=${pageSize}`,value=>{
      if(!keys(value,['items','total','page','page_size'])||value.page!==page||value.page_size!==pageSize||!Number.isSafeInteger(value.total)||value.total<0||!Array.isArray(value.items)||value.items.length>pageSize||value.total<value.items.length)throw invalid();
      const records=value.items.map(item=>checkedCleanup(item));if(new Set(records.map(item=>item.document_id)).size!==records.length)throw invalid();
      return {records,total:value.total,page,pageSize,unknownIds:this.value.unknownIds.filter(id=>!records.some(item=>item.document_id===id))};
    });
  }
  async read(path,validate,onFailure=()=>({})){
    this.controller?.abort();const serial=++this.serial;this.controller=new AbortController();this.emit({...this.value,phase:'reading',error:null});
    try{const response=await this.request(path,{method:'GET',signal:this.controller.signal});if(serial!==this.serial)return null;const result=validate(response);this.emit({...this.value,...result,phase:this.value.unknownIds.length && !Object.hasOwn(result,'unknownIds')?'unknown':'ready',error:null});return response;}
    catch(error){if(serial!==this.serial)return null;const update=onFailure();this.emit({...this.value,...update,phase:(update.unknownIds??this.value.unknownIds).length?'unknown':'error',error});if(error?.status===401)this.onAuthenticationFailure(error);return null;}
    finally{if(serial===this.serial)this.controller=null;}
  }
  requestOne(id){return this.write([id],false);}
  requestBatch(ids){return this.write(ids,true);}
  async write(ids,batch){
    if(!Array.isArray(ids)||ids.length<1||ids.length>100||ids.some(id=>!ID.test(id??''))||new Set(ids).size!==ids.length||this.value.phase==='requesting'||ids.some(id=>this.value.unknownIds.includes(id)))return null;
    const captured=[...ids];this.controller?.abort();const serial=++this.serial;this.controller=new AbortController();this.pendingIds=captured;this.emit({...this.value,phase:'requesting',batch:null,error:null});
    try{
      const response=await this.request(batch?'/v1/management/document-cleanups':`/v1/documents/${captured[0]}/cleanup`,{method:'POST',...(batch?{body:{document_ids:captured}}:{}),signal:this.controller.signal});
      if(serial!==this.serial)return null;
      const result=batch?checkedBatch(response,captured):checkedCleanup(response,captured[0]);
      const records=batch?result.items.filter(item=>item.status==='accepted').map(item=>item.cleanup):[result];
      if(records.some(item=>item.cleanup_status==='not_requested' || this.value.records.some(previous=>previous.document_id===item.document_id && previous.cleanup_id && previous.cleanup_id!==item.cleanup_id)))throw invalid();
      this.emit({...this.value,phase:'ready',records:this.merge(records),batch:batch?result:null,error:null});return result;
    }catch(error){
      if(serial!==this.serial)return null;
      const known=[400,401,403,404,409,413,415,422].includes(error?.status);
      this.emit({...this.value,phase:known?'error':'unknown',unknownIds:known?this.value.unknownIds:[...new Set([...this.value.unknownIds,...captured])],error});
      if(error?.status===401)this.onAuthenticationFailure(error);throw error;
    }finally{if(serial===this.serial){this.controller=null;this.pendingIds=[];}}
  }
}
