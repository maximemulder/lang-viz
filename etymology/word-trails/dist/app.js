/* Word Trails: browser-local exploration of the supplied DiACL exports. */
(() => {
  'use strict';
  const D = window.DIACL_DATA;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const short = (value, length=20) => String(value).length > length ? String(value).slice(0, length - 1) + '…' : String(value);
  const fmt = n => n.toLocaleString('en-US');
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs={}, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  if (!D) {
    $('view-note').textContent = 'The data could not load. Open the prototype using the included local server, then reload.';
    $('visible-count').textContent = 'Data unavailable';
    return;
  }
  const incoming = new Map(), outgoing = new Map(), byLanguage = new Map(), wordConcepts = new Map();
  const edgeById = new Map(D.edges.map(e => [e.id, e]));
  for (const edge of D.edges) {
    if (!incoming.has(edge.c)) incoming.set(edge.c, []);
    if (!outgoing.has(edge.p)) outgoing.set(edge.p, []);
    incoming.get(edge.c).push(edge); outgoing.get(edge.p).push(edge);
  }
  for (const [id, w] of Object.entries(D.lexemes)) {
    if (!byLanguage.has(w.l)) byLanguage.set(w.l, []);
    byLanguage.get(w.l).push(id);
  }
  for (const concept of Object.values(D.concepts)) {
    for (const id of concept.lexemes) {
      if (!wordConcepts.has(id)) wordConcepts.set(id, []);
      wordConcepts.get(id).push(concept.id);
    }
  }
  const colors = {0:'#9a9e96',1:'#267665',2:'#bc8525',4:'#bb6d3f',8:'#b15c6c',16:'#52759a',32:'#866599'};
  const dashes = {0:'2 5',2:'5 4',4:'7 4',8:'2 4',16:'8 3 2 3'};
  const language = id => D.languages[D.lexemes[id].l];
  const wordLabel = id => D.lexemes[id].f + ' · ' + language(id).name;
  const preferred = {Italian:0,Spanish:1,French:2,German:3,English:4};
  const compareWords = (a,b) => (preferred[language(a).name] ?? 10) - (preferred[language(b).name] ?? 10) || language(a).name.localeCompare(language(b).name) || Number(a)-Number(b);
  const state = {root:'69562', selected:'69562', edge:null, view:'history', depth:4, branches:true, stubs:false, concept:'3090', list:'3', family:'all', expanded:new Set(), comparison:false};
  let graph = {ids:[], edges:[], omitted:0, hiddenStubs:0}, graphViewport = {x:0,y:0,k:1}, layout = null;
  let searchTimer, toastTimer, topology = window.DIACL_MAP || null, mapLoading = false, mapFailed = false;

  function toast(message) {
    $('toast').textContent = message; $('toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3800);
  }
  function fillLists() {
    $('list-select').innerHTML = D.lists.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
    $('list-select').value = state.list;
    fillConcepts();
    $('family-select').innerHTML = '<option value="all">All represented families</option>' + [...new Set(Object.values(D.languages).map(l => l.family))].sort().map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('');
  }
  function fillConcepts() {
    const concepts = Object.values(D.concepts).filter(c => c.groups.some(g=>g.list===state.list)).sort((a,b)=>a.name.localeCompare(b.name));
    if (!concepts.some(c=>c.id===state.concept)) state.concept=concepts[0]?.id || null;
    const nameCounts=new Map();for(const c of concepts)nameCounts.set(c.name,(nameCounts.get(c.name)||0)+1);
    $('concept-select').innerHTML = concepts.map(c=>`<option value="${c.id}">${esc(c.name)}${nameCounts.get(c.name)>1?' · '+esc(c.groups.find(g=>g.list===state.list).category):''}</option>`).join('');
    $('concept-select').value = state.concept || '';
  }
  function chooseConcept(id) {
    const ids = wordConcepts.get(id) || [];
    let cid = ids.includes(state.concept) ? state.concept : ids[0];
    if (!cid) { state.concept = null; $('concept-select').selectedIndex=-1; return; }
    state.concept=cid;
    const concept=D.concepts[cid];
    if (!concept.groups.some(g=>g.list===state.list)) state.list=concept.groups[0].list;
    $('list-select').value=state.list; fillConcepts();
  }
  function focusWord(id, {keepConcept=false}={}) {
    if (!D.lexemes[id]) return;
    state.root=String(id); state.selected=String(id);state.edge=null;state.expanded.clear();state.comparison=false;
    if (!keepConcept) chooseConcept(String(id));
    $('word-search').value=''; closeSearch();
    const w=D.lexemes[id], l=language(id);
    $('focus-form').textContent=short(w.f,32);
    $('focus-context').textContent=l.name+' · '+(w.m?'“'+w.m+'”':'Meaning not recorded');
    document.querySelectorAll('[data-example]').forEach(b=>b.classList.toggle('active',b.dataset.example===state.root));
    graph=buildGraph(); renderView();renderDetails();
    try {history.replaceState(null,'','#word='+encodeURIComponent(id)+'&view='+state.view);} catch {}
  }
  function buildGraph() {
    const ids=new Set([state.root]), hiddenStubs=new Set();let omitted=0;
    const eligible=id=>{if(!D.lexemes[id])return false;if(!state.stubs&&D.lexemes[id].stub){hiddenStubs.add(id);return false;}return true;};
    let frontier=[state.root];
    for(let step=0;step<state.depth;step++) {
      const next=[];
      for(const id of frontier) for(const e of incoming.get(id)||[]) {
        if(eligible(e.p)&&!ids.has(e.p)) { if(ids.size>=60){omitted++;continue;} ids.add(e.p);next.push(e.p); }
      }
      frontier=next;if(!frontier.length)break;
    }
    const ancestors=[...ids];
    if(state.branches) {
      // Two neighbors per ancestor keep the first view readable without inventing collapsed edges.
      for(const id of ancestors) {
        const candidates=[...new Set((outgoing.get(id)||[]).map(e=>e.c))].filter(c=>!ids.has(c)&&eligible(c)).sort(compareWords);
        for(const c of candidates.slice(0,2)) {if(ids.size<60)ids.add(c);else omitted++;}
        omitted+=Math.max(0,candidates.length-2);
      }
    }
    for(const id of state.expanded) {
      if(!eligible(id))continue;
      if(!ids.has(id)&&ids.size>=60){omitted++;continue;}ids.add(id);
      for(const e of [...incoming.get(id)||[],...outgoing.get(id)||[]]) {
        const other=e.p===id?e.c:e.p;
        if(!eligible(other)||ids.has(other))continue;
        if(ids.size>=60){omitted++;continue;}ids.add(other);
      }
    }
    return {ids:[...ids],edges:D.edges.filter(e=>ids.has(e.p)&&ids.has(e.c)),omitted,hiddenStubs:hiddenStubs.size};
  }
  function selectWord(id) {state.selected=id;state.edge=null;renderDetails();paintSelection();if(state.view==='map')drawMap();}
  function selectEdge(id) {state.edge=id;state.selected=null;renderDetails();paintSelection();}
  function paintSelection() {
    document.querySelectorAll('.graph-node').forEach(n=>n.classList.toggle('selected',n.dataset.id===state.selected));
    document.querySelectorAll('.graph-edge').forEach(e=>e.classList.toggle('selected',e.dataset.id===state.edge));
    document.querySelectorAll('.form-button').forEach(b=>b.classList.toggle('selected',b.dataset.id===state.selected));
  }
  function renderView() {
    const rootWord=D.lexemes[state.root],rootLanguage=language(state.root);
    const comparing=state.view==='family'&&state.concept;
    document.querySelector('.page-heading h1').innerHTML=comparing?`How do languages express <em id="focus-form">${esc(short(D.concepts[state.concept].name,32))}</em>?`:`Where does <em id="focus-form">${esc(short(rootWord.f,32))}</em> come from?`;
    $('focus-context').textContent=comparing?'Compare entries for a shared concept · historical relationships require separate evidence':rootLanguage.name+' · '+(rootWord.m?'“'+rootWord.m+'”':'Meaning not recorded');
    for(const view of ['history','family','map']) {
      $(view+'-view').hidden=state.view!==view;
      $(view+'-controls').hidden=state.view!==view;
    }
    document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view);b.setAttribute('aria-pressed',String(b.dataset.view===state.view));});
    $('graph-legend').hidden=state.view==='family';
    if(state.view==='history') {
      $('view-title').textContent='A word’s recorded journey';$('view-kicker').textContent='TRACE THE CONNECTIONS';
      $('visible-count').textContent=graph.ids.length+' forms · '+graph.edges.length+' links';
      $('view-note').textContent=[`${state.depth} earlier steps · spacing ≠ elapsed time`,graph.hiddenStubs?`${graph.hiddenStubs} placeholder(s) hidden; paths may stop here`:null,graph.omitted?`More branches available via “Expand connections”`:null].filter(Boolean).join(' · ');
      drawGraph();
    } else if(state.view==='family') {
      $('view-title').textContent=state.concept?'Expressions for “'+D.concepts[state.concept].name+'”':'Forms in this word history';
      $('view-kicker').textContent='COMPARE WITH LANGUAGE CONTEXT'; renderFamily();
      $('view-note').textContent='Same concept does not establish cognacy. Families group languages, not word links.';
    } else {
      $('view-title').textContent='Where these languages are represented';$('view-kicker').textContent='LOCATE THE CURRENT WORD HISTORY';
      $('view-note').textContent='Connections link language focal points; they do not trace exact borrowing routes.';
      drawMap();loadMap();
    }
  }
  function getLayout() {
    const ids=graph.ids, set=new Set(ids), degree=new Map(ids.map(i=>[i,0])), rank=new Map(ids.map(i=>[i,0]));
    for(const e of graph.edges) if(e.p!==e.c)degree.set(e.c,degree.get(e.c)+1);
    const queue=ids.filter(i=>degree.get(i)===0).sort(compareWords), processed=new Set();
    while(queue.length){const id=queue.shift();processed.add(id);for(const e of outgoing.get(id)||[])if(set.has(e.c)&&e.c!==id){rank.set(e.c,Math.max(rank.get(e.c),rank.get(id)+1));degree.set(e.c,degree.get(e.c)-1);if(degree.get(e.c)===0)queue.push(e.c);}}
    // Cyclic records remain visible; no claim of an acyclic ancestry tree is made.
    const cyclic=ids.filter(i=>!processed.has(i));
    if(cyclic.length)cyclic.sort(compareWords).forEach((id,i)=>rank.set(id,Math.min(i,7)));
    const columns=new Map();for(const id of ids){const r=rank.get(id);if(!columns.has(r))columns.set(r,[]);columns.get(r).push(id);}
    const maxRows=Math.max(1,...[...columns.values()].map(v=>v.length)), points=new Map();
    for(const [r,rows]of columns){rows.sort(compareWords);rows.forEach((id,i)=>points.set(id,{x:40+r*182,y:55+(maxRows-rows.length)*53+i*106,w:136,h:66}));}
    return {points,width:Math.max(300,Math.max(...rank.values())*182+216),height:Math.max(240,maxRows*106+75),cyclic:cyclic.length};
  }
  function drawGraph() {
    const svg=$('history-graph'),wrap=$('graph-wrap');if(!wrap.clientWidth)return;
    svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${wrap.clientWidth} ${wrap.clientHeight}`);
    svg.append(svgEl('title',{},`Word history for ${wordLabel(state.root)}. ${graph.ids.length} forms and ${graph.edges.length} recorded connections.`));
    const defs=svgEl('defs');
    for(const [type,color]of Object.entries(colors)) {
      const marker=svgEl('marker',{id:'arrow-'+type,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});
      marker.append(svgEl('path',{d:'M 0 1 L 9 5 L 0 9',fill:'none',stroke:color,'stroke-width':1.4}));defs.append(marker);
    }
    svg.append(defs);const scene=svgEl('g',{id:'graph-scene'});svg.append(scene);layout=getLayout();
    for(const e of graph.edges) {
      const a=layout.points.get(e.p),b=layout.points.get(e.c);if(!a||!b)continue;
      const x1=a.x+a.w,y1=a.y+a.h/2,x2=b.x,y2=b.y+b.h/2,mid=(x1+x2)/2;
      const path=e.p===e.c?`M${a.x+105},${a.y} C${a.x+165},${a.y-60} ${a.x-20},${a.y-60} ${a.x+25},${a.y}`:x2>x1?`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2-3},${y2}`:`M${a.x+a.w/2},${a.y+a.h} C${a.x+a.w/2},${a.y+a.h+50} ${b.x+b.w/2},${b.y-50} ${b.x+b.w/2},${b.y}`;
      const line=svgEl('path',{d:path,class:'graph-edge'+(state.edge===e.id?' selected':''),stroke:colors[e.t]||colors[0],'data-id':e.id,'marker-end':`url(#arrow-${e.t})`});
      if(dashes[e.t])line.setAttribute('stroke-dasharray',dashes[e.t]);scene.append(line);
      const hit=svgEl('path',{d:path,class:'edge-hit',role:'button',tabindex:0,'aria-label':`${D.types[e.t]}: ${wordLabel(e.p)} to ${wordLabel(e.c)}. Inspect relationship.`});
      hit.append(svgEl('title',{},`${D.types[e.t]} · link ${e.id}`));hit.addEventListener('click',()=>selectEdge(e.id));hit.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();selectEdge(e.id);}});scene.append(hit);
      if(graph.edges.length<=12&&(e.t===4||e.t===2||e.t===0))scene.append(svgEl('text',{x:mid,y:(y1+y2)/2-9,'text-anchor':'middle',class:'edge-label'},e.t===4?'borrowed':e.t===2?'probably borrowed':'unspecified'));
    }
    for(const id of graph.ids) {
      const w=D.lexemes[id],l=language(id),p=layout.points.get(id);
      const node=svgEl('g',{transform:`translate(${p.x},${p.y})`,class:'graph-node'+(id===state.selected?' selected':'')+(id===state.root?' focus':'')+(w.stub?' stub':''),'data-id':id,role:'button',tabindex:0,'aria-label':wordLabel(id)+'. '+(w.m||'Meaning not recorded')+'. Select to inspect.'});
      node.append(svgEl('title',{},`${wordLabel(id)}\n${w.m||'Meaning not recorded'}\nLexeme ${id}${w.stub?' · Placeholder':''}`));
      node.append(svgEl('rect',{width:p.w,height:p.h}));node.append(svgEl('text',{x:13,y:29,class:'node-form'},short(w.f,15)));node.append(svgEl('text',{x:13,y:48,class:'node-language'},short(l.name,21)));
      if(w.stub)node.append(svgEl('text',{x:13,y:61,class:'node-extra'},'PLACEHOLDER'));
      node.addEventListener('click',()=>selectWord(id));node.addEventListener('dblclick',()=>focusWord(id));node.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();selectWord(id);}});scene.append(node);
    }
    if(layout.cyclic)$('view-note').textContent+=' · Cyclic links are present; inspect individual relationships.';
    fitGraph();
  }
  function applyViewport(){const scene=$('graph-scene');if(scene)scene.setAttribute('transform',`translate(${graphViewport.x},${graphViewport.y}) scale(${graphViewport.k})`);}
  function fitGraph(){if(!layout)return;const w=$('graph-wrap').clientWidth,h=$('graph-wrap').clientHeight;const k=Math.min(1.15,(w-26)/layout.width,(h-65)/layout.height);graphViewport={x:(w-layout.width*k)/2,y:(h-35-layout.height*k)/2,k};applyViewport();}
  function zoomGraph(factor){const w=$('graph-wrap').clientWidth,h=$('graph-wrap').clientHeight;const k=Math.max(.18,Math.min(3,graphViewport.k*factor));graphViewport.x=w/2-(w/2-graphViewport.x)*(k/graphViewport.k);graphViewport.y=h/2-(h/2-graphViewport.y)*(k/graphViewport.k);graphViewport.k=k;applyViewport();}

  function sourceHTML(refs) {
    if(!refs?.length)return '<p class="subtle">No source reference recorded.</p>';
    return '<ol class="source-list">'+refs.map(ref=>{
      const s=D.sources[String(ref.FkSourceId)];
      if(!s)return `<li>Source ${esc(ref.FkSourceId)} · record unavailable</li>`;
      return `<li><strong>${esc(s.CitationKey)}</strong><p>${esc(s.FullCitation)}</p>${ref.LocationWithinSource?`<p class="source-note">Location: ${esc(ref.LocationWithinSource)}</p>`:''}${ref.Note?`<p>${esc(ref.Note)}</p>`:''}${s.Note?`<p class="source-note">${esc(s.Note)}</p>`:''}</li>`;
    }).join('')+'</ol>';
  }
  function detailLink(e, direction) {
    const id=direction==='incoming'?e.p:e.c;
    return `<button class="mini-link" data-edge="${e.id}"><span style="color:${colors[e.t]}">${esc(D.types[e.t])}</span><small>${direction==='incoming'?'← ':'→ '}${esc(wordLabel(id))}</small></button>`;
  }
  function renderDetails() {
    if(state.edge) {
      const e=edgeById.get(state.edge),a=D.lexemes[e.p],b=D.lexemes[e.c];
      $('detail-kind').textContent='SELECTED RELATIONSHIP';
      $('details').innerHTML=`<div><span class="badge${[2,4].includes(e.t)?' borrowing':''}">${esc(D.types[e.t])}</span><h2 style="font-size:29px">${esc(a.f)} → ${esc(b.f)}</h2><p class="detail-language">${esc(language(e.p).name)} → ${esc(language(e.c).name)}</p></div><div class="detail-block"><h3>What this link records</h3><p>${relationshipExplanation(e.t)}</p>${e.note?`<p>${esc(e.note)}</p>`:''}<p class="subtle">Relationship ID ${esc(e.id)} · label code ${e.t}</p></div><div class="detail-block"><h3>Inspect the entries</h3><button class="mini-link" data-inspect="${e.p}">${esc(wordLabel(e.p))}</button><button class="mini-link" data-inspect="${e.c}">${esc(wordLabel(e.c))}</button></div><div class="detail-block"><h3>Relationship evidence</h3><details open><summary>${e.refs.length} source reference${e.refs.length===1?'':'s'}</summary>${sourceHTML(e.refs)}</details></div>`;
    } else if(state.selected) {
      const id=state.selected,w=D.lexemes[id],l=language(id),ins=incoming.get(id)||[],outs=outgoing.get(id)||[];
      const reconstructed=l.status==='Reconstructed language'||w.f.startsWith('*');
      $('detail-kind').textContent='SELECTED WORD';
      $('details').innerHTML=`<div><h2>${esc(w.f)}</h2><p class="detail-language">${esc(l.name)}${l.iso?' · '+esc(l.iso):''}</p><span class="badge">${esc(l.status)}</span>${reconstructed?'<span class="badge">Reconstructed form</span>':''}${w.stub?'<span class="badge placeholder">Placeholder node</span>':''}<button class="primary-button" data-trace="${id}">Trace this word ↗</button><button class="secondary-button" data-expand="${id}">Expand connections (${ins.length+outs.length})</button></div><div class="detail-block"><h3>Meaning</h3><p class="meaning">${esc(w.m||'Not recorded')}</p>${w.meaningNote?`<p class="subtle">${esc(w.meaningNote)}</p>`:''}${w.note?`<p>${esc(w.note)}</p>`:''}${w.script?`<p>Script: ${esc(w.script)}</p>`:''}${w.ipa?`<p>IPA: ${esc(w.ipa)}</p>`:''}${w.grammar?`<p class="subtle">Grammar, as recorded: ${esc(w.grammar)}</p>`:''}</div><div class="detail-block"><h3>Language-family context</h3><p class="family-path">${esc(l.path.length?l.path.join(' › '):'Unmapped in the supplied tree')}</p><p class="subtle">Language family ≠ word transmission</p></div><div class="detail-block"><h3>Recorded connections</h3>${ins.slice(0,4).map(e=>detailLink(e,'incoming')).join('')}${outs.slice(0,3).map(e=>detailLink(e,'outgoing')).join('')}${!ins.length&&!outs.length?'<p class="subtle">No etymological links recorded for this entry.</p>':''}${ins.length+outs.length>7?`<p class="subtle">${ins.length} incoming · ${outs.length} outgoing. Expand connections to explore more.</p>`:''}</div><div class="detail-block"><h3>Word-entry evidence</h3><details><summary>${w.refs.length} source reference${w.refs.length===1?'':'s'}</summary>${sourceHTML(w.refs)}</details><p class="subtle">Lexeme ${esc(id)} · language ${esc(w.l)}</p></div>`;
    }
    $('details').querySelectorAll('[data-trace]').forEach(b=>b.addEventListener('click',()=>{state.view='history';focusWord(b.dataset.trace);}));
    $('details').querySelectorAll('[data-inspect]').forEach(b=>b.addEventListener('click',()=>selectWord(b.dataset.inspect)));
    $('details').querySelectorAll('[data-edge]').forEach(b=>b.addEventListener('click',()=>selectEdge(b.dataset.edge)));
    $('details').querySelectorAll('[data-expand]').forEach(b=>b.addEventListener('click',()=>{state.expanded.add(b.dataset.expand);graph=buildGraph();state.view='history';renderView();toast('Showing available connections, up to 60 forms.');}));
  }
  function relationshipExplanation(t) {
    return ({0:'The database records this connection without specifying its relationship category. This is distinct from “Uncertain origin.”',1:'The child form is recorded as inherited from the source form.',2:'The relationship is classified as a probable borrowing between the recorded forms.',4:'The relationship is classified by DiACL as certainly borrowed. Inspect its sources for the supporting argument.',8:'The recorded relationship has the label “Uncertain origin.”',16:'The link is classified as Wanderwort: a word that spread across languages, often with a difficult-to-establish transmission history.',32:'The child form is recorded as a derivation from the source form.'})[t]||'Inspect the recorded relationship and its supporting references.';
  }

  function renderFamily() {
    const concept=state.concept?D.concepts[state.concept]:null;
    let ids=concept?concept.lexemes.filter(id=>D.lexemes[id]):graph.ids;
    ids=ids.filter(id=>state.stubs||!D.lexemes[id].stub);
    const groups=new Map();
    for(const id of ids){const lid=D.lexemes[id].l,l=D.languages[lid];if(state.family!=='all'&&l.family!==state.family)continue;if(!groups.has(lid))groups.set(lid,[]);groups.get(lid).push(id);}
    if($('missing-check').checked)for(const [lid,l]of Object.entries(D.languages))if((state.family==='all'||l.family===state.family)&&!groups.has(lid))groups.set(lid,[]);
    const groupLabel=l=>l.path.length>2?l.family+' / '+l.path[1]:l.family;
    const rows=[...groups.entries()].sort(([a],[b])=>groupLabel(D.languages[a]).localeCompare(groupLabel(D.languages[b]))||D.languages[a].name.localeCompare(D.languages[b].name));
    const formCount=rows.reduce((n,[,v])=>n+v.length,0);
    $('visible-count').textContent=formCount+' forms · '+rows.length+' languages';
    $('comparison-summary').textContent=concept?`${D.concepts[state.concept].name} · ${formCount} recorded forms across the selected scope. Multiple forms and relationship labels can occur in one language.`:'This word is not assigned to a concept list. Comparing only forms from its displayed history.';
    let previous=null;
    $('family-rows').innerHTML=rows.map(([lid,forms])=>{
      const l=D.languages[lid],group=groupLabel(l);let head='';if(group!==previous){head=`<tr class="family-heading"><td colspan="3">${esc(group)}</td></tr>`;previous=group;}
      const typeCounts=new Map();for(const id of forms)for(const e of incoming.get(id)||[])typeCounts.set(e.t,(typeCounts.get(e.t)||0)+1);
      const rel=[...typeCounts].map(([t,n])=>`<span class="rel-tag"><i style="background:${colors[t]}"></i>${esc(D.types[t])} (${n})</span>`).join('');
      return head+`<tr><td>${esc(l.name)}<small>${esc(l.path.slice(1,-1).join(' › ')||l.status)}</small></td><td>${forms.length?forms.map(id=>`<button class="form-button${id===state.selected?' selected':''}" data-id="${id}" aria-label="Inspect ${esc(wordLabel(id))}">${esc(D.lexemes[id].f)}</button>`).join(''):'<small>No concept entry recorded</small>'}</td><td>${rel||'<small>No incoming relationship recorded</small>'}</td></tr>`;
    }).join('')||'<tr><td colspan="3" class="empty-state">No word entries in this scope. Choose another family or concept.</td></tr>';
    $('family-rows').querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>selectWord(b.dataset.id)));
  }

  function mapProject(lon,lat,w,h){return [(lon+180)/360*w,(90-lat)/180*h];}
  function decodeRing(arcIds) {
    const points=[];
    for(const id of arcIds){const arc=topology.arcs[id<0?~id:id];let x=0,y=0;let decoded=arc.map(p=>{x+=p[0];y+=p[1];return [x*topology.transform.scale[0]+topology.transform.translate[0],y*topology.transform.scale[1]+topology.transform.translate[1]];});if(id<0)decoded.reverse();points.push(...decoded);}
    return points;
  }
  function drawMap() {
    const svg=$('language-map'),w=900,h=450;svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
    svg.append(svgEl('title',{},'Representative language focal points for the selected word history; lines are not exact transmission routes.'));
    for(let lon=-180;lon<=180;lon+=30){const [x]=mapProject(lon,0,w,h);svg.append(svgEl('path',{d:`M${x},0V${h}`,class:'map-graticule'}));}
    for(let lat=-60;lat<=60;lat+=30){const [,y]=mapProject(0,lat,w,h);svg.append(svgEl('path',{d:`M0,${y}H${w}`,class:'map-graticule'}));}
    if(topology)for(const geom of topology.objects.countries.geometries){const polys=geom.type==='Polygon'?[geom.arcs]:geom.type==='MultiPolygon'?geom.arcs:[];let d='';for(const poly of polys)for(const ring of poly){const points=decodeRing(ring).map(([lon,lat])=>mapProject(lon,lat,w,h));d+=points.map(([x,y],i)=>(i?'L':'M')+x.toFixed(2)+','+y.toFixed(2)).join('')+'Z';}svg.append(svgEl('path',{d,class:'map-land'}));}
    const langs=new Map();for(const id of graph.ids){const l=language(id);if(l.lat===null||l.lon===null)continue;if(!langs.has(D.lexemes[id].l))langs.set(D.lexemes[id].l,[]);langs.get(D.lexemes[id].l).push(id);}
    if($('map-links-check').checked)for(const e of graph.edges){const a=language(e.p),b=language(e.c);if(a.lat===null||b.lat===null||a.lon===null||b.lon===null)continue;const [x1,y1]=mapProject(a.lon,a.lat,w,h),[x2,y2]=mapProject(b.lon,b.lat,w,h);if(Math.abs(x1-x2)>w/2)continue;const lift=Math.min(65,Math.abs(x1-x2)*.2+12);const p=svgEl('path',{d:`M${x1},${y1} Q${(x1+x2)/2},${Math.min(y1,y2)-lift} ${x2},${y2}`,fill:'none',stroke:colors[e.t],'stroke-width':1.6,opacity:.7});if(dashes[e.t])p.setAttribute('stroke-dasharray',dashes[e.t]);p.append(svgEl('title',{},`${D.types[e.t]}: ${wordLabel(e.p)} → ${wordLabel(e.c)}`));svg.append(p);}
    for(const [lid,ids]of langs){const l=D.languages[lid],[x,y]=mapProject(l.lon,l.lat,w,h);const point=svgEl('circle',{cx:x,cy:y,r:state.selected&&D.lexemes[state.selected].l===lid?6:4.3,class:'map-point'+(state.selected&&D.lexemes[state.selected].l===lid?' selected':''),role:'button',tabindex:0,'aria-label':l.name+': '+ids.map(id=>D.lexemes[id].f).join(', ')});point.append(svgEl('title',{},`${l.name}\n${ids.map(id=>D.lexemes[id].f).join(', ')}\n${l.lat.toFixed(2)}, ${l.lon.toFixed(2)}`));point.addEventListener('click',()=>selectWord(ids[0]));point.addEventListener('keydown',ev=>{if(ev.key==='Enter'){selectWord(ids[0]);}});svg.append(point);}
    $('visible-count').textContent=langs.size+' language locations';
    $('map-status').textContent=(topology?'World basemap: Natural Earth / world-atlas. ':mapFailed?'Basemap unavailable offline; coordinates remain available below. ':'Loading world basemap… ')+ 'Historical stages can share locations. Use the language list to select overlapping points.';
    $('map-language-list').innerHTML=[...langs].sort(([a],[b])=>D.languages[a].name.localeCompare(D.languages[b].name)).map(([lid,ids])=>`<button data-map-id="${ids[0]}" class="${state.selected&&D.lexemes[state.selected].l===lid?'selected':''}">${esc(D.languages[lid].name)} · ${D.languages[lid].lat.toFixed(1)}°, ${D.languages[lid].lon.toFixed(1)}°</button>`).join('');
    $('map-language-list').querySelectorAll('[data-map-id]').forEach(b=>b.addEventListener('click',()=>selectWord(b.dataset.mapId)));
  }
  async function loadMap() {
    if(topology||mapLoading||mapFailed)return;mapLoading=true;
    try {const response=await fetch('world-110m.json');if(!response.ok)throw new Error('No bundled map');topology=await response.json();}
    catch {mapFailed=true;}
    finally {mapLoading=false;if(state.view==='map')drawMap();}
  }

  const searchEntries=Object.entries(D.lexemes).map(([id,w])=>({id,form:norm(w.f),meaning:norm(w.m),lang:norm(language(id).name)}));
  function searchWords(query) {
    const q=norm(query.trim());if(!q){closeSearch();return;}
    const matches=[];
    for(const item of searchEntries) {
      if(!state.stubs&&D.lexemes[item.id].stub)continue;
      let score=99;
      if(item.form===q)score=0;else if(item.meaning===q)score=1;else if(item.form.startsWith(q))score=2;else if(item.lang===q)score=3;else if(item.form.includes(q)||item.meaning.includes(q))score=4;else if(item.lang.includes(q))score=5;
      if(score<99)matches.push({id:item.id,score});
    }
    matches.sort((a,b)=>a.score-b.score||(language(a.id).name==='English'?-1:0)-(language(b.id).name==='English'?-1:0)||compareWords(a.id,b.id));
    showResults(matches.slice(0,22).map(x=>x.id),`${fmt(matches.length)} matching entries${matches.length>22?' · showing 22':''}`);
  }
  function showResults(ids,caption) {
    const box=$('search-results');box.innerHTML=`<div class="search-caption">${esc(caption)}</div>`+ids.map(id=>{const w=D.lexemes[id];return `<button class="search-result" data-result="${id}"><strong>${esc(w.f)}</strong><small>${esc(language(id).name)} · ${esc(w.m||'Meaning not recorded')} · #${id}</small></button>`;}).join('')+(!ids.length?'<div class="search-caption">Try another form, meaning, or language.</div>':'');
    box.hidden=false;$('word-search').setAttribute('aria-expanded','true');box.querySelectorAll('[data-result]').forEach(b=>b.addEventListener('click',()=>{state.view='history';focusWord(b.dataset.result);}));
  }
  function closeSearch(){$('search-results').hidden=true;$('word-search').setAttribute('aria-expanded','false');}

  $('word-search').addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>searchWords(e.target.value),130);});
  $('word-search').addEventListener('keydown',e=>{if(e.key==='Escape'){closeSearch();e.target.blur();}if(e.key==='ArrowDown'){e.preventDefault();$('search-results').querySelector('button')?.focus();}if(e.key==='Enter'){const first=$('search-results').querySelector('[data-result]');if(first){e.preventDefault();state.view='history';focusWord(first.dataset.result);}}});
  $('search-results').addEventListener('keydown',e=>{const buttons=[...$('search-results').querySelectorAll('button')],index=buttons.indexOf(document.activeElement);if(e.key==='ArrowDown'){e.preventDefault();buttons[(index+1)%buttons.length]?.focus();}if(e.key==='ArrowUp'){e.preventDefault();if(index===0)$('word-search').focus();else buttons[index-1]?.focus();}if(e.key==='Escape'){closeSearch();$('word-search').focus();}});
  document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))closeSearch();});
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('word-search').focus();}});
  document.querySelectorAll('[data-example]').forEach(b=>b.addEventListener('click',()=>{state.view='history';state.depth=4;state.branches=true;state.stubs=false;$('depth-select').value='4';$('branches-check').checked=true;$('stubs-check').checked=false;focusWord(b.dataset.example);}));
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;renderView();try{history.replaceState(null,'','#word='+state.root+'&view='+state.view);}catch{}}));
  $('depth-select').addEventListener('change',e=>{state.depth=Number(e.target.value);graph=buildGraph();renderView();});
  $('branches-check').addEventListener('change',e=>{state.branches=e.target.checked;graph=buildGraph();renderView();});
  $('stubs-check').addEventListener('change',e=>{state.stubs=e.target.checked;graph=buildGraph();renderView();});
  $('list-select').addEventListener('change',e=>{state.list=e.target.value;fillConcepts();if(state.view==='family')renderView();});
  $('concept-select').addEventListener('change',e=>{state.concept=e.target.value;state.view='family';state.family='all';$('family-select').value='all';renderView();toast('Comparing entries for “'+D.concepts[state.concept].name+'”. Select a form to inspect its history.');});
  $('browse-concept').addEventListener('click',()=>{state.concept=$('concept-select').value;state.view='family';renderView();});
  $('family-select').addEventListener('change',e=>{state.family=e.target.value;renderFamily();});
  $('missing-check').addEventListener('change',renderFamily);
  $('map-links-check').addEventListener('change',drawMap);
  $('zoom-in').addEventListener('click',()=>zoomGraph(1.25));$('zoom-out').addEventListener('click',()=>zoomGraph(.8));$('fit-graph').addEventListener('click',fitGraph);
  $('reset-button').addEventListener('click',()=>{state.depth=4;state.branches=true;state.stubs=false;state.view='history';state.family='all';$('depth-select').value='4';$('branches-check').checked=true;$('stubs-check').checked=false;$('family-select').value='all';$('missing-check').checked=false;focusWord('69562');});
  document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();$('reset-button').click();});
  $('guide-button').addEventListener('click',()=>$('guide').hidden=!$('guide').hidden);$('close-guide').addEventListener('click',()=>$('guide').hidden=true);
  $('about-button').addEventListener('click',()=>$('about-dialog').showModal());$('close-about').addEventListener('click',()=>$('about-dialog').close());$('about-dialog').addEventListener('click',e=>{if(e.target===$('about-dialog')){const rect=e.target.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)e.target.close();}});
  let drag=null;
  $('history-graph').addEventListener('pointerdown',e=>{if(e.target.closest('.graph-node,.edge-hit'))return;drag={x:e.clientX,y:e.clientY,startX:graphViewport.x,startY:graphViewport.y};$('history-graph').setPointerCapture(e.pointerId);});
  $('history-graph').addEventListener('pointermove',e=>{if(!drag)return;graphViewport.x=drag.startX+e.clientX-drag.x;graphViewport.y=drag.startY+e.clientY-drag.y;applyViewport();});
  $('history-graph').addEventListener('pointerup',()=>drag=null);$('history-graph').addEventListener('pointercancel',()=>drag=null);
  $('history-graph').addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();zoomGraph(e.deltaY>0?.92:1.08);}},{passive:false});
  let lastWidth=0;new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(Math.abs(width-lastWidth)>2){lastWidth=width;if(state.view==='history')drawGraph();}}).observe($('graph-wrap'));
  fillLists();
  const hash=new URLSearchParams(location.hash.slice(1));if(['history','family','map'].includes(hash.get('view')))state.view=hash.get('view');
  focusWord(D.lexemes[hash.get('word')]?hash.get('word'):'69562');
  // A small read-only hook supports reproducible prototype checks without exposing user information.
  window.wordTrails={getState:()=>({...state,expanded:[...state.expanded],visibleNodes:graph.ids.length,visibleEdges:graph.edges.length}),focusWord,searchWords};
})();
