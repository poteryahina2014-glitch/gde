(function(){
"use strict";
const EMOJIS=["🏡","🏢","🚪","🗄️","🧳","🎒","👜","💼","👝","🛍️","📦","🗃️","📁","📂","🗂️","🧰","🔌","🔋","🖱️","💻","📱","🎧","💊","🩹","🥫","🍫","🐱","🧥","👟","🧸","🔑","📄"];
const $=s=>document.querySelector(s);
const main=$("#main");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ls={get(k,d){try{const v=localStorage.getItem("gde:"+k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem("gde:"+k,JSON.stringify(v))}catch(e){}}};
const norm=s=>String(s||"").toLowerCase().replace(/ё/g,"е").replace(/\s+/g," ").trim();
const DAY=864e5;

/* ---------- data: Supabase tables, camelCase in the app, snake_case in the base ---------- */
const sb=supabase.createClient(CONFIG.url,CONFIG.key);
const TBL={places:"w_places",items:"w_items",rules:"w_rules"};
const COLS=Object.keys(TBL);
const FIELDS={
  places:["parentId","name","emoji","note","kit","order"],
  items:["placeId","name","note","qty","checkOn"],
  rules:["name","words","need","order"],
};
const MAP={parentId:"parent_id",placeId:"place_id",checkOn:"check_on",order:"ord",taskId:"task_id",createdAt:"created_at",updatedAt:"updated_at"};
const UNMAP=Object.fromEntries(Object.entries(MAP).map(([a,b])=>[b,a]));
function fromRow(r){const o={};for(const [k,v] of Object.entries(r)){if(k==="user_id")continue;o[UNMAP[k]||k]=v}if(!Array.isArray(o.words))o.words=o.words?[o.words]:[];return o}
function toRow(col,o){
  const r={};
  for(const k of FIELDS[col]){
    if(!(k in o))continue;let v=o[k];
    if(k==="parentId"||k==="placeId"||k==="checkOn")v=v||null;
    r[MAP[k]||k]=v;
  }
  return r;
}

let S={places:{},items:{},rules:{}};
let user=null,loaded=false;

const queues={};
function enqueue(path,fn){const p=(queues[path]||Promise.resolve()).then(fn,fn);queues[path]=p.catch(()=>{});return p}
const isNet=e=>navigator.onLine===false||/failed to fetch|networkerror|load failed|network request/i.test(e&&e.message||"");
function fail(e){console.error(e);toast("Не удалось сохранить: "+(isNet(e)?"нет связи":e&&e.message||"проверь интернет"));load(true)}
const newId=()=>crypto.randomUUID();
const done=r=>{if(r.error)throw r.error;return r};

// srv — то, что точно есть в базе: не сохранилось — экран возвращается к нему
let srv={places:{},items:{},rules:{}};
const pend={};
let wseq=0;   // меняется при каждой записи: ответ load, начатый до неё, устарел
function write(col,id,fn,ok){
  const path=col+"/"+id;pend[path]=(pend[path]||0)+1;wseq++;
  const end=()=>{
    wseq++;
    if(--pend[path])return;
    delete pend[path];
    if(JSON.stringify(S[col][id])===JSON.stringify(srv[col][id]))return;
    if(srv[col][id])S[col][id]=srv[col][id];else delete S[col][id];
    render();
  };
  // true — сохранилось, false — нет (сообщение уже показано)
  return enqueue(path,fn).then(()=>{ok();end();return true},e=>{end();fail(e);return false});
}
function put(col,id,data){
  S[col][id]=Object.assign({},S[col][id],data,{id});render();
  return write(col,id,()=>sb.from(TBL[col]).upsert({id,...toRow(col,data)}).then(done),()=>{srv[col][id]=Object.assign({},srv[col][id],data,{id})});
}
function patch(col,id,p){
  const cur=S[col][id];if(!cur)return Promise.resolve(false);
  S[col][id]=Object.assign({},cur,p);render();
  return write(col,id,()=>sb.from(TBL[col]).update(toRow(col,p)).eq("id",id).then(done),()=>{if(srv[col][id])srv[col][id]=Object.assign({},srv[col][id],p)});
}
function del(col,id){
  delete S[col][id];render();
  return write(col,id,()=>sb.from(TBL[col]).delete().eq("id",id).then(done),()=>{delete srv[col][id]});
}

async function fetchAll(){
  const rs=await Promise.all(COLS.map(c=>sb.from(TBL[c]).select("*")));
  const bad=rs.find(r=>r.error);if(bad)throw bad.error;
  const out={};COLS.forEach((c,i)=>{const o={};rs[i].data.forEach(r=>o[r.id]=fromRow(r));out[c]=o});
  return out;
}
async function load(quiet){
  try{
    const w=wseq,d=await fetchAll();if(w!==wseq)return load(quiet);
    S=d;srv={};COLS.forEach(c=>srv[c]={...S[c]});loaded=true;render()}
  catch(e){
    console.error(e);
    const net=isNet(e),why=e&&e.message||"";
    if(loaded){if(quiet!==true)toast(net?"Нет связи — показано загруженное раньше":"Не удалось обновить: "+why);return}
    const noTable=/42P01|PGRST205/.test(e&&e.code||"")||/does not exist|schema cache/i.test(why);
    main.innerHTML=noTable?`<div class="empty"><b>База ещё не готова</b>Нужно один раз запустить файл <code>001_gde.sql</code> в Supabase → SQL Editor.</div>`
      :`<div class="empty"><b>${net?"Нет связи":"Не удалось загрузить"}</b>${net?"":`<p>${esc(why)}</p>`}<button class="btn" id="retry">Повторить</button></div>`;
    const r=$("#retry");if(r)r.onclick=()=>load();
  }
}
let channel=null;
function listen(){
  if(channel)return;
  channel=sb.channel("gde");
  COLS.forEach(c=>channel.on("postgres_changes",{event:"*",schema:"public",table:TBL[c]},p=>{
    if(p.eventType==="DELETE"){delete S[c][p.old.id];delete srv[c][p.old.id]}else S[c][p.new.id]=srv[c][p.new.id]=fromRow(p.new);
    render();
  }));
  channel.subscribe();
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&user)load()});
window.addEventListener("online",()=>{if(user)load(true)});

/* ---------- sign-in: the same account as in «Задачи» and Корзинка ---------- */
function renderLogin(msg="",err=false){
  $("#top").hidden=true;
  main.innerHTML=`<form class="acard" id="login">
    <h2>📦 Где что лежит</h2>
    <p class="meta" style="text-align:center;margin:0">Вход тот же, что в «Задачах» и Корзинке.</p>
    <div class="fld"><label for="email">Почта</label><input id="email" type="email" autocomplete="email" required></div>
    <div class="fld"><label for="pass">Пароль</label><input id="pass" type="password" autocomplete="current-password" required></div>
    <button class="btn pri" type="submit">Войти</button>
    ${msg?`<p class="meta" style="margin:0;${err?"color:var(--danger)":""}">${esc(msg)}</p>`:""}
  </form>`;
  $("#login").addEventListener("submit",async e=>{
    e.preventDefault();
    const {error}=await sb.auth.signInWithPassword({email:$("#email").value.trim(),password:$("#pass").value});
    if(error)renderLogin(/invalid login/i.test(error.message)?"Неверная почта или пароль":error.message,true);
  });
}
sb.auth.onAuthStateChange((ev,session)=>{
  const was=user&&user.id;user=session?session.user:null;
  if(!user){loaded=false;renderLogin();return}
  $("#top").hidden=false;
  if(was!==user.id)setTimeout(()=>{load();listen()},0);
});

/* ---------- places tree ---------- */
const places=()=>Object.values(S.places);
const byOrder=(a,b)=>(a.order||0)-(b.order||0)||a.name.localeCompare(b.name,"ru");
const exists=id=>!!(id&&S.places[id]);
function kids(pid){return places().filter(p=>(exists(p.parentId)?p.parentId:"")===(pid||"")).sort(byOrder)}
function itemsIn(pid){
  return Object.values(S.items).filter(i=>pid==="none"?!exists(i.placeId):i.placeId===pid).sort((a,b)=>a.name.localeCompare(b.name,"ru"));
}
function chain(pid){const out=[];let p=S.places[pid],guard=0;while(p&&guard++<30){out.unshift(p);p=exists(p.parentId)?S.places[p.parentId]:null}return out}
const pathText=pid=>pid&&exists(pid)?chain(pid).map(p=>p.name).join(" › "):"Без места";
// every place inside pid (pid included); stopAtKits skips nested kit bags (they are checked on their own)
function subtree(pid,stopAtKits){
  const out=new Set([pid]),stack=[pid];
  while(stack.length){const c=stack.pop();for(const k of kids(c)){if(out.has(k.id)||(stopAtKits&&k.kit))continue;out.add(k.id);stack.push(k.id)}}
  return out;
}
function countIn(pid){const set=subtree(pid);let n=0;for(const i of Object.values(S.items))if(set.has(i.placeId))n++;return n}
function plural(n,a,b,c){const m=n%10,h=n%100;return n+" "+(m===1&&h!==11?a:m>=2&&m<=4&&(h<12||h>14)?b:c)}

/* ---------- kit check ---------- */
const rules=()=>Object.values(S.rules).sort(byOrder);
const kits=()=>places().filter(p=>p.kit).sort((a,b)=>pathText(a.id).localeCompare(pathText(b.id),"ru"));
// слова: через запятую — любой из вариантов, через пробел — нужны все сразу
const fits=(rule,item)=>(rule.words||[]).some(w=>hasAll(norm(w).split(" ").filter(Boolean),item.name));
function hasAll(toks,...texts){if(!toks.length)return false;const s=norm(texts.join(" "));return toks.every(t=>s.includes(t))}
function checkKit(kid){
  const set=subtree(kid,true);
  const its=Object.values(S.items).filter(i=>set.has(i.placeId));
  return rules().map(r=>{
    const m=its.filter(i=>+i.qty>0&&fits(r,i));
    const have=m.reduce((s,i)=>s+(+i.qty||0),0),need=+r.need||1;
    return {rule:r,items:m,have,need,st:have<need?"miss":have>need?"extra":"ok"};
  });
}
function problems(){let n=0;for(const k of kits())for(const c of checkKit(k.id))if(c.st!=="ok")n++;return n}

/* ---------- dates ---------- */
function today(){const d=new Date();d.setHours(0,0,0,0);return d}
function daysTo(s){if(!s)return null;const [y,m,d]=s.split("-").map(Number);return Math.round((new Date(y,m-1,d)-today())/DAY)}
const fmtDate=s=>{if(!s)return"";const [y,m,d]=s.split("-");return `${d}.${m}.${y}`};
function dateBadge(s){
  const n=daysTo(s);if(n==null)return"";
  if(n<0)return `<span class="badge b-late">истёк ${fmtDate(s)}</span>`;
  if(n===0)return `<span class="badge b-late">сегодня</span>`;
  if(n<=30)return `<span class="badge b-soon">через ${plural(n,"день","дня","дней")}</span>`;
  return `<span class="badge b-date">${fmtDate(s)}</span>`;
}
const dated=()=>Object.values(S.items).filter(i=>i.checkOn).sort((a,b)=>a.checkOn.localeCompare(b.checkOn));
const dueCount=()=>dated().filter(i=>daysTo(i.checkOn)<=0).length;

/* ---------- navigation (hash, so the phone's back button works) ---------- */
let tab="places",cur="",query="";
function readHash(){
  const h=new URLSearchParams(location.hash.slice(1));
  tab=["places","check","dates"].includes(h.get("t"))?h.get("t"):"places";
  cur=h.get("p")||"";
}
function go(t,p){
  if(backing){backing.then(()=>go(t,p));return}
  const h=new URLSearchParams();if(t&&t!=="places")h.set("t",t);if(p)h.set("p",p);
  const s=h.toString();
  if(query){query="";$("#q").value=""}
  if(("#"+s)!==location.hash&&!(s===""&&location.hash===""))location.hash=s;else{readHash();render()}
  window.scrollTo(0,0);
}
window.addEventListener("hashchange",()=>{readHash();render()});
readHash();
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>go(b.dataset.tab,""));
$("#q").addEventListener("input",e=>{query=e.target.value;render()});
$("#gear").onclick=settingsModal;
if($("#help"))$("#help").onclick=openHelp;

// у кнопки-значка при наведении — подсказка с её названием (из aria-label)
document.addEventListener("mouseover",e=>{const b=e.target.closest&&e.target.closest("button[aria-label],a[aria-label]");if(b&&!b.title)b.title=b.getAttribute("aria-label")});

/* ---------- render ---------- */
const chevron=`<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>`;
function render(){
  if(!user||!loaded)return;
  document.querySelectorAll(".tabs button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.tab===tab&&!query));
  const pr=problems(),du=dueCount();
  $("#cntCheck").classList.toggle("off",!pr);$("#cntCheck").textContent=pr;
  $("#cntDates").classList.toggle("off",!du);$("#cntDates").textContent=du;
  if(query.trim())return renderSearch();
  if(tab==="check")return renderCheck();
  if(tab==="dates")return renderDates();
  const qn=document.activeElement&&document.activeElement.id==="quickName"?document.activeElement:null;
  const at=qn&&{p:qn.dataset.place,s:qn.selectionStart,e:qn.selectionEnd};
  renderPlaces();
  // экран перерисован (пришло изменение с другого устройства) — курсор на прежнем месте
  const now=$("#quickName");if(at&&now&&now.dataset.place===at.p){now.focus({preventScroll:true});now.setSelectionRange(at.s,at.e)}
}
// недописанное в «Добавить вещь сюда» — по местам, переживает уход с экрана и перезапуск
const drafts=ls.get("drafts",{});
function setDraft(pid,v){if(v)drafts[pid]=v;else delete drafts[pid];ls.set("drafts",drafts)}

function placeRow(p,search){
  const n=countIn(p.id),k=kids(p.id).length;
  const meta=[search&&exists(p.parentId)?esc(pathText(p.parentId)):"",n?plural(n,"вещь","вещи","вещей"):"пусто",k?plural(k,"место","места","мест")+" внутри":"",search&&p.note?hl(p.note):""].filter(Boolean).join(" · ");
  return `<button class="row" data-go="${p.id}"><span class="ic">${esc(p.emoji||"📦")}</span><span class="tx"><span class="nm">${hl(p.name)}</span><span class="meta">${meta}</span></span>${p.kit?`<span class="badge b-kit">тревожная</span>`:""}${chevron}</button>`;
}
function itemRow(i,withPath){
  const q=+i.qty;
  const meta=[withPath?esc(pathText(i.placeId)):"",i.note?hl(i.note):""].filter(Boolean).join(" · ");
  return `<button class="row" data-item="${i.id}"><span class="tx"><span class="nm">${hl(i.name)}</span>${meta?`<span class="meta">${meta}</span>`:""}</span>${dateBadge(i.checkOn)}${q!==1?`<span class="qn">×${q}</span>`:""}</button>`;
}
const tokens=s=>norm(s).split(" ").filter(Boolean);
// подсветка найденных слов: каждое слово запроса, где бы ни стояло
function hl(s){
  s=String(s??"");
  const toks=tokens(query),low=s.toLowerCase().replace(/ё/g,"е");
  if(!toks.length||low.length!==s.length)return esc(s);
  const on=new Array(s.length).fill(false);
  for(const t of toks)for(let i=low.indexOf(t);i>=0;i=low.indexOf(t,i+1))on.fill(true,i,i+t.length);
  let h="";
  for(let i=0;i<s.length;){let j=i;while(j<s.length&&on[j]===on[i])j++;const part=esc(s.slice(i,j));h+=on[i]?`<mark>${part}</mark>`:part;i=j}
  return h;
}
function wire(){
  main.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>go("places",b.dataset.go));
  main.querySelectorAll("[data-item]").forEach(b=>b.onclick=()=>itemModal(b.dataset.item));
}

function renderPlaces(){
  if(cur&&cur!=="none"&&!exists(cur))cur="";
  const p=cur&&cur!=="none"?S.places[cur]:null;
  const subs=cur==="none"?[]:kids(cur);
  const its=cur?itemsIn(cur):[];
  let h="";
  if(cur){
    h+=`<nav class="crumbs"><button data-go="">Все места</button>${(p?chain(cur).slice(0,-1):[]).map(x=>`<span class="sep">›</span><button data-go="${x.id}">${esc(x.name)}</button>`).join("")}</nav>`;
    h+=p?`<div class="ptitle"><span class="em">${esc(p.emoji||"📦")}</span><div class="tx"><h1>${esc(p.name)}</h1>${p.note?`<span class="sub">${esc(p.note)}</span>`:""}${p.kit?`<span class="kitmark"><span class="badge b-kit">тревожная</span></span>`:""}</div><button class="btn" id="editPlace" aria-label="Изменить">✎</button></div>`
        :`<div class="ptitle"><span class="em">❔</span><div class="tx"><h1>Без места</h1></div></div>`;
    if(p&&p.kit)h+=kitPills(cur);
  }
  if(cur!=="none"){
    const loose=itemsIn("none").length;
    h+=`<section class="sec"><h2>${cur?"Внутри":"Места"} ${subs.length?`<span class="n">${subs.length}</span>`:""}</h2>`;
    if(subs.length||(!cur&&loose))h+=`<div class="list">${subs.map(placeRow).join("")}${!cur&&loose?`<button class="row" data-go="none"><span class="ic">❔</span><span class="tx"><span class="nm">Без места</span><span class="meta">${plural(loose,"вещь","вещи","вещей")}</span></span>${chevron}</button>`:""}</div>`;
    else if(!cur)h+=`<div class="empty"><b>Пока пусто</b></div>`;
    h+=`<div class="btns"><button class="btn" id="addPlace">+ ${cur?"Место внутри":"Место"}</button></div></section>`;
  }
  if(cur){
    h+=`<section class="sec"><h2>Вещи ${its.length?`<span class="n">${its.length}</span>`:""}</h2>`;
    if(its.length)h+=`<div class="list">${its.map(i=>itemRow(i)).join("")}</div>`;
    if(p)h+=`<form class="add" id="quick"><input id="quickName" placeholder="Добавить вещь сюда…" autocomplete="off" enterkeyhint="done" data-place="${cur}" value="${esc(drafts[cur]||"")}"><button class="btn pri" type="submit" aria-label="Добавить">＋</button></form>`;
    else if(!its.length)h+=`<div class="empty">Здесь ничего нет.</div>`;
    h+=`</section>`;
  }
  main.innerHTML=h;wire();
  const ep=$("#editPlace");if(ep)ep.onclick=()=>placeModal(cur);
  const ap=$("#addPlace");if(ap)ap.onclick=()=>placeModal(null,cur);
  const qf=$("#quick");
  if(qf){
    const inp=$("#quickName"),pid=cur;
    inp.oninput=()=>setDraft(pid,inp.value);
    qf.onsubmit=e=>{
      e.preventDefault();const v=inp.value.trim();if(!v)return;
      const r=parseQuick(v);
      if(!r.name){toast("Впиши название вещи");inp.focus();return}
      if(r.qty>MAXQ){toast("Количество — не больше "+MAXQ_T);inp.focus();return}
      setDraft(pid,"");
      put("items",newId(),{name:r.name,qty:r.qty,placeId:pid,note:"",checkOn:null}).then(ok=>{if(!ok&&!drafts[pid]){setDraft(pid,v);render()}});
      setTimeout(()=>{const i=$("#quickName");if(i)i.focus()},0);
    };
  }
}
const MAXQ=999999,MAXQ_T="999 999";
// «Мышка ×2», «Мышка x2», «Мышка 2 шт»
function parseQuick(v){
  const m=v.match(/^(.*?)\s*[×*]\s*(\d+)\s*$/)||v.match(/^(?:(.*?)\s+)?[xх]\s*(\d+)\s*$/i)||v.match(/^(?:(.*?)\s+)?(\d+)\s*шт\.?$/i);
  return m?{name:(m[1]||"").trim(),qty:+m[2]}:{name:v.trim(),qty:1};
}
function kitPills(kid){
  const cs=checkKit(kid);
  if(!cs.length)return `<div class="hint">Правил пока нет</div>`;
  return `<div class="inline">${cs.map(c=>`<span class="pill ${c.st}">${c.st==="ok"?"✓":c.st==="miss"?"нет:":"лишнее:"} ${esc(c.rule.name)}${c.st==="ok"?"":` (${c.have} из ${c.need})`}</span>`).join("")}</div>`;
}

function renderSearch(){
  const toks=tokens(query);
  const its=Object.values(S.items).filter(i=>hasAll(toks,i.name,i.note||"")).sort((a,b)=>a.name.localeCompare(b.name,"ru"));
  const ps=places().filter(p=>hasAll(toks,p.name,p.note||"")).sort((a,b)=>a.name.localeCompare(b.name,"ru"));
  const total=its.reduce((s,i)=>s+(+i.qty||0),0);
  let h="";
  if(its.length)h+=`<section class="sec"><h2>Вещи <span class="n">${its.length} ${its.length!==total?`· всего ${total} шт.`:""}</span></h2><div class="list">${its.map(i=>itemRow(i,true)).join("")}</div></section>`;
  if(ps.length)h+=`<section class="sec"><h2>Места <span class="n">${ps.length}</span></h2><div class="list">${ps.map(p=>placeRow(p,true)).join("")}</div></section>`;
  main.innerHTML=h||`<div class="empty">Ничего не нашлось: «${esc(query.trim())}».</div>`;wire();
}

function renderCheck(){
  const ks=kits(),rs=rules();
  let h="";
  if(ks.length&&rs.length){
    const pr=problems();
    h+=pr?`<div class="summary bad">⚠ Есть что поправить: ${pr}</div>`:`<div class="summary ok">✓ Во всех тревожных сумках всё на месте</div>`;
  }
  h+=`<section class="sec"><h2>Тревожные сумки ${ks.length?`<span class="n">${ks.length}</span>`:""}</h2>`;
  if(!ks.length)h+=`<div class="empty"><b>Тревожных сумок пока нет</b></div>`;
  else if(!rs.length)h+=`<div class="hint">Правил пока нет</div>`;
  for(const k of ks){
    const cs=checkKit(k.id);
    h+=`<div class="kit"><button class="kh" data-go="${k.id}"><span class="tx"><span class="nm">${esc(k.emoji||"🧳")} ${esc(k.name)}</span><span class="meta">${esc(k.parentId&&exists(k.parentId)?pathText(k.parentId):"")}</span></span>${chevron}</button>`;
    h+=cs.map(c=>{
      const list=c.items.map(i=>esc(i.name)+(+i.qty!==1?" ×"+i.qty:"")).join(", ");
      const txt=c.st==="ok"?`есть: ${list}`:c.st==="miss"?(c.have?`только ${c.have} из ${c.need}: ${list}`:`нет ни одной, нужно ${c.need}`):`${c.have} вместо ${c.need} — лишние переложить: ${list}`;
      return `<div class="st ${c.st}"><span class="mk">${c.st==="ok"?"✓":c.st==="miss"?"✕":"!"}</span><span class="tx"><span class="nm">${esc(c.rule.name)}</span><span class="meta">${txt}</span></span></div>`;
    }).join("");
    h+=`</div>`;
  }
  h+=`</section><section class="sec"><h2>Что должно быть в каждой ${rs.length?`<span class="n">${rs.length}</span>`:""}</h2>`;
  if(rs.length)h+=`<div class="list">${rs.map(r=>`<button class="row" data-rule="${r.id}"><span class="tx"><span class="nm">${esc(r.name)}</span><span class="meta">узнаю по словам: ${esc((r.words||[]).join(", ")||"—")}</span></span><span class="qn">нужно ${r.need}</span></button>`).join("")}</div>`;
  h+=`<div class="btns"><button class="btn" id="addRule">+ Правило</button></div></section>`;
  main.innerHTML=h;wire();
  main.querySelectorAll("[data-rule]").forEach(b=>b.onclick=()=>ruleModal(b.dataset.rule));
  $("#addRule").onclick=()=>ruleModal(null);
}

function renderDates(){
  const its=dated();
  let h=``;
  h+=its.length?`<div class="list">${its.map(i=>itemRow(i,true)).join("")}</div>`:`<div class="empty"><b>Сроков пока нет</b></div>`;
  main.innerHTML=h;wire();
}

/* ---------- editors ---------- */
let onClose=null;
/* ---------- справка: все пояснения — здесь, а не на экране ---------- */
const HELP=[
  ["Места и вещи","Места вкладываются друг в друга: дача → шкаф → сумка. «Где находится» пусто — место верхнего уровня (дача, квартира); в списке сначала само место, потом путь к нему. Перевезла сумку в квартиру — выбери ей новое место, всё внутри переедет вместе с ней. Переложила вещь — выбери у неё новое место. Быстро добавить вещь — строка «Добавить вещь сюда…», можно «Мышка ×2» или «Мышка 2 шт»; недописанное в ней остаётся, пока не добавишь или не сотрёшь. Количество 0 — вещь в списке есть, но самой её сейчас нет: в проверке сумок она не считается. Больше 999 999 не вписать. Второе место с тем же названием рядом — приложение переспросит."],
  ["Удаление","🗑 всегда спрашивает отдельным окном. Удаляешь место внутри другого — всё, что в нём, переедет в то, другое. Удаляешь место верхнего уровня — места внутри сами станут верхними, а вещи попадут в «Без места» (там вещи, у которых место не указано или удалено)."],
  ["Сохранение и связь","Enter в окне сохраняет. Закрываешь окно с набранным — приложение спросит: «Не сохранять», «Остаться» или «Сохранить»; «Назад» на телефоне закрывает окно. Нет интернета — загруженное остаётся на экране, посмотреть можно, но правки не сохранятся: на экране вернётся прежнее, а окно с набранным откроется снова."],
  ["Поиск","Строка поиска вверху находит вещи и места — по названию и по заметке. Слов может быть несколько, в любом порядке и не целиком: «телефон зарядк» найдёт «Зарядка для телефона». Найденное подсвечено."],
  ["Тревожные сумки","Открой сумку → ✎ → галочка «Тревожная сумка». На вкладке «Проверка» добавь правила — что обязательно должно быть, например «Зарядка для телефона», нужно 1. Правило — одно на все тревожные сумки. «Узнавать по словам в названии вещи»: можно начало слова («зарядк» найдёт и «зарядка», и «зарядку»); через пробел — нужны все слова сразу, в любом порядке («провод hdmi»), через запятую — подойдёт любой вариант («usb-c, type-c»). У нового правила слова подставляются из названия сами — все, кроме «для», «от» и похожих; лишнее сотри. «Сейчас подходят» показывает, какие вещи найдутся. ✓ — сколько нужно, ✕ — не хватает, ! — лишнее: больше нормы, надо переложить. Сумка внутри сумки проверяется отдельно."],
  ["Числа на вкладках","У «Проверки» — сколько всего поправить в тревожных сумках: и нехватка, и лишнее. У «Сроков» — у скольких вещей срок сегодня или уже истёк. На «Сроках» красное — истёк или сегодня, жёлтое — осталось 30 дней и меньше, серое — дальше."],
  ["Сроки","Поставь у вещи (корм, продукты, лекарства) дату «Годен до» — в «Задачах» сама появится памятка «Заменить: …» (доска 📌 → «Памятки»), в этот день она встанет в «Пора». Заменила — отметь ✓ там и впиши новый срок, он появится и здесь; без нового срока дата у вещи снимется. Поменяешь дату здесь — памятка переедет; снимешь дату или удалишь вещь — памятка уйдёт. Удалишь памятку — дата здесь снимется, вещь останется. Загрузка «заменить всё» стирает историю замен."],
  ["Загрузка из файла","Надиктуй Claude, что где лежит (места, вещи, правила), — он подготовит файл, а ты загрузишь его через ⚙ → «Загрузить из файла». Места с тем же путём не задвоятся, а вещи с тем же названием в том же месте пропустятся. Аккаунт тот же, что в «Задачах»."],
  ["Версия","Номер версии — внизу этой справки (дата и время выкладки). Если приложение давно открыто, а на сайте вышла новая версия, вверху появится «Есть новая версия» — нажми «Обновить»."],
];
function openHelp(){openModal(`<h2>Справка</h2><div class="help">${HELP.map(([t,x])=>`<details><summary>${t}</summary><p>${x}</p></details>`).join("")}</div>
  <div class="mact"><span class="left ver">${verText()}</span><button class="btn" data-close>Закрыть</button></div>`,null,"helpwin")}
function openModal(html,init,cls){
  const root=$("#modalRoot"),had=!!root.firstChild;
  root.innerHTML=`<div class="ov"><div class="modal ${cls||""}" role="dialog" aria-modal="true">${html}</div></div>`;
  quiet();
  const ov=root.firstChild,m=ov.firstChild;
  ov.addEventListener("click",e=>{if(e.target===ov||e.target.closest("[data-close]"))guard(closeModal)});
  document.addEventListener("keydown",escClose);
  if(!had)pushWin();
  init&&init(m);
  if(m.save){
    const snap=()=>JSON.stringify([[...m.querySelectorAll("input,select,textarea")].map(x=>x.type==="checkbox"?x.checked:x.value),m.extra?m.extra():""]);
    const s0=snap();m.isDirty=()=>!!m.typed||snap()!==s0;
    // Enter в поле — сохранить (в заметке Enter — новая строка)
    m.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.isComposing&&e.target.matches("input:not([type=checkbox])")){e.preventDefault();m.save()}});
  }
  return m;
}
function escClose(e){if(e.key==="Escape")guard(closeModal)}
function closeModal(){
  const was=!!$("#modalRoot").firstChild;
  $("#modalRoot").innerHTML="";document.removeEventListener("keydown",escClose);
  if(was){quiet();popWin()}
  if(onClose){const f=onClose;onClose=null;f()}
}
// окно только что появилось или исчезло — второе нажатие двойного щелчка не должно попасть в то, что под пальцем
let quietTill=0;
function quiet(){quietTill=Date.now()+350}
document.addEventListener("click",e=>{if(e.isTrusted&&e.detail&&Date.now()<quietTill&&!e.target.closest(".ask")){e.preventDefault();e.stopPropagation()}},true);
// открытое окно — запись в истории браузера: «Назад» закрывает окно, страница под ним не меняется
let backing=null,backDone=null;
function pushWin(){
  if(backing){backing.then(()=>{if($("#modalRoot").firstChild)pushWin()});return}
  history.pushState({win:1},"");
}
function popWin(){
  if(backing||!(history.state&&history.state.win))return;
  const p=backing=new Promise(r=>backDone=r);
  setTimeout(backDone,400);
  p.then(()=>{if(backing===p){backing=null;backDone=null}});
  history.back();
}
window.addEventListener("popstate",()=>{
  if(backing){backDone();return}
  if(!$("#modalRoot").firstChild)return;
  if(history.state&&history.state.win)return;
  if(askCancel){history.pushState({win:1},"");askCancel();return}
  const m=$("#modalRoot .modal");
  if(m.isDirty&&m.isDirty()){history.pushState({win:1},"");guard(closeModal)}else closeModal();
});
window.addEventListener("beforeunload",e=>{const m=$("#modalRoot .modal");if(m&&m.isDirty&&m.isDirty())e.preventDefault()});
// вопрос поверх всего; окно под ним не меняется. Сразу после появления нажатия не принимаются —
// второй щелчок двойного не должен ничего удалить
let askCancel=null;
function ask(text,btns,lines){return new Promise(res=>{
  const el=document.createElement("div");el.className="ov ask";
  el.innerHTML=`<div class="modal" role="alertdialog" aria-modal="true"><h2>${esc(text)}</h2>${(lines||[]).map(l=>`<div class="meta">${esc(l)}</div>`).join("")}<div class="mact">${btns.map((b,i)=>`<button type="button" class="btn ${b.cls||""}" data-i="${i}">${esc(b.label)}</button>`).join("")}</div></div>`;
  const t0=Date.now();
  const key=e=>{if(e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();close(null)}};
  const close=v=>{el.remove();askCancel=null;quiet();document.removeEventListener("keydown",key,true);res(v)};
  askCancel=()=>close(null);
  el.addEventListener("click",e=>{
    e.stopPropagation();
    const b=e.target.closest("[data-i]"),btn=b&&btns[b.dataset.i];
    if(!btn&&e.target!==el)return;
    if(Date.now()-t0<(btn&&!/danger|del/.test(btn.cls||"")?350:800))return;
    close(btn?btn.v:null);
  });
  document.addEventListener("keydown",key,true);
  document.body.appendChild(el);
  (el.querySelector(".btn:not(.danger):not(.del)")||el.querySelector(".btn")).focus();
})}
const SAVE_ASK=[{v:"no",label:"Не сохранять",cls:"danger"},{v:null,label:"Остаться"},{v:"yes",label:"Сохранить",cls:"pri"}];
const confirmDel=async(text,lines)=>await ask(text,[{v:null,label:"Остаться"},{v:"yes",label:"Удалить",cls:"del"}],lines)==="yes";
// закрыть окно: набранное — только после ответа
async function guard(then){
  const m=$("#modalRoot .modal");
  if($(".ask"))return;
  if(!m||!m.isDirty||!m.isDirty())return then();
  const v=await ask("Сохранить изменения?",SAVE_ASK);
  if(v==="no")then();else if(v==="yes")m.save();
}
// окно с полями: Enter, кнопка и «Сохранить» из вопроса идут одним путём
function wireSave(m,btn,nameInp,fn){
  let busy=false;
  m.save=async()=>{
    if(busy)return;
    if(!nameInp.value.trim()){
      nameInp.setCustomValidity("Впиши название");nameInp.reportValidity();
      nameInp.addEventListener("input",()=>nameInp.setCustomValidity(""),{once:true});
      return;
    }
    for(const x of m.querySelectorAll("input"))if(!x.reportValidity())return;
    busy=true;try{await fn(nameInp.value.trim())}finally{busy=false}
  };
  btn.onclick=()=>m.save();
}
// не сохранилось, другое окно не открыто — вернуть окно с набранным
function reopen(ok,fn){if(!ok&&!$("#modalRoot").firstChild&&!$(".ask"))fn()}
function gone(col,id){if(!id||S[col][id])return false;toast("Это уже удалили на другом устройстве");return true}

function placeOptions(sel,exclude){
  const all=places().filter(p=>!exclude||!exclude.has(p.id)).map(p=>({id:p.id,s:pathText(p.id),t:p.name+(exists(p.parentId)?" — "+pathText(p.parentId):"")})).sort((a,b)=>a.s.localeCompare(b.s,"ru"));
  return all.map(o=>`<option value="${o.id}"${o.id===sel?" selected":""}>${esc(o.t)}</option>`).join("");
}

function itemModal(id,placeDefault,typed){
  const was=id?S.items[id]:{name:"",qty:1,placeId:placeDefault||"",note:"",checkOn:null};
  if(!was)return;
  const it=Object.assign({},was,typed);
  openModal(`<h2>${id?"Вещь":"Новая вещь"}</h2>
    <div class="fld"><label for="iName">Название</label><input id="iName" value="${esc(it.name)}" autocomplete="off"></div>
    <div class="grid2">
      <div class="fld"><label for="iQty">Сколько штук</label><input id="iQty" type="number" min="0" max="${MAXQ}" step="1" inputmode="numeric" value="${+it.qty||0}"></div>
      <div class="fld"><label for="iDate">Годен до</label><input id="iDate" type="date" value="${esc(it.checkOn||"")}"></div>
    </div>
    <div class="fld"><label for="iPlace">Где лежит</label><select id="iPlace"><option value="">— Без места —</option>${placeOptions(exists(it.placeId)?it.placeId:"")}</select></div>
    <div class="fld"><label for="iNote">Заметка</label><textarea id="iNote" placeholder="Например: белый, на 2 метра">${esc(it.note||"")}</textarea></div>
    <div class="mact">${id?`<button class="btn danger left" id="iDel" aria-label="Удалить">🗑</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="iSave">Сохранить</button></div>`,m=>{
    const q=s=>m.querySelector(s);
    m.typed=typed;
    wireSave(m,q("#iSave"),q("#iName"),name=>{
      if(gone("items",id))return;
      const data={name,qty:Math.max(0,Math.round(+q("#iQty").value||0)),placeId:q("#iPlace").value||null,note:q("#iNote").value.trim(),checkOn:q("#iDate").value||null};
      closeModal();
      (id?patch("items",id,data):put("items",newId(),data)).then(ok=>reopen(ok,()=>itemModal(id,placeDefault,data)));
    });
    if(id)q("#iDel").onclick=async()=>{if(await confirmDel(`Удалить «${was.name}»?`)){closeModal();del("items",id)}};
    if(!id)setTimeout(()=>q("#iName").focus(),50);
  });
}

function placeModal(id,parentDefault,typed){
  const was=id?S.places[id]:{name:"",emoji:"🧳",parentId:parentDefault&&parentDefault!=="none"?parentDefault:"",note:"",kit:false};
  if(!was)return;
  const p=Object.assign({},was,typed);
  const ex=id?subtree(id):null;
  openModal(`<h2>${id?"Место":"Новое место"}</h2>
    <div class="fld"><label for="pName">Название</label><input id="pName" value="${esc(p.name)}" placeholder="Например: Сумка от рабочего ноутбука" autocomplete="off"></div>
    <div class="fld"><span class="lb">Значок</span><div class="emojis">${EMOJIS.map(x=>`<button type="button" data-em="${x}" aria-pressed="${x===p.emoji}">${x}</button>`).join("")}</div></div>
    <div class="fld"><label for="pParent">Где находится</label><select id="pParent"><option value="">— Верхний уровень (дача, квартира…) —</option>${placeOptions(exists(p.parentId)?p.parentId:"",ex)}</select></div>
    <label class="chk"><input type="checkbox" id="pKit" ${p.kit?"checked":""}><span><b>Тревожная сумка</b></span></label>
    <div class="fld"><label for="pNote">Заметка</label><textarea id="pNote" placeholder="Например: стоит под кроватью">${esc(p.note||"")}</textarea></div>
    <div class="mact">${id?`<button class="btn danger left" id="pDel" aria-label="Удалить">🗑</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="pSave">Сохранить</button></div>`,m=>{
    const q=s=>m.querySelector(s);let em=p.emoji||"📦";
    q(".emojis").onclick=e=>{const b=e.target.closest("[data-em]");if(!b)return;em=b.dataset.em;m.querySelectorAll(".emojis button").forEach(x=>x.setAttribute("aria-pressed",x===b))};
    m.extra=()=>em;m.typed=typed;
    wireSave(m,q("#pSave"),q("#pName"),async name=>{
      if(gone("places",id))return;
      const data={name,emoji:em,parentId:q("#pParent").value||null,kit:q("#pKit").checked,note:q("#pNote").value.trim()};
      const moved=!id||norm(was.name)!==norm(name)||(was.parentId||"")!==(data.parentId||"");
      if(moved&&kids(data.parentId||"").some(x=>x.id!==id&&norm(x.name)===norm(name))
        &&await ask(`«${name}» здесь уже есть. Сохранить ещё одно такое же?`,[{v:null,label:"Остаться"},{v:"yes",label:"Сохранить",cls:"pri"}])!=="yes")return;
      closeModal();
      const again=ok=>reopen(ok,()=>placeModal(id,parentDefault,data));
      if(id)patch("places",id,data).then(again);
      else{const nid=newId();put("places",nid,{...data,order:kids(data.parentId||"").length}).then(again);go("places",nid)}
    });
    if(id){
      const par=exists(p.parentId)?p.parentId:"";
      q("#pDel").onclick=async()=>{
        const n=itemsIn(id).length,k=kids(id).length;
        const ride=c=>c%10===1&&c%100!==11?"переедет":"переедут";
        const ns=plural(n,"вещь","вещи","вещей"),ks=plural(k,"место","места","мест");
        const lines=par?(n||k?[`${[k?ks:"",n?ns:""].filter(Boolean).join(" и ")} ${n&&k?"переедут":ride(n+k)} в «${S.places[par].name}».`]:[])
          :[k?`${ks} ${ride(k)} на верхний уровень.`:"",n?`${ns} ${ride(n)} в «Без места».`:""].filter(Boolean);
        if(!await confirmDel(`Удалить место «${was.name}»?`,lines))return;
        closeModal();
        const oks=await Promise.all([...kids(id).map(c=>patch("places",c.id,{parentId:par||null})),...itemsIn(id).map(i=>patch("items",i.id,{placeId:par||null}))]);
        if(oks.includes(false))return;   // содержимое не переехало — место не удалять
        setDraft(id,"");del("places",id);go("places",par);
      };
    }else setTimeout(()=>q("#pName").focus(),50);
  });
}

function ruleModal(id,typed){
  const was=id?S.rules[id]:{name:"",words:[],need:1};
  if(!was)return;
  const r=Object.assign({},was,typed);
  openModal(`<h2>${id?"Правило":"Новое правило"}</h2>
    <div class="fld"><label for="rName">Что</label><input id="rName" value="${esc(r.name)}" placeholder="Зарядка для телефона" autocomplete="off"></div>
    <div class="fld"><label for="rWords">Узнавать по словам в названии вещи</label><input id="rWords" value="${esc((r.words||[]).join(", "))}" placeholder="зарядк, кабель type-c" autocomplete="off"></div>
    <div class="fld"><label for="rNeed">Сколько нужно в каждой</label><input id="rNeed" type="number" min="1" max="${MAXQ}" step="1" inputmode="numeric" value="${+r.need||1}" style="max-width:120px"></div>
    <div class="fld"><span class="lb">Сейчас подходят</span><div class="meta prevbox" id="rPrev"></div></div>
    <div class="mact">${id?`<button class="btn danger left" id="rDel" aria-label="Удалить">🗑</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="rSave">Сохранить</button></div>`,m=>{
    const q=s=>m.querySelector(s);
    const words=()=>q("#rWords").value.split(",").map(s=>s.trim()).filter(Boolean);
    const prev=()=>{const w=words();const its=Object.values(S.items).filter(i=>fits({words:w},i));
      q("#rPrev").innerHTML=!w.length?"—":its.length?its.slice(0,30).map(i=>`${esc(i.name)} <span style="opacity:.7">(${esc(pathText(i.placeId))})</span>`).join("<br>")+(its.length>30?`<br>…и ещё ${its.length-30}`:""):"ничего — проверь слова"};
    q("#rWords").oninput=()=>{q("#rWords").dataset.touched="1";prev()};prev();
    q("#rName").oninput=()=>{if(!id&&!q("#rWords").dataset.touched){q("#rWords").value=autoWord(q("#rName").value);prev()}};
    m.typed=typed;if(typed)q("#rWords").dataset.touched="1";
    wireSave(m,q("#rSave"),q("#rName"),name=>{
      if(gone("rules",id))return;
      const data={name,words:words().length?words():[autoWord(name)],need:Math.max(1,Math.round(+q("#rNeed").value||1))};
      closeModal();
      (id?patch("rules",id,data):put("rules",newId(),{...data,order:rules().length})).then(ok=>reopen(ok,()=>ruleModal(id,data)));
    });
    if(id)q("#rDel").onclick=async()=>{if(await confirmDel(`Удалить правило «${was.name}»?`)){closeModal();del("rules",id)}};
    else setTimeout(()=>q("#rName").focus(),50);
  });
}
// «Зарядка для телефона» → «зарядк телефон»: значимые слова без окончаний
const STOP=new Set("для от с со на и в во из под по к ко без или у за о об при до".split(" "));
function autoWord(s){
  const ws=norm(s).split(/[\s,;:()«»"'\/+]+/).filter(w=>w.length>1&&/[a-zа-я0-9]/.test(w)&&!STOP.has(w));
  return ws.map(w=>w.length>5?w.replace(/[аяоеыиьйую]+$/,""):w).join(" ")||norm(s).replace(/,/g," ").trim();
}

/* ---------- settings: import / export / sign out ---------- */
function settingsModal(){
  const n=Object.keys(S.items).length,k=Object.keys(S.places).length;
  openModal(`<h2>Настройки</h2>
    <p class="meta" style="margin:0">Ты вошла как <b>${esc(user&&user.email)}</b></p>
    <div class="fld"><span class="lb">Загрузить из файла</span>
      <button class="btn" id="imp" style="align-self:flex-start" >📁 Выбрать файл</button>
</div>
    <div class="fld"><span class="lb">Резервная копия</span><button class="btn" id="exp" style="align-self:flex-start">Скачать всё файлом</button></div>
    <div class="mact"><button class="btn danger left" id="out">Выйти</button><button class="btn pri" data-close>Готово</button></div>`,m=>{
    const q=s=>m.querySelector(s);
    const pick=mode=>{importMode=mode;$("#import-file").value="";$("#import-file").click()};
    q("#imp").onclick=()=>{if(!n&&!k&&!Object.keys(S.rules).length)return pick("replace");openModal(`<h2>Загрузить из файла</h2>
      <p class="meta" style="margin:0">Сейчас здесь ${plural(k,"место","места","мест")} и ${plural(n,"вещь","вещи","вещей")}. Что сделать с ними?</p>
      <div class="btns"><button class="btn" id="impAdd">Оставить и добавить новое</button><button class="btn danger" id="impRep">Удалить всё и загрузить файл</button></div>
      <div class="mact"><button class="btn" data-close>Отмена</button></div>`,m2=>{
      m2.querySelector("#impAdd").onclick=()=>{closeModal();pick("add")};
      m2.querySelector("#impRep").onclick=()=>{closeModal();pick("replace")};
    })};
    q("#exp").onclick=exportFile;
    q("#out").onclick=()=>{closeModal();sb.auth.signOut()};
  });
}
let importMode="add";
$("#import-file").addEventListener("change",async e=>{
  const f=e.target.files[0];if(!f)return;
  let d;try{d=JSON.parse(await f.text())}catch(err){toast("Это не файл с данными (.json)");return}
  closeModal();
  try{const r=await importData(d,importMode);toast(`Загружено: ${plural(r.places,"место","места","мест")}, ${plural(r.items,"вещь","вещи","вещей")}, ${plural(r.rules,"правило","правила","правил")}`)}
  catch(err){console.error(err);toast("Не удалось загрузить: "+(err.message||err))}
  await load();go("places","");
});
const splitPath=s=>String(s||"").split(/\s*(?:\/|›|>)\s*/).map(x=>x.trim()).filter(Boolean);
async function importData(d,mode){
  if(!d||typeof d!=="object")throw new Error("пустой файл");
  if(mode==="replace")for(const c of ["items","rules","places"])done(await sb.from(TBL[c]).delete().eq("user_id",user.id));
  const base=await fetchAll();   // what the base really has, not what the page remembers
  const pathOf={};               // "дача/сумка" → id
  const key=parts=>parts.map(norm).join("/");
  const bp=Object.values(base.places);
  const bchain=id=>{const out=[];let p=base.places[id],g=0;while(p&&g++<30){out.unshift(p.name);p=base.places[p.parentId]}return out};
  bp.forEach(p=>pathOf[key(bchain(p.id))]=p.id);
  const extra={};(d.places||[]).forEach(p=>{const parts=splitPath(p.path||p.name);if(parts.length)extra[key(parts)]=p});
  const levels=[];const order={};
  function ensure(parts){
    if(!parts.length)return null;
    const k=key(parts);if(pathOf[k])return pathOf[k];
    const parent=ensure(parts.slice(0,-1)),info=extra[k]||{},id=newId();
    pathOf[k]=id;const pk=parent||"";order[pk]=(order[pk]??bp.filter(p=>(p.parentId||"")===pk).length);
    (levels[parts.length-1]=levels[parts.length-1]||[]).push({id,parent_id:parent,name:parts[parts.length-1],emoji:info.emoji||(parts.length===1?"🏡":"📦"),note:info.note||null,kit:!!info.kit,ord:order[pk]++});
    return id;
  }
  // places from the list first (keeps their order), then the ones items mention
  (d.places||[]).forEach(p=>ensure(splitPath(p.path||p.name)));
  const have=new Set(Object.values(base.items).map(i=>(i.placeId||"")+"|"+norm(i.name)));
  const items=[];
  for(const i of d.items||[]){
    const name=String(i.name||"").trim();if(!name)continue;
    const pid=ensure(splitPath(i.place));const k=(pid||"")+"|"+norm(name);
    if(have.has(k))continue;have.add(k);
    const row={id:newId(),place_id:pid,name,qty:Number.isFinite(+i.qty)&&i.qty!==""&&i.qty!=null?Math.min(MAXQ,Math.max(0,Math.round(+i.qty))):1,note:i.note?String(i.note):null};
    if(i.check_on||i.checkOn)row.check_on=String(i.check_on||i.checkOn).slice(0,10);
    items.push(row);
  }
  let nPlaces=0;
  for(const lv of levels){if(!lv||!lv.length)continue;done(await sb.from(TBL.places).insert(lv,{defaultToNull:false}));nPlaces+=lv.length}
  for(let i=0;i<items.length;i+=200)done(await sb.from(TBL.items).insert(items.slice(i,i+200),{defaultToNull:false}));
  const haveR=new Set(Object.values(base.rules).map(r=>norm(r.name)));
  const rs=(d.rules||[]).filter(r=>r&&r.name&&!haveR.has(norm(r.name))).map((r,n)=>({id:newId(),name:String(r.name),words:[].concat(r.words||autoWord(r.name)).map(String),need:Math.min(MAXQ,Math.max(1,Math.round(+r.need||1))),ord:Object.keys(base.rules).length+n}));
  if(rs.length)done(await sb.from(TBL.rules).insert(rs,{defaultToNull:false}));
  return {places:nPlaces,items:items.length,rules:rs.length};
}
function exportFile(){
  const d={
    places:places().map(p=>({path:pathText(p.id).replace(/ › /g," / "),emoji:p.emoji||"",kit:!!p.kit,note:p.note||""})).sort((a,b)=>a.path.localeCompare(b.path,"ru")),
    items:Object.values(S.items).map(i=>({name:i.name,place:exists(i.placeId)?pathText(i.placeId).replace(/ › /g," / "):"",qty:+i.qty,note:i.note||"",check_on:i.checkOn||""})),
    rules:rules().map(r=>({name:r.name,words:r.words||[],need:+r.need||1})),
  };
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([JSON.stringify(d,null,1)],{type:"application/json"}));
  a.download=`где-что-лежит-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}

let tt=null;
function toast(msg){let el=$(".toast");if(!el){el=document.createElement("div");el.className="toast";el.setAttribute("role","status");document.body.appendChild(el)}el.textContent=msg;clearTimeout(tt);tt=setTimeout(()=>el.remove(),/^Не удалось/.test(msg)?7000:2600)}

if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(()=>{});
})();

// Версия на экране и сверка с сайтом (ревизия 22.11.2026). Номер — в version.js: каждая выкладка ставит новый
// (крючок перед коммитом не пустит изменение docs/ без него). На сайте новее — полоска «Есть новая версия».
const verText=()=>"Версия "+(window.APP_VERSION||"?");
async function checkVersion(){
  if(!window.APP_VERSION||document.getElementById("updBar"))return;
  try{
    const m=(await (await fetch("version.js",{cache:"no-cache"})).text()).match(/APP_VERSION\s*=\s*"([^"]+)"/);
    if(!m||m[1]===window.APP_VERSION)return;
    const b=document.createElement("div");b.id="updBar";b.className="upd-bar";
    b.innerHTML='Есть новая версия <button type="button">Обновить</button>';
    b.querySelector("button").onclick=()=>location.reload();
    document.body.appendChild(b);
  }catch(e){}
}
checkVersion();
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")checkVersion()});
