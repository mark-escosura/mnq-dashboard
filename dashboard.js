/* Strategy Dashboard for Mark's MNQ trading journal.
   Self-contained: no other app files needed. Data lives in localStorage (key mnqJournal.v1, same shape the
   earlier journal app used: {version, trades:[], observations:[], settings:{...}}); unknown fields are kept as-is.
   CSV columns match journal.csv. Only kind=trade rows count as trades. */
(function(){
'use strict';
var KEY='mnqJournal.v1', TZ='America/Los_Angeles';
var COLS=['kind','id','date','time','instrument','direction','contracts','entry','stop','target','exit','exit_time','pnl','pnl_manual','r','r_manual','setup','followed_rules','notes','tags','text','fees','broker','import_keys','accounts'];
var INSTR={MNQ:{pv:2,fee:1.24},NQ:{pv:20,fee:0},MES:{pv:5,fee:0},ES:{pv:50,fee:0},M2K:{pv:5,fee:0},RTY:{pv:50,fee:0},MYM:{pv:0.5,fee:0},YM:{pv:5,fee:0},MGC:{pv:10,fee:0},GC:{pv:100,fee:0},MCL:{pv:100,fee:0},CL:{pv:1000,fee:0}};
var DEFAULT_ACCTS=[{id:'static50k',name:'Static 50K'},{id:'combine1',name:'Combine 50K #1'},{id:'combine2',name:'Combine 50K #2'},{id:'express1',name:'50K DLL Express #1'}];

function $(s){return document.querySelector(s);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function num(v){if(v===null||v===undefined)return NaN;var s=String(v).replace(/[$,\s]/g,'');if(s===''||s==='-')return NaN;return Number(s);}
function has(v){return !isNaN(num(v));}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
function toast(m,act,lbl){var t=$('#toast');t.textContent=m;if(act){var b=document.createElement('button');b.type='button';b.className='tact';b.textContent=lbl||'Undo';b.onclick=function(){t.style.display='none';act();};t.appendChild(b);}t.style.display='block';clearTimeout(toast._t);toast._t=setTimeout(function(){t.style.display='none';},act?7000:2400);}
function money(v,sign){if(!isFinite(v))return '—';var a=Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});return (v<0?'−$':(sign&&v>0?'+$':'$'))+a;}
function cls(v){return v>0?'pos':(v<0?'neg':'');}
function nowPT(){var p={};new Intl.DateTimeFormat('en-US',{timeZone:TZ,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date()).forEach(function(x){p[x.type]=x.value;});return {date:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute};}

/* ---------- storage ---------- */
var eqAcct='';var SEED=(typeof window!=='undefined'&&window.MNQ_SEED)||{};
var db=load(), sample=null, lastUndo=null;
function load(){var raw=null;try{raw=localStorage.getItem(KEY);}catch(e){}
  var d=null;if(raw){try{d=JSON.parse(raw);}catch(e){console.warn('Could not read saved journal',e);}}
  d=d&&typeof d==='object'?d:{version:1,trades:[],observations:[]};
  if(!Array.isArray(d.trades))d.trades=[];if(!Array.isArray(d.observations))d.observations=[];d.version=d.version||1;return d;}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(db));return true;}catch(e){alert('Could not save: browser storage is full or blocked.');return false;}}
function delAccts(){return (db.settings&&db.settings.deletedAccounts)||[];}
function accounts(){var D=delAccts();return acctsAll().filter(function(a){return D.indexOf(a.id)<0;});}
function acctsAll(){var s=db.settings&&Array.isArray(db.settings.accounts)&&db.settings.accounts.length?db.settings.accounts:DEFAULT_ACCTS;
  var L=s.map(function(a){return {id:String(a.id),name:String(a.name||a.id)};}),seen={};L.forEach(function(a){seen[a.id]=1;});
  DEFAULT_ACCTS.concat(SEED.accounts||[]).forEach(function(a){if(!seen[a.id]){seen[a.id]=1;L.push({id:String(a.id),name:String(a.name||a.id)});}});
  db.trades.forEach(function(t){(t.accounts||[]).forEach(function(id){if(!seen[id]){seen[id]=1;L.push({id:id,name:id});}});});return L;}
function inst(sym){var s=db.settings&&db.settings.instruments;var k=String(sym||'').toUpperCase();return (s&&s[k])||INSTR[k]||null;}

/* ---------- calc ---------- */
function autoPnl(t){var i=inst(t.instrument);if(!i)return NaN;var e=num(t.entry),x=num(t.exit),c=num(t.contracts);if(isNaN(e)||isNaN(x)||isNaN(c))return NaN;
  var pts=t.direction==='short'?e-x:x-e;return Math.round((pts*i.pv*c-i.fee*c)*100)/100;}
function autoR(t){var e=num(t.entry),s=num(t.stop),x=num(t.exit);if(isNaN(e)||isNaN(s)||isNaN(x)||e===s)return NaN;var pts=t.direction==='short'?e-x:x-e;return Math.round(pts/Math.abs(e-s)*100)/100;}
function pnlOf(t){return has(t.pnl)?num(t.pnl):autoPnl(t);}
function pnlFor(t,acct){var x=acct&&t.tsx&&t.tsx[acct];if(x&&isFinite(x.net)&&t.pnlSource==='TopstepX')return x.net;return pnlOf(t);}
function rOf(t){return has(t.r)?num(t.r):autoR(t);}
function sortT(a,b){return (a.date+(a.time||'')).localeCompare(b.date+(b.time||''))||((a.entryTs||0)-(b.entryTs||0));}
function onAcct(t,acct){return !acct||!t.accounts||!t.accounts.length||t.accounts.indexOf(acct)>=0;}

function select(f){var src=sample||db.trades;
  return src.filter(function(t){return t&&t.date&&(!f.from||t.date>=f.from)&&(!f.to||t.date<=f.to)&&onAcct(t,f.acct);})
    .slice().sort(sortT).map(function(t){return {t:t,p:pnlFor(t,f.acct),r:rOf(t)};}).filter(function(x){return isFinite(x.p);});}
function stats(rows){var s={n:rows.length,total:0,wins:0,losses:0,be:0,gw:0,gl:0,rSum:0,rN:0,fol:0,folN:0,peak:0,mdd:0,mddAt:'',eq:[],eqRows:[]};var eq=0;
  rows.forEach(function(x){s.total+=x.p;if(x.p>0){s.wins++;s.gw+=x.p;}else if(x.p<0){s.losses++;s.gl+=-x.p;}else s.be++;
    if(isFinite(x.r)){s.rSum+=x.r;s.rN++;}if(x.t.followed==='yes'||x.t.followed==='no'){s.folN++;if(x.t.followed==='yes')s.fol++;}
    eq+=x.p;if(eq>s.peak)s.peak=eq;var dd=s.peak-eq;if(dd>s.mdd){s.mdd=dd;s.mddAt=x.t.date;}
    s.eq.push({x:fmtD(x.t.date)+(x.t.time?' '+fmtT(x.t.time):''),y:Math.round(eq*100)/100});s.eqRows.push({d:x.t.date,y:Math.round(eq*100)/100});});
  s.total=Math.round(s.total*100)/100;s.winRate=s.n?s.wins/s.n:NaN;s.avgW=s.wins?s.gw/s.wins:NaN;s.avgL=s.losses?s.gl/s.losses:NaN;
  s.rr=(s.wins&&s.losses)?s.avgW/s.avgL:NaN;s.avgR=s.rN?s.rSum/s.rN:NaN;s.pf=s.gl?s.gw/s.gl:NaN;return s;}

/* ---------- render ---------- */
var ICONS={
 cal:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
 down:'<path d="M6 9l6 6 6-6"/>',right:'<path d="M9 6l6 6-6 6"/>',
 wallet:'<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M16 13h2M3 9h14a2 2 0 0 0 2-2V5"/>',
 sync:'<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 grid:'<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
 list:'<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
 upload:'<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
 share:'<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
 trend:'<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
 scale:'<path d="M12 4v16M5 20h14M5 8h14M7 8l-3 6a3 3 0 0 0 6 0zM17 8l-3 6a3 3 0 0 0 6 0z"/>',shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v5M12 16v.01"/>',
 inA:'<path d="M4 12h12M11 7l5 5-5 5M20 4v16"/>',outA:'<path d="M20 12H8M13 7l-5 5 5 5M4 4v16"/>',check:'<path d="M5 12l5 5 9-10"/>',xm:'<path d="M6 6l12 12M18 6L6 18"/>',trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'};
function ico(n,c){return '<span class="ico'+(c?' '+c:'')+'" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+(ICONS[n]||'')+'</svg></span>';}
function hydrateIcons(root){(root||document).querySelectorAll('.ico[data-i]').forEach(function(el){var n=el.getAttribute('data-i');el.removeAttribute('data-i');el.outerHTML=ico(n,el.className.replace(/\bico\b/,'').trim());});}
var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtD(d,yr){if(!d)return '';var p=d.split('-');return MON[+p[1]-1]+' '+(+p[2])+(yr?', '+p[0]:'');}
function fmtT(t){if(!t)return '';var p=t.split(':'),h=+p[0];return ((h%12)||12)+':'+p[1]+' '+(h<12?'AM':'PM');}
function moneyK(v){if(!isFinite(v))return '—';var a=Math.abs(v),s=v<0?'−$':'$';return s+(a>=10000?(a/1000).toFixed(a>=100000?0:1)+'K':Math.round(a).toLocaleString('en-US'));}
function dAdd(d,n){var x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);}
function dDiff(a,b){return Math.round((new Date(b+'T12:00:00Z')-new Date(a+'T12:00:00Z'))/864e5);}
function weekOf(d){var x=new Date(d+'T12:00:00Z'),w=(x.getUTCDay()+6)%7;return dAdd(d,-w);}
function filt(){return {from:$('#fFrom').value,to:$('#fTo').value,acct:$('#fAcct').value};}
function prior(f){if(!f.from)return null;var to=f.to||nowPT().date,len=dDiff(f.from,to)+1;if(len<1)return null;return {from:dAdd(f.from,-len),to:dAdd(f.from,-1),acct:f.acct,len:len};}
var preset=null;
function rangeLabel(f){if(!f.from&&!f.to)return 'All time';if(preset&&preset.fr===f.from&&preset.to===f.to)return preset.name;var y=nowPT().date.slice(0,4),same=f.from&&f.to&&f.from.slice(0,4)===f.to.slice(0,4);
  if(f.from&&f.to)return fmtD(f.from,!same)+' – '+fmtD(f.to,true);return f.from?'Since '+fmtD(f.from,true):'Until '+fmtD(f.to,true);}
function series(rows){var eq=0,peak=0,w=0,gw=0,gl=0,nw=0,nl=0,o={eq:[],wr:[],rr:[],dd:[]};
  rows.forEach(function(x,i){eq+=x.p;if(eq>peak)peak=eq;if(x.p>0){w++;gw+=x.p;nw++;}else if(x.p<0){gl+=-x.p;nl++;}
    o.eq.push(eq);o.wr.push(w/(i+1)*100);o.rr.push(nw&&nl?(gw/nw)/(gl/nl):null);o.dd.push(eq-peak);});return o;}
function kpiHTML(s,cmp,spark){
  function k(key,l,icon,v,c,sub,chg){return '<div class="kpi k-'+key+'"><div class="kh">'+ico(icon,'kico')+'<span class="l">'+l+'</span></div><div class="v '+(c||'')+'">'+v+'</div>'+
    '<div class="kf"><div class="s">'+(chg||'')+'<span class="sub">'+sub+'</span></div>'+(spark?'<div class="spark"><canvas id="sp-'+key+'" aria-hidden="true"></canvas></div>':'')+'</div></div>';}
  function ch(d,fmt,better){if(!cmp||!isFinite(d))return '';var good=better==='lower'?d<0:d>0;return '<span class="chg '+(d===0?'':(good?'pos':'neg'))+'">'+(d>0?'↑ ':(d<0?'↓ ':''))+fmt(Math.abs(d))+' vs prev '+cmp.len+'d</span>';}
  if(!s.n)return k('pnl','Total P&amp;L','trend','—','','')+k('wr','Win Rate','target','—','','')+k('rr','Avg R:R','scale','—','','')+k('dd','Max Drawdown','shield','—','','');
  var c=cmp&&cmp.s.n?cmp.s:null;if(!c)cmp=null;
  return k('pnl','Total P&amp;L','trend',money(s.total,true),cls(s.total),s.n+' trade'+(s.n>1?'s':'')+(isFinite(s.pf)?' · PF '+s.pf.toFixed(2):''),c&&ch(s.total-c.total,function(a){return money(a);}))+
    k('wr','Win Rate','target',(s.winRate*100).toFixed(1)+'%','blue',s.wins+'W · '+s.losses+'L'+(s.be?' · '+s.be+' BE':''),c&&ch((s.winRate-c.winRate)*100,function(a){return a.toFixed(1)+' pts';}))+
    k('rr','Avg R:R','scale',isFinite(s.rr)?s.rr.toFixed(2):'—','purple',isFinite(s.rr)?money(s.avgW)+' / '+money(s.avgL):'—',c&&isFinite(c.rr)&&isFinite(s.rr)&&ch(s.rr-c.rr,function(a){return a.toFixed(2);}))+
    k('dd','Max Drawdown','shield',s.mdd?money(-s.mdd):'$0.00',s.mdd?'neg':'',s.mdd?fmtD(s.mddAt,true):'—',c&&ch(s.mdd-c.mdd,function(a){return money(a);},'lower'));}
var charts={};
function kill(id){if(charts[id]){charts[id].destroy();delete charts[id];}}
function sparks(rows){['pnl','wr','rr','dd'].forEach(function(k){kill('sp-'+k);});if(rows.length<2||typeof Chart==='undefined')return;var S=series(rows);
  [['pnl',[0].concat(S.eq),S.eq[S.eq.length-1]>=0?'#34d399':'#ff5c5c'],['wr',S.wr,'#4da3ff'],['rr',S.rr,'#b07cff'],['dd',[0].concat(S.dd),'#ff5c5c']].forEach(function(a){var cv=document.getElementById('sp-'+a[0]);if(!cv)return;
    charts['sp-'+a[0]]=new Chart(cv,{type:'line',data:{labels:a[1].map(function(_,i){return i;}),datasets:[{data:a[1],borderColor:a[2],borderWidth:1.6,pointRadius:0,tension:.3,fill:true,spanGaps:true,backgroundColor:grad(a[2],.28)}]},
      options:{responsive:true,maintainAspectRatio:false,animation:false,events:[],plugins:{legend:{display:false},tooltip:{enabled:false}},scales:{x:{display:false},y:{display:false,grace:'8%'}},layout:{padding:{top:2,bottom:2}}}});});}
function rgba(hex,a){var n=parseInt(hex.slice(1),16);return 'rgba('+(n>>16)+','+((n>>8)&255)+','+(n&255)+','+a+')';}
function grad(col,a){return function(ctx){var c=ctx.chart,ar=c.chartArea;if(!ar)return rgba(col,a/2);var g=c.ctx.createLinearGradient(0,ar.top,0,ar.bottom);g.addColorStop(0,rgba(col,a));g.addColorStop(1,rgba(col,0));return g;};}
var endBadge={id:'endBadge',afterDatasetsDraw:function(c){var m=c.getDatasetMeta(0),p=m.data[m.data.length-1];if(!p)return;var v=c.data.datasets[0].data[m.data.length-1],x=c.ctx,t=moneyK(v),col=c.data.datasets[0].borderColor;
  x.save();x.font='600 12px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial';var w=x.measureText(t).width+14,h=22,bx=Math.min(c.chartArea.right+6,c.width-w-2),by=Math.max(c.chartArea.top,Math.min(p.y-h/2,c.chartArea.bottom-h));
  x.fillStyle=col;round(x,bx,by,w,h,6);x.fill();x.fillStyle='#06130c';x.textBaseline='middle';x.fillText(t,bx+7,by+h/2+.5);x.restore();}};
function eqPoints(s,mode){var pts=[{x:'Start',y:0}];if(mode==='weekly'||mode==='daily'){var last={},order=[];s.eqRows.forEach(function(e){var k=mode==='weekly'?weekOf(e.d):e.d;if(!(k in last))order.push(k);last[k]=e.y;});
  order.forEach(function(k){pts.push({x:(mode==='weekly'?'Wk '+fmtD(k):fmtD(k)),y:last[k]});});return pts;}return pts.concat(s.eq);}
function drawChart(id,emptyId,s,mode){var cv=document.getElementById(id);kill(id);
  $('#'+emptyId).classList.toggle('hide',!!s.n);cv.style.visibility=s.n?'visible':'hidden';if(!s.n||typeof Chart==='undefined')return;
  var pts=eqPoints(s,mode||'daily'),up=s.total>=0,col=up?'#34d399':'#ff5c5c';
  charts[id]=new Chart(cv,{type:'line',data:{labels:pts.map(function(p){return p.x;}),datasets:[{data:pts.map(function(p){return p.y;}),borderColor:col,backgroundColor:grad(col,.38),fill:'origin',tension:.25,pointRadius:pts.length>30?0:2.5,pointHoverRadius:4,borderWidth:2.2,pointBackgroundColor:col}]},plugins:[endBadge],
    options:{responsive:true,maintainAspectRatio:false,animation:false,layout:{padding:{right:62,top:6}},interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return money(c.parsed.y,true);}}}},
      scales:{x:{ticks:{color:'#8b949e',maxTicksLimit:6,maxRotation:0,autoSkipPadding:12},grid:{display:false},border:{color:'#2d3640'}},y:{ticks:{color:'#8b949e',maxTicksLimit:6,callback:function(v){return moneyK(v);}},grid:{color:'rgba(139,148,158,.12)'},border:{display:false}}}}});}
function groups(rows){var g={};rows.forEach(function(x){var k=(x.t.setup||'').trim()||'(no setup)';(g[k]=g[k]||[]).push(x);});
  return Object.keys(g).map(function(k){return {k:k,s:stats(g[k])};}).sort(function(a,b){return b.s.total-a.s.total;});}
var PAL=['#34d399','#ff6b6b','#4da3ff','#f5a524','#b07cff','#22d3ee','#f472b6'];
function hue(s){var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return PAL[h%PAL.length];}
function initials(s){var w=s.replace(/[^A-Za-z0-9 ]/g,' ').trim().split(/\s+/);return ((w[0]||'?')[0]+((w[1]||'')[0]||'')).toUpperCase();}
function stratCards(rows){var G=groups(rows);
  if(!G.length){$('#strats').innerHTML='<div class="card empty-card">No strategies yet.</div>';return;}
  $('#strats').innerHTML=G.map(function(g){var s=g.s,c=hue(g.k),wr=s.winRate*100;return '<div class="strat card"><div class="sh"><span class="sico" style="color:'+c+';background:'+rgba(c,.16)+'">'+esc(initials(g.k))+'</span><div><div class="sn">'+esc(g.k)+'</div><div class="small mut">Win '+wr.toFixed(1)+'%</div></div></div>'+
    '<div class="bar"><i style="width:'+Math.max(2,wr).toFixed(1)+'%;background:'+(s.total>=0?'#34d399':'#ff5c5c')+'"></i></div><div class="sf"><b class="'+cls(s.total)+'">'+money(s.total,true)+'</b><span class="small mut">'+s.n+' trade'+(s.n>1?'s':'')+'</span></div></div>';}).join('');}
function setupTable(rows){var G=groups(rows);
  var h='<thead><tr><th class="l">Setup</th><th>Trades</th><th>Win rate</th><th>Net P&amp;L</th><th>Avg P&amp;L</th><th>Avg R</th><th>Profit factor</th><th>Max DD</th><th>Rules followed</th></tr></thead><tbody>';
  if(!G.length)h+='<tr><td class="empty" colspan="9">No trades yet.</td></tr>';
  G.forEach(function(g){var s=g.s;h+='<tr><td class="l">'+esc(g.k)+'</td><td>'+s.n+'</td><td>'+(s.winRate*100).toFixed(0)+'%</td><td class="'+cls(s.total)+'">'+money(s.total,true)+'</td><td class="'+cls(s.total)+'">'+money(s.total/s.n,true)+'</td><td>'+(isFinite(s.avgR)?s.avgR.toFixed(2):'—')+'</td><td>'+(isFinite(s.pf)?s.pf.toFixed(2):(s.gw?'∞':'—'))+'</td><td class="'+(s.mdd?'neg':'')+'">'+(s.mdd?money(-s.mdd):'$0.00')+'</td><td>'+(s.folN?Math.round(s.fol/s.folN*100)+'%':'—')+'</td></tr>';});
  $('#tblSetup').innerHTML=h+'</tbody>';}
function tradeCard(x,A,full){var t=x.t,dir=t.direction==='short'?'short':'long',n=num(t.contracts);
  var acc=(t.accounts&&t.accounts.length)?t.accounts.map(function(id){return A[id]||id;}).join(', '):'All accounts';
  var rule=t.followed==='yes'?'<span class="rchip ok">'+ico('check')+'Rules Followed</span>':(t.followed==='no'?'<span class="rchip bad">'+ico('xm')+'Broke Rules</span>':'');
  function leg(icon,lbl,d,tm,px){return '<div class="leg">'+ico(icon,'lico')+'<span class="lt">'+lbl+' '+esc(fmtD(d,true))+(tm?' '+esc(fmtT(tm)):'')+'</span><span class="px">'+(has(px)?esc(Number(px).toLocaleString('en-US',{maximumFractionDigits:4})):'—')+'</span></div>';}
  return '<article class="trade card" data-id="'+esc(t.id)+'"><span class="dir '+dir+'">'+dir.toUpperCase()+'</span>'+
    '<div class="tm"><div class="tt">'+esc(t.setup||'(no setup)')+' <span class="mut">• '+esc(t.instrument||'')+'</span></div><div class="small mut">'+(isFinite(n)?n+' ct':'')+(full?' · '+esc(acc):'')+'</div></div>'+
    '<div class="legs">'+leg('inA','In',t.date,t.time,t.entry)+leg('outA','Out',t.date,t.exitTime,t.exit)+'</div>'+
    '<div class="tp"><b class="'+cls(x.p)+'">'+money(x.p,true)+'</b>'+rule+(full&&isFinite(x.r)?'<span class="small mut">'+x.r.toFixed(2)+' R</span>':'')+'</div>'+
    (full?(sample?'':'<button type="button" class="del" data-del="'+esc(t.id)+'" title="Delete trade" aria-label="Delete trade">'+ico('trash')+'</button>'):'<span class="chev">'+ico('right')+'</span>')+'</article>';}
function emptyTrades(){return '<div class="card empty-card">No trades yet.<div class="btns center"><button type="button" class="btn pri" data-act="add">＋ Add trade</button><button type="button" class="btn" data-act="import">Import CSV</button></div></div>';}
function tradeLists(rows){var A={};accounts().forEach(function(a){A[a.id]=a.name;});var L=rows.slice().reverse();
  $('#recent').innerHTML=L.length?L.slice(0,5).map(function(x){return tradeCard(x,A,false);}).join(''):emptyTrades();
  $('#allTrades').innerHTML=L.length?L.map(function(x){return tradeCard(x,A,true);}).join(''):emptyTrades();
  $('#tradeCount').textContent=L.length?'('+L.length+')':'';}
function acctOptions(sel){var v=sel.value;sel.innerHTML='<option value="">All accounts</option>'+accounts().map(function(a){return '<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>';}).join('');sel.value=v;if(sel.value!==v)sel.value='';}
function render(){[$('#fAcct'),$('#shAcct')].forEach(acctOptions);
  var f=filt(),rows=select(f),s=stats(rows),pr=prior(f),cmp=null;
  if(pr&&rows.length){var ps=stats(select(pr));cmp={s:ps,len:pr.len};}
  $('#rangeLbl').textContent=rangeLabel(f);acctSummary(f.acct);$('#delAcct').classList.toggle('hide',!f.acct||!!sample);syncLbl();
  $('#kpis').innerHTML=kpiHTML(s,cmp,true);sparks(rows);drawChart('eqChart','eqEmpty',s,$('#eqMode').value);stratCards(rows);setupTable(rows);tradeLists(rows);
  $('#eqNote').textContent='';eqAcct=f.acct?acctName(f.acct):'';
  $('#sampleBanner').classList.toggle('hide',!sample);document.body.classList.toggle('sampling',!!sample);
  $('#setupList').innerHTML=uniq(db.trades.map(function(t){return t.setup;}).concat(['Midpoint rule'])).map(function(s){return '<option value="'+esc(s)+'">';}).join('');}
function acctSummary(id){var a=(SEED.accounts||[]).filter(function(x){return x.id===id;})[0],el=$('#acctSum');if(!a||sample){el.classList.add('hide');return;}
  var d=a.share_page_displayed||{},K=[['Total P&L','Net P&L'],['Trade Win %','Win %'],['Profit Factor','PF'],['Avg Win / Avg Loss','Avg W/L'],['Total Number of Trades','Trades']],
    M=[['Total Number of Lots Traded','Lots'],['Best Trade','Best'],['Worst Trade','Worst']];
  function dl(L){return '<dl class="asum">'+L.filter(function(k){return d[k[0]];}).map(function(k){return '<div><dt title="'+esc(k[0])+'">'+esc(k[1])+'</dt><dd>'+esc(d[k[0]])+'</dd></div>';}).join('')+'</dl>';}
  el.innerHTML='<div class="row"><h2>'+esc(a.name)+'</h2><span class="rchip ok">'+esc(a.broker||'')+'</span></div>'+dl(K)+
    '<div class="afoot"><details class="more"><summary>More</summary>'+dl(M)+'<p class="small mut">From the TopstepX share page ('+esc(a.share_page_range_default||'')+'), fetched '+esc(a.fetched_at_pt||'')+'. Account '+esc(a.topstepx_account_name||'')+'.</p></details>'+
    '<a class="small" href="'+esc(a.source_url)+'" target="_blank" rel="noopener">Share page ↗</a></div>';el.classList.remove('hide');}
function uniq(a){var o={},r=[];a.forEach(function(x){x=(x||'').trim();if(x&&!o[x]){o[x]=1;r.push(x);}});return r;}

/* ---------- modals ---------- */
function openM(id){$(id).classList.remove('hide');document.documentElement.classList.add('modal-open');}
function closeM(el){el.closest('.modal').classList.add('hide');unlock();document.body.classList.remove('printing');}
document.addEventListener('click',function(e){var c=e.target.closest('[data-close]');if(c){closeM(c);return;}
  if(e.target.classList.contains('modal')){e.target.classList.add('hide');unlock();return;}
  var d=e.target.closest('[data-del]');if(d){var id=d.getAttribute('data-del'),t=db.trades.filter(function(x){return x.id===id;})[0];
    if(t&&confirm('Delete the '+t.date+' '+(t.direction||'')+' trade ('+money(pnlOf(t),true)+')?')){db.seedDeletedIds=(db.seedDeletedIds||[]).concat([t.id]);if(t.importKeys&&t.importKeys.length)db.deletedImportKeys=(db.deletedImportKeys||[]).concat(t.importKeys);db.trades=db.trades.filter(function(x){return x.id!==id;});persist();render();toast('Trade deleted');}}});
document.addEventListener('keydown',function(e){if(e.key==='Escape')document.querySelectorAll('.modal').forEach(function(m){m.classList.add('hide');});unlock();});
function unlock(){if(!document.querySelector('.modal:not(.hide)'))document.documentElement.classList.remove('modal-open');}

/* ---------- add trade ---------- */
var F=$('#addForm');
function formTrade(){var o={};new FormData(F).forEach(function(v,k){o[k]=String(v).trim();});return o;}
function updateAuto(){var o=formTrade(),t={instrument:o.instrument,direction:o.direction,contracts:o.contracts,entry:o.entry,stop:o.stop,exit:o.exit};
  var p=autoPnl(t),r=autoR(t);$('#pnlHint').textContent=isFinite(p)?'(auto: '+money(p,true)+')':(inst(o.instrument)?'(auto)':'(manual)');
  $('#rHint').textContent=isFinite(r)?'(auto: '+r.toFixed(2)+')':'(needs stop)';
  var e=num(o.entry),s=num(o.stop),bad=isFinite(e)&&isFinite(s)&&((o.direction==='long'&&s>=e)||(o.direction==='short'&&s<=e));$('#addErr').textContent=bad?'Stop is on the wrong side of the entry for a '+o.direction+'.':'';}
F.addEventListener('input',updateAuto);
$('#btnAdd').onclick=function(){F.reset();var n=nowPT();F.date.value=n.date;F.time.value=n.time;
  $('#acctBoxes').innerHTML='<div class="small mut">Accounts</div>'+accounts().map(function(a){return '<label class="acc"><input type="checkbox" name="acct" value="'+esc(a.id)+'" checked> '+esc(a.name)+'</label>';}).join('');
  updateAuto();openM('#mAdd');if(!(window.matchMedia&&matchMedia('(pointer:coarse)').matches))F.date.focus();};
F.addEventListener('submit',function(e){e.preventDefault();var o=formTrade();
  if(!o.date){$('#addErr').textContent='Date is required.';return;}
  if(!has(o.pnl)&&!(has(o.entry)&&has(o.exit)&&has(o.contracts))){$('#addErr').textContent='Enter entry, exit and contracts, or type the P&L.';return;}
  var ac=[].slice.call(F.querySelectorAll('input[name=acct]:checked')).map(function(x){return x.value;}),all=F.querySelectorAll('input[name=acct]').length;
  if(all&&!ac.length){$('#addErr').textContent='Keep at least one account ticked.';return;}
  var t={id:uid(),date:o.date,time:o.time,instrument:(o.instrument||'MNQ').toUpperCase(),direction:o.direction==='short'?'short':'long',
    contracts:has(o.contracts)?num(o.contracts):'',entry:has(o.entry)?num(o.entry):'',stop:has(o.stop)?num(o.stop):'',target:has(o.target)?num(o.target):'',exit:has(o.exit)?num(o.exit):'',exitTime:o.exit_time,
    setup:o.setup,followed:o.followed,notes:o.notes,screenshot:'',createdAt:Date.now()};
  t.pnlManual=has(o.pnl);t.pnl=t.pnlManual?num(o.pnl):(isFinite(autoPnl(t))?autoPnl(t):'');
  t.rManual=has(o.r);t.r=t.rManual?num(o.r):(isFinite(autoR(t))?autoR(t):'');
  if(ac.length&&ac.length<all)t.accounts=ac;
  db.trades.push(t);if(!persist()){db.trades.pop();return;}if(sample){sample=null;$('#fSample').checked=false;}
  closeM(F);render();toast('Saved ('+money(pnlOf(t),true)+')');});

/* ---------- CSV ---------- */
function csvCell(v){v=v==null?'':String(v);return /[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}
function toCSV(){var rows=[COLS.join(',')];
  db.trades.slice().sort(sortT).forEach(function(t){rows.push(['trade',t.id,t.date,t.time,t.instrument,t.direction,t.contracts,t.entry,t.stop,t.target,t.exit,t.exitTime,pnlOf(t),t.pnlManual?'yes':'no',has(t.r)?t.r:'',t.rManual?'yes':'no',t.setup,t.followed,t.notes,'','',has(t.fees)?t.fees:'',t.broker||'',(t.importKeys||[]).join(' '),(t.accounts||[]).join(' ')].map(csvCell).join(','));});
  db.observations.slice().sort(sortT).forEach(function(o){rows.push([o.kind==='skip'?'skip':'observation',o.id,o.date,o.time,'','','','','','','','','','','','',o.setup||'',o.followed||'','',(o.tags||[]).join('; '),o.text].map(csvCell).join(','));});
  return rows.join('\r\n')+'\r\n';}
function parseCSV(s){var rows=[],row=[],cell='',q=false,i=0;s=s.replace(/^\uFEFF/,'');
  for(;i<s.length;i++){var c=s[i];if(q){if(c==='"'){if(s[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=c;}
    else if(c==='"')q=true;else if(c===','){row.push(cell);cell='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&s[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=c;}
  if(cell!==''||row.length){row.push(cell);rows.push(row);}return rows.filter(function(r){return r.length>1||r[0]!=='';});}
function upsert(list,item){var i=list.findIndex(function(x){return x.id===item.id;});if(i<0){list.push(item);return 'add';}if(!item.screenshot&&list[i].screenshot)item.screenshot=list[i].screenshot;
  ['tsx','tsxBase','pnlSource','entryTs','exitTs','contract'].forEach(function(k){if(item[k]===undefined&&list[i][k]!==undefined)item[k]=list[i][k];});list[i]=item;return 'upd';}
/* account cells: one or more account ids or names separated by ; | , (names may contain spaces); old files used space-separated ids */
function parseAccts(v){var A=accounts(),out=[];function find(p){p=p.trim();var a=A.filter(function(x){return x.id===p||x.name.toLowerCase()===p.toLowerCase();})[0];return a?a.id:null;}
  String(v).split(/[;|,]/).forEach(function(p){if(!p.trim())return;var id=find(p);if(id){out.push(id);return;}p.trim().split(/\s+/).forEach(function(q){out.push(find(q)||q);});});
  return out.filter(function(x,i){return out.indexOf(x)===i;});}
function keyIx(){var ix={};db.trades.forEach(function(t){(t.importKeys||[]).forEach(function(k){ix[k]=1;});});(db.deletedImportKeys||[]).forEach(function(k){ix[k]=1;});return ix;}
/* seed-data.js (built from journal.csv by build_seed.py): load its trades once per journal.csv version so they show without a manual import.
   Trades already present (same id or TopstepX key) or deleted earlier are skipped, so nothing is duplicated or resurrected. */
function applySeed(){if(!SEED.journalCsv)return;db.settings=db.settings||{};if(db.settings.seedHash===SEED.hash)return;
  try{mergeRows(parseCSV(SEED.journalCsv));db.settings.seedHash=SEED.hash;persist();}catch(e){console.warn('Seed data not loaded',e);}}
/* add journal rows that are not already here, deleted, or on a deleted account; returns trades added */
function mergeRows(rows){if(rows.length<2)return 0;var hd=rows[0].map(function(h){return h.trim().toLowerCase();}),ki=hd.indexOf('kind'),ii=hd.indexOf('id'),kk=hd.indexOf('import_keys'),ix=keyIx(),
    del=db.seedDeletedIds||[],keep=[rows[0]],C=function(n){return hd.indexOf(n);},fp=function(d,dir,c,e,x){return [d,String(dir||'').toLowerCase(),Math.abs(num(c)),num(e),num(x)].join('|');},FP={},n=0,
    DA=delAccts(),AL=acctsAll(),onDel=function(v){if(!DA.length||!v)return false;var ids=String(v).split(/[;|]/).map(function(p){p=p.trim().toLowerCase();var a=AL.filter(function(x){return x.id.toLowerCase()===p||x.name.toLowerCase()===p;})[0];return a?a.id:p;}).filter(Boolean);return ids.length&&ids.every(function(id){return DA.indexOf(id)>=0;});};
  db.trades.forEach(function(t){FP[fp(t.date,t.direction,t.contracts,t.entry,t.exit)]=1;});
  rows.slice(1).forEach(function(r){var kind=(r[ki]||'trade').toLowerCase();if(kind!=='trade'){if(!db.observations.some(function(o){return o.id===r[ii];}))keep.push(r);return;}
    if(db.trades.some(function(t){return t.id===r[ii];})||del.indexOf(r[ii])>=0)return;if(String(r[kk]||'').split(/\s+/).some(function(k){return k&&ix[k];}))return;var f=fp(r[C('date')],r[C('direction')],r[C('contracts')],r[C('entry')],r[C('exit')]);if(FP[f])return;if(onDel(r[C('accounts')]))return;FP[f]=1;n++;keep.push(r);});
  if(keep.length>1)importJournal(keep);return n;}
/* ---------- TopstepX sync (public share API, CORS open) ---------- */
var TSX_API='https://userapi.topstepx.com',JHD='kind,id,date,time,instrument,direction,contracts,entry,stop,target,exit,exit_time,pnl,pnl_manual,r,r_manual,setup,followed_rules,notes,tags,text,fees,broker,import_keys,accounts'.split(',');
function ptP(iso){var p={};new Intl.DateTimeFormat('en-US',{timeZone:TZ,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(iso)).forEach(function(x){p[x.type]=x.value;});return {d:p.year+'-'+p.month+'-'+p.day,hm:p.hour+':'+p.minute,hms:p.hour+':'+p.minute+':'+p.second};}
function tsxRow(t,a){var en=ptP(t.createdAt),ex=ptP(t.exitedAt),g=+t.pnL,fe=+t.fees,co=+t.commissions,o={kind:'trade',id:'tsx-'+t.id,date:en.d,time:en.hm,instrument:String(t.symbolId||'').split('.').pop()||'MNQ',
  direction:t.positionSize<0?'long':'short',contracts:String(Math.abs(t.positionSize)),entry:String(t.entryPrice),exit:String(t.exitPrice),exit_time:ex.hm,pnl:(g-fe-co).toFixed(2),pnl_manual:'yes',r_manual:'no',
  notes:'TopstepX trade '+t.id+', '+(t.contractDisplayName||'')+'. Entry '+en.hms+', exit '+ex.hms+' PT ('+(t.tradeDurationDisplay||'')+'). Gross $'+g.toFixed(2)+', commissions $'+co.toFixed(2)+', fees $'+fe.toFixed(2)+'. Source: public share page, account '+(a.topstepx_account_name||'')+'.',
  fees:(fe+co).toFixed(2),broker:'TopstepX',import_keys:'topstepx:'+t.id,accounts:a.name};return JHD.map(function(h){return o[h]==null?'':o[h];});}
function syncLbl(){var s=db.settings&&db.settings.lastSync;$('#syncLbl').textContent=s?'Synced '+fmtD(ptP(s.at).d)+', '+fmtT(ptP(s.at).hm)+' PT'+(s.mode==='live'?'':' (published)'):'';}
function refreshAccts(){if(!/^https?:/.test(location.protocol))return Promise.resolve();
  return fetch('accounts.json?v='+Date.now(),{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(j){if(!j||!j.accounts)return;var M={};j.accounts.forEach(function(a){M[a.id]=a;});
    (SEED.accounts||[]).forEach(function(a,i){var b=M[a.id];if(b){delete b.raw_responses;SEED.accounts[i]=b;}});}).catch(function(){});}
function syncNow(){if(sample){toast('Turn off sample data first');return;}var btn=$('#syncBtn');if(btn.classList.contains('spin'))return;btn.classList.add('spin');
  var A=(SEED.accounts||[]).filter(function(a){return a.topstepx_account_id&&delAccts().indexOf(a.id)<0;}),end=new Date(Date.now()+2*864e5).toISOString();
  function done(n,mode){db.settings=db.settings||{};db.settings.lastSync={at:new Date().toISOString(),mode:mode};persist();btn.classList.remove('spin');render();
    toast((n?'+'+n+' trade'+(n===1?'':'s'):'Up to date')+(mode==='live'?'':' (published data)'));}
  function published(){return fetch('journal.csv?v='+Date.now(),{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error(r.status);return r.text();})
    .then(function(c){var n=mergeRows(parseCSV(c));return refreshAccts().then(function(){done(n,'published');});})
    .catch(function(){btn.classList.remove('spin');toast('Sync failed');});}
  if(!A.length)return published();
  Promise.all(A.map(function(a){return fetch(TSX_API+'/Trade/range',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tradingAccountId:a.topstepx_account_id,start:'2020-01-01T00:00:00.000Z',end:end})})
    .then(function(r){if(!r.ok)throw new Error(r.status);return r.json();}).then(function(L){return (Array.isArray(L)?L:[]).filter(function(t){return !t.voided&&t.exitedAt;}).sort(function(x,y){return x.createdAt<y.createdAt?-1:1;}).map(function(t){return tsxRow(t,a);});});}))
    .then(function(ls){var n=mergeRows([JHD].concat([].concat.apply([],ls)));return refreshAccts().then(function(){done(n,'live');});})
    .catch(function(e){console.warn('Live sync failed, loading published data',e);published();});}
function delAcct(){var id=$('#fAcct').value;if(!id||sample)return;var nm=acctName(id),mine=db.trades.filter(function(t){return t.accounts&&t.accounts.indexOf(id)>=0;}),only=mine.filter(function(t){return t.accounts.length===1;});
  if(!confirm('Delete "'+nm+'" and its '+only.length+' trade'+(only.length===1?'':'s')+'?'))return;var snap=JSON.stringify(db);db.settings=db.settings||{};
  db.settings.deletedAccounts=delAccts().concat([id]);if(Array.isArray(db.settings.accounts))db.settings.accounts=db.settings.accounts.filter(function(a){return String(a.id)!==id;});
  only.forEach(function(t){db.seedDeletedIds=(db.seedDeletedIds||[]).concat([t.id]);if(t.importKeys&&t.importKeys.length)db.deletedImportKeys=(db.deletedImportKeys||[]).concat(t.importKeys);});
  db.trades=db.trades.filter(function(t){return only.indexOf(t)<0;});mine.forEach(function(t){if(t.accounts.length>1){t.accounts=t.accounts.filter(function(x){return x!==id;});if(t.tsx)delete t.tsx[id];}});
  persist();$('#fAcct').value='';render();toast('Deleted '+nm,function(){db=JSON.parse(snap);persist();render();$('#fAcct').value=id;render();});}
function importJournal(rows){var hd=rows[0].map(function(h){return h.trim().toLowerCase();}),r={trades:0,updated:0,notes:0};
  rows.slice(1).forEach(function(rw){var o={};hd.forEach(function(h,i){o[h]=rw[i]==null?'':rw[i];});var kind=(o.kind||'trade').toLowerCase();
    if(kind==='trade'){if(!o.date)return;var t={id:o.id||uid(),date:o.date,time:o.time,instrument:(o.instrument||'MNQ').toUpperCase(),direction:(o.direction||'long').toLowerCase()==='short'?'short':'long',
      contracts:has(o.contracts)?num(o.contracts):'',entry:has(o.entry)?num(o.entry):'',stop:has(o.stop)?num(o.stop):'',target:has(o.target)?num(o.target):'',exit:has(o.exit)?num(o.exit):'',exitTime:o.exit_time||'',
      setup:o.setup||'',followed:(o.followed_rules||'').toLowerCase()==='no'?'no':((o.followed_rules||'')?'yes':''),notes:o.notes||'',screenshot:''};
      t.pnlManual=(o.pnl_manual||'').toLowerCase()==='yes';t.rManual=(o.r_manual||'').toLowerCase()==='yes';
      t.pnl=has(o.pnl)?num(o.pnl):(isFinite(autoPnl(t))?autoPnl(t):'');t.r=has(o.r)?num(o.r):(isFinite(autoR(t))?autoR(t):'');
      if(o.import_keys){t.importKeys=o.import_keys.split(/\s+/).filter(Boolean);t.broker=o.broker||'';}if(has(o.fees))t.fees=num(o.fees);
      if(o.accounts){var ac=parseAccts(o.accounts);if(ac.length)t.accounts=ac;}
      if(!db.trades.some(function(x){return x.id===t.id;})&&(t.importKeys||[]).some(function(k){return keyIx()[k];})){r.dups=(r.dups||0)+1;return;}
      if(upsert(db.trades,t)==='add')r.trades++;else r.updated++;}
    else{if(!o.date)return;var ob={id:o.id||uid(),kind:kind==='skip'?'skip':'observation',date:o.date,time:o.time||'',text:o.text||o.notes||'',tags:(o.tags||'').split(/[;|]/).map(function(s){return s.trim();}).filter(Boolean),screenshot:''};
      if(ob.kind==='skip'){ob.setup=o.setup||'';ob.followed=(o.followed_rules||'yes').toLowerCase()==='no'?'no':'yes';}upsert(db.observations,ob);r.notes++;}});
  return 'Journal CSV: added '+r.trades+' trade'+(r.trades===1?'':'s')+(r.updated?', updated '+r.updated:'')+(r.dups?', skipped '+r.dups+' already imported from TopstepX':'')+(r.notes?', '+r.notes+' note/no-trade entr'+(r.notes===1?'y':'ies'):'')+'.';}

/* TopstepX / ProjectX Trades export */
function normH(h){return String(h||'').replace(/^\uFEFF/,'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');}
function pnum(v){if(v==null)return NaN;var s=String(v).trim();if(!s)return NaN;var neg=/^\(.*\)$/.test(s)||/^[-\u2212]/.test(s)||/^\$\s*[-\u2212]/.test(s);s=s.replace(/[^0-9.]/g,'');if(!s)return NaN;var n=Number(s);return isNaN(n)?NaN:(neg?-n:n);}
function tzOff(zone,ms){var p={};new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(ms)).forEach(function(x){p[x.type]=x.value;});
  return Math.round((Date.UTC(+p.year,+p.month-1,+p.day,(+p.hour)%24,+p.minute,+p.second)-ms)/60000);}
function wallToUTC(y,mo,d,h,mi,s,zone){var g=Date.UTC(y,mo-1,d,h,mi,s),o=tzOff(zone,g),u=g-o*60000,o2=tzOff(zone,u);if(o2!==o)u=g-o2*60000;return u;}
function parseDT(v,zone){var s=String(v==null?'':v).trim(),m;if(!s)return null;var y,mo,d,h=0,mi=0,se=0,ap='',z='';
  if((m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?\s*(.*)$/))){y=+m[1];mo=+m[2];d=+m[3];h=+(m[4]||0);mi=+(m[5]||0);se=+(m[6]||0);z=m[7]||'';}
  else if((m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*([AaPp][Mm])?)?\s*(.*)$/))){mo=+m[1];d=+m[2];y=+m[3];if(y<100)y+=2000;h=+(m[4]||0);mi=+(m[5]||0);se=+(m[6]||0);ap=(m[7]||'').toUpperCase();z=m[8]||'';}
  else{var t=Date.parse(s);return isNaN(t)?null:{ms:t,zoned:true};}
  if(ap==='PM'&&h<12)h+=12;if(ap==='AM'&&h===12)h=0;z=z.trim().toUpperCase();var base=Date.UTC(y,mo-1,d,h,mi,se);
  if(z==='Z'||z==='UTC'||z==='GMT')return {ms:base,zoned:true};
  if((m=z.match(/^(?:UTC|GMT)?\s*([+-])(\d{1,2}):?(\d{2})?$/))){var off=((+m[2])*60+(+(m[3]||0)))*(m[1]==='-'?-1:1);return {ms:base-off*60000,zoned:true};}
  return {ms:wallToUTC(y,mo,d,h,mi,se,zone),zoned:false};}
function ptParts(ms){var p={};new Intl.DateTimeFormat('en-US',{timeZone:TZ,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(ms)).forEach(function(x){p[x.type]=x.value;});
  return {date:p.year+'-'+p.month+'-'+p.day,time:('0'+((+p.hour)%24)).slice(-2)+':'+p.minute};}
function rootOf(c){var s=String(c||'').toUpperCase().trim(),m;if(!s)return '';s=s.replace(/^.*:/,'');
  if((m=s.match(/^CON\.F\.[A-Z]+\.([A-Z0-9]+)\.[A-Z]\d+$/)))return m[1];s=s.replace(/^F\.US\./,'').split(/[\s.]/)[0].replace(/\d*!$/,'');
  if((m=s.match(/^([A-Z0-9]+?)([FGHJKMNQUVXZ])(\d{1,4})$/)))return m[1];return s;}
function r4(x){return Math.round(x*10000)/10000;}
function isTopstepX(H){return ['contractname','enteredat','exitedat','entryprice','exitprice','size','type'].every(function(k){return H.indexOf(k)>=0;});}
function importTopstepX(rows,acct,zone){var H=rows[0].map(normH),list=[],bad=0,unz=false;
  rows.slice(1).forEach(function(rw){var r={};H.forEach(function(h,i){r[h]=rw[i]==null?'':String(rw[i]);});
    var e=parseDT(r.enteredat,zone),x=parseDT(r.exitedat,zone),size=Math.abs(pnum(r.size)),en=pnum(r.entryprice),ex=pnum(r.exitprice),pl=pnum(r.pnl);
    if(!e||!x||!isFinite(en)||!isFinite(ex)||!size){bad++;return;}if(!e.zoned||!x.zoned)unz=true;
    var dir=/short|sell/i.test(r.type)?'short':'long',fee=0,feeAny=false;['fees','commissions'].forEach(function(c){var n=pnum(r[c]);if(isFinite(n)){fee+=Math.abs(n);feeAny=true;}});
    var contract=r.contractname.trim()||'MNQ',keys=['k:'+contract+'|'+Math.round(e.ms/1000)+'|'+Math.round(x.ms/1000)+'|'+en+'|'+ex+'|'+size];if(r.id)keys.unshift('topstepx:'+r.id.trim());
    list.push({contract:contract,sym:rootOf(contract)||'MNQ',dir:dir,size:size,eVal:en*size,xVal:ex*size,eMs:e.ms,xMs:x.ms,pnl:pl,fees:feeAny?fee:NaN,keys:keys,parts:1});});
  /* rows of one position (same contract & side, overlapping in time) become one trade */
  list.sort(function(a,b){return a.eMs-b.eMs||a.xMs-b.xMs;});var open={},out=[];
  list.forEach(function(t){var k=t.contract+'|'+t.dir,g=open[k];
    if(g&&(t.eMs<g.xMs||t.eMs===g.eMs)){g.size+=t.size;g.eVal+=t.eVal;g.xVal+=t.xVal;g.xMs=Math.max(g.xMs,t.xMs);g.pnl=(isFinite(g.pnl)&&isFinite(t.pnl))?g.pnl+t.pnl:NaN;
      g.fees=(isFinite(g.fees)||isFinite(t.fees))?(isFinite(g.fees)?g.fees:0)+(isFinite(t.fees)?t.fees:0):NaN;g.keys=g.keys.concat(t.keys);g.parts++;}
    else{open[k]=t;out.push(t);}});
  var ix={};db.trades.forEach(function(t){(t.importKeys||[]).forEach(function(k){ix[k]=1;});});(db.deletedImportKeys||[]).forEach(function(k){ix[k]=1;});
  var added=0,dups=0,est=false;
  out.forEach(function(t){if(t.keys.some(function(k){return ix[k];})){dups++;return;}t.keys.forEach(function(k){ix[k]=1;});
    var I=inst(t.sym),entry=r4(t.eVal/t.size),exit=r4(t.xVal/t.size),pts=t.dir==='long'?exit-entry:entry-exit,gross=I?Math.round(pts*I.pv*t.size*100)/100:NaN;
    var fees=isFinite(t.fees)?Math.round(t.fees*100)/100:(I&&I.fee?Math.round(I.fee*t.size*100)/100:0);if(!isFinite(t.fees)&&fees)est=true;
    var net;if(isFinite(t.pnl)){net=(fees&&isFinite(gross)&&Math.abs(t.pnl-(gross-fees))<0.015&&Math.abs(t.pnl-gross)>=0.015)?t.pnl:t.pnl-fees;}else net=isFinite(gross)?gross-fees:NaN;
    net=Math.round(net*100)/100;var e=ptParts(t.eMs),x=ptParts(t.xMs);
    var o={id:uid(),date:e.date,time:e.time,instrument:t.sym,direction:t.dir,contracts:t.size,entry:entry,stop:'',target:'',exit:exit,exitTime:x.time,pnl:isFinite(net)?net:'',pnlManual:isFinite(net),
      pnlSource:'TopstepX',fees:fees,feesEstimated:!isFinite(t.fees)&&fees>0,r:'',rManual:false,setup:'Midpoint rule',followed:'',notes:'',screenshot:'',importKeys:t.keys,broker:'TopstepX',contract:t.contract,entryTs:t.eMs,exitTs:t.xMs,parts:t.parts};
    if(acct){o.accounts=[acct];o.tsx={};o.tsx[acct]={net:o.pnl};}db.trades.push(o);added++;});
  return 'TopstepX export: added '+added+' trade'+(added===1?'':'s')+', skipped '+dups+' duplicate'+(dups===1?'':'s')+(bad?', '+bad+' unreadable row'+(bad===1?'':'s'):'')+'.'+(unz?' Some times had no timezone and were read as '+zone+'.':'')+(est?' Fees were estimated for rows without a fee column.':'')+' Setup set to "Midpoint rule"; stop, target and rules are left blank.';}
function importText(text){var rows=parseCSV(text);if(rows.length<1)throw new Error('The file is empty.');
  var H=rows[0].map(normH),snap=JSON.stringify({t:db.trades,o:db.observations}),msg;
  if(H.indexOf('kind')>=0&&H.indexOf('id')>=0&&H.indexOf('date')>=0)msg=importJournal(rows);
  else if(isTopstepX(H))msg=importTopstepX(rows,$('#impAcct').value,$('#impZone').value);
  else throw new Error('Unrecognized columns. Use journal.csv format or a TopstepX Trades export.');
  if(!persist()){var s=JSON.parse(snap);db.trades=s.t;db.observations=s.o;throw new Error('Could not save.');}
  lastUndo=snap;return msg;}
function showImport(msg,err){var el=$('#impResult');el.innerHTML=(err?'<span class="neg">⚠ ':'<span class="pos">✓ ')+esc(msg)+'</span>';$('#impUndo').classList.toggle('hide',!!err||!lastUndo);}
$('#btnImport').onclick=function(){acctOptions($('#impAcct'));$('#impAcct').options[0].textContent='All accounts (copy trade)';$('#impResult').textContent='';$('#impUndo').classList.add('hide');$('#impFile').value='';openM('#mImp');};
$('#impFile').addEventListener('change',function(){var f=this.files[0];if(!f)return;var rd=new FileReader();
  var inp=this;rd.onload=function(){inp.value='';try{showImport(importText(String(rd.result)));if(sample){sample=null;$('#fSample').checked=false;}render();}catch(e){lastUndo=null;showImport(e.message,true);}};rd.readAsText(f);});
$('#impUndo').onclick=function(){if(!lastUndo)return;var s=JSON.parse(lastUndo);db.trades=s.t;db.observations=s.o;persist();lastUndo=null;render();showImport('Import undone.');$('#impUndo').classList.add('hide');};
$('#impLoadJournal').onclick=function(){if(location.protocol==='file:'){showImport('Browsers block reading journal.csv directly from file://. Pick journal.csv with the File box above, or serve the folder (python3 -m http.server).',true);return;}
  fetch('journal.csv',{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('journal.csv not found ('+r.status+').');return r.text();}).then(function(t){showImport(importText(t));render();}).catch(function(e){showImport(e.message,true);});};
$('#btnExport').onclick=$('#btnExport2').onclick=function(){exportFile('journal-'+nowPT().date+'.csv',toCSV(),'text/csv');};
function exportFile(name,data,mime){var blob=data instanceof Blob?data:new Blob([data],{type:mime}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1500);toast('Exported '+name);}

/* ---------- share view ---------- */
function shFilt(){return {from:$('#shFrom').value,to:$('#shTo').value,acct:$('#shAcct').value};}
function acctName(id){var a=accounts().filter(function(x){return x.id===id;})[0];return a?a.name:'All accounts';}
function renderShare(){var f=shFilt(),rows=select(f),s=stats(rows);
  $('#scTitle').textContent=$('#shTitle').value||'Trading results';
  var rng=(f.from||f.to)?((f.from||'start')+' → '+(f.to||'today')):(rows.length?rows[0].t.date+' → '+rows[rows.length-1].t.date:'All time');
  $('#scSub').textContent=acctName(f.acct)+' · '+rng+(sample?' · SAMPLE DATA (not real)':'');
  $('#scKpis').innerHTML=kpiHTML(s);drawChart('shChart','shEmpty',s);
  $('#scFoot').textContent=(s.n?s.n+' closed trades, net of fees.':'No trades yet.')+' Generated '+nowPT().date+' '+nowPT().time+' PT. Past results only; not a guarantee of future results.';return s;}
$('#btnShare').onclick=function(){var f=filt();$('#shFrom').value=f.from;$('#shTo').value=f.to;acctOptions($('#shAcct'));$('#shAcct').value=f.acct;openM('#mShare');renderShare();};
['#shTitle','#shFrom','#shTo','#shAcct'].forEach(function(id){$(id).addEventListener('input',renderShare);$(id).addEventListener('change',renderShare);});
$('#shPrint').onclick=function(){document.body.classList.add('printing');renderShare();setTimeout(function(){window.print();},50);};
window.addEventListener('afterprint',function(){document.body.classList.remove('printing');});
$('#shPng').onclick=function(){var s=renderShare(),f=shFilt(),W=1200,Hh=675,c=document.createElement('canvas');c.width=W;c.height=Hh;var x=c.getContext('2d');
  x.fillStyle='#0d1117';x.fillRect(0,0,W,Hh);x.fillStyle='#e6edf3';x.font='bold 34px -apple-system,Segoe UI,Roboto,Arial';x.fillText($('#scTitle').textContent,40,60);
  x.fillStyle='#8b949e';x.font='18px -apple-system,Segoe UI,Roboto,Arial';x.fillText($('#scSub').textContent,40,92);x.textAlign='right';x.fillText('📓 Trading Journal',W-40,60);x.textAlign='left';
  var K=[['TOTAL P&L',s.n?money(s.total,true):'—',s.total>0?'#2ecc71':(s.total<0?'#ff5c5c':'#e6edf3')],['WIN RATE',s.n?(s.winRate*100).toFixed(1)+'%':'—','#e6edf3'],['AVG R:R',isFinite(s.rr)?'1 : '+s.rr.toFixed(2):'—','#e6edf3'],['MAX DRAWDOWN',s.n?(s.mdd?money(-s.mdd):'$0.00'):'—',s.mdd?'#ff5c5c':'#e6edf3']];
  var cw=(W-80-36)/4;K.forEach(function(k,i){var kx=40+i*(cw+12);x.fillStyle='#161b22';round(x,kx,120,cw,100,14);x.fill();x.strokeStyle='#2d3640';x.stroke();
    x.fillStyle='#8b949e';x.font='15px -apple-system,Segoe UI,Roboto,Arial';x.fillText(k[0],kx+18,150);x.fillStyle=k[2];x.font='bold 34px -apple-system,Segoe UI,Roboto,Arial';x.fillText(k[1],kx+18,198);});
  x.fillStyle='#161b22';round(x,40,240,W-80,370,14);x.fill();x.strokeStyle='#2d3640';x.stroke();
  var ch=charts.shChart;if(ch){x.drawImage(ch.canvas,56,256,W-112,338);}else{x.fillStyle='#8b949e';x.font='20px -apple-system,Segoe UI,Roboto,Arial';x.textAlign='center';x.fillText('No trades in this range',W/2,430);x.textAlign='left';}
  x.fillStyle='#8b949e';x.font='14px -apple-system,Segoe UI,Roboto,Arial';x.fillText($('#scFoot').textContent,40,645);
  c.toBlob(function(b){sharePng('stats-'+(f.acct||'all')+'-'+nowPT().date+'.png',b);},'image/png');};
/* on phones, open the share sheet (Save Image, Messages, X...) when the browser supports sharing files; otherwise download */
function sharePng(name,b){var fl;try{fl=new File([b],name,{type:'image/png'});}catch(e){}
  var touch=window.matchMedia&&matchMedia('(pointer:coarse)').matches;
  if(fl&&touch&&navigator.canShare&&navigator.canShare({files:[fl]})){navigator.share({files:[fl],title:$('#shTitle').value}).catch(function(e){if(e&&e.name!=='AbortError')exportFile(name,b,'image/png');});return;}
  exportFile(name,b,'image/png');}
function round(x,a,b,w,h,r){x.beginPath();x.moveTo(a+r,b);x.arcTo(a+w,b,a+w,b+h,r);x.arcTo(a+w,b+h,a,b+h,r);x.arcTo(a,b+h,a,b,r);x.arcTo(a,b,a+w,b,r);x.closePath();}

/* ---------- filters + sample ---------- */
['#fFrom','#fTo','#fAcct'].forEach(function(id){$(id).addEventListener('change',render);});
$('#fClear').onclick=function(){$('#fFrom').value='';$('#fTo').value='';render();};
$('#eqMode').addEventListener('change',render);
$('#eqInfo').onclick=function(){toast('Cumulative net P&L after fees, closed trades only, from $0. '+(eqAcct?'Account: '+eqAcct+'.':'All accounts: a copy trade counts once.'));};
$('#prefInfo').onclick=function(){toast('Stored in this browser (localStorage mnqJournal.v1). Import › Export CSV saves journal.csv.');};
$('#rangeInfo').onclick=function(){toast('Changes compare with the prior period of the same length. All time has none.');};
$('#shareInfo').onclick=function(){toast('PNG and PDF are made on this device. A public link needs the site published (README › Dashboard).');};
$('#rangeBtn').onclick=function(){openM('#mRange');};
$('#presets').addEventListener('click',function(e){var b=e.target.closest('[data-preset]');if(!b)return;var t=nowPT().date,y=t.slice(0,4),m=t.slice(0,7),p=b.getAttribute('data-preset'),fr='',to='';
  if(p==='week'){fr=weekOf(t);to=t;}else if(p==='month'){fr=m+'-01';to=t;}else if(p==='last30'){fr=dAdd(t,-29);to=t;}else if(p==='ytd'){fr=y+'-01-01';to=t;}
  else if(p==='lastmonth'){to=dAdd(m+'-01',-1);fr=to.slice(0,7)+'-01';}
  preset={name:b.textContent,fr:fr,to:to};$('#fFrom').value=fr;$('#fTo').value=to;render();closeM(b);});
/* tabs */
function go(v){var tr=v==='trades';$('#viewDash').classList.toggle('hide',tr);$('#viewTrades').classList.toggle('hide',!tr);$('#tabDash').classList.toggle('on',!tr);$('#tabTrades').classList.toggle('on',tr);
  $('#tabDash').setAttribute('aria-current',tr?'false':'page');$('#tabTrades').setAttribute('aria-current',tr?'page':'false');window.scrollTo(0,0);
  if(!tr)Object.keys(charts).forEach(function(k){charts[k].resize();});}
document.addEventListener('click',function(e){var g=e.target.closest('[data-go]');if(g){go(g.getAttribute('data-go'));return;}
  var a=e.target.closest('[data-act]');if(a){$(a.getAttribute('data-act')==='add'?'#btnAdd':'#btnImport').click();return;}
  var c=e.target.closest('#recent .trade');if(c){var id=c.getAttribute('data-id');go('trades');var el=document.querySelector('#allTrades .trade[data-id="'+(window.CSS&&CSS.escape?CSS.escape(id):id)+'"]');
    if(el){el.scrollIntoView({block:'center'});el.classList.add('flash');setTimeout(function(){el.classList.remove('flash');},1200);}}});
/* Sample data: made-up trades for previewing the layout only. Off by default, never saved or exported. */
$('#fSample').addEventListener('change',function(){if(!this.checked){sample=null;render();return;}
  /* deterministic made-up trades on recent weekdays, MNQ math, setups prefixed SAMPLE so they can't be mistaken for real ones */
  var L=[],seed=7,d=dAdd(nowPT().date,-58),SET=['SAMPLE Breakout','SAMPLE Pullback','SAMPLE Fade'],px=21000;
  function rnd(){seed=(seed*16807)%2147483647;return seed/2147483647;}
  for(var i=0;L.length<28&&i<90;i++){d=dAdd(d,1);var wd=new Date(d+'T12:00:00Z').getUTCDay();if(wd===0||wd===6||rnd()<.3)continue;
    var dir=rnd()<.55?'long':'short',k=Math.floor(rnd()*3),win=rnd()<[.62,.5,.55][k],stop=Math.round(8+rnd()*6)*1,
      pts=win?Math.round((stop*(1.2+rnd()*1.6))*4)/4:-stop,c=1+Math.floor(rnd()*3),en=Math.round((px+=(rnd()-.45)*60)*4)/4,
      ex=dir==='long'?en+pts:en-pts,h=6+Math.floor(rnd()*2),mi=30+Math.floor(rnd()*29),hm=('0'+h).slice(-2)+':'+('0'+mi).slice(-2),xm=('0'+h).slice(-2)+':'+('0'+Math.min(59,mi+5+Math.floor(rnd()*20))).slice(-2);
    var t={id:'SAMPLE-'+L.length,date:d,time:hm,exitTime:xm,instrument:'MNQ',direction:dir,contracts:c,entry:en,stop:dir==='long'?en-stop:en+stop,exit:ex,setup:SET[k],followed:rnd()<.8?'yes':'no',broker:'SAMPLE'};
    t.pnl=autoPnl(t);t.r=autoR(t);L.push(t);}
  sample=L;render();});
$('#syncBtn').onclick=syncNow;$('#delAcct').onclick=function(e){e.preventDefault();e.stopPropagation();delAcct();};
hydrateIcons();applySeed();render();
})();
