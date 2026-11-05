import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../worker/assessment.ts',import.meta.url),'utf8').replace("import html from './assessment.html?raw';","const html='<!doctype html><title>CodeGate</title>';");
const {handleQuiz}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
function fixture(){
 const sql=new DatabaseSync(':memory:');
 const folder=new URL('../drizzle/',import.meta.url);
 for(const file of readdirSync(folder).filter(x=>x.endsWith('.sql')).sort()){
   sql.exec(readFileSync(new URL(file,folder),'utf8'));
   if(file.startsWith('0000'))sql.prepare("INSERT INTO invites(hash,label,status,browser) VALUES('legacy','Старый участник','ready','browser-1')").run();
 }
 const db={withSession(){return this},prepare(query){let args=[];return {bind(...v){args=v;return this},_all(){return sql.prepare(query).all(...args)},async first(){return sql.prepare(query).get(...args)||null},async run(){return sql.prepare(query).run(...args)},async all(){return {results:this._all()}}}},async batch(statements){sql.exec('BEGIN');try{const r=statements.map(s=>({results:s._all(),success:true}));sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
 const call=async(path,data={},cookie='',admin=false,browser='browser-1',origin)=>{const req=new Request('https://quiz.example/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,...(admin?{'X-Admin-Key':'test-admin'}:{}),...(origin?{Origin:origin}:{})},body:JSON.stringify({browser,...data})});const res=await handleQuiz(req,{DB:db,ADMIN_KEY:'test-admin'});return {status:res.status,body:res.headers.get('Content-Type')?.includes('text/csv')?await res.text():await res.json(),cookie:res.headers.get('Set-Cookie')?.split(';')[0],headers:res.headers}};
 return {sql,call};
}
test('name-only entry, session binding, atomic registration and validation',async()=>{
 const {sql,call}=fixture();try{
  assert.equal(sql.prepare("SELECT label FROM invites WHERE hash='legacy'").get().label,'Старый участник');
  assert.equal((await call('state')).status,401);
  assert.equal((await call('register',{firstName:'123',lastName:'Иванов'})).status,400);
  assert.equal((await call('register',{firstName:'Иван',lastName:''})).status,400);
  const results=await Promise.all([call('register',{firstName:'Иван',lastName:'Иванов'}),call('register',{firstName:'Пётр',lastName:'Петров'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const login=results.find(r=>r.status===200);
  assert.match(login.headers.get('Set-Cookie'),/HttpOnly/);assert.match(login.headers.get('Set-Cookie'),/Secure/);
  assert.equal((await call('state',{},login.cookie,false,'other-browser')).status,403);
  assert.equal((await call('register',{firstName:'Другое',lastName:'Имя'},login.cookie)).body.existing,true);
  assert.equal((await call('redeem',{code:'old-code'})).status,401);
  assert.equal((await call('admin/create',{},'',true)).status,404);
  assert.equal((await call('admin/report',{id:1})).status,403);
  assert.equal((await call('admin/list',{},'',true,'browser-1','https://other.example')).status,403);
 }finally{sql.close()}
});
test('live reporting records progress, answers, score, duration, events and CSV',async()=>{
 const {sql,call}=fixture();try{
  const login=await call('register',{firstName:'  Иван ',lastName:'Иванов'}),cookie=login.cookie;
  const rows=(await call('admin/list',{},'',true)).body.rows;
  const id=rows.find(r=>r.label==='Иван Иванов').id;
  assert.equal(rows[0].answered,0);assert.ok(rows[0].joined_at);
  await call('start',{},cookie);
  const state=(await call('state',{},cookie)).body;assert.equal(state.questions.length,5);assert.equal(state.questions[0].a,undefined);
  assert.equal((await call('finish',{},cookie)).status,409);
  await call('progress',{index:2},cookie);
  await call('answer',{index:0,answer:1},cookie);
  let report=(await call('admin/report',{id},'',true)).body;
  assert.equal(report.participant.answered,1);assert.equal(report.participant.status,'active');assert.ok(report.participant.last_seen_at);
  assert.equal(report.questions[0].correct,true);assert.equal(report.questions[1].selected,null);
  assert.ok(report.events.some(e=>e.kind==='question'&&e.detail.index===2));
  assert.ok(report.events.some(e=>e.kind==='answer'&&e.detail.answer===1));
  for(const [index,answer] of [1,2,0,2,0].entries())assert.equal((await call('answer',{index,answer},cookie)).status,200);
  assert.equal((await call('finish',{},cookie)).body.score,4);
  report=(await call('admin/report',{id},'',true)).body;
  assert.equal(report.participant.score,4);assert.equal(report.participant.status,'done');assert.ok(report.participant.finished_at>=report.participant.started_at);assert.equal(report.questions[4].correct,false);
  assert.ok(report.events.some(e=>e.kind==='finished'));
  const filtered=await call('admin/list',{search:'иван'},'',true);assert.equal(filtered.body.rows.length,1);
  const csv=await call('admin/export',{},'',true);assert.equal(csv.status,200);assert.match(csv.body,/Иванов/);assert.match(csv.body,/Вопрос 5: верно/);
  assert.equal((await call('answer',{index:0,answer:0},cookie)).status,409);
 }finally{sql.close()}
});
test('ban and admin stop preserve history and prevent later answer changes',async()=>{
 const {sql,call}=fixture();try{
  const login=await call('register',{firstName:'Анна',lastName:'Соколова'}),cookie=login.cookie;
  await call('start',{},cookie);await call('answer',{index:0,answer:0},cookie);
  for(let i=0;i<4;i++){sql.prepare('UPDATE invites SET last_violation_at=NULL').run();await call('violation',{reason:'Свернул окно',eventId:crypto.randomUUID()},cookie)}
  assert.equal((await call('state',{},cookie)).status,423);assert.equal((await call('answer',{index:0,answer:1},cookie)).status,423);
  const r=(await call('admin/list',{status:'banned'},'',true)).body.rows[0];
  assert.equal(r.reason,'Свернул окно');assert.equal(r.answers[0],0);assert.ok(r.finished_at);
  const report=(await call('admin/report',{id:r.id},'',true)).body;assert.ok(report.events.some(e=>e.kind==='banned'&&e.detail.reason==='Свернул окно'));
  const l2=await call('register',{firstName:'Анна',lastName:'Соколова'},'',false,'browser-2');assert.equal(l2.status,200);
  const id=(await call('admin/list',{},'',true)).body.rows[0].id;
  await call('admin/revoke',{id},'',true);assert.equal((await call('state',{},l2.cookie,false,'browser-2')).status,423);
  assert.ok((await call('admin/report',{id},'',true)).body.events.some(e=>e.kind==='admin_ban'));
 }finally{sql.close()}
});

test('three warnings then ban; duplicate and simultaneous browser events count once',async()=>{
 const {sql,call}=fixture();try{
  const login=await call('register',{firstName:'Проверка',lastName:'Предупреждений'}),cookie=login.cookie;
  await call('start',{},cookie);
  const eventId=crypto.randomUUID();
  const first=await call('violation',{reason:'Потеря фокуса',eventId},cookie);
  assert.equal(first.body.warnings,1);assert.equal(first.body.banned,false);
  assert.equal((await call('violation',{reason:'Повтор',eventId},cookie)).body.warnings,1);
  assert.equal((await call('violation',{reason:'visibilitychange',eventId:crypto.randomUUID()},cookie)).body.warnings,1);
  for(let n=2;n<=3;n++){
   sql.prepare('UPDATE invites SET last_violation_at=NULL').run();
   const warning=await call('violation',{eventId:crypto.randomUUID(),reason:'Уход из окна'},cookie);
   assert.equal(warning.body.warnings,n);assert.equal(warning.body.banned,false);
   assert.equal((await call('state',{},cookie)).body.warnings,n);
   assert.equal((await call('answer',{index:0,answer:1},cookie)).status,200);
  }
  sql.prepare('UPDATE invites SET last_violation_at=NULL').run();
  assert.equal((await call('violation',{eventId,reason:'Старый повтор'},cookie)).body.warnings,3);
  assert.equal((await call('state',{},cookie)).body.status,'active');
  const final=await call('violation',{eventId:crypto.randomUUID(),reason:'Четвёртое нарушение'},cookie);
  assert.equal(final.body.banned,true);assert.equal(final.body.warnings,3);
  assert.equal((await call('state',{},cookie)).status,423);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM attempt_events WHERE kind='warning'").get().n,3);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM attempt_events WHERE kind='banned'").get().n,1);
 }finally{sql.close()}
});

test('editable question counts, version conflicts and frozen attempts',async()=>{
 const {sql,call}=fixture();try{
  const config=(await call('admin/questions',{},'',true)).body;assert.equal(config.questions.length,5);
  assert.equal((await call('admin/questions/save',{revision:config.revision,questions:[]})).status,403);
  assert.equal((await call('admin/questions/save',{revision:config.revision,questions:[]},'',true)).status,400);
  const questions=[{q:'Первый новый вопрос?',o:['a','b','c','d'],a:2},{q:'Второй новый вопрос?',o:['e','f','g','h'],a:3}];
  const saved=await call('admin/questions/save',{revision:config.revision,questions},'',true);assert.equal(saved.status,200);assert.equal(saved.body.count,2);
  assert.equal((await call('admin/questions/save',{revision:config.revision,questions},'',true)).status,409);
  const login=await call('register',{firstName:'Первый',lastName:'Участник'}),cookie=login.cookie;
  assert.equal((await call('state',{},cookie)).body.questionCount,2);
  await call('start',{},cookie);
  assert.equal((await call('state',{},cookie)).body.questions[0].a,undefined);
  const newQuestion=[{q:'Только один вопрос',o:['1','2','3','4'],a:0}];
  await call('admin/questions/save',{revision:saved.body.revision,questions:newQuestion},'',true);
  const active=(await call('state',{},cookie)).body;assert.equal(active.questionCount,2);assert.equal(active.questions[0].q,'Первый новый вопрос?');
  await call('answer',{index:0,answer:2},cookie);await call('answer',{index:1,answer:3},cookie);
  assert.equal((await call('answer',{index:2,answer:0},cookie)).status,400);
  assert.equal((await call('finish',{},cookie)).body.score,2);
  const id=(await call('admin/list',{search:'Первый'},'',true)).body.rows[0].id;
  const report=(await call('admin/report',{id},'',true)).body;assert.equal(report.questions.length,2);assert.equal(report.questions[0].correct,true);assert.equal(report.participant.question_count,2);
  const login2=await call('register',{firstName:'Второй',lastName:'Участник'},'',false,'browser-2');
  await call('start',{},login2.cookie,false,'browser-2');
  const s2=(await call('state',{},login2.cookie,false,'browser-2')).body;assert.equal(s2.questionCount,1);assert.equal(s2.questions[0].q,newQuestion[0].q);
  await call('answer',{index:0,answer:0},login2.cookie,false,'browser-2');assert.equal((await call('finish',{},login2.cookie,false,'browser-2')).body.score,1);
  const csv=(await call('admin/export',{},'',true)).body;assert.match(csv,/Первый новый вопрос/);assert.match(csv,/Только один вопрос/);assert.match(csv,/Всего вопросов/);assert.match(csv,/Предупреждений/);
 }finally{sql.close()}
});
