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
function fail(e){console.error(e);toast("Не удалось сохранить"+(e&&e.message?": "+e.message:" — проверь интернет"));load()}
const newId=()=>crypto.randomUUID();
const done=r=>{if(r.error)throw r.error;return r};

function put(col,id,data){
  S[col][id]=Object.assign({},S[col][id],data,{id});render();
  return enqueue(col+"/"+id,()=>sb.from(TBL[col]).upsert({id,...toRow(col,data)}).then(done)).catch(fail);
}
function patch(col,id,p){
  const cur=S[col][id];if(!cur)return Promise.resolve();
  S[col][id]=Object.assign({},cur,p);render();
  return enqueue(col+"/"+id,()=>sb.from(TBL[col]).update(toRow(col,p)).eq("id",id).then(done)).catch(fail);
}
function del(col,id){
  delete S[col][id];render();
  return enqueue(col+"/"+id,()=>sb.from(TBL[col]).delete().eq("id",id).then(done)).catch(fail);
}

async function fetchAll(){
  const rs=await Promise.all(COLS.map(c=>sb.from(TBL[c]).select("*")));
  const bad=rs.find(r=>r.error);if(bad)throw bad.error;
  const out={};COLS.forEach((c,i)=>{const o={};rs[i].data.forEach(r=>o[r.id]=fromRow(r));out[c]=o});
  return out;
}
async function load(){
  try{S=await fetchAll();loaded=true;render()}
  catch(e){console.error(e);main.innerHTML=`<div class="empty"><b>База ещё не готова</b>Нужно один раз запустить файл <code>001_gde.sql</code> в Supabase → SQL Editor.</div>`}
}
let channel=null;
function listen(){
  if(channel)return;
  channel=sb.channel("gde");
  COLS.forEach(c=>channel.on("postgres_changes",{event:"*",schema:"public",table:TBL[c]},p=>{
    if(p.eventType==="DELETE")delete S[c][p.old.id];else S[c][p.new.id]=fromRow(p.new);
    render();
  }));
  channel.subscribe();
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&user)load()});

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
const fits=(rule,item)=>(rule.words||[]).some(w=>norm(w)&&norm(item.name).includes(norm(w)));
function checkKit(kid){
  const set=subtree(kid,true);
  const its=Object.values(S.items).filter(i=>set.has(i.placeId));
  return rules().map(r=>{
    const m=its.filter(i=>fits(r,i));
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
  if(n<0)return `<span class="badge b-late">проверить! ${fmtDate(s)}</span>`;
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
  $("#cntCheck").hidden=!pr;$("#cntCheck").textContent=pr;
  $("#cntDates").hidden=!du;$("#cntDates").textContent=du;
  if(query.trim())return renderSearch();
  if(tab==="check")return renderCheck();
  if(tab==="dates")return renderDates();
  renderPlaces();
}

function placeRow(p){
  const n=countIn(p.id),k=kids(p.id).length;
  const meta=[n?plural(n,"вещь","вещи","вещей"):"пусто",k?plural(k,"место","места","мест")+" внутри":""].filter(Boolean).join(" · ");
  return `<button class="row" data-go="${p.id}"><span class="ic">${esc(p.emoji||"📦")}</span><span class="tx"><span class="nm">${esc(p.name)}</span><span class="meta">${meta}</span></span>${p.kit?`<span class="badge b-kit">тревожная</span>`:""}${chevron}</button>`;
}
function itemRow(i,withPath){
  const q=+i.qty;
  const meta=[withPath?pathText(i.placeId):"",i.note||""].filter(Boolean).map(esc).join(" · ");
  return `<button class="row" data-item="${i.id}"><span class="tx"><span class="nm">${hl(i.name)}</span>${meta?`<span class="meta">${meta}</span>`:""}</span>${dateBadge(i.checkOn)}${q!==1?`<span class="qn">×${q}</span>`:""}</button>`;
}
function hl(s){
  const q=norm(query);if(!q)return esc(s);
  const i=norm(s).indexOf(q);if(i<0)return esc(s);
  return esc(s.slice(0,i))+"<mark>"+esc(s.slice(i,i+q.length))+"</mark>"+esc(s.slice(i+q.length));
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
    h+=p?`<div class="ptitle"><span class="em">${esc(p.emoji||"📦")}</span><div class="tx"><h1>${esc(p.name)}</h1>${p.note?`<span class="sub">${esc(p.note)}</span>`:""}</div><button class="btn" id="editPlace" aria-label="Изменить">✎</button></div>`
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
    if(p)h+=`<form class="add" id="quick"><input id="quickName" placeholder="Добавить вещь сюда… (можно «Мышка ×2»)" autocomplete="off" enterkeyhint="done"><button class="btn pri" type="submit" aria-label="Добавить">＋</button></form>`;
    else if(!its.length)h+=`<div class="empty">Здесь ничего нет.</div>`;
    h+=`</section>`;
  }
  main.innerHTML=h;wire();
  const ep=$("#editPlace");if(ep)ep.onclick=()=>placeModal(cur);
  const ap=$("#addPlace");if(ap)ap.onclick=()=>placeModal(null,cur);
  const qf=$("#quick");
  if(qf)qf.onsubmit=e=>{
    e.preventDefault();const v=$("#quickName").value.trim();if(!v)return;
    const m=v.match(/^(.*?)\s*[x×х*]\s*(\d+)\s*$/i)||v.match(/^(.*?)\s+(\d+)\s*шт\.?$/i);
    put("items",newId(),{name:(m?m[1]:v).trim(),qty:m?+m[2]:1,placeId:cur,note:"",checkOn:null});
    setTimeout(()=>{const i=$("#quickName");if(i)i.focus()},0);
  };
}
function kitPills(kid){
  const cs=checkKit(kid);
  if(!cs.length)return `<div class="hint">Тревожная сумка · правил пока нет</div>`;
  return `<div class="inline">${cs.map(c=>`<span class="pill ${c.st}">${c.st==="ok"?"✓":c.st==="miss"?"нет:":"лишнее:"} ${esc(c.rule.name)}${c.st==="ok"?"":` (${c.have} из ${c.need})`}</span>`).join("")}</div>`;
}

function renderSearch(){
  const q=norm(query);
  const its=Object.values(S.items).filter(i=>norm(i.name).includes(q)||norm(i.note).includes(q)).sort((a,b)=>a.name.localeCompare(b.name,"ru"));
  const ps=places().filter(p=>norm(p.name).includes(q)||norm(p.note).includes(q));
  const total=its.reduce((s,i)=>s+(+i.qty||0),0);
  let h=`<section class="sec"><h2>Вещи ${its.length?`<span class="n">${its.length} ${its.length!==total?`· всего ${total} шт.`:""}</span>`:""}</h2>`;
  h+=its.length?`<div class="list">${its.map(i=>itemRow(i,true)).join("")}</div>`:`<div class="empty">Вещей «${esc(query.trim())}» не нашлось.</div>`;
  h+=`</section>`;
  if(ps.length)h+=`<section class="sec"><h2>Места <span class="n">${ps.length}</span></h2><div class="list">${ps.map(p=>placeRow(p).replace(`<span class="meta">`,`<span class="meta">${esc(p.parentId&&exists(p.parentId)?pathText(p.parentId)+" · ":"")}`)).join("")}</div></section>`;
  main.innerHTML=h;wire();
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
      const txt=c.st==="ok"?`есть: ${list}`:c.st==="miss"?(c.have?`только ${c.have} из ${c.need}: ${list}`:`нет ни одной, нужно ${c.need}`):`${c.have} вместо ${c.need} — лишние можно вынуть: ${list}`;
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
  ["Места и вещи","Места вкладываются друг в друга: дача → шкаф → сумка. «Где находится» пусто — место верхнего уровня (дача, квартира). Перевезла сумку в квартиру — выбери ей новое место, всё внутри переедет вместе с ней. Переложила вещь — выбери у неё новое место. Быстро добавить вещь — строка «Добавить вещь сюда…», можно «Мышка ×2». «Без места» — вещи, у которых место не указано или место удалено."],
  ["Поиск","Строка поиска вверху находит вещь по названию во всех местах."],
  ["Тревожные сумки","Открой сумку → «Изменить» → галочка «Тревожная сумка». На вкладке «Проверка» добавь правила — что обязательно должно быть, например «Зарядка для телефона», нужно 1. «Узнавать по словам в названии вещи» — через запятую, можно начало слова: «зарядк» найдёт и «зарядка», и «зарядку». Тогда видно, всё ли в сумке на месте."],
  ["Сроки","Поставь у вещи (корм, продукты, лекарства) дату «Проверить срок» — в этот день в «Задачах» сама появится задача «Проверить срок: …». Поменяешь дату здесь — задача переедет."],
  ["Загрузка из файла","Надиктуй Claude, что где лежит (места, вещи, правила), — он подготовит файл, а ты загрузишь его через ⚙ → «Загрузить из файла». Места с тем же путём не задвоятся, а вещи с тем же названием в том же месте пропустятся. Аккаунт тот же, что в «Задачах»."],
];
function openHelp(){openModal(`<h2>Справка</h2><div class="help">${HELP.map(([t,x])=>`<details><summary>${t}</summary><p>${x}</p></details>`).join("")}</div>
  <div class="mact"><button class="btn" data-close>Закрыть</button></div>`)}
function openModal(html,init){
  const root=$("#modalRoot");
  root.innerHTML=`<div class="ov"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const ov=root.firstChild,m=ov.firstChild;
  ov.addEventListener("click",e=>{if(e.target===ov||e.target.closest("[data-close]"))closeModal()});
  document.addEventListener("keydown",escClose);
  init&&init(m);return m;
}
function escClose(e){if(e.key==="Escape")closeModal()}
function closeModal(){$("#modalRoot").innerHTML="";document.removeEventListener("keydown",escClose);if(onClose){const f=onClose;onClose=null;f()}}
// a delete button that asks once more before doing it
function armDelete(btn,text,fn){btn.onclick=()=>{if(btn.dataset.armed){fn();return}btn.dataset.armed="1";btn.textContent=text;btn.classList.add("pri")}}

function placeOptions(sel,exclude){
  const all=places().filter(p=>!exclude||!exclude.has(p.id)).map(p=>({id:p.id,t:pathText(p.id)})).sort((a,b)=>a.t.localeCompare(b.t,"ru"));
  return all.map(o=>`<option value="${o.id}"${o.id===sel?" selected":""}>${esc(o.t)}</option>`).join("");
}

function itemModal(id,placeDefault){
  const it=id?S.items[id]:{name:"",qty:1,placeId:placeDefault||"",note:"",checkOn:null};
  if(!it)return;
  openModal(`<h2>${id?"Вещь":"Новая вещь"}</h2>
    <div class="fld"><label for="iName">Название</label><input id="iName" value="${esc(it.name)}" required></div>
    <div class="grid2">
      <div class="fld"><label for="iQty">Сколько штук</label><input id="iQty" type="number" min="0" step="1" inputmode="numeric" value="${+it.qty||0}"></div>
      <div class="fld"><label for="iDate">Проверить срок</label><input id="iDate" type="date" value="${esc(it.checkOn||"")}"></div>
    </div>
    <div class="fld"><label for="iPlace">Где лежит</label><select id="iPlace"><option value="">— Без места —</option>${placeOptions(exists(it.placeId)?it.placeId:"")}</select></div>
    <div class="fld"><label for="iNote">Заметка</label><textarea id="iNote" placeholder="Например: белый, на 2 метра">${esc(it.note||"")}</textarea></div>
    <div class="mact">${id?`<button class="btn danger left" id="iDel" aria-label="Удалить">🗑</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="iSave">Сохранить</button></div>`,m=>{
    const q=s=>m.querySelector(s);
    q("#iSave").onclick=()=>{
      const name=q("#iName").value.trim();if(!name){q("#iName").focus();return}
      const data={name,qty:Math.max(0,Math.round(+q("#iQty").value||0)),placeId:q("#iPlace").value||null,note:q("#iNote").value.trim(),checkOn:q("#iDate").value||null};
      closeModal();
      id?patch("items",id,data):put("items",newId(),data);
    };
    if(id)armDelete(q("#iDel"),"Точно удалить?",()=>{closeModal();del("items",id)});
    if(!id)setTimeout(()=>q("#iName").focus(),50);
  });
}

function placeModal(id,parentDefault){
  const p=id?S.places[id]:{name:"",emoji:"🧳",parentId:parentDefault&&parentDefault!=="none"?parentDefault:"",note:"",kit:false};
  if(!p)return;
  const ex=id?subtree(id):null;
  openModal(`<h2>${id?"Место":"Новое место"}</h2>
    <div class="fld"><label for="pName">Название</label><input id="pName" value="${esc(p.name)}" placeholder="Например: Сумка от рабочего ноутбука" required></div>
    <div class="fld"><span class="lb">Значок</span><div class="emojis">${EMOJIS.map(x=>`<button type="button" data-em="${x}" aria-pressed="${x===p.emoji}">${x}</button>`).join("")}</div></div>
    <div class="fld"><label for="pParent">Где находится</label><select id="pParent"><option value="">— Верхний уровень (дача, квартира…) —</option>${placeOptions(exists(p.parentId)?p.parentId:"",ex)}</select></div>
    <label class="chk"><input type="checkbox" id="pKit" ${p.kit?"checked":""}><span><b>Тревожная сумка</b></span></label>
    <div class="fld"><label for="pNote">Заметка</label><textarea id="pNote" placeholder="Например: стоит под кроватью">${esc(p.note||"")}</textarea></div>
    <div class="mact">${id?`<button class="btn danger left" id="pDel" aria-label="Удалить">🗑</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="pSave">Сохранить</button></div>`,m=>{
    const q=s=>m.querySelector(s);let em=p.emoji||"📦";
    q(".emojis").onclick=e=>{const b=e.target.closest("[data-em]");if(!b)return;em=b.dataset.em;m.querySelectorAll(".emojis button").forEach(x=>x.setAttribute("aria-pressed",x===b))};
    q("#pSave").onclick=()=>{
      const name=q("#pName").value.trim();if(!name){q("#pName").focus();return}
      const data={name,emoji:em,parentId:q("#pParent").value||null,kit:q("#pKit").checked,note:q("#pNote").value.trim()};
      closeModal();
      if(id)patch("places",id,data);
      else{const nid=newId();data.order=kids(data.parentId||"").length;put("places",nid,data);go("places",nid)}
    };
    if(id){
      const n=itemsIn(id).length,k=kids(id).length,par=exists(p.parentId)?p.parentId:"";
      const where=par?`«${S.places[par].name}»`:(k?"верхний уровень":"«Без места»");
      armDelete(q("#pDel"),n||k?`Удалить? Внутри ${[n?plural(n,"вещь","вещи","вещей"):"",k?plural(k,"место","места","мест"):""].filter(Boolean).join(" и ")} — переедут в ${where}`:"Точно удалить?",async()=>{
        closeModal();
        await Promise.all([...kids(id).map(c=>patch("places",c.id,{parentId:par||null})),...itemsIn(id).map(i=>patch("items",i.id,{placeId:par||null}))]);
        del("places",id);go("places",par);
      });
    }else setTimeout(()=>q("#pName").focus(),50);
  });
}

function ruleModal(id){
  const r=id?S.rules[id]:{name:"",words:[],need:1};
  if(!r)return;
  openModal(`<h2>${id?"Правило":"Новое правило"}</h2>
    <p class="meta" style="margin:0">Что должно лежать в <b>каждой</b> тревожной сумке.</p>
    <div class="fld"><label for="rName">Что</label><input id="rName" value="${esc(r.name)}" placeholder="Зарядка для телефона"></div>
    <div class="fld"><label for="rWords">Узнавать по словам в названии вещи</label><input id="rWords" value="${esc((r.words||[]).join(", "))}" placeholder="зарядк, кабель type-c"></div>
    <div class="fld"><label for="rNeed">Сколько нужно в каждой</label><input id="rNeed" type="number" min="1" step="1" inputmode="numeric" value="${+r.need||1}" style="max-width:120px"></div>
    <div class="fld"><span class="lb">Сейчас подходят</span><div class="meta" id="rPrev"></div></div>
    <div class="mact">${id?`<button class="btn danger left" id="rDel" aria-label="Удалить">🗑</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="rSave">Сохранить</button></div>`,m=>{
    const q=s=>m.querySelector(s);
    const words=()=>q("#rWords").value.split(",").map(s=>s.trim()).filter(Boolean);
    const prev=()=>{const w=words();const its=Object.values(S.items).filter(i=>fits({words:w},i));
      q("#rPrev").innerHTML=!w.length?"—":its.length?its.slice(0,30).map(i=>`${esc(i.name)} <span style="opacity:.7">(${esc(pathText(i.placeId))})</span>`).join("<br>")+(its.length>30?`<br>…и ещё ${its.length-30}`:""):"ничего — проверь слова"};
    q("#rWords").oninput=prev;prev();
    q("#rName").oninput=()=>{if(!id&&!q("#rWords").dataset.touched){q("#rWords").value=autoWord(q("#rName").value);prev()}};
    q("#rWords").addEventListener("keydown",()=>q("#rWords").dataset.touched="1");
    q("#rSave").onclick=()=>{
      const name=q("#rName").value.trim();if(!name){q("#rName").focus();return}
      const data={name,words:words().length?words():[autoWord(name)],need:Math.max(1,Math.round(+q("#rNeed").value||1))};
      closeModal();
      id?patch("rules",id,data):put("rules",newId(),{...data,order:rules().length});
    };
    if(id)armDelete(q("#rDel"),"Точно удалить?",()=>{closeModal();del("rules",id)});
  });
}
// «Зарядка для телефона» → «зарядк»: the first word without its ending
function autoWord(s){const w=norm(s).split(" ")[0]||"";return w.length>5?w.replace(/[аяоеыиьйую]+$/,""):w}

/* ---------- settings: import / export / sign out ---------- */
function settingsModal(){
  const n=Object.keys(S.items).length,k=Object.keys(S.places).length;
  openModal(`<h2>Настройки</h2>
    <p class="meta" style="margin:0">Ты вошла как <b>${esc(user&&user.email)}</b></p>
    <div class="fld"><span class="lb">Загрузить из файла</span>
      <button class="btn" id="imp" style="align-self:flex-start" aria-label="Выбрать файл">📁</button>
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
    const row={id:newId(),place_id:pid,name,qty:Number.isFinite(+i.qty)&&i.qty!==""&&i.qty!=null?Math.max(0,Math.round(+i.qty)):1,note:i.note?String(i.note):null};
    if(i.check_on||i.checkOn)row.check_on=String(i.check_on||i.checkOn).slice(0,10);
    items.push(row);
  }
  let nPlaces=0;
  for(const lv of levels){if(!lv||!lv.length)continue;done(await sb.from(TBL.places).insert(lv,{defaultToNull:false}));nPlaces+=lv.length}
  for(let i=0;i<items.length;i+=200)done(await sb.from(TBL.items).insert(items.slice(i,i+200),{defaultToNull:false}));
  const haveR=new Set(Object.values(base.rules).map(r=>norm(r.name)));
  const rs=(d.rules||[]).filter(r=>r&&r.name&&!haveR.has(norm(r.name))).map((r,n)=>({id:newId(),name:String(r.name),words:[].concat(r.words||autoWord(r.name)).map(String),need:Math.max(1,Math.round(+r.need||1)),ord:Object.keys(base.rules).length+n}));
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
