// Run separately from deterministic capture/encoding and other workers' browser tests.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert');
const {serve,launch,openApp,sleep,until}=require('./common');const {createHost}=require('./host');
const OUT=process.env.SHOTS||path.join(os.tmpdir(),'halation-background-runtime');fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hal-bg-runtime-')),host=createHost(tmp),server=serve(),browser=await launch();
 try{
  const {page,tab,errors}=await openApp(browser,server,host,{motion:true,width:1280,height:800});
  for(const name of ['library','settings','home']){await tab(name);await until(()=>page.evaluate(()=>!window.__motion.busy()),4000,30);}
  await sleep(1800);await browser.startTracing(page,{categories:['toplevel','devtools.timeline','disabled-by-default-devtools.timeline']});
  const measurement=await page.evaluate(async()=>{
   const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
   function drag(type){const dt=new DataTransfer();dt.items.add(new File(['x'],'drag.wav',{type:'audio/wav'}));window.dispatchEvent(new DragEvent(type,{dataTransfer:dt,clientX:790,clientY:500,bubbles:true,cancelable:true}));}
   async function measure(name,action,duration){
    const frames=[],poses=[],el=document.querySelector('#homeDrop');let active=true,last=performance.now();
    function sample(t){if(!active)return;frames.push(t-last);last=t;poses.push({at:t,w:el.offsetWidth,h:el.offsetHeight,transform:getComputedStyle(el).transform});requestAnimationFrame(sample);}requestAnimationFrame(sample);
    await action();await wait(duration);active=false;results.push({name,frames,poses});
   }
   const click=name=>document.querySelector('.rail .tab[data-tab='+name+']').click();
   await measure('navigation',()=>click('library'),650);await measure('return-home',()=>click('home'),650);
   await measure('drag-interruption',async()=>{drag('dragenter');await wait(70);drag('dragleave');await wait(40);drag('dragenter');await wait(200);drag('dragleave');},700);
   await measure('rapid-navigation',async()=>{click('library');await wait(45);click('settings');await wait(45);click('home');},700);
   return results;
  });
  const trace=JSON.parse((await browser.stopTracing()).toString()),events=trace.traceEvents||[];
  const main=new Set(events.filter(e=>e.ph==='M'&&e.name==='thread_name'&&e.args?.name==='CrRendererMain').map(e=>e.pid+':'+e.tid));
  const renderer=events.filter(e=>e.ph==='X'&&main.has(e.pid+':'+e.tid));
  const long=renderer.filter(e=>/^(RunTask|ThreadControllerImpl::RunTask)$/.test(e.name)&&e.dur>50000).map(e=>({name:e.name,ms:e.dur/1000}));
  const costs=Object.fromEntries(['Layout','Paint','UpdateLayoutTree'].map(name=>{const a=renderer.filter(e=>e.name===name);return [name,{count:a.length,totalMs:a.reduce((s,e)=>s+(e.dur||0)/1000,0),maxMs:Math.max(0,...a.map(e=>(e.dur||0)/1000))}];}));
  const summaries=measurement.map(m=>{const a=m.frames.slice(1).sort((a,b)=>a-b);return {name:m.name,frames:a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)],longestMs:Math.max(...a),over33ms:a.filter(v=>v>33.4).length,layoutStable:m.poses.every(p=>p.w===m.poses[0].w&&p.h===m.poses[0].h)};});
  fs.writeFileSync(path.join(OUT,'runtime-isolated.json'),JSON.stringify({environment:'Windows Chromium153 ANGLE SwiftShader, isolated from capture and worker runners; does not certify hardware WebView2',summaries,longMainTasks:long,costs,measurement,errors},null,2));
  assert.strictEqual(errors.length,0);assert.strictEqual(long.length,0,'main-thread task over50ms');assert(summaries.every(s=>s.layoutStable),'drop geometry changed during transform');
  assert(await until(()=>page.evaluate(()=>!window.__motion.busy()&&!document.querySelector('.view.leaving')),4000,20));
  console.log('OK isolated continuity/layout and no main-thread task>50ms; frame/cost metrics:',JSON.stringify({summaries,costs}));
 }finally{await browser.close();server.close();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
