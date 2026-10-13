// External native diagnostic. Never loaded by the shell or tools.
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
const workspace=path.resolve(__dirname,'../..');process.chdir(workspace);
const {chromium}=require(require.resolve('playwright',{paths:[path.join(workspace,'.tools'),workspace]}));
const mode=process.argv[2]||'normal',label=process.argv[3]||'1',revision=process.env.HAL_WARM_REVISION||'11a640ab1ecaffa4a1b20091632cf6c4998b12e8';
assert(process.argv.includes('--allow-reset'),'Use only a disposable native window: --allow-reset');
assert(['normal','no-spring','no-reveal','sequence','shell-exit','freeze-all','freeze-root','freeze-child'].includes(mode));
assert(/^[a-z0-9-]+$/i.test(label));assert(revision==='working'||/^[a-f0-9]{40}$/i.test(revision));
const tabs=['grade','removebg','interp','framegrab','upscale'];
function probe(){if(window!==top)return;const p=window.__warmProbe={raf:[],long:[],animations:[],shadows:[],initializations:[],seq:0,freeze:false};new PerformanceObserver(es=>p.long.push(...es.getEntries().map(e=>({t:e.startTime,ms:e.duration,attribution:e.attribution.map(a=>a.containerId)})))).observe({type:'longtask',buffered:true});const tick=t=>{p.raf.push({t,wall:performance.now()});const c=p.cold;if(c){const sk=document.querySelector('#toolSkel'),f=document.querySelector('#v-'+c.tab);if(!c.skeleton&&sk&&!sk.hidden&&sk.dataset.tab===c.tab&&+getComputedStyle(sk).opacity>.01)c.skeleton=performance.now();if(!c.content&&f?.classList.contains('on')&&!f.classList.contains('pending')&&f.contentWindow?.__halApp&&+getComputedStyle(f).opacity>.01)c.content=performance.now();}requestAnimationFrame(tick);};requestAnimationFrame(tick);}
const hook=`
  const __p=window===top?window.__warmProbe:parent.__warmProbe;
  if(__p)for(const __name of ['fromTo','to','from']){
    const __fn=G[__name];G[__name]=function(targets,...args){
      const vars={...args.at(-1)},els=G.utils.toArray(targets),clock=()=>performance.timeOrigin+performance.now()-(window===top?window:parent).performance.timeOrigin;
      const toolSpring=vars.duration===.32&&(window!==top||els.some(el=>el.tagName==='IFRAME'||(el.closest?.('#v-home')&&!el.matches('.view'))));
      if('${mode}'==='no-spring'&&toolSpring){vars.duration=0;vars.delay=0;}
      const gate='${mode}'==='sequence'&&toolSpring?__p.navigationReady:null;
      if(gate)vars.paused=true;
      const rec={seq:__p.seq,realm:location.pathname,targets:els.map(el=>el.id||el.className?.baseVal||el.className||el.tagName),created:clock(),duration:vars.duration*1000,delay:(vars.delay||0)*1000,opacity:vars.opacity,scaleX:vars.scaleX,scaleY:vars.scaleY};
      __p.animations.push(rec);
      for(const [key,field]of [['onStart','start'],['onComplete','end'],['onInterrupt','cancel']]){const old=vars[key];vars[key]=function(...a){rec[field]=clock();return old?.apply(this,a);};}
      args[args.length-1]=vars;const tween=__fn.call(this,targets,...args);if(gate)gate.then(ok=>{if(ok===false)tween.kill();else tween.play();});return tween;
    };
  }
`;
(async()=>{
 const b=await chromium.connectOverCDP('http://127.0.0.1:9237'),p=b.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://tauri.localhost'));assert(p);const errors=[];p.on('pageerror',e=>errors.push(String(e)));
 for(const file of fs.readdirSync('app/dist').filter(f=>f.endsWith('.js'))){let body=(revision==='working'?fs.readFileSync('app/dist/'+file,'utf8'):cp.execFileSync('C:/Program Files/Git/cmd/git.exe',['show',revision+':app/dist/'+file],{encoding:'utf8',maxBuffer:16*1024*1024})).replace(/\r\n/g,'\n');
 if(file==='motion.js'){
 if(mode==='sequence')body=fs.readFileSync('app/dist/motion.js','utf8').replace(/\r\n/g,'\n');
 body=body.replace('const G = window.gsap, FL = window.Flip;', 'const G = window.gsap, FL = window.Flip;'+hook);
 if(mode==='sequence')body=body.replace('window.__motion = {',`const originalSwap=swap;swap=(...args)=>{const a=originalSwap(...args);if(window===top&&window.__warmProbe)window.__warmProbe.navigationReady=a?.settled||Promise.resolve(true);return a;};\n  window.__motion = {`);
 }
 if(tabs.includes(file.replace('.js',''))){const mark=`try { parent.__warmProbe.initializations.push({tab:'${file.replace('.js','')}',t:performance.timeOrigin+performance.now()-parent.performance.timeOrigin}); } catch {}`;body=body.includes('"use strict";')?body.replace('"use strict";','"use strict";'+mark):mark+'\n'+body;}
 if(file==='shell.js'&&mode==='no-reveal')body=body.replace('if (active === tab && v) M.animate(v,','if (false && active === tab && v) M.animate(v,');
 if(file==='shell.js')body=body.replace('function show(tab) {',"function show(tab) { window.__warmProbe?.navigations?.push({seq:window.__warmProbe.seq,tab,t:performance.now()});");
 if(file==='ui-shadows.js'){
 body=body.replace('function flush(){',`function flush(){ const __start=performance.now(),__draws=draws,__render=elapsed,__p=window===top?window.__warmProbe:parent.__warmProbe;
 if(__p?.freeze ${mode==='freeze-child'?'&&window!==top':mode==='freeze-root'?'&&window===top':mode==='normal'||mode==='no-reveal'||mode==='shell-exit'?'&&false':''}){queued=false;return;}`);
 body=body.replace('watch();}\n    if(document.getAnimations()',"watch(); __p?.shadows.push({seq:__p.seq,realm:location.pathname,t:performance.timeOrigin+__start-(window===top?window:parent).performance.timeOrigin,ms:performance.now()-__start,draws:draws-__draws,rasterMs:elapsed-__render});}\n    if(document.getAnimations()");
 }
 await p.route('**/'+file,r=>r.fulfill({contentType:'text/javascript',body}));
 }
 await p.addInitScript(probe);await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__shell?.session);await p.waitForTimeout(700);if(await p.locator('#modal').isVisible())await p.locator('#mCancel').click();await p.evaluate(()=>window.__shell.session.ready);
 const cold=[];
 for(const tab of tabs){await p.evaluate(()=>window.__shell.show('home'));await p.waitForTimeout(1000);const start=await p.evaluate(async tab=>{const p=window.__warmProbe;p.seq++;p.cold={tab,t:performance.now(),seq:p.seq};window.__shell.show(tab);await window.__shell.ensureApp(tab);p.cold.ready=performance.now();return {...p.cold};},tab);await p.waitForTimeout(600);cold.push(await p.evaluate(start=>{const p=window.__warmProbe,c=p.cold,anims=p.animations.filter(a=>a.seq===start.seq),end=Math.max(start.t+300,...anims.filter(a=>a.targets.includes('v-'+start.tab)&&[84,150].some(d=>Math.abs(a.duration-d)<.01)).map(a=>a.end||a.cancel||start.t)),frames=p.raf.filter(f=>f.t>=start.t&&f.t<end),gaps=p.raf.slice(1).map((f,i)=>({t:p.raf[i].t,end:f.t,ms:f.t-p.raf[i].t})).filter(g=>g.t<end&&g.end>start.t),row={tab:start.tab,transitionEnd:end-start.t,raf:frames.length,maxGap:Math.max(0,...gaps.map(g=>g.ms)),long:p.long.filter(e=>e.t<end&&e.t+e.ms>start.t).length,skeleton:c.skeleton?c.skeleton-start.t:null,content:c.content?c.content-start.t:null,ready:c.ready-start.t,initializations:p.initializations.filter(e=>e.tab===start.tab&&e.t>=start.t).map(e=>({...e,t:e.t-start.t})),animations:anims.map(a=>({...a,created:a.created-start.t,start:a.start==null?null:a.start-start.t,end:a.end==null?null:a.end-start.t,cancel:a.cancel==null?null:a.cancel-start.t}))};p.cold=null;return row;},start));}
 await p.evaluate(()=>window.__shell.show('home'));await p.waitForTimeout(2000);
 await p.evaluate(tabs=>{window.__warmApps=Object.fromEntries(tabs.map(tab=>[tab,window.__shell.loadedApp(tab)]));window.__warmProbe.initializations.length=0;window.__warmProbe.navigations=[];},tabs);
 const cdp=await p.context().newCDPSession(p);await cdp.send('Performance.enable');
 const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 const rows=[];
 async function nav(from,to,round){
 const before=await metrics();
 const start=await p.evaluate(({to,mode})=>{const p=window.__warmProbe;p.seq++;p.freeze=mode.startsWith('freeze');
 if(mode==='shell-exit'){window.__pausedToolTweens=[];for(const frame of document.querySelectorAll('#views iframe'))try{if(frame.classList.contains('on')){const g=frame.contentWindow.__motion?.gsap;for(const t of g?.globalTimeline.getChildren(true,true,false)||[])if(t.progress()<1){t.pause();window.__pausedToolTweens.push(t);}}}catch{}}
 const start=performance.now();window.__shell.show(to);return {t:start,seq:p.seq};},{to,mode});
 await p.waitForTimeout(1000);
 const row=await p.evaluate(({from,to,round,start})=>{const p=window.__warmProbe,end=start.t+300,frames=p.raf.filter(f=>f.t>=start.t&&f.t<end),gaps=p.raf.slice(1).map((f,i)=>({t:p.raf[i].t,end:f.t,ms:f.t-p.raf[i].t})).filter(g=>g.t<end&&g.end>start.t),long=p.long.filter(e=>e.t<end&&e.t+e.ms>start.t),anims=p.animations.filter(a=>(a.start||a.created)<end&&(a.end||a.cancel||Infinity)>start.t),shadows=p.shadows.filter(e=>e.t<end&&e.t+e.ms>start.t),exitEnd=start.t+150,exitGaps=gaps.filter(g=>g.t<exitEnd&&g.end>start.t);const byRealm={};for(const s of shadows){const r=byRealm[s.realm]||= {calls:0,ms:0,draws:0,rasterMs:0};r.calls++;r.ms+=s.ms;r.draws+=s.draws;r.rasterMs+=s.rasterMs;}return {from,to,round,seq:start.seq,raf:frames.length,maxGap:Math.max(0,...gaps.map(g=>g.ms)),exitRaf:frames.filter(f=>f.t<exitEnd).length,exitMaxGap:Math.max(0,...exitGaps.map(g=>g.ms)),long:long.length,initializations:p.initializations.filter(e=>e.t>=start.t&&e.t<end),animations:anims.map(a=>({...a,created:a.created-start.t,start:a.start==null?null:a.start-start.t,end:a.end==null?null:a.end-start.t,cancel:a.cancel==null?null:a.cancel-start.t})),shadows:byRealm,identities:Object.entries(window.__warmApps).every(([tab,a])=>a===window.__shell.loadedApp(tab))};},{from,to,round,start});
 row.actual=await p.evaluate(({start,to})=>{const p=window.__warmProbe,anims=p.animations.filter(a=>a.seq===start.seq&&a.targets.includes('v-'+to)&&[84,150].some(d=>Math.abs(a.duration-d)<.01)),end=Math.max(start.t+300,...anims.map(a=>a.end||a.cancel||start.t)),frames=p.raf.filter(f=>f.t>=start.t&&f.t<end),gaps=p.raf.slice(1).map((f,i)=>({t:p.raf[i].t,end:f.t,ms:f.t-p.raf[i].t})).filter(g=>g.t<end&&g.end>start.t);return {end:end-start.t,raf:frames.length,maxGap:Math.max(0,...gaps.map(g=>g.ms)),long:p.long.filter(e=>e.t<end&&e.t+e.ms>start.t).length};},{start,to});
 const after=await metrics();row.metrics=Object.fromEntries(['LayoutCount','LayoutDuration','RecalcStyleCount','RecalcStyleDuration','TaskDuration','ScriptDuration'].map(k=>[k,after[k]-before[k]]));
 row.navigations=await p.evaluate(seq=>window.__warmProbe.navigations.filter(e=>e.seq===seq),start.seq);assert.equal(await p.evaluate(()=>window.__shell.active()),to,'External navigation contaminated this sample');assert.deepEqual(row.navigations.map(e=>e.tab),[to],'Only the benchmark navigation may run during its sample');
 rows.push(row);assert(row.identities&&!row.initializations.length,'Warm run must never initialize or replace tools');console.log(`${round} ${from} -> ${to}: ${row.raf} rAF, ${row.maxGap.toFixed(1)}ms; exit ${row.exitMaxGap.toFixed(1)}ms`);
 await p.evaluate(mode=>{window.__warmProbe.freeze=false;for(const t of window.__pausedToolTweens||[])t.play();window.__pausedToolTweens=[];if(mode.startsWith('freeze')){for(const frame of document.querySelectorAll('#views iframe'))try{frame.contentWindow.dispatchEvent(new Event('resize'));}catch{}window.dispatchEvent(new Event('resize'));}},mode);await p.waitForTimeout(mode.startsWith('freeze')?500:150);
 fs.writeFileSync(`.tools/warm-${mode}-${label}.json`,JSON.stringify({mode,revision,cold,rows,errors},null,2));
 }
 for(let round=1;round<=3;round++)for(const tab of tabs){await nav('home',tab,round);await nav(tab,'home',round);}
 await p.evaluate(()=>window.__shell.show('grade'));await p.waitForTimeout(600);
 for(let round=1;round<=3;round++){await nav('grade','removebg',round);await nav('removebg','grade',round);}
 assert.deepEqual(errors,[]);await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
