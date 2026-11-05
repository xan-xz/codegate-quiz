import html from './assessment.html?raw';

type Attempt={id:number;label:string;status:string;browser:string;reason:string|null;answers:string;score:number|null;first_name:string|null;last_name:string|null;joined_at:number|null;started_at:number|null;finished_at:number|null;last_seen_at:number|null;current_question:number;user_agent:string|null;created:string};
const questions=[
  {q:'Какое значение вернёт 2 + 3 * 4?',o:['20','14','24','9'],a:1},
  {q:'Какой тип данных хранит true и false?',o:['String','Number','Boolean','Array'],a:2},
  {q:'Что делает цикл?',o:['Повторяет инструкции','Удаляет программу','Создаёт базу данных','Шифрует файл'],a:0},
  {q:'Что вернёт JavaScript: typeof "hello"?',o:['text','String','string','object'],a:2},
  {q:'Для чего нужен Git?',o:['Для рисования','Для контроля версий кода','Для запуска SQL','Для создания паролей'],a:1},
];
const columns='id,label,status,reason,answers,score,created,first_name,last_name,joined_at,started_at,finished_at,last_seen_at,current_question,user_agent';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
const send=(status:number,value:unknown,extra:Record<string,string>={})=>Response.json(value,{status,headers:{...headers,...extra}});
const random=(size:number)=>Array.from(crypto.getRandomValues(new Uint8Array(size)),n=>n.toString(16).padStart(2,'0')).join('');
async function hash(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),n=>n.toString(16).padStart(2,'0')).join('');}
async function safe(a:string,b:string){const [x,y]=await Promise.all([hash(a),hash(b)]);let d=0;for(let i=0;i<x.length;i++)d|=x.charCodeAt(i)^y.charCodeAt(i);return d===0;}
const cleanName=(s:unknown)=>typeof s==='string'?s.normalize('NFKC').trim().replace(/\s+/g,' '):'';
const validName=(s:string)=>s.length>=1&&s.length<=60&&/^[\p{L}\p{M}][\p{L}\p{M}'’ .-]*$/u.test(s);
function summary(row:Attempt){const answers=JSON.parse(row.answers);return {...row,answers,answered:Object.keys(answers).length,duration_ms:row.started_at?Math.max(0,(row.finished_at||Date.now())-row.started_at):null};}
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
    if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();return send(413,{error:'Слишком большой запрос'})}chunks.push(value)}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
    b=JSON.parse(new TextDecoder().decode(bytes)||'{}');if(!b||Array.isArray(b)||typeof b!=='object')throw Error();
  }catch{return send(400,{error:'Некорректный запрос'})}
  const now=Date.now();
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
      if(path==='/api/admin/list'){
        const search=String(b.search||'').slice(0,120).toLocaleLowerCase('ru');
        const status=['ready','active','done','banned','new'].includes(String(b.status))?String(b.status):'';
        const before=Number.isSafeInteger(b.before)&&Number(b.before)>0?Number(b.before):Number.MAX_SAFE_INTEGER;
        const result=await db.prepare(`SELECT ${columns} FROM invites WHERE id<? AND (?='' OR instr(coalesce(search_name,lower(label)),?)>0 OR instr(label,?)>0) AND (?='' OR status=?) ORDER BY id DESC LIMIT 51`).bind(before,search,search,String(b.search||'').trim().slice(0,120),status,status).all<Attempt>();
        const rows=result.results.slice(0,50).map(summary);
        const stats=await db.prepare("SELECT count(*) AS total,sum(status='active') AS active,sum(status='ready') AS ready,sum(status='done') AS done,sum(status='banned') AS banned,round(avg(CASE WHEN status='done' THEN score END),2) AS average FROM invites WHERE status!='new'").first();
        return send(200,{rows,stats,next:result.results.length>50?rows.at(-1)?.id:null,server_time:now});
      }
      if(path==='/api/admin/report'){
        if(!Number.isSafeInteger(b.id))return send(400,{error:'Некорректный участник'});
        const row=await db.prepare(`SELECT ${columns} FROM invites WHERE id=?`).bind(b.id).first<Attempt>();
        if(!row)return send(404,{error:'Участник не найден'});
        const events=await db.prepare('SELECT id,kind,detail,created_at FROM attempt_events WHERE invite_id=? ORDER BY id DESC LIMIT 501').bind(b.id).all<{id:number;kind:string;detail:string;created_at:number}>();
        const answers=JSON.parse(row.answers);
        return send(200,{participant:summary(row),questions:questions.map((q,i)=>({...q,index:i,selected:answers[i]??null,correct:answers[i]===undefined?null:answers[i]===q.a})),events:events.results.slice(0,500).map(e=>({...e,detail:JSON.parse(e.detail)})),events_truncated:events.results.length>500,server_time:now});
      }
      if(path==='/api/admin/revoke'){
        if(!Number.isSafeInteger(b.id))return send(400,{error:'Некорректный участник'});
        const reason='Попытка остановлена администратором';
        await db.batch([
          db.prepare("INSERT INTO attempt_events(invite_id,kind,detail,created_at) SELECT id,'admin_ban',?,? FROM invites WHERE id=? AND status NOT IN ('banned','done')").bind(JSON.stringify({reason}),now,b.id),
          db.prepare("UPDATE invites SET status='banned',reason=?,finished_at=? WHERE id=? AND status NOT IN ('banned','done')").bind(reason,now,b.id),
        ]);return send(200,{ok:true});
      }
      if(path==='/api/admin/export'){
        const rows=await db.prepare(`SELECT ${columns} FROM invites ORDER BY id DESC`).all<Attempt>();
        const head=['ID','Имя','Фамилия','Имя в отчёте','Статус','Ответов','Баллы из 5','Регистрация UTC','Начало UTC','Окончание UTC','Последняя связь UTC','Время в секундах','Текущий вопрос','Причина',...questions.flatMap((_,i)=>[`Вопрос ${i+1}: ответ`,`Вопрос ${i+1}: верно`])];
        const date=(v:number|null)=>v?new Date(v).toISOString():'';
        const lines=rows.results.map(r=>{const s=summary(r);return [r.id,r.first_name,r.last_name,r.label,r.status,s.answered,r.score,date(r.joined_at),date(r.started_at),date(r.finished_at),date(r.last_seen_at),s.duration_ms===null?'':Math.round(s.duration_ms/1000),r.current_question+1,r.reason,...questions.flatMap((q,i)=>[s.answers[i]===undefined?'':q.o[s.answers[i]],s.answers[i]===undefined?'':s.answers[i]===q.a?'Да':'Нет'])].map(csvCell).join(';')});
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
      return send(200,{ok:true},{'Set-Cookie':`quiz=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${url.protocol==='https:'?'; Secure':''}`});
    }
    if(!row||!row.first_name)return send(401,{error:'Введите имя и фамилию'});
    if(row.browser!==browser)return send(403,{error:'Сессия привязана к другому браузеру'});
    if(row.status==='banned')return send(423,{error:row.reason||'Попытка заблокирована',banned:true});
    if(path==='/api/state')return send(200,{status:row.status,name:row.label,answers:JSON.parse(row.answers),score:row.score,currentQuestion:row.current_question,startedAt:row.started_at,questions:row.status==='active'?questions.map(({a,...q})=>q):[]});
    if(path==='/api/start'&&row.status==='ready'){
      const result=await db.batch([
        db.prepare("INSERT INTO attempt_events(invite_id,kind,created_at) SELECT id,'started',? FROM invites WHERE id=? AND status='ready'").bind(now,row.id),
        db.prepare("UPDATE invites SET status='active',started_at=?,last_seen_at=? WHERE id=? AND status='ready' RETURNING id").bind(now,now,row.id),
      ]);return result[1].results.length?send(200,{ok:true}):send(409,{error:'Статус попытки изменился. Обновите страницу.'});
    }
    if(path==='/api/ban'){
      const reason=String(b.reason||'Уход из окна теста').slice(0,160);
      await db.batch([
        db.prepare("INSERT INTO attempt_events(invite_id,kind,detail,created_at) SELECT id,'banned',?,? FROM invites WHERE id=? AND status='active'").bind(JSON.stringify({reason}),now,row.id),
        db.prepare("UPDATE invites SET status='banned',reason=?,finished_at=?,last_seen_at=? WHERE id=? AND status='active'").bind(reason,now,now,row.id),
      ]);return send(200,{ok:true});
    }
    if(row.status!=='active')return send(409,{error:'Попытка не активна'});
    if(path==='/api/progress'){
      if(!Number.isInteger(b.index)||Number(b.index)<0||Number(b.index)>4)return send(400,{error:'Некорректный вопрос'});
      await db.batch([
        db.prepare("INSERT INTO attempt_events(invite_id,kind,detail,created_at) SELECT id,'question',?,? FROM invites WHERE id=? AND status='active' AND current_question!=?").bind(JSON.stringify({index:b.index}),now,row.id,b.index),
        db.prepare("UPDATE invites SET current_question=?,last_seen_at=? WHERE id=? AND status='active'").bind(b.index,now,row.id),
      ]);return send(200,{ok:true});
    }
    if(path==='/api/answer'){
      if(!Number.isInteger(b.index)||Number(b.index)<0||Number(b.index)>4||!Number.isInteger(b.answer)||Number(b.answer)<0||Number(b.answer)>3)return send(400,{error:'Некорректный ответ'});
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
