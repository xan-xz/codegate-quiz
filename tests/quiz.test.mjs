import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { stripTypeScriptTypes } from 'node:module';

// Exercise the actual Worker handler and migration SQL against SQLite, including
// conditional writes used by D1. Hosting is additionally verified after deploy.
const source=readFileSync(new URL('../worker/quiz.ts',import.meta.url),'utf8').replace("import html from './quiz.html?raw';","const html='<!doctype html><title>CodeGate</title>';");
const {handleQuiz}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));

test('cloud quiz: single-use codes, device binding, scoring and irreversible bans',async()=>{
  const sql=new DatabaseSync(':memory:');
  const migrations=new URL('../drizzle/',import.meta.url);
  for(const file of readdirSync(migrations).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL(file,migrations),'utf8'));
  const db={withSession(){return this},prepare(query){let args=[];return {bind(...values){args=values;return this},async first(){return sql.prepare(query).get(...args)||null},async run(){return sql.prepare(query).run(...args)},async all(){return {results:sql.prepare(query).all(...args)}}}}};
  const env={DB:db,ADMIN_KEY:'test-admin'};
  const call=async(path,data={},cookie='',admin=false,origin)=>{
    const req=new Request('https://quiz.example/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,...(admin?{'X-Admin-Key':'test-admin'}:{}),...(origin?{Origin:origin}:{})},body:JSON.stringify({browser:'device-1',...data})});
    const res=await handleQuiz(req,env);
    return {status:res.status,body:await res.json(),cookie:res.headers.get('Set-Cookie')?.split(';')[0]};
  };
  const make=async()=>{const r=await call('admin/create',{label:'Test'},'',true);assert.equal(r.status,200);return r.body.code};
  try{
    assert.equal((await handleQuiz(new Request('https://quiz.example/'),env)).status,200);
    assert.equal((await call('admin/list')).status,403);
    assert.equal((await call('admin/create',{},'',true,'https://other.example')).status,403);
    const code=await make();
    const raced=await Promise.all([call('redeem',{code}),call('redeem',{code,browser:'device-2'})]);
    assert.deepEqual(raced.map(x=>x.status).sort(),[200,403]);
    const code2=await make(),login=await call('redeem',{code:code2}),cookie=login.cookie;
    assert.equal((await call('state',{browser:'other'},cookie)).status,403);
    await call('start',{},cookie);
    const state=await call('state',{},cookie);assert.equal(state.body.questions.length,5);assert.equal(state.body.questions[0].a,undefined);
    assert.equal((await call('finish',{},cookie)).status,409);
    assert.equal((await call('answer',{index:5,answer:0},cookie)).status,400);
    await Promise.all([1,2,0,2,1].map((answer,index)=>call('answer',{index,answer},cookie)));
    assert.equal((await call('finish',{},cookie)).body.score,5);
    assert.equal((await call('answer',{index:0,answer:0},cookie)).status,409);
    const c3=await make(),l3=await call('redeem',{code:c3});await call('start',{},l3.cookie);
    await call('ban',{reason:'Tab hidden'},l3.cookie);
    assert.equal((await call('state',{},l3.cookie)).status,423);
    assert.equal((await call('finish',{},l3.cookie)).status,423);
    assert.equal((await call('redeem',{code:c3})).status,403);
    const c4=await make(),l4=await call('redeem',{code:c4});
    const rows=(await call('admin/list',{},'',true)).body.rows;
    await call('admin/revoke',{id:rows[0].id},'',true);
    assert.equal((await call('state',{},l4.cookie)).status,423);
  }finally{sql.close()}
});
