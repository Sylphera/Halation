// A cancelled hover tween must not leave the SVG geometry loop running.
// Functional lifecycle check only; no screenshots or synthetic GPU claim.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {serve,launch,openApp,sleep}=require('./common'),{createHost}=require('./host');
(async()=>{
 const server=serve(),browser=await launch(),host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),'hal-dock-life-')));
 try{
  const {page,errors}=await openApp(browser,server,host,{motion:true,init:()=>{
   window.__dockSteps=0;const request=requestAnimationFrame.bind(window);
   window.requestAnimationFrame=fn=>request(t=>{if(fn.name==='step')window.__dockSteps++;fn(t);});
  }});
  const hover=tab=>page.locator('.rail .tab[data-tab='+tab+']').hover();
  await hover('home');await sleep(600);await hover('grade');await sleep(35);
  const interrupted=await page.evaluate(()=>{
   const pill=document.querySelector('.rail .hover-selector'),t=pill._gl.t;
   const state={active:t.isActive(),progress:t.progress()};window.__motion.gsap.killTweensOf(pill);return state;
  });
  assert(interrupted.active&&interrupted.progress<1,'Interrupt an actual moving tween');
  await page.mouse.move(700,500);await sleep(800);
  const before=await page.evaluate(()=>window.__dockSteps);await sleep(700);
  assert.equal(await page.evaluate(()=>window.__dockSteps),before,'Cancelled glide cannot keep the geometry loop alive');
  // A later hover must still wake the geometry loop, finish and stop normally.
  await hover('home');await sleep(800);await hover('grade');await sleep(100);
  assert(await page.evaluate(()=>window.__dockSteps)>before,'Later hover resumes surface tracking');
  await page.mouse.move(700,500);await sleep(800);const settled=await page.evaluate(()=>window.__dockSteps);await sleep(700);
  assert.equal(await page.evaluate(()=>window.__dockSteps),settled,'Completed hover sleeps');
  assert.deepEqual(errors,[]);console.log('PASS cancelled hover has no residual geometry loop; later hover resumes and settles');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
