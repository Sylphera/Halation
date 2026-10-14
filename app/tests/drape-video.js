// Render the actual frontend at controlled clock times, without changing Drape.
const fs=require('fs'),path=require('path'),assert=require('assert');
const {serve,launch,openApp,until}=require('./common'),{newHost}=require('./scan');
const review=require('./visual-review');
const out=path.resolve(__dirname,'../../review/drape'),frames=path.join(out,'navigation');fs.mkdirSync(frames,{recursive:true});
(async()=>{
 const server=serve(),browser=await launch();
 try {
  const {host}=newHost('en'),{page,errors}=await openApp(browser,server,host,{width:960,height:640,motion:true});
  await page.waitForFunction(()=>window.__atmo.review.scene()?.frame>1);
  await until(()=>page.evaluate(()=>!window.__motion.busy()),5000,20);
  const live=await page.evaluate(()=>window.__atmo.review.scene());
  const clock=await review.prepareTimeline(page);
  const replay=await page.evaluate(s=>window.__atmo.review.sceneAt(s),live);
  assert.deepStrictEqual(replay,live,'Scene uniforms, geometry and phase must match the live run');
  const manifest={live,replay,fps:60,frames:100,events:[],source:(await review.state(page)).sources};
  for(let i=0;i<100;i++){
   if([12,45,60,80].includes(i)){
    const name=i===12?'library':i===45?'settings':'home';
    await page.evaluate(n=>document.querySelector(`.rail .tab[data-tab="${n}"]`).click(),name);
    manifest.events.push({frame:i,name});
   }
   await review.stepTimeline(page,clock,i);
   await page.evaluate(({live,i})=>window.__atmo.review.sceneAt({...live,time:live.time+i/60*.05,frame:(live.frame+i)%4096}),{live,i});
   await page.screenshot({path:path.join(frames,String(i).padStart(4,'0')+'.png')});
  }
  // An interrupted/restored frame carries component time through the bounded delta.
  const before=await page.evaluate(()=>window.__atmo.review.scene());
  await page.clock.fastForward(10000);
  const after=await page.evaluate(()=>window.__atmo.review.scene());
  assert(after.time-before.time<.011,'A resumed frame must bound the elapsed clock instead of jumping ten seconds');
  manifest.resume={before,after};assert(!errors.length,errors.join('\n'));
  fs.writeFileSync(path.join(out,'navigation-timeline.json'),JSON.stringify(manifest,null,2));
  review.encodeVideo(frames,path.join(out,'navigation.webm'),60);
  console.log('PASS Drape live scene parity, controlled navigation/interruption video, bounded resumed clock');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
