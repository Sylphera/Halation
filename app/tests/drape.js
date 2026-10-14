// Drape in the real shell (drape.js + atmosphere.js): what it draws and how it behaves. No screenshots or videos.
// The image is read back in the same task as a controlled draw (__atmo.review.sceneAt), before the page composites it.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {serve,launch,openApp,painted,until}=require('./common'),{createHost}=require('./host');
const host=()=>createHost(fs.mkdtempSync(path.join(os.tmpdir(),'hal-drape-')));
const stats=(page,time)=>page.evaluate(time=>{
 const scene=window.__atmo.review.sceneAt({time}),c=document.querySelector('.drape-host canvas'),gl=c.getContext('webgl');
 const w=c.width,h=c.height,px=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
 let sum=0,lit=0,n=0,hash=0;
 for(let i=0;i<px.length;i+=4*7){const L=(.2126*px[i]+.7152*px[i+1]+.0722*px[i+2])/255;sum+=L;if(L>.08)lit++;n++;hash=(hash*31+px[i]+px[i+1]*7+px[i+2]*13)>>>0;}
 return {time:scene.time,mean:sum/n,lit:lit/n,hash,blue:px.filter((v,i)=>i%4===2).reduce((a,b)=>a+b,0)>px.filter((v,i)=>i%4===0).reduce((a,b)=>a+b,0)};
},time);
(async()=>{const server=serve(),browser=await launch();
 try{
  const {page,tab,errors}=await openApp(browser,server,host(),{width:1280,height:800,motion:true});
  await page.evaluate(()=>window.__renderBudget.setFocused(true));
  await page.waitForFunction(()=>window.__atmo?.review?.scene()?.frame>1);await painted(page);
  const state=()=>page.evaluate(()=>document.querySelector('.drape-host canvas').__drapeState());

  /* ---------- host, canvas and field ---------- */
  const shape=await page.evaluate(()=>{const h=document.querySelector('.drape-host'),c=h.querySelector('canvas'),s=window.__atmo.review.scene(),k=Math.min(devicePixelRatio,2);
   return {count:document.querySelectorAll('.atmo canvas').length,grain:!!document.querySelector('.grain'),aria:h.getAttribute('aria-hidden'),first:document.body.firstElementChild===h,
    proxy:!!h.querySelector('.drape-wave'),match:c.width===Math.round(innerWidth*k)&&c.height===Math.round(innerHeight*k)&&s.viewport[2]===c.width&&s.viewport[3]===c.height,renderer:s.renderer,mode:h.dataset.mode,
    canvasTransform:getComputedStyle(c).transform,surfaceTransform:getComputedStyle(c.parentElement).transform};});
  assert.deepEqual(shape,{count:1,grain:false,aria:'true',first:true,proxy:true,match:true,renderer:'drape',mode:'home',canvasTransform:'none',surfaceTransform:'none'});
  const s0=await state();assert.equal(s0.fieldWidth,320);assert.equal(s0.fieldHeight,200);assert.equal(s0.targetFps,15);assert.equal(s0.grain,'static-film-grain');assert.equal(s0.state,'animate');
  // software WebGL (SwiftShader) draws the warped field slowly: wait for the next generation, not a fixed 600 ms
  assert(await until(async()=>(await state()).generations>s0.generations,3000,100),'Home stays animated');
  console.log('PASS host, one canvas at native size, 320 px field, animated at 15 Hz');

  /* ---------- what it draws ---------- */
  const frames=[];for(let t=0;t<=120;t+=7.5)frames.push(await stats(page,t));
  for(const f of frames){assert(f.mean>.035&&f.mean<.075,'Mean luminance in range at '+f.time+': '+f.mean.toFixed(4));assert(f.lit>.15&&f.lit<.36,'Lit share in range at '+f.time+': '+f.lit.toFixed(3));assert(f.blue,'Blue-grey, not neutral or warm');}
  const means=frames.map(f=>f.mean),lits=frames.map(f=>f.lit);
  assert(Math.max(...means)/Math.min(...means)<1.35,'Steady brightness over two minutes: '+means.map(x=>x.toFixed(4)).join(' '));
  assert(Math.max(...lits)/Math.min(...lits)<1.5,'Steady coverage over two minutes: '+lits.map(x=>x.toFixed(3)).join(' '));
  assert.equal((await stats(page,30)).hash,(await stats(page,30)).hash,'Same time, same pixels: grain and dither are stationary');
  assert.notEqual(frames[0].hash,frames[1].hash,'The field moves');
  console.log('PASS non-black blue-grey field; mean',Math.min(...means).toFixed(4),'-',Math.max(...means).toFixed(4),'lit',Math.min(...lits).toFixed(3),'-',Math.max(...lits).toFixed(3),'over 120 s; stationary grain');

  /* ---------- window.__atmo ---------- */
  const api=await page.evaluate(()=>({current:window.__atmo.current,variant:window.__atmo.variant,tool:typeof window.__atmo.toolReview?.scene,keys:Object.keys(window.__atmo).sort()}));
  assert.equal(api.current,'home');assert.equal(api.variant.length,4);assert.equal(api.tool,'function');
  assert.deepEqual(api.keys,['current','mode','navigationWave','review','toolReview','variant']);
  await page.evaluate(()=>window.__atmo.mode('elsewhere'));assert.equal(await page.evaluate(()=>window.__atmo.current),'home','Unknown modes are ignored');
  await page.evaluate(()=>{window.__initialDrape=document.querySelector('.drape-host canvas');window.__initialGL=window.__initialDrape.getContext('webgl');});
  for(const name of ['grade','library','settings','home']){
   await tab(name);
   const mode=name==='home'?'home':name==='grade'?'tool':'page';
   await page.waitForFunction(([m,r])=>window.__atmo.current===m&&document.querySelector('.drape-host').dataset.mode===m&&document.querySelector('.drape-host').dataset.rest===r,[mode,mode==='home'?'home':'tool']);
   const v=await page.evaluate(()=>{const h=document.querySelector('.drape-host'),c=h.querySelector('canvas');return {same:c===window.__initialDrape&&c.getContext('webgl')===window.__initialGL,visibility:getComputedStyle(h).visibility,state:c.__drapeState().state};});
   assert(v.same,'Same canvas and context in '+name);assert.equal(v.visibility,mode==='home'?'visible':'hidden');assert.equal(v.state,mode==='home'?'animate':'suspended',name);
  }
  console.log('PASS __atmo mode/current/variant/toolReview/review, host data-mode/data-rest, one canvas and context across navigation');

  /* ---------- navigation wave ---------- */
  await tab('library');await page.waitForFunction(()=>document.querySelector('.drape-host').dataset.rest==='tool');
  await page.evaluate(()=>{window.__waveSeen={fps:0,phase:0,scale:1};const c=document.querySelector('.drape-host canvas');const watch=()=>{const s=c.__drapeState();window.__waveSeen.fps=Math.max(window.__waveSeen.fps,s.fps);window.__waveSeen.phase=Math.max(window.__waveSeen.phase,s.wave[0]);window.__waveSeen.scale=Math.max(window.__waveSeen.scale,s.scale[0]);if(performance.now()-t0<2500)requestAnimationFrame(watch);};const t0=performance.now();requestAnimationFrame(watch);document.querySelector('.rail .tab[data-tab="home"]').click();});
  await page.waitForTimeout(2600);
  const seen=await page.evaluate(()=>window.__waveSeen);
  assert.equal(seen.fps,60,'Presentation at 60 Hz while the wave travels');assert(seen.phase>0,'Refraction phase reaches the renderer');assert(seen.scale>1,'Surface scale read from .drape-wave');
  await until(async()=>(await state()).fps===15,3000,50);const rest=await state();assert.deepEqual(rest.scale,[1,1]);assert.equal(rest.wave[0],0,'Wave released');
  console.log('PASS navigation refraction and .drape-wave scale drive a 60 Hz presentation, then back to 15 Hz');

  /* ---------- resize ---------- */
  for(const size of [{width:900,height:650},{width:1920,height:1080},{width:1280,height:800}]){
   await page.setViewportSize(size);
   assert(await until(()=>page.evaluate(()=>{const s=document.querySelector('.drape-host canvas').__drapeState();return s.outputWidth===innerWidth&&s.outputHeight===innerHeight&&s.fieldWidth===320&&!s.dirty;}),5000,50),'Resize to '+size.width);
  }
  assert.deepEqual(errors,[]);await page.close();
  console.log('PASS resize keeps whole native pixels and the 320 px field');

  /* ---------- DPR 2, reduced motion, Welcome ---------- */
  const d=await openApp(browser,server,host(),{width:900,height:650,scale:2,motion:true});
  await d.page.waitForFunction(()=>window.__atmo.review.scene()?.frame>=1);
  assert(await d.page.evaluate(()=>{const s=window.__atmo.review.scene();return s.width===1800&&s.height===1300&&s.viewport[2]===1800&&s.viewport[3]===1300;}),'DPR 2: 1800×1300 drawing buffer');
  assert.deepEqual(d.errors,[]);await d.page.close();
  const r=await openApp(browser,server,host(),{width:1280,height:800});
  await r.page.evaluate(()=>window.__renderBudget.setFocused(true));await r.page.waitForTimeout(300);
  const r1=await r.page.evaluate(()=>document.querySelector('.drape-host canvas').__drapeState());await r.page.waitForTimeout(600);
  const r2=await r.page.evaluate(()=>document.querySelector('.drape-host canvas').__drapeState());
  assert.equal(r2.state,'sleep');assert(r1.presentations>=1,'Reduced motion still shows a still image');assert.equal(r2.generations,r1.generations,'Reduced motion: no animation');
  const still=await stats(r.page,40);assert(still.mean>.035,'The still image is the same field');
  assert.deepEqual(r.errors,[]);await r.page.close();
  const w=await openApp(browser,server,host(),{width:1280,height:800,motion:true,welcome:true});
  await w.page.evaluate(()=>window.__renderBudget.setFocused(true));
  await w.page.waitForFunction(()=>document.body.classList.contains('welcome-active'));await w.page.waitForTimeout(400);
  const w1=await w.page.evaluate(()=>document.querySelector('.drape-host canvas').__drapeState());await w.page.waitForTimeout(400);
  const w2=await w.page.evaluate(()=>document.querySelector('.drape-host canvas').__drapeState());
  assert.equal(w2.state,'suspended');assert.equal(w2.generations,w1.generations,'Welcome covers Home: no work');
  assert.deepEqual(w.errors,[]);await w.page.close();
  console.log('PASS DPR 2 sizing, reduced motion still image, Welcome suspension, no frontend errors');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
