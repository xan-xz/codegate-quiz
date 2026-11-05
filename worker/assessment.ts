import html from './assessment.html?raw';

type Question={q:string;o:string[];a:number};
type Connection={ip_address:string|null;last_ip_address:string|null;last_user_agent:string|null;previous_attempt_id:number|null;next_attempt_id:number|null};
type Attempt=Connection&{id:number;label:string;status:string;browser:string;reason:string|null;answers:string;score:number|null;first_name:string|null;last_name:string|null;joined_at:number|null;started_at:number|null;finished_at:number|null;last_seen_at:number|null;current_question:number;user_agent:string|null;created:string;question_snapshot:string|null;violation_count:number;last_violation_id:string|null;last_violation_at:number|null};
const WARNING_LIMIT=3;
const defaultQuestions:Question[]=[
  {q:'Какое значение вернёт 2 + 3 * 4?',o:['20','14','24','9'],a:1},
  {q:'Какой тип данных хранит true и false?',o:['String','Number','Boolean','Array'],a:2},
  {q:'Что делает цикл?',o:['Повторяет инструкции','Удаляет программу','Создаёт базу данных','Шифрует файл'],a:0},
  {q:'Что вернёт JavaScript: typeof "hello"?',o:['text','String','string','object'],a:2},
  {q:'Для чего нужен Git?',o:['Для рисования','Для контроля версий кода','Для запуска SQL','Для создания паролей'],a:1},
];
const columns='id,label,status,reason,answers,score,created,first_name,last_name,joined_at,started_at,finished_at,last_seen_at,current_question,user_agent,question_snapshot,violation_count,last_violation_id,last_violation_at,ip_address,last_ip_address,last_user_agent,previous_attempt_id,next_attempt_id';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
const send=(status:number,value:unknown,extra:Record<string,string>={})=>Response.json(value,{status,headers:{...headers,...extra}});
const random=(size:number)=>Array.from(crypto.getRandomValues(new Uint8Array(size)),n=>n.toString(16).padStart(2,'0')).join('');
async function hash(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),n=>n.toString(16).padStart(2,'0')).join('');}
async function safe(a:string,b:string){const [x,y]=await Promise.all([hash(a),hash(b)]);let d=0;for(let i=0;i<x.length;i++)d|=x.charCodeAt(i)^y.charCodeAt(i);return d===0;}
const cleanName=(s:unknown)=>typeof s==='string'?s.normalize('NFKC').trim().replace(/\s+/g,' '):'';
const validName=(s:string)=>s.length>=1&&s.length<=60&&/^[\p{L}\p{M}][\p{L}\p{M}'’ .-]*$/u.test(s);
const questionsFor=(row:Attempt,readyQuestions=defaultQuestions):Question[]=>row.question_snapshot?JSON.parse(row.question_snapshot):row.status==='ready'?readyQuestions:defaultQuestions;
function deviceInfo(ua:string|null){if(!ua)return 'Нет данных';const os=/Android/i.test(ua)?'Android':/iPhone|iPad|iPod/i.test(ua)?'iOS / iPadOS':/Windows/i.test(ua)?'Windows':/Macintosh|Mac OS/i.test(ua)?'macOS':/Linux/i.test(ua)?'Linux':'ОС не определена';const browser=/Edg\//.test(ua)?'Edge':/OPR\//.test(ua)?'Opera':/Firefox\/|FxiOS\//.test(ua)?'Firefox':/Chrome\/|CriOS\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Браузер не определён';const kind=/iPad|Tablet/i.test(ua)||(/Android/i.test(ua)&&!/Mobile/i.test(ua))?'Планшет':/Mobile|iPhone|iPod/i.test(ua)?'Телефон':'Компьютер / другое устройство';return kind+' · '+os+' · '+browser;}
function summary(row:Attempt,readyQuestions=defaultQuestions){const answers=JSON.parse(row.answers);const {question_snapshot,...publicRow}=row;return {...publicRow,device:deviceInfo(row.user_agent),last_device:deviceInfo((row as Attempt&Connection).last_user_agent),answers,question_count:questionsFor(row,readyQuestions).length,warnings:Math.min(row.violation_count,WARNING_LIMIT),answered:Object.keys(answers).length,duration_ms:row.started_at?Math.max(0,(row.finished_at||Date.now())-row.started_at):null};}
async function settings(db:D1DatabaseSession){const row=await db.prepare("SELECT questions,revision FROM quiz_settings WHERE id='main'").first<{questions:string;revision:number}>();return {questions:row?JSON.parse(row.questions) as Question[]:defaultQuestions,revision:row?.revision||0};}
function validateQuestions(value:unknown):Question[]|null{
  if(!Array.isArray(value)||value.length<1||value.length>100)return null;
  const normalized:Question[]=[];
  for(const item of value){if(!item||typeof item.q!=='string'||!item.q.trim()||item.q.trim().length>1000||!Array.isArray(item.o)||item.o.length!==4||!item.o.every((o:unknown)=>typeof o==='string'&&o.trim().length>0&&o.trim().length<=500)||!Number.isInteger(item.a)||item.a<0||item.a>3)return null;normalized.push({q:item.q.trim(),o:item.o.map((o:string)=>o.trim()),a:item.a})}
  return normalized;
}
function csvCell(value:unknown){let s=String(value??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}

export async function handleQuiz(request:Request,env:Cloudflare.Env):Promise<Response>{
  const url=new URL(request.url),path=url.pathname;
  if(path==='/'||path==='/admin'){
    if(!['GET','HEAD'].includes(request.method))return send(405,{error:'Method not allowed'});
    return new Response(request.method==='HEAD'?null:html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"}});
  }
  if(request.method!=='POST')return send(405,{error:'POST required'});
  if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return send(403,{error:'Origin rejected'});
  if(!env.DB||!env.ADMIN_KEY)return send(503,{error:'Сервис ещё настраивается'});
  const db=env.DB.withSession('first-primary');
  let b:Record<string,unknown>;
  try{
    const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
    const maxBody=path==='/api/admin/questions/save'?524288:8192;
    if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBody){await reader.cancel();return send(413,{error:'Слишком большой запрос'})}chunks.push(value)}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
    b=JSON.parse(new TextDecoder().decode(bytes)||'{}');if(!b||Array.isArray(b)||typeof b!=='object')throw Error();
  }catch{return send(400,{error:'Некорректный запрос'})}
  const now=Date.now();
  const clientIp=request.headers.get('CF-Connecting-IP');
  const ip=clientIp&&/^[0-9a-fA-F:.]{3,45}$/.test(clientIp)?clientIp:null;
  const userAgent=(request.headers.get('User-Agent')||'').slice(0,350)||null;
  try{
    if(path==='/api/register'||path.startsWith('/api/admin/')){
      const sec=Math.floor(now/1000),expiry=sec+60;
      const key=await hash((request.headers.get('CF-Connecting-IP')||'unknown')+(path==='/api/register'?':register':':admin'));
      const rate=await db.prepare('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<=? THEN ? ELSE expires END RETURNING count').bind(key,expiry,sec,sec,expiry).first<{count:number}>();
      if(rate&&rate.count>120)return send(429,{error:'Слишком много запросов. Подождите минуту.'});
      await db.prepare('DELETE FROM rate_limits WHERE expires < ?').bind(sec-3600).run();
    }
    if(path.startsWith('/api/admin/')){
      if(!await safe(request.headers.get('X-Admin-Key')||'',env.ADMIN_KEY))return send(403,{error:'Неверный ключ администратора'});
      if(path==='/api/admin/questions')return send(200,await settings(db));
      if(path==='/api/admin/questions/save'){
        const questions=validateQuestions(b.questions);
        if(!questions)return send(400,{error:'Нужно от 1 до 100 вопросов. У каждого — текст, 4 непустых варианта и один правильный ответ.'});
        const current=await settings(db);
        if(!Number.isSafeInteger(b.revision)||b.revision!==current.revision)return send(409,{error:'Вопросы уже изменились. Обновите редактор и повторите изменения.'});
        const saved=await db.prepare("INSERT INTO quiz_settings(id,questions,revision,updated_at) VALUES('main',?,1,?) ON CONFLICT(id) DO UPDATE SET questions=excluded.questions,revision=quiz_settings.revision+1,updated_at=excluded.updated_at WHERE quiz_settings.revision=? RETURNING revision").bind(JSON.stringify(questions),now,b.revision).first<{revision:number}>();
        return saved?send(200,{ok:true,revision:saved.revision,count:questions.length}):send(409,{error:'Вопросы уже изменились. Обновите редактор.'});
      }
      if(path==='/api/admin/list'){
        const search=String(b.search||'').slice(0,120).toLocaleLowerCase('ru');
        const status=['ready','active','done','banned','new'].includes(String(b.status))?String(b.status):'';
        const before=Number.isSafeInteger(b.before)&&Number(b.before)>0?Number(b.before):Number.MAX_SAFE_INTEGER;
        const result=await db.prepare(`SELECT ${columns} FROM invites WHERE id<? AND (?='' OR instr(coalesce(search_name,lower(label)),?)>0 OR instr(label,?)>0) AND (?='' OR status=?) ORDER BY id DESC LIMIT 51`).bind(before,search,search,String(b.search||'').trim().slice(0,120),status,status).all<Attempt>();
        const current=await settings(db);
        const rows=result.results.slice(0,50).map(r=>summary(r,current.questions));
        const stats=await db.prepare("SELECT count(*) AS total,sum(status='active') AS active,sum(status='ready') AS ready,sum(status='done') AS done,sum(status='banned') AS banned,round(avg(CASE WHEN status='done' THEN score END),2) AS average FROM invites WHERE status!='new'").first();
        return send(200,{rows,stats,next:result.results.length>50?rows.at(-1)?.id:null,server_time:now});
      }
      if(path==='/api/admin/report'){
        if(!Number.isSafeInteger(b.id))return send(400,{error:'Некорректный участник'});
        const row=await db.prepare(`SELECT ${columns} FROM invites WHERE id=?`).bind(b.id).first<Attempt>();
        if(!row)return send(404,{error:'Участник не найден'});
        const events=await db.prepare('SELECT id,kind,detail,created_at FROM attempt_events WHERE invite_id=? ORDER BY id DESC LIMIT 501').bind(b.id).all<{id:number;kind:string;detail:string;created_at:number}>();
        const answers=JSON.parse(row.answers);
        const questions=questionsFor(row,(await settings(db)).questions);
        return send(200,{participant:summary(row,questions),questions:questions.map((q,i)=>({...q,index:i,selected:answers[i]??null,correct:answers[i]===undefined?null:answers[i]===q.a})),events:events.results.slice(0,500).map(e=>({...e,detail:JSON.parse(e.detail)})),events_truncated:events.results.length>500,server_time:now});
      }
      if(path==='/api/admin/revoke'){
        if(!Number.isSafeInteger(b.id))return send(400,{error:'Некорректный участник'});
        const reason='Попытка остановлена администратором';
        await db.batch([
          db.prepare("INSERT INTO attempt_events(invite_id,kind,detail,created_at) SELECT id,'admin_ban',?,? FROM invites WHERE id=? AND status NOT IN ('banned','done')").bind(JSON.stringify({reason}),now,b.id),
          db.prepare("UPDATE invites SET status='banned',reason=?,finished_at=? WHERE id=? AND status NOT IN ('banned','done')").bind(reason,now,b.id),
        ]);return send(200,{ok:true});
      }
      if(path==='/api/admin/unban'){
        if(!Number.isSafeInteger(b.id))return send(400,{error:'Некорректный участник'});
        const result=await db.batch([
          db.prepare("INSERT INTO attempt_events(invite_id,kind,created_at) SELECT id,'admin_unban',? FROM invites WHERE id=? AND status='banned' AND next_attempt_id IS NULL").bind(now,b.id),
          db.prepare("UPDATE invites SET status=CASE WHEN started_at IS NULL THEN 'ready' ELSE 'active' END,reason=NULL,finished_at=NULL,violation_count=0,last_violation_at=NULL,last_violation_id=NULL WHERE id=? AND status='banned' AND next_attempt_id IS NULL RETURNING id").bind(b.id),
        ]);
        return result[1].results.length?send(200,{ok:true}):send(409,{error:'Эта попытка не заблокирована или уже заменена новой.'});
      }
      if(path==='/api/admin/retry'){
        if(!Number.isSafeInteger(b.id))return send(400,{error:'Некорректный участник'});
        const target=await db.prepare(`SELECT ${columns},browser,session,search_name FROM invites WHERE id=?`).bind(b.id).first<Attempt&Connection&{session:string;search_name:string}>();
        if(!target)return send(404,{error:'Участник не найден'});
        if(!target.session||!target.first_name||target.next_attempt_id||!['banned','done'].includes(target.status))return send(409,{error:'Повторную попытку можно выдать для завершённого или заблокированного теста, если новая ещё не выдана.'});
        const newHash=await hash(random(24));
        const result=await db.batch([
          db.prepare("INSERT INTO invites(hash,label,status,browser,first_name,last_name,search_name,joined_at,previous_attempt_id) SELECT ?,label,'ready',browser,first_name,last_name,search_name,?,id FROM invites WHERE id=? AND status IN ('banned','done') AND next_attempt_id IS NULL AND session=? RETURNING id").bind(newHash,now,target.id,target.session),
          db.prepare('UPDATE invites SET session=NULL,next_attempt_id=(SELECT id FROM invites WHERE hash=?) WHERE id=? AND EXISTS(SELECT 1 FROM invites WHERE hash=?)').bind(newHash,target.id,newHash),
          db.prepare('UPDATE invites SET session=? WHERE hash=?').bind(target.session,newHash),
          db.prepare("INSERT INTO attempt_events(invite_id,kind,detail,created_at) SELECT ?, 'retry_granted',json_object('nextId',id),? FROM invites WHERE hash=?").bind(target.id,now,newHash),
          db.prepare("INSERT INTO attempt_events(invite_id,kind,detail,created_at) SELECT id,'retry_created',json_object('previousId',?),? FROM invites WHERE hash=?").bind(target.id,now,newHash),
        ]);
        return result[0].results.length?send(200,{ok:true,id:result[0].results[0].id}):send(409,{error:'Статус изменился. Обновите отчёт.'});
      }
      if(path==='/api/admin/export'){
        const rows=await db.prepare(`SELECT ${columns} FROM invites ORDER BY id DESC`).all<Attempt>();
        const current=await settings(db),maxQuestions=Math.max(current.questions.length,...rows.results.map(r=>questionsFor(r,current.questions).length));
        const head=['ID','Имя','Фамилия','Имя в отчёте','Статус','Ответов','Баллы','Всего вопросов','Предупреждений','Регистрация UTC','Начало UTC','Окончание UTC','Последняя связь UTC','Время в секундах','Текущий вопрос','Причина','Первый зафиксированный IP','Последний IP','Устройство','Последнее устройство','Предыдущая попытка','Следующая попытка',...Array.from({length:maxQuestions},(_,i)=>[`Вопрос ${i+1}: текст`,`Вопрос ${i+1}: ответ`,`Вопрос ${i+1}: верно`]).flat()];
        const date=(v:number|null)=>v?new Date(v).toISOString():'';
        const lines=rows.results.map(r=>{const s=summary(r,current.questions),questions=questionsFor(r,current.questions);return [r.id,r.first_name,r.last_name,r.label,r.status,s.answered,r.score,questions.length,s.warnings,date(r.joined_at),date(r.started_at),date(r.finished_at),date(r.last_seen_at),s.duration_ms===null?'':Math.round(s.duration_ms/1000),r.current_question+1,r.reason,r.ip_address,r.last_ip_address,s.device,s.last_device,r.previous_attempt_id,r.next_attempt_id,...Array.from({length:maxQuestions},(_,i)=>{const q=questions[i];return q?[q.q,s.answers[i]===undefined?'':q.o[s.answers[i]],s.answers[i]===undefined?'':s.answers[i]===q.a?'Да':'Нет']:['','','']}).flat()].map(csvCell).join(';')});
        return new Response('\uFEFF'+[head.map(csvCell).join(';'),...lines].join('\r\n'),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="codegate-report.csv"'}});
      }
      return send(404,{error:'Не найдено'});
    }
    const browser=String(b.browser||'').slice(0,100);
    if(!browser)return send(400,{error:'Не найден идентификатор браузера'});
    const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)quiz=([a-f0-9]{64})(?:;|$)/)?.[1];
    const row=token?await db.prepare(`SELECT ${columns},browser FROM invites WHERE session=?`).bind(await hash(token)).first<Attempt>():null;
    if(path==='/api/register'){
      if(row&&row.first_name&&row.browser===browser)return send(200,{ok:true,existing:true});
      const first=cleanName(b.firstName),last=cleanName(b.lastName);
      if(!validName(first)||!validName(last))return send(400,{error:'Укажите имя и фамилию буквами, до 60 символов каждое.'});
      const session=random(32),sessionHash=await hash(session);
      const results=await db.batch([
        db.prepare("INSERT INTO invites(hash,label,status,session,browser,first_name,last_name,search_name,joined_at,last_seen_at,user_agent) SELECT ?,?,'ready',?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM invites WHERE browser=? AND first_name IS NOT NULL) RETURNING id").bind(await hash(random(24)),first+' '+last,sessionHash,browser,first,last,(first+' '+last).toLocaleLowerCase('ru'),now,now,(request.headers.get('User-Agent')||'').slice(0,350),browser),
        db.prepare("INSERT INTO attempt_events(invite_id,kind,created_at) SELECT id,'registered',? FROM invites WHERE session=?").bind(now,sessionHash),
      ]);
      if(!results[0].results.length)return send(409,{error:'В этом браузере уже есть попытка. Откройте её в прежнем браузере или обратитесь к администратору.'});
      await db.prepare('UPDATE invites SET ip_address=?,last_ip_address=?,user_agent=?,last_user_agent=? WHERE session=?').bind(ip,ip,userAgent,userAgent,sessionHash).run();
      return send(200,{ok:true},{'Set-Cookie':`quiz=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${url.protocol==='https:'?'; Secure':''}`});
    }
    if(!row||!row.first_name)return send(401,{error:'Введите имя и фамилию'});
    if(row.browser!==browser)return send(403,{error:'Сессия привязана к другому браузеру'});
    await db.prepare('UPDATE invites SET ip_address=coalesce(ip_address,?),last_ip_address=coalesce(?,last_ip_address),user_agent=coalesce(user_agent,?),last_user_agent=coalesce(?,last_user_agent) WHERE id=?').bind(ip,ip,userAgent,userAgent,row.id).run();
    if(row.status==='banned')return send(423,{error:row.reason||'Попытка заблокирована',banned:true});
    const questions=questionsFor(row,row.status==='ready'?(await settings(db)).questions:defaultQuestions);
    if(path==='/api/state')return send(200,{status:row.status,name:row.label,answers:JSON.parse(row.answers),score:row.score,currentQuestion:row.current_question,startedAt:row.started_at,questionCount:questions.length,warnings:Math.min(row.violation_count,WARNING_LIMIT),warningLimit:WARNING_LIMIT,questions:row.status==='active'?questions.map(({a,...q})=>q):[]});
    if(path==='/api/start'&&row.status==='ready'){
      const result=await db.batch([
        db.prepare("INSERT INTO attempt_events(invite_id,kind,created_at) SELECT id,'started',? FROM invites WHERE id=? AND status='ready'").bind(now,row.id),
        db.prepare("UPDATE invites SET status='active',started_at=?,last_seen_at=?,question_snapshot=? WHERE id=? AND status='ready' RETURNING id").bind(now,now,JSON.stringify(questions),row.id),
      ]);return result[1].results.length?send(200,{ok:true}):send(409,{error:'Статус попытки изменился. Обновите страницу.'});
    }
    if(path==='/api/violation'||path==='/api/ban'){
      const reason=String(b.reason||'Уход из окна теста').slice(0,160);
      const eventId=typeof b.eventId==='string'?b.eventId:random(20);
      if(!/^[a-zA-Z0-9-]{16,80}$/.test(eventId))return send(400,{error:'Некорректное событие'});
      const key=row.id+':'+eventId;
      const result=await db.batch([
        db.prepare("UPDATE invites SET violation_count=violation_count+1,last_violation_at=?,last_violation_id=?,last_seen_at=?,status=CASE WHEN violation_count>=? THEN 'banned' ELSE status END,reason=CASE WHEN violation_count>=? THEN ? ELSE reason END,finished_at=CASE WHEN violation_count>=? THEN ? ELSE finished_at END WHERE id=? AND status='active' AND (last_violation_at IS NULL OR last_violation_at<=?) AND NOT EXISTS(SELECT 1 FROM attempt_events WHERE event_key=?)").bind(now,key,now,WARNING_LIMIT,WARNING_LIMIT,reason,WARNING_LIMIT,now,row.id,now-2000,key),
        db.prepare("INSERT INTO attempt_events(invite_id,kind,detail,created_at,event_key) SELECT id,CASE WHEN status='banned' THEN 'banned' ELSE 'warning' END,json_object('reason',?,'number',violation_count),?,? FROM invites WHERE id=? AND last_violation_id=? AND NOT EXISTS(SELECT 1 FROM attempt_events WHERE event_key=?)").bind(reason,now,key,row.id,key,key),
        db.prepare('SELECT status,violation_count,reason FROM invites WHERE id=?').bind(row.id),
      ]);
      const updated=result[2].results[0] as {status:string;violation_count:number;reason:string|null};
      return send(200,{ok:true,banned:updated.status==='banned',warnings:Math.min(updated.violation_count,WARNING_LIMIT),warningLimit:WARNING_LIMIT,error:updated.status==='banned'?updated.reason:undefined,reason});
    }
    if(row.status!=='active')return send(409,{error:'Попытка не активна'});
    if(path==='/api/progress'){
      if(!Number.isInteger(b.index)||Number(b.index)<0||Number(b.index)>=questions.length)return send(400,{error:'Некорректный вопрос'});
      await db.batch([
        db.prepare("INSERT INTO attempt_events(invite_id,kind,detail,created_at) SELECT id,'question',?,? FROM invites WHERE id=? AND status='active' AND current_question!=?").bind(JSON.stringify({index:b.index}),now,row.id,b.index),
        db.prepare("UPDATE invites SET current_question=?,last_seen_at=? WHERE id=? AND status='active'").bind(b.index,now,row.id),
      ]);return send(200,{ok:true});
    }
    if(path==='/api/answer'){
      if(!Number.isInteger(b.index)||Number(b.index)<0||Number(b.index)>=questions.length||!Number.isInteger(b.answer)||Number(b.answer)<0||Number(b.answer)>=questions[Number(b.index)].o.length)return send(400,{error:'Некорректный ответ'});
      const result=await db.batch([
        db.prepare("INSERT INTO attempt_events(invite_id,kind,detail,created_at) SELECT id,'answer',?,? FROM invites WHERE id=? AND status='active'").bind(JSON.stringify({index:b.index,answer:b.answer}),now,row.id),
        db.prepare("UPDATE invites SET answers=json_set(answers,?,CAST(? AS INTEGER)),last_seen_at=?,current_question=? WHERE id=? AND status='active' RETURNING id").bind(`$."${b.index}"`,b.answer,now,b.index,row.id),
      ]);return result[1].results.length?send(200,{ok:true}):send(423,{banned:true,error:'Попытка больше не активна'});
    }
    if(path==='/api/finish'){
      const scoring=questions.map((q,i)=>`CASE WHEN json_extract(answers,'$."${i}"')=${q.a} THEN 1 ELSE 0 END`).join(' + ');
      const complete=questions.map((_,i)=>`json_type(answers,'$."${i}"')='integer'`).join(' AND ');
      const result=await db.batch([
        db.prepare(`INSERT INTO attempt_events(invite_id,kind,created_at) SELECT id,'finished',? FROM invites WHERE id=? AND status='active' AND ${complete}`).bind(now,row.id),
        db.prepare(`UPDATE invites SET status='done',score=(${scoring}),finished_at=?,last_seen_at=? WHERE id=? AND status='active' AND ${complete} RETURNING score`).bind(now,now,row.id),
      ]);return result[1].results.length?send(200,result[1].results[0]):send(409,{error:'Ответьте на все вопросы. Попытка должна быть активна.'});
    }
    return send(404,{error:'Не найдено'});
  }catch(e){console.error('Assessment request failed',e);return send(500,{error:'Ошибка сервера. Попробуйте ещё раз.'})}
}
