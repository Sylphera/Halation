// Runtime metrics without a recorder. Separate deterministic rendering is in island-render.js.
// Frontend under Chromium/software rendering, existing mocked backend; not native Windows/GPU proof.
const fs = require('fs'), os = require('os'), path = require('path');
const { serve, launch, openApp, sleep, until } = require('./common');
const { createHost } = require('./host');
const { makeFixtures, toolOptions } = require('./fixtures');
const OUT = process.env.ISLAND_OUT || '/tmp/halation-island-profile';
fs.mkdirSync(OUT, { recursive: true });
const percentile = (xs, p) => [...xs].sort((a,b) => a-b)[Math.max(0, Math.ceil(xs.length*p)-1)] || 0;
(async () => {
 const fx = makeFixtures(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'halation-profile-'));
 const host = createHost(root, toolOptions(fx)), server = serve(), browser = await launch();
 const app = await openApp(browser, server, host, { width:1440, height:900, motion:true });
 const page = app.page;
 await app.tab('grade'); await app.appReady('grade');
 await app.grade.locator('#imgIn').setInputFiles(path.join(fx.FIX,'sky.png'));
 await until(() => app.grade.locator('#exportBtn').isEnabled(),5000); await sleep(800);
 const setup = () => page.evaluate(() => {
   const P=window.__procs,J=window.__shell.jobs;
   window.__profile = async () => {
     const frames=[], boundaries=[], entries=[], marks=[];
     let phase='idle',run=true;
     const rect=el => {const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
     const state=() => { const isl=document.querySelector('#procIsland'),bg=isl.querySelector('.isl-bg');return {surface:rect(bg),island:rect(isl),transform:getComputedStyle(isl).transform,bgTransform:getComputedStyle(bg).transform,expanded:isl.classList.contains('expanded'),closing:isl.classList.contains('closing'),state:isl.dataset.state};};
     const sample=t=>{frames.push({t,phase,...state()});if(run)requestAnimationFrame(sample);};
     const supported=PerformanceObserver.supportedEntryTypes;
     const po=new PerformanceObserver(list=>entries.push(...list.getEntries().map(e=>({type:e.entryType,t:e.startTime,duration:e.duration,renderStart:e.renderStart,styleAndLayoutStart:e.styleAndLayoutStart,blockingDuration:e.blockingDuration}))));
     for(const type of ['longtask','long-animation-frame'])if(supported.includes(type))po.observe({type,buffered:false});
     const wait=ms=>new Promise(r=>setTimeout(r,ms));
     const action=(name,fn)=>{phase=name;const before=state();const t=performance.now();performance.mark('island:'+name);fn();const after=state();boundaries.push({name,t,before,after});marks.push({name,t});};
     requestAnimationFrame(sample);
     await wait(500);
     for(let i=0;i<3;i++) {
       action('idle-open-'+i,()=>P.openTray());await wait(440);
       action('idle-close-'+i,()=>P.closeTray({restore:false}));await wait(440);
     }
     let release;
     action('activation',()=>{const h=J.submit({tool:'grade',kind:'export-image',lane:'cpu',title:'cover.png',run:ctx=>{ctx.progress(.37,'Encoding');return new Promise(r=>release=r);}});window.__profileJob=h.id;});
     await wait(700);P.closePill(true);
     for(let i=0;i<3;i++) {
       action('active-open-'+i,()=>P.openTray());await wait(440);
       action('active-close-'+i,()=>P.closeTray({restore:false}));await wait(440);
     }
     for(let i=0;i<3;i++) {
       action('interrupt-open-'+i,()=>P.openTray());await wait(80);
       action('interrupt-close-'+i,()=>P.closeTray({restore:false}));await wait(80);
       action('interrupt-reopen-'+i,()=>P.openTray());await wait(440);
       action('interrupt-fold-'+i,()=>P.closeTray({restore:false}));await wait(440);
     }
     action('finishing',()=>{const j=window.__jobs.jobs.get(window.__profileJob);j.progress=.99;j.stage='Finalizing';window.__jobs.touch(j);});await wait(440);
     action('completion',()=>release());await wait(500);
     action('return-idle',()=>{J.clearFinished();P.closePill(true);P.paintIsland();});await wait(700);
     run=false;await wait(30);po.disconnect();
     return {frames,boundaries,entries,marks,supported};
   };
 });
 await setup();
 const runs=[];
 // No screenshots, video or trace on the baseline. Trace overhead is measured separately.
 for(let n=0;n<2;n++) {
   const data=await page.evaluate(()=>window.__profile());
   fs.writeFileSync(path.join(OUT,'baseline-'+n+'.json'),JSON.stringify(data));runs.push({name:'baseline-'+n,data});
 }
 await browser.startTracing(page,{categories:['toplevel','devtools.timeline','blink.user_timing','disabled-by-default-devtools.timeline']});
 const traced=await page.evaluate(()=>window.__profile());
 const raw=await browser.stopTracing();fs.writeFileSync(path.join(OUT,'runtime-trace.json'),raw);
 fs.writeFileSync(path.join(OUT,'traced-samples.json'),JSON.stringify(traced));
 const trace=JSON.parse(raw).traceEvents;
 const tids=new Set(trace.filter(e=>e.ph==='M'&&e.name==='thread_name'&&e.args.name==='CrRendererMain').map(e=>e.pid+':'+e.tid));
 const main=trace.filter(e=>e.ph==='X'&&tids.has(e.pid+':'+e.tid));
 const stats=events=>({count:events.length,totalMs:events.reduce((s,e)=>s+(e.dur||0)/1000,0),maxMs:Math.max(0,...events.map(e=>(e.dur||0)/1000))});
 const layout=main.filter(e=>e.name==='Layout'),paint=main.filter(e=>e.name==='Paint'),style=main.filter(e=>/UpdateLayoutTree|RecalculateStyles/.test(e.name));
 const summary=runs.concat([{name:'traced',data:traced}]).map(({name,data})=>{
   const dt=data.frames.slice(1).map((f,i)=>f.t-data.frames[i].t);
   return {name,frames:data.frames.length,frameMs:{p50:percentile(dt,.5),p95:percentile(dt,.95),p99:percentile(dt,.99),max:Math.max(...dt)},over25ms:dt.filter(x=>x>25).length,over50ms:dt.filter(x=>x>50).length,observers:data.entries,
     boundaries:data.boundaries.map(b=>({name:b.name,t:b.t,delta:Object.fromEntries(['x','y','w','h'].map(k=>[k,b.after.surface[k]-b.before.surface[k]])),before:b.before.surface,after:b.after.surface})),
     phases:data.marks.map((m,i)=>{const end=data.marks[i+1]?.t??Infinity;const f=data.frames.filter(f=>f.t>=m.t&&f.t<end);const xs=f.slice(1).map((v,j)=>v.t-f[j].t);return {name:m.name,frames:f.length,p95:percentile(xs,.95),max:Math.max(0,...xs),over25ms:xs.filter(x=>x>25).length};})};
 });
 const report={scope:'Chromium 1440x900, software rendering; real frontend, mocked backend; baseline has no recording/screenshots/tracing',runs:summary,trace:{layout:stats(layout),paint:stats(paint),style:stats(style),longTasks:main.filter(e=>/^(RunTask|ThreadControllerImpl::RunTask)$/.test(e.name)&&e.dur>50000).map(e=>({ms:e.dur/1000,ts:e.ts})),events:main.filter(e=>['Layout','Paint','UpdateLayoutTree','RecalculateStyles'].includes(e.name)).map(e=>({name:e.name,ts:e.ts,ms:e.dur/1000,args:e.args}))},errors:app.errors};
 fs.writeFileSync(path.join(OUT,'metrics.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({runs:summary.map(({boundaries,phases,...r})=>r),trace:{layout:report.trace.layout,paint:report.trace.paint,style:report.trace.style,longTasks:report.trace.longTasks},boundaries:summary[0].boundaries.filter(b=>Object.values(b.delta).some(v=>Math.abs(v)>1)),errors:app.errors},null,2));
 await browser.close();server.close();fs.rmSync(root,{recursive:true,force:true});
 if(app.errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1);});
