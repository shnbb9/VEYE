/* Simple product settings for VEYE's sole administrator. */
(function () {
const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const UI = window.Veye.UI;
const H = window.Veye.H;
const esc = UI.esc;

const MODES = [
  { key:'account', label:'Cara’s account', route:'/settings/account' },
  { key:'product', label:'Product settings', route:'/settings/product' },
  { key:'features', label:'Feature states', route:'/settings/features' },
];

function render(outlet, route) {
  const mode = route.params.section || 'account';
  if (!MODES.some(m=>m.key===mode)) { R.navigate('/settings/account'); return; }
  outlet.innerHTML=`<div class="page">
    ${H.pageHead({title:'Settings',desc:'The small set of account and product controls Cara needs for the Beta.',crumbs:[{label:'Home',route:'/home'},{label:'Settings'}],where:'settings'})}
    ${H.subnav(MODES,mode)}
    <div id="settingsBody"></div>
  </div>`;
  ({account,product,features})[mode](outlet.querySelector('#settingsBody'));
}

function account(host) {
  const me=S.get().me;
  host.innerHTML=`<div class="hgrid" data-reveal>
    <div class="card"><div class="card__head"><div><h2 class="card__title">Cara Hogue</h2><p class="t-support">Founder and sole administrator</p></div><span class="avatar avatar--lg">${esc(me.initials)}</span></div>
      <div class="card__body stack gap-5"><div><div class="t-eyebrow">Email</div><p>${esc(me.email)}</p></div><div><div class="t-eyebrow">Access</div><p>Full VEYE administration</p></div>
      <div class="notice notice--quiet">${icon('info',{size:18})}<div>This Beta console has one administrator. Roles, teams, invitations and organisation hierarchies are intentionally not included.</div></div></div>
      <div class="card__foot"><a class="btn btn--primary" href="${R.href('/profile')}">${icon('user-cog',{size:18})} Edit your profile</a></div></div>
    <div class="card"><div class="card__head"><div><h2 class="card__title">Account security</h2><p class="t-support">Production controls planned before member data is connected.</p></div></div>
      <div class="card__body card__body--flush"><div class="rows">
        <div class="rowitem"><span class="rowitem__icon">${icon('lock',{size:18})}</span><div><div class="rowitem__title">Password</div><div class="rowitem__meta">Managed through secure account recovery in production.</div></div><button class="btn btn--secondary btn--sm" data-demo="Password change">Review</button></div>
        <div class="rowitem"><span class="rowitem__icon">${icon('shield',{size:18})}</span><div><div class="rowitem__title">Two-step verification</div><div class="rowitem__meta">Required before production access.</div></div><span class="chip chip--draft">Planned</span></div>
      </div></div></div>
  </div>`;
  wireDemo(host);
}

function product(host) {
  const st=S.get();
  host.innerHTML=`<div class="hgrid" data-reveal>
    <div class="card"><div class="card__head"><div><h2 class="card__title">Member support</h2><p class="t-support">The contact details shown in member help areas.</p></div></div><div class="card__body stack gap-5">
      ${H.field({id:'supportEmail',label:'Support email',type:'email',value:st.org.supportEmail,required:true})}
      ${H.field({id:'supportPhone',label:'Support phone',value:st.org.supportPhone})}
      <button class="btn btn--primary" id="saveSupport">Save support details</button>
    </div></div>
    <div class="card"><div class="card__head"><div><h2 class="card__title">Beta defaults</h2><p class="t-support">Clear platform behaviour without technical configuration.</p></div></div><div class="card__body card__body--flush"><div class="rows">
      ${toggle('tips','Daily health tips',true,'Show approved health tips on the member dashboard.')}
      ${toggle('reminders','Tracker reminders',true,'Remind members when a tracker is due.')}
      ${toggle('companionReview','Companion review queue',true,'Hold sensitive replies for Cara to review.')}
    </div></div></div>
  </div>`;
  host.querySelector('#saveSupport').addEventListener('click',()=>{
    const email=host.querySelector('#supportEmail').value.trim();
    if(!email || !email.includes('@')){H.fieldError(host,'supportEmail','Enter a valid support email.');return;}
    S.set({org:{...st.org,supportEmail:email,supportPhone:host.querySelector('#supportPhone').value.trim()}});
    UI.toast({title:'Product settings saved',message:'Support details were updated in this browser only.'});
  });
  host.querySelectorAll('[data-simple-toggle]').forEach(x=>x.addEventListener('change',()=>UI.toast({title:'Preference updated',message:x.checked?'Turned on for the Beta.':'Turned off for the Beta.'})));
}

function toggle(id,title,checked,desc){return `<div class="rowitem"><span class="rowitem__icon">${icon('settings',{size:18})}</span><div><div class="rowitem__title">${esc(title)}</div><div class="rowitem__meta">${esc(desc)}</div></div><label class="switch"><input type="checkbox" data-simple-toggle id="${id}" ${checked?'checked':''}><span class="switch__track"></span><span class="sr-only">${esc(title)}</span></label></div>`;}

function features(host) {
  const rows=[
    ['Health Number','Available','The deterministic assessment and history.','live'],
    ['Blood markers','Available','Member entry and read-only result review.','live'],
    ['BMI and body composition','Available','Body-fat progress in My Progress; not part of onboarding.','live'],
    ['Health Assessment','Available','Eleven-question health assessment.','live'],
    ['Simple Health Quiz','Available','Eight yes-or-no questions.','live'],
    ['Mood, food and meal planning','Available','Core Beta tracking and planning.','live'],
    ['VEYE Companion','Beta','Conversation review and approved-source boundary.','info'],
    ['Supplements','Phase 2','Not an active management area in this Beta.','draft'],
    ['Fitness','Phase 2','Final workouts and media will be added after Beta.','draft'],
    ['Resources','Phase 2','Resource cards and media will be added after Beta.','draft'],
  ];
  host.innerHTML=`<div class="card" data-reveal><div class="card__head"><div><h2 class="card__title">Feature states</h2><p class="t-support">An honest view of what is available now and what comes later.</p></div></div><div class="card__body card__body--flush"><div class="rows">${rows.map(r=>`<div class="rowitem"><span class="rowitem__icon${r[3]==='draft'?' rowitem__icon--off':''}">${icon(r[3]==='draft'?'clock':'check-circle',{size:18})}</span><div><div class="rowitem__title">${r[0]}</div><div class="rowitem__meta">${r[2]}</div></div><span class="chip chip--${r[3]}">${r[1]}</span></div>`).join('')}</div></div></div>`;
}

function wireDemo(host){host.querySelectorAll('[data-demo]').forEach(b=>b.addEventListener('click',()=>UI.modal({title:b.dataset.demo,desc:'This security flow will be connected during production authentication work.',body:'<div class="notice notice--quiet">No account change is made in this prototype.</div>',actions:[{label:'Close',variant:'secondary',value:'close',autofocus:true}]})));}

window.Veye.screens=window.Veye.screens||{};
window.Veye.screens.settings={render};
})();
