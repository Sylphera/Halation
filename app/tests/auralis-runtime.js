// Real-time execution measurement, run separately from all video/capture workers. The presentation alternates between its resting and refraction programs; neither is recompiled or deleted.
const fs=require('fs'),path=require('path'),assert=require('assert');
const {serve,launch,openApp,until}=require('./common'),{newHost}=require('./scan');
const out=path.resolve(__dirname,'../../review/auralis');
(async()=>{
 const server=serve(),browser=await launch();
 try{
  const {host}=newHost('en'),{page,tab,errors}=await openApp(browser,server,host,{width:1280,height:800,motion:true,init:()=>{window.__halVisualTest=true}});
  for(const n of ['library','settings','home'])await tab(n);
  await until(()=>page.evaluate(()=>!window.__motion.busy()),5000,20);
  await browser.startTracing(page,{categories:['toplevel','devtools.timeline','disabled-by-default-devtools.timeline']});
  const measurement=await page.evaluate(async()=>{
   const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),click=n=>document.querySelector(`.rail .tab[data-tab="${n}"]`).click();
   const canvas=document.querySelector('.atmo canvas'),gl=canvas.getContext('webgl'),programs=new Set([gl.getParameter(gl.CURRENT_PROGRAM)]);
   async function run(name,action){
    const frames=[];let active=true,last=performance.now();const before=window.__atmo.review.scene(),cacheBefore=canvas.__auralisState();
    const sample=t=>{if(!active)return;programs.add(gl.getParameter(gl.CURRENT_PROGRAM));frames.push(t-last);last=t;requestAnimationFrame(sample);};requestAnimationFrame(sample);
    await action();await wait(900);active=false;
    results.push({name,frames,before,after:window.__atmo.review.scene(),cacheBefore,cacheAfter:canvas.__auralisState(),sameCanvas:canvas===document.querySelector('.atmo canvas'),sameProgram:(programs.add(gl.getParameter(gl.CURRENT_PROGRAM)),programs.size<=2&&[...programs].every(p=>gl.isProgram(p)))});
   }
   await run('idle',()=>{});await run('navigation',()=>click('library'));
   await run('interrupted-navigation',async()=>{click('settings');await wait(45);click('home');await wait(45);click('library');await wait(45);click('home');});
   return results;
  });
  const events=JSON.parse((await browser.stopTracing()).toString()).traceEvents;
  const main=new Set(events.filter(e=>e.ph==='M'&&e.name==='thread_name'&&e.args?.name==='CrRendererMain').map(e=>e.pid+':'+e.tid));
  const renderer=events.filter(e=>e.ph==='X'&&main.has(e.pid+':'+e.tid));
  const long=renderer.filter(e=>/^(RunTask|ThreadControllerImpl::RunTask)$/.test(e.name)&&e.dur>50000).map(e=>({name:e.name,ms:e.dur/1000}));
  const costs=Object.fromEntries(['Layout','Paint','UpdateLayoutTree'].map(name=>{const a=renderer.filter(e=>e.name===name);return [name,{count:a.length,totalMs:a.reduce((s,e)=>s+(e.dur||0)/1000,0),maxMs:Math.max(0,...a.map(e=>(e.dur||0)/1000))}];}));
  const summaries=measurement.map(m=>{const a=m.frames.slice(1).sort((a,b)=>a-b);return {name:m.name,frames:a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)],longestMs:Math.max(...a),over33ms:a.filter(x=>x>33.4).length};});
  const result={environment:'Windows Chromium153 ANGLE SwiftShader; isolated runtime, no capture/encoding; does not certify hardware GPU or native WebView2',measurement,summaries,longMainTasks:long,costs,errors};
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'runtime-isolated.json'),JSON.stringify(result,null,2));
  assert(!errors.length,errors.join('\n'));assert(measurement.every(m=>m.sameCanvas&&m.sameProgram&&m.after.time>=m.before.time),'Continuous scene across navigation');
  assert(measurement[0].cacheAfter.generations>measurement[0].cacheBefore.generations&&measurement[0].cacheAfter.time>measurement[0].cacheBefore.time,'Visible idle Auralis stays animated');
  assert(measurement.every(m=>m.cacheAfter.fieldWidth<=320&&m.cacheAfter.fieldHeight<=320&&m.cacheAfter.outputWidth===m.cacheAfter.cssWidth&&m.cacheAfter.outputHeight===m.cacheAfter.cssHeight),'Navigation keeps the bounded field and CSS-pixel presentation');
  console.log('PASS animated tiny-field Auralis runtime. Measured:',JSON.stringify({summaries,longMainTasks:long,costs}));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
