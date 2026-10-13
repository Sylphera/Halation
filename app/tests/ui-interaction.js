// Retained Thread2 scope only. No pulse/grain/shader API calls and no renderer-specific video capture.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert');
const {serve,launch,openApp,sleep,until}=require('./common');const {createHost}=require('./host');
const OUT=process.env.SHOTS||path.join(os.tmpdir(),'halation-ui-interaction');fs.mkdirSync(OUT,{recursive:true});
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const event=(page,type,image=false)=>page.evaluate(({type,image,png})=>{
 const dt=new DataTransfer();dt.items.add(image?new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],'review.png',{type:'image/png'}):new File(['x'],'drag.wav',{type:'audio/wav'}));
 window.dispatchEvent(new DragEvent(type,{dataTransfer:dt,clientX:790,clientY:500,bubbles:true,cancelable:true}));
},{type,image,png:PNG});
async function settled(page){assert(await until(()=>page.evaluate(()=>!window.__motion.busy()),5000,20),'motion settles');}
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hal-ui-')),host=createHost(tmp),server=serve(),browser=await launch(),checks=[];
 const ok=(condition,name)=>{assert(condition,name);checks.push(name);};
 fs.writeFileSync(path.join(host.base,'Settings','app.json'),JSON.stringify({settings:{language:'en'}}));
 try{
  const app=await openApp(browser,server,host,{motion:true,width:1280,height:800}),{page}=app;await settled(page);
  await event(page,'dragenter');await sleep(120);
  ok(await page.locator('#homeDrop').evaluate(e=>getComputedStyle(e).transform!=='none'),'Home surface yields');
  const continuity=await page.evaluate(()=>{
   const el=document.querySelector('#homeDrop'),read=()=>({width:el.offsetWidth,height:el.offsetHeight,transform:getComputedStyle(el).transform}),before=read(),dt=new DataTransfer();dt.items.add(new File(['x'],'drag.wav',{type:'audio/wav'}));
   for(const type of ['dragleave','dragenter'])window.dispatchEvent(new DragEvent(type,{dataTransfer:dt,clientX:790,clientY:500}));return {before,after:read()};
  });
  assert.deepStrictEqual(continuity.before,continuity.after);checks.push('interrupted drag retains exact current pose and layout');
  await event(page,'drop',true);await settled(page);
  ok(await page.locator('#homeDrop').evaluate(e=>e.classList.contains('choosing')),'image drop uses existing Home choice');
  ok(await page.locator('#homeDrop').evaluate(e=>!e.style.transform),'drop returns to stylesheet rest');
  await page.locator('#homeChoiceActs [data-to=cancel]').click();
  for(const name of ['library','settings','home']){await app.tab(name);await settled(page);}
  const centered=await page.evaluate(async()=>{
   const poses=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
   for(const name of ['library','settings','home']){
    document.querySelector('.rail .tab[data-tab='+name+']').click();
    const el=document.querySelector('#v-'+name),t=window.gsap.globalTimeline.getChildren(true,true,false).find(t=>t.targets().includes(el)&&'scaleX' in t.vars);
    poses.push({name,x:t?.vars.x,y:t?.vars.y,scaleX:t?.vars.scaleX});await wait(40);
   }return poses;
  });
  ok(centered.every(p=>p.x===0&&p.y===0&&p.scaleX>1&&p.scaleX<1.005),'navigation stretch stays centered without lateral translation');
  await settled(page);ok(await page.locator('.view.leaving').count()===0,'rapid navigation cleans outgoing views');
  await app.tab('library');await settled(page);await event(page,'dragenter');await sleep(100);
  ok(await page.locator('#views').evaluate(e=>getComputedStyle(e).transform!=='none'),'persistent content surface yields outside Home');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await settled(page);
  ok(await page.locator('#views').evaluate(e=>!e.style.transform),'blur releases content surface');
  await event(page,'dragenter');await settled(page);await page.evaluate(()=>document.documentElement.dataset.motion='reduce');await sleep(30);
  ok(await page.locator('#views').evaluate(e=>getComputedStyle(e).transform==='none'),'activating reduced motion releases held transform');
  await event(page,'dragleave');await page.evaluate(()=>delete document.documentElement.dataset.motion);
  await app.tab('home');await settled(page);await page.evaluate(()=>document.documentElement.dataset.motion='reduce');await event(page,'dragenter');await sleep(100);
  ok(await page.locator('#homeDrop').evaluate(e=>getComputedStyle(e).transform==='none'),'reduced-motion drag stays still');await event(page,'dragleave');
  await page.evaluate(()=>delete document.documentElement.dataset.motion);
  await app.tab('library');await settled(page);await app.tab('home');await sleep(40);
  ok(await page.locator('.auralis-host .auralis-wave').evaluate(e=>getComputedStyle(e).transform!=='none'),'returning Home deforms the Auralis field without changing shader');
  ok(await page.locator('.auralis-host canvas').evaluate(e=>getComputedStyle(e).transform==='none'&&getComputedStyle(e.parentElement).transform==='none'),'Auralis canvas never moves during the wave (no black edges)');
  const waveContinuity=await page.evaluate(()=>{
   const e=document.querySelector('.auralis-host .auralis-wave'),c=document.querySelector('.auralis-host canvas'),read=()=>({transform:getComputedStyle(e).transform,width:c.width,height:c.height}),before=read();
   document.querySelector('.rail .tab[data-tab=library]').click();return {before,after:read()};
  });
  assert.deepStrictEqual(waveContinuity.before,waveContinuity.after);checks.push('interrupted wave retains exact current pose and buffer');
  await settled(page);
  ok(await page.locator('.auralis-host .auralis-wave').evaluate(e=>!e.style.transform),'wave restores exact resting canvas transform');
  await app.tab('grade');await settled(page);
  ok(await until(()=>page.evaluate(()=>getComputedStyle(document.querySelector('.auralis-host')).visibility==='hidden'),5000,20),'Grade keeps Auralis hidden at rest');
  ok(await page.locator('.tool-atmo').evaluate(e=>getComputedStyle(e).transform==='none'),'own tool canvas remains untransformed');
  await app.tab('home');await sleep(30);await page.evaluate(()=>document.documentElement.dataset.motion='reduce');await sleep(30);
  ok(await page.locator('.auralis-host .auralis-wave').evaluate(e=>getComputedStyle(e).transform==='none'),'reduced motion releases active background wave');
  await settled(page);await app.tab('library');await settled(page);
  ok(await page.locator('.auralis-host .auralis-wave').evaluate(e=>getComputedStyle(e).transform==='none'),'reduced navigation produces no background deformation');
  ok(!app.errors.length,'no frontend errors');
  fs.writeFileSync(path.join(OUT,'ui-interaction-wave.json'),JSON.stringify({checks,centered,continuity,waveContinuity,errors:app.errors,scope:'physical drop plus Auralis navigation deformation; own tool canvas and source preserved'},null,2));
  await page.close();console.log('OK retained UI interaction:',checks.join('; '));
 }finally{await browser.close();server.close();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
