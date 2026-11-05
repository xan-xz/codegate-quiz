import html from './quiz.html?raw';

type Invite = { id:number; status:string; browser:string; reason:string|null; answers:string; score:number|null };
const questions = [
  {q:'Какое значение вернёт 2 + 3 * 4?',o:['20','14','24','9'],a:1},
  {q:'Какой тип данных хранит true и false?',o:['String','Number','Boolean','Array'],a:2},
  {q:'Что делает цикл?',o:['Повторяет инструкции','Удаляет программу','Создаёт базу данных','Шифрует файл'],a:0},
  {q:'Что вернёт JavaScript: typeof "hello"?',o:['text','String','string','object'],a:2},
  {q:'Для чего нужен Git?',o:['Для рисования','Для контроля версий кода','Для запуска SQL','Для создания паролей'],a:1},
];
const headers = {'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY'};
const send = (status:number, value:unknown, extra:Record<string,string>={}) => Response.json(value,{status,headers:{...headers,...extra}});
const random = (size:number) => Array.from(crypto.getRandomValues(new Uint8Array(size)),n=>n.toString(16).padStart(2,'0')).join('');
async function hash(s:string) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),n=>n.toString(16).padStart(2,'0')).join('');}
async function safe(a:string,b:string) {const [x,y]=await Promise.all([hash(a),hash(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x.charCodeAt(i)^y.charCodeAt(i);return diff===0;}

export async function handleQuiz(request:Request, env:Cloudflare.Env):Promise<Response> {
  const url=new URL(request.url), path=url.pathname;
  if(path==='/'||path==='/admin') {
    if(request.method!=='GET'&&request.method!=='HEAD')return send(405,{error:'Method not allowed'});
    return new Response(request.method==='HEAD'?null:html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"}});
  }
  if(request.method!=='POST')return send(405,{error:'POST required'});
  const origin=request.headers.get('Origin');
  if(origin&&origin!==url.origin)return send(403,{error:'Origin rejected'});
  if(!env.DB||!env.ADMIN_KEY)return send(503,{error:'Сервис ещё настраивается'});
  const db=env.DB.withSession('first-primary');
  let b:Record<string,unknown>;
  try {
    if(Number(request.headers.get('Content-Length')||0)>8192)return send(413,{error:'Слишком большой запрос'});
    const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
    if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();return send(413,{error:'Слишком большой запрос'})}chunks.push(value)}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
    b=JSON.parse(new TextDecoder().decode(bytes)||'{}');
    if(!b||Array.isArray(b)||typeof b!=='object')throw Error('Invalid JSON');
  }catch{return send(400,{error:'Некорректный запрос'})}
  try {
    // Database-backed limits apply across all worker instances. Hashes keep raw IPs out of records.
    if(path==='/api/redeem'||path.startsWith('/api/admin/')){
      const now=Math.floor(Date.now()/1000), expiry=now+60;
      const key=await hash((request.headers.get('CF-Connecting-IP')||'unknown')+(path==='/api/redeem'?':redeem':':admin'));
      const rate=await db.prepare('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<=? THEN ? ELSE expires END RETURNING count').bind(key,expiry,now,now,expiry).first<{count:number}>();
      if(rate&&rate.count>120)return send(429,{error:'Слишком много запросов. Подождите минуту.'});
      await db.prepare('DELETE FROM rate_limits WHERE expires < ?').bind(now-3600).run();
    }
    if(path.startsWith('/api/admin/')){
      if(!await safe(request.headers.get('X-Admin-Key')||'',env.ADMIN_KEY))return send(403,{error:'Неверный ключ администратора'});
      if(path==='/api/admin/create'){
        const code=random(12).toUpperCase();
        await db.prepare('INSERT INTO invites(hash,label) VALUES(?,?)').bind(await hash(code),String(b.label||'Участник').slice(0,80)).run();
        return send(200,{code});
      }
      if(path==='/api/admin/list'){
        const rows=await db.prepare('SELECT id,label,status,reason,score,created FROM invites ORDER BY id DESC LIMIT 200').all();
        return send(200,{rows:rows.results});
      }
      if(path==='/api/admin/revoke'){
        if(!Number.isInteger(b.id)||Number(b.id)<1)return send(400,{error:'Некорректный участник'});
        await db.prepare("UPDATE invites SET status='banned',reason='Доступ отозван администратором' WHERE id=?").bind(b.id).run();
        return send(200,{ok:true});
      }
      return send(404,{error:'Не найдено'});
    }
    const browser=String(b.browser||'').slice(0,100);
    if(!browser)return send(400,{error:'Не найден идентификатор браузера'});
    if(path==='/api/redeem'){
      const code=String(b.code||'').replace(/[\s-]/g,'').toUpperCase(), session=random(32);
      const row=await db.prepare("UPDATE invites SET status='ready',session=?,browser=? WHERE hash=? AND status='new' RETURNING id").bind(await hash(session),browser,await hash(code)).first();
      if(!row)return send(403,{error:'Код неверный, уже использован или отозван. Второе устройство не допускается.'});
      return send(200,{ok:true},{'Set-Cookie':`quiz=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${url.protocol==='https:'?'; Secure':''}`});
    }
    const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)quiz=([a-f0-9]{64})(?:;|$)/)?.[1];
    const row=token?await db.prepare('SELECT id,status,browser,reason,answers,score FROM invites WHERE session=?').bind(await hash(token)).first<Invite>():null;
    if(!row)return send(401,{error:'Введите одноразовый код'});
    if(row.browser!==browser)return send(403,{error:'Сессия привязана к другому браузеру'});
    if(row.status==='banned')return send(423,{error:row.reason||'Попытка заблокирована',banned:true});
    if(path==='/api/state')return send(200,{status:row.status,answers:JSON.parse(row.answers),score:row.score,questions:row.status==='active'?questions.map(({a,...q})=>q):[]});
    if(path==='/api/start'&&row.status==='ready'){
      const updated=await db.prepare("UPDATE invites SET status='active' WHERE id=? AND status='ready' RETURNING id").bind(row.id).first();
      return updated?send(200,{ok:true}):send(409,{error:'Статус попытки изменился. Обновите страницу.'});
    }
    if(path==='/api/ban'){
      await db.prepare("UPDATE invites SET status='banned',reason=? WHERE id=? AND status='active'").bind(String(b.reason||'Уход из окна теста').slice(0,160),row.id).run();
      return send(200,{ok:true});
    }
    if(row.status!=='active')return send(409,{error:'Попытка не активна'});
    if(path==='/api/answer'){
      if(!Number.isInteger(b.index)||Number(b.index)<0||Number(b.index)>4||!Number.isInteger(b.answer)||Number(b.answer)<0||Number(b.answer)>3)return send(400,{error:'Некорректный ответ'});
      const updated=await db.prepare("UPDATE invites SET answers=json_set(answers,?,CAST(? AS INTEGER)) WHERE id=? AND status='active' RETURNING id").bind(`$.\"${b.index}\"`,b.answer,row.id).first();
      return updated?send(200,{ok:true}):send(423,{banned:true,error:'Попытка больше не активна'});
    }
    if(path==='/api/finish'){
      const scoring=questions.map((q,i)=>`CASE WHEN json_extract(answers,'$.\"${i}\"')=${q.a} THEN 1 ELSE 0 END`).join(' + ');
      const complete=questions.map((_,i)=>`json_type(answers,'$.\"${i}\"')='integer'`).join(' AND ');
      const updated=await db.prepare(`UPDATE invites SET status='done',score=(${scoring}) WHERE id=? AND status='active' AND ${complete} RETURNING score`).bind(row.id).first<{score:number}>();
      return updated?send(200,updated):send(409,{error:'Ответьте на все вопросы. Попытка должна быть активна.'});
    }
    return send(404,{error:'Не найдено'});
  }catch(e){console.error('Quiz request failed',e);return send(500,{error:'Ошибка сервера. Попробуйте ещё раз.'})}
}
