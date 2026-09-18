/* Unified member requests: Contact Us, Help questions and Join Beta. */
(function () {
const { icon } = window.Veye;
const R = window.Veye.R;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const requests = [
  { id:'RQ-1042', type:'Contact Us', from:'Maya Chen', subject:'Question about my assessment history', received:'Today, 09:24', priority:'Normal', status:'New' },
  { id:'RQ-1041', type:'Help question', from:'Robert Williams', subject:'Where can I update a blood marker?', received:'Today, 08:50', priority:'Normal', status:'New' },
  { id:'RQ-1040', type:'Join Beta', from:'Elena Brooks', subject:'Beta application', received:'Yesterday, 16:12', priority:'Normal', status:'New' },
  { id:'RQ-1039', type:'Contact Us', from:'Cara Morgan', subject:'Please correct the email on my account', received:'Yesterday, 11:08', priority:'High', status:'In progress' },
  { id:'RQ-1038', type:'Help question', from:'Lena Ortiz', subject:'Meal plan question', received:'12 Aug 2026', priority:'Normal', status:'Resolved' },
];
let selected = 'RQ-1042';
let filter = 'Open';

function render(outlet) {
  outlet.innerHTML = `<div class="page">
    ${H.pageHead({ title:'Requests & Inbox', desc:'One simple place for Contact Us messages, Help questions and Join Beta submissions.', crumbs:[{label:'Home',route:'/home'},{label:'Requests & Inbox'}] })}
    <section class="lead"><div><h2>Member requests</h2><p>Start with the oldest high-priority item, then work through new messages.</p></div>
      <div class="minirow"><div class="mini"><span class="mini__n">3</span><span class="mini__l">New</span></div><div class="mini"><span class="mini__n">1</span><span class="mini__l">In progress</span></div><div class="mini"><span class="mini__n">1</span><span class="mini__l">Resolved</span></div></div>
    </section>
    <div class="review2" data-reveal>
      <div class="card"><div class="findbar" style="padding:var(--s-4)"><div class="modeswitch" style="width:100%">
        ${['Open','All','Resolved'].map(x=>`<button class="modeswitch__btn" data-rq-filter="${x}" aria-selected="${filter===x}">${x}</button>`).join('')}
      </div></div><div class="flaglist" id="rqList"></div></div>
      <div class="card" id="rqDetail"></div>
    </div>
  </div>`;
  outlet.querySelectorAll('[data-rq-filter]').forEach(b=>b.addEventListener('click',()=>{ filter=b.dataset.rqFilter; paint(outlet); }));
  paint(outlet);
}

function visibleRows() {
  return requests.filter(r => filter==='All' || (filter==='Resolved' ? r.status==='Resolved' : r.status!=='Resolved'));
}

function paint(outlet) {
  const rows=visibleRows();
  if (!rows.some(r=>r.id===selected)) selected=rows[0] && rows[0].id;
  outlet.querySelectorAll('[data-rq-filter]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.rqFilter===filter)));
  const list=outlet.querySelector('#rqList');
  list.innerHTML=rows.map(r=>`<button class="flag${r.id===selected?' is-active':''}" data-rq="${r.id}"><span class="flag__top"><span class="flag__who">${esc(r.from)}</span>${r.priority==='High'?'<span class="chip chip--attention chip--sm">High</span>':''}</span><span class="flag__why">${esc(r.subject)}</span><span class="t-support">${esc(r.type)} · ${esc(r.received)}</span></button>`).join('');
  list.querySelectorAll('[data-rq]').forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.rq;paint(outlet);}));
  const item=requests.find(r=>r.id===selected);
  const detail=outlet.querySelector('#rqDetail');
  if(!item){detail.innerHTML=`<div class="card__body">${H.emptyState({icon:'messages',title:'No requests here',msg:'Choose another filter.'})}</div>`;return;}
  detail.innerHTML=`<div class="card__head"><div><h2 class="card__title">${esc(item.subject)}</h2><p class="t-support">${esc(item.from)} · ${esc(item.received)}</p></div>${H.chip(item.status)}</div>
    <div class="card__body stack gap-5"><div><div class="t-eyebrow">Source</div><p>${esc(item.type)}</p></div><div><div class="t-eyebrow">Message</div><p class="t-support" style="font-size:var(--fs-body)">This sample submission shows where the member's full message and contact details will appear once the production forms are connected.</p></div>
    <div class="notice notice--quiet">${icon('info',{size:18})}<div>This is prototype data. No email or reply is sent from this screen.</div></div></div>
    <div class="card__foot"><button class="btn btn--secondary btn--sm" id="rqProgress">Mark in progress</button><button class="btn btn--primary btn--sm" id="rqResolve">Resolve</button></div>`;
  detail.querySelector('#rqProgress').addEventListener('click',()=>{item.status='In progress';UI.toast({title:'Request updated',message:'Marked in progress in this browser only.'});paint(outlet);});
  detail.querySelector('#rqResolve').addEventListener('click',()=>{item.status='Resolved';UI.toast({title:'Request resolved',message:'The sample request is now resolved.'});paint(outlet);});
}

window.Veye.screens=window.Veye.screens||{};
window.Veye.screens.requests={render};
})();
