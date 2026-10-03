import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { startDevServer } from '../scripts/dev-server.mjs';
import { startExternalServer } from '../scripts/external-server.mjs';

const publicOrigin = 'https://knowledge.example.invalid';
const cookie = 'rag_session=fixture';
async function fixture(t, external, handler, settings = {}) {
  const backend = http.createServer((req, res) => {
    if (external && req.url === '/health/entry-policy') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ enabled: true, public_origin: publicOrigin, auth_mode: 'jwt' }));
    } else if (external && req.url === '/v1/config') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ auth_mode: 'jwt', capabilities: [] }));
    } else if (external && req.url === '/v1/session') {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = req.headers.cookie === cookie ? 200 : 401;
      res.end(JSON.stringify({ status: res.statusCode === 200 ? 'authenticated' : 'unauthenticated' }));
    } else handler(req, res);
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => new Promise(r => { backend.close(r); backend.closeAllConnections(); }));
  const backendOrigin = `http://127.0.0.1:${backend.address().port}`;
  const server = await (external ? startExternalServer({ publicOrigin, backendOrigin, port: 0, ...settings })
    : startDevServer({ backendOrigin, port: 0, ...settings }));
  t.after(() => new Promise(r => { server.close(r); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { backendOrigin, request: (path, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request(origin, { path, method, headers: {
      ...(external ? { Host: new URL(publicOrigin).host, Cookie: cookie } : {}),
      ...(!['GET', 'HEAD'].includes(method) ? { Origin: external ? publicOrigin : origin } : {}), ...headers,
      ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }),
    } }, res => { const chunks = []; res.on('data', x => chunks.push(x)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })); });
    req.on('error', reject); req.end(body);
  }) };
}


for (const external of [false,true]) {
  const name=external?'external':'development';
  test(`${name} cleanup forwards exact bodyless control and authorized paging with ordinary identity`,async t=>{
    const seen=[];const {request}=await fixture(t,external,(req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{seen.push({path:req.url,method:req.method,body:Buffer.concat(chunks).toString(),headers:req.headers});res.setHeader('Content-Type','application/json');res.statusCode=req.method==='POST'?202:200;res.end('{}');});});
    assert.equal((await request('/v1/documents/doc-one/cleanup',{method:'POST'})).status,202);
    assert.equal((await request('/v1/documents/doc-one/cleanup')).status,200);
    assert.equal((await request('/v1/management/document-cleanups?page=2&page_size=20')).status,200);
    const body=JSON.stringify({document_ids:['one','missing','two']});assert.equal((await request('/v1/management/document-cleanups',{method:'POST',body,headers:{'Content-Type':'application/json'}})).status,202);
    assert.equal(seen.length,4);assert.equal(seen[0].body,'');assert.equal(seen[3].body,body);assert.equal(seen[2].path,'/v1/management/document-cleanups?page=2&page_size=20');
    assert.equal((await request('/document-cleanup.mjs')).status,200);
  });
  test(`${name} cleanup denies unknown paths, query, body and method without upstream`,async t=>{
    let calls=0;const {request}=await fixture(t,external,(_req,res)=>{calls++;res.end('{}');});
    for(const path of ['/v1/documents/one/cleanup/','/v1/documents/one/cleanup/more','/v1/management/document-cleanups/more'])assert.equal((await request(path)).status,404);
    for(const suffix of ['?','?x=1'])assert.equal((await request('/v1/documents/one/cleanup'+suffix)).status,400);
    for(const query of ['page=0','page=1&page=2','page_size=101','x=1','page=1.5'])assert.equal((await request('/v1/management/document-cleanups?'+query)).status,400);
    assert.equal((await request('/v1/management/document-cleanups?page=1',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}})).status,400);
    assert.equal((await request('/v1/documents/one/cleanup',{method:'POST',body:'{}'})).status,400);
    assert.equal((await request('/v1/documents/one/cleanup',{method:'DELETE'})).status,405);
    assert.equal((await request('/v1/management/document-cleanups',{method:'POST',body:'{}'})).status,415);
    assert.equal(calls,0);
  });
  test(`${name} cleanup keeps ordinary size and deadline rather than media privileges`,async t=>{
    let calls=0;const {request}=await fixture(t,external,(req,res)=>{calls++;req.resume();req.on('end',()=>setTimeout(()=>res.end('{}'),70));},{requestBytes:32,deadlineMs:20,answerDeadlineMs:1000});
    assert.equal((await request('/v1/management/document-cleanups',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(33)})).status,413);
    assert.equal((await request('/v1/documents/one/cleanup',{method:'POST'})).status,504);assert.equal(calls,1);
  });
}
