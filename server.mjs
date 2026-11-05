import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes,createHash,timingSafeEqual } from 'node:crypto';
import { readFileSync,mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
mkdirSync(process.env.DATA_DIR||root+'data',{recursive:true});
const db=new DatabaseSync((process.env.DATA_DIR||root+'data')+'/quiz.sqlite');
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS invites(id INTEGER PRIMARY KEY, hash TEXT UNIQUE, label TEXT, status TEXT DEFAULT 'new', session TEXT, browser TEXT, reason TEXT, answers TEXT DEFAULT '{}', score INTEGER, created TEXT DEFAULT CURRENT_TIMESTAMP);`);
const hash=s=>createHash('sha256').update(s).digest('hex');
const secret=process.env.ADMIN_KEY||randomBytes(24).toString('hex');
if(!process.env.ADMIN_KEY) console.log('Ключ администратора (только для вас): '+secret);
const questions=[{q:'Какое значение вернёт 2 + 3 * 4?',o:['20','14','24','9'],a:1},{q:'Какой тип данных хранит true и false?',o:['String','Number','Boolean','Array'],a:2},{q:'Что делает цикл?',o:['Повторяет инструкции','Удаляет программу','Создаёт базу данных','Шифрует файл'],a:0},{q:'Что вернёт JavaScript: typeof "hello"?',o:['text','String','string','object'],a:2},{q:'Для чего нужен Git?',o:['Для рисования','Для контроля версий кода','Для запуска SQL','Для создания паролей'],a:1}];
const limits=new Map();
function limited(ip){const t=Date.now();let a=limits.get(ip)||{n:0,t};if(t-a.t>60000)a={n:0,t};a.n++;limits.set(ip,a);if(limits.size>10000)limits.clear();return a.n>60;}
const safe=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y)};
const server=http.createServer(async(req,res)=>{
 const send=(s,v)=>{res.writeHead(s,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(v))};
 try{
 const path=new URL(req.url,'http://localhost').pathname;
 if(!path.startsWith('/api/')){if(path!=='/'&&path!=='/admin')return send(404,{error:'Страница не найдена'});res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"});return res.end(readFileSync(root+'index.html'))}
 if(req.method!=='POST')return send(405,{error:'POST required'});
 if(req.headers.origin&&req.headers.origin!==`${req.headers['x-forwarded-proto']==='https'?'https':'http'}://${req.headers.host}`)return send(403,{error:'Origin rejected'});
 let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)return send(413,{error:'Слишком большой запрос'})}const b=JSON.parse(body||'{}');
 if(path.startsWith('/api/admin/')){
 if(!safe(req.headers['x-admin-key'],secret))return send(403,{error:'Неверный ключ администратора'});
 if(path.endsWith('/create')){const code=randomBytes(12).toString('hex').toUpperCase();db.prepare('INSERT INTO invites(hash,label) VALUES(?,?)').run(hash(code),String(b.label||'Участник').slice(0,80));return send(200,{code})}
 if(path.endsWith('/list'))return send(200,{rows:db.prepare('SELECT id,label,status,reason,score,created FROM invites ORDER BY id DESC LIMIT 200').all()});
 if(path.endsWith('/revoke')){db.prepare("UPDATE invites SET status='banned',reason='Доступ отозван администратором' WHERE id=?").run(Number(b.id));return send(200,{ok:true})}
 return send(404,{error:'Не найдено'});
 }
 if(path==='/api/redeem'){
 if(limited(req.socket.remoteAddress))return send(429,{error:'Слишком много попыток. Подождите минуту.'});
 const code=String(b.code||'').replace(/[\s-]/g,'').toUpperCase();const session=randomBytes(32).toString('hex');const row=db.prepare("UPDATE invites SET status='ready',session=?,browser=? WHERE hash=? AND status='new' RETURNING id").get(hash(session),String(b.browser||'').slice(0,100),hash(code));
 if(!row)return send(403,{error:'Код неверный, уже использован или отозван. Второе устройство не допускается.'});
 res.setHeader('Set-Cookie',`quiz=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.NODE_ENV==='production'?'; Secure':''}`);return send(200,{ok:true});
 }
 const token=(req.headers.cookie||'').match(/(?:^|;\s*)quiz=([a-f0-9]+)/)?.[1];const row=token?db.prepare('SELECT * FROM invites WHERE session=?').get(hash(token)):null;
 if(!row)return send(401,{error:'Введите одноразовый код'});
 if(row.browser!==String(b.browser||''))return send(403,{error:'Сессия привязана к другому браузеру'});
 if(row.status==='banned')return send(423,{error:row.reason||'Попытка заблокирована',banned:true});
 if(path==='/api/state')return send(200,{status:row.status,answers:JSON.parse(row.answers),score:row.score,questions:row.status==='active'?questions.map(({a,...q})=>q):[]});
 if(path==='/api/start'&&row.status==='ready'){db.prepare("UPDATE invites SET status='active' WHERE id=?").run(row.id);return send(200,{ok:true})}
 if(path==='/api/ban'&&row.status==='active'){const reason=String(b.reason||'Уход из окна теста').slice(0,160);db.prepare("UPDATE invites SET status='banned',reason=? WHERE id=?").run(reason,row.id);return send(200,{ok:true})}
 if(row.status!=='active')return send(409,{error:'Попытка не активна'});
 if(path==='/api/answer'){if(!Number.isInteger(b.index)||b.index<0||b.index>4||!Number.isInteger(b.answer)||b.answer<0||b.answer>3)return send(400,{error:'Некорректный ответ'});const answers=JSON.parse(row.answers);answers[b.index]=b.answer;db.prepare('UPDATE invites SET answers=? WHERE id=?').run(JSON.stringify(answers),row.id);return send(200,{ok:true})}
 if(path==='/api/finish'){const a=JSON.parse(row.answers);if(Object.keys(a).length!==5)return send(400,{error:'Ответьте на все вопросы'});const score=questions.reduce((s,q,i)=>s+Number(a[i]===q.a),0);db.prepare("UPDATE invites SET status='done',score=? WHERE id=?").run(score,row.id);return send(200,{score})}
 return send(404,{error:'Не найдено'});
 }catch(e){console.error(e);if(!res.headersSent)send(500,{error:'Ошибка сервера'});else res.end()}
});
server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('CodeGate: http://localhost:'+(process.env.PORT||3000)));
