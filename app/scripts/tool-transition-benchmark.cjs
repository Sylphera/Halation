// External native transition benchmark: no probes are shipped in app/dist.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const workspace=path.resolve(__dirname,'../..');process.chdir(workspace);
const {chromium}=require(require.resolve('playwright',{paths:[path.join(workspace,'.tools'),workspace]}));
const strategy=process.argv[2]||'A',delay=Number(process.argv[3]||0),round=process.argv[4]||'1';
assert(process.argv.includes('--allow-reset'),'Disposable native window required: --allow-reset');
assert(['A','B','Braf','C','production'].includes(strategy));assert(Number.isFinite(delay)&&delay>=0&&delay<=1000);assert(/^[a-z0-9-]+$/i.test(round));
const tabs=['grade','removebg','interp','framegrab','upscale'];
function probe(){
 if(window!==top){try{parent.__trans?.marks.push({name:'document',tab:location.pathname.split('/').pop().replace('.html',''),t:performance.timeOrigin+performance.now()-parent.performance.timeOrigin});}catch{}return;}
 const p=window.__trans={times:[],long:[],marks:[],shadows:[],visual:[],current:null};
 new PerformanceObserver(es=>p.long.push(...es.getEntries().map(e=>({t:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true});
 function tick(t){p.times.push(t);const now=performance.now(),c=p.current;if(c){const sk=document.querySelector('#toolSkel'),f=document.querySelector('#v-'+c.tab);if(!c.skeleton&&sk&&!sk.hidden&&sk.dataset.tab===c.tab&&+getComputedStyle(sk).opacity>.01)c.skeleton=now;
 if(!c.content&&f?.classList.contains('on')&&!f.classList.contains('pending')&&f.contentWindow?.__halApp&&+getComputedStyle(f).opacity>.01)c.content=now;}
 requestAnimationFrame(tick);}requestAnimationFrame(tick);
}
(async()=>{
 const b=await chromium.connectOverCDP(process.env.HAL_PERF_CDP||'http://127.0.0.1:9237'),p=b.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://tauri.localhost'));assert(p);
 const errors=[];p.on('pageerror',e=>errors.push(String(e)));
 for(const file of fs.readdirSync('app/dist').filter(f=>f.endsWith('.js'))){let body=(process.env.HAL_TRANSITION_REVISION?require('child_process').execFileSync('C:/Program Files/Git/cmd/git.exe',['show',process.env.HAL_TRANSITION_REVISION+':app/dist/'+file],{encoding:'utf8',maxBuffer:16*1024*1024}):fs.readFileSync(path.join('app/dist',file),'utf8')).replace(/\r\n/g,'\n');
 if(tabs.includes(file.replace('.js',''))){const mark=`try { parent.__trans?.marks.push({name:'tool-init',tab:'${file.replace('.js','')}',t:performance.timeOrigin+performance.now()-parent.performance.timeOrigin}); } catch {}`;body=body.includes('"use strict";')?body.replace('"use strict";','"use strict";'+mark):mark+'\n'+body;}
 if(file==='shell.js'){
 if(strategy!=='production'&&strategy!=='A')body=body.replace('view.src = view.dataset.src;',strategy==='Braf'?'requestAnimationFrame(() => requestAnimationFrame(() => { view.src = view.dataset.src; }));':`setTimeout(() => { view.src = view.dataset.src; }, ${delay});`);
 body=body.replace('readyTabs.add(tab);',"window.__trans?.marks.push({name:'ready',tab,t:performance.now()}); readyTabs.add(tab);");
 body=body.replace('function show(tab) {',"function show(tab) { window.__trans?.marks.push({name:'show',tab,t:performance.now()});");
 }
 if(file==='ui-shadows.js'){

 body=body.replace('function flush(){',"function flush(){ const __start=performance.now();").replace('watch();}\n    if(document.getAnimations()',"watch(); (window===top?window:parent).__trans?.shadows.push({tab:location.pathname,t:performance.timeOrigin+__start-(window===top?window:parent).performance.timeOrigin,ms:performance.now()-__start});}\n    if(document.getAnimations()");

 }
 if(file==='motion.js'){
 body=body.replace('done(a).then(ok => {\n        if (!ok || !a',"done(a).then(ok => {\n        window.__trans?.marks.push({name:ok?'half':'cancel',tab:view.id.slice(2),t:performance.now()});\n        if (!ok || !a");
 const needle='animate(view, [{ transform: stretch, transformOrigin: org }, { transform: "none", transformOrigin: org }], { dur: ms * .5, channel: "vis", noOvershoot: true });';
 if(body.includes('const tail = '+needle))body=body.replace('return done(tail);',"return done(tail).then(ok => {window.__trans?.marks.push({name:ok?'end':'cancel',tab:view.id.slice(2),t:performance.now()});return ok;});");
 else body=body.replace(needle,`const final = ${needle.slice(0,-1)}; final?.finished.then(ok => window.__trans?.marks.push({name:ok?'end':'cancel',tab:view.id.slice(2),t:performance.now()}));`);
 }
 await p.route('**/'+file,r=>r.fulfill({status:200,contentType:'text/javascript',body}));}
 await p.addInitScript(()=>sessionStorage.clear());await p.addInitScript(probe);
 async function reset(){await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__shell?.session);await p.waitForTimeout(700);if(await p.locator('#modal').isVisible())await p.locator('#mCancel').click();await p.evaluate(()=>window.__shell.session.ready);await p.waitForTimeout(500);}
 async function show(tab){await p.evaluate(tab=>window.__shell.show(tab),tab);if(tab!=='home'){await p.waitForFunction(tab=>!!document.querySelector('#v-'+tab).contentWindow?.__halApp,tab);await p.evaluate(tab=>window.__shell.ensureApp(tab),tab);}await p.waitForTimeout(550);}
 const rows=[];
 async function measure(from,tab,cold){
 await p.evaluate(tab=>{const p=window.__trans;p.current={tab,start:performance.now()};window.__shell.show(tab)},tab);
 await p.waitForFunction(tab=>window.__trans.marks.some(m=>m.name==='ready'&&m.tab===tab)||document.querySelector('#v-'+tab).contentWindow?.__halApp,tab,{timeout:20000});await p.waitForTimeout(700);
 const row=await p.evaluate(({from,tab,cold})=>{const p=window.__trans,c=p.current,start=c.start,end=start+window.__motion.dur('place'),times=p.times.filter(t=>t>=start&&t<=end),all=p.times;const gaps=all.slice(1).map((t,i)=>({start:all[i],end:t,ms:t-all[i]})).filter(g=>g.start<end&&g.end>start),long=p.long.filter(e=>e.t<end&&e.t+e.ms>start),marks=p.marks.filter(m=>m.tab===tab&&m.t>=start),shadows=p.shadows.filter(e=>e.t<end&&e.t+e.ms>start);return {from,tab,cold,windowMs:end-start,raf:times.length,maxGap:Math.max(0,...gaps.map(g=>g.ms)),long:long.length,longMs:long.reduce((s,e)=>s+Math.min(end,e.t+e.ms)-Math.max(start,e.t),0),skeleton:c.skeleton?c.skeleton-start:null,content:c.content?c.content-start:null,marks:marks.map(m=>({...m,t:m.t-start})),shadows:shadows.length,shadowMs:shadows.reduce((s,e)=>s+e.ms,0),longDetails:long,gaps:gaps.filter(g=>g.ms>30).map(g=>({...g,start:g.start-start,end:g.end-start}))};},{from,tab,cold});rows.push(row);console.log(row.from+' -> '+tab+' '+(cold?'cold':'warm')+': '+row.raf+' rAF; gap '+row.maxGap.toFixed(1)+'ms; long tasks '+row.long);fs.writeFileSync(`.tools/transitions-${strategy}-${delay}-${round}.json`,JSON.stringify({strategy,delay,round,rows,errors},null,2));
 }
 for(const tab of tabs){await reset();await measure('home',tab,true);await show('home');await measure('home',tab,false);}
 for(const tab of tabs){await reset();const from=tab==='grade'?'removebg':'grade';await show(from);await measure(from,tab,true);await show(from);await measure(from,tab,false);}
 await b.close();assert.deepEqual(errors,[]);
})().catch(e=>{console.error(e);process.exit(1)});
