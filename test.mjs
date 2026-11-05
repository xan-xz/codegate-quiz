import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('invites, session binding, server scoring and persistent bans',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'codegate-test-'));const proc=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'3137',ADMIN_KEY:'test-admin',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 try{
 await new Promise((resolve,reject)=>{proc.stdout.once('data',resolve);proc.once('error',reject);proc.once('exit',c=>reject(Error('server exit '+c)))});
 const call=async(path,body={},cookie='',admin=false)=>{const r=await fetch('http://127.0.0.1:3137/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,...(admin?{'X-Admin-Key':'test-admin'}:{})},body:JSON.stringify({browser:'device-1',...body})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}};
 assert.equal((await call('admin/list')).status,403);
 const make=async()=>{const r=await call('admin/create',{label:'Test'},'',true);return r.body.code};
 const code=await make();const raced=await Promise.all([call('redeem',{code}),call('redeem',{code,browser:'device-2'})]);assert.deepEqual(raced.map(x=>x.status).sort(),[200,403]);
 const code2=await make(),login=await call('redeem',{code:code2}),cookie=login.cookie;
 assert.equal((await call('state',{browser:'other'},cookie)).status,403);
 await call('start',{},cookie);const st=await call('state',{},cookie);assert.equal(st.body.questions.length,5);assert.equal(st.body.questions[0].a,undefined);
 assert.equal((await call('finish',{},cookie)).status,400);
 for(const [index,answer] of [1,2,0,2,1].entries())await call('answer',{index,answer},cookie);
 assert.equal((await call('finish',{},cookie)).body.score,5);
 const c3=await make(),l3=await call('redeem',{code:c3});await call('start',{},l3.cookie);await call('ban',{reason:'Tab hidden'},l3.cookie);assert.equal((await call('state',{},l3.cookie)).status,423);assert.equal((await call('finish',{},l3.cookie)).status,423);assert.equal((await call('redeem',{code:c3})).status,403);
 const c4=await make(),l4=await call('redeem',{code:c4});const rows=(await call('admin/list',{},'',true)).body.rows;await call('admin/revoke',{id:rows[0].id},'',true);assert.equal((await call('state',{},l4.cookie)).status,423);
 }finally{proc.kill();await new Promise(r=>proc.once('exit',r));rmSync(dir,{recursive:true,force:true})}
});
