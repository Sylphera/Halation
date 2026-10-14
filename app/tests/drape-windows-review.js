// Fresh actual-frontend exports requested by the user: PNG and Windows-compatible H.264 MP4.
// This explicitly supersedes the prior VP9 review encoding requirement for this export only.
const fs=require('fs'),path=require('path'),assert=require('assert'),cp=require('child_process');
const {serve,launch,openApp,painted,until}=require('./common'),{newHost}=require('./scan');
const review=require('./visual-review');
const out=path.resolve(__dirname,'../../review/drape-grain2-windows'),frames=path.join(out,'source-frames');fs.mkdirSync(frames,{recursive:true});
(async()=>{
 const server=serve(),browser=await launch();
 try{
  const {host}=newHost('en'),{page,tab,errors}=await openApp(browser,server,host,{width:1280,height:800,motion:true});
  await page.waitForFunction(()=>window.__atmo?.review?.scene()?.frame>1);
  await painted(page);await page.screenshot({path:path.join(out,'home.png')});
  for(const n of ['grade']){await tab(n);await painted(page);await page.screenshot({path:path.join(out,n+'.png')});}
  await tab('home');await page.setViewportSize({width:1920,height:1080});await painted(page);
  await page.screenshot({path:path.join(out,'home-1920.png')});
  await page.setViewportSize({width:960,height:640});await painted(page);
  await until(()=>page.evaluate(()=>!window.__motion.busy()),5000,20);
  const clock=await review.prepareTimeline(page),live=await page.evaluate(()=>window.__atmo.review.scene());
  const toolLive=await page.evaluate(()=>window.__atmo.toolReview.scene());
  const toolReplay=await page.evaluate(s=>window.__atmo.toolReview.sceneAt(s),toolLive);assert.deepStrictEqual(toolReplay,toolLive);
  const replay=await page.evaluate(s=>window.__atmo.review.sceneAt(s),live);assert.deepStrictEqual(replay,live);
  const manifest={live,replay,toolLive,toolReplay,frames:100,fps:60,events:[],source:(await review.state(page)).sources, drapeFrames:[], drapeTiming:"Unmodified component rAF executes on controlled page clock; no synthetic shader time/bias",
   userEncodingOverride:'MP4 H.264 required for Windows review; prior WebM is no longer the review deliverable',
   encoding:{codec:'H.264',profile:'Main',level:'4.0',pixelFormat:'yuv420p',colorMatrix:'BT.709',range:'limited',faststart:true,crf:16}};
  for(let i=0;i<100;i++){
   if([12,45,60,80].includes(i)){const n=i===12?'library':i===45?'settings':'home';await page.evaluate(n=>document.querySelector(`.rail .tab[data-tab="${n}"]`).click(),n);manifest.events.push({frame:i,name:n});}
   await review.stepTimeline(page,clock,i);
   manifest.drapeFrames.push(await page.evaluate(()=>window.__atmo.review.scene()));
   await page.evaluate(({toolLive,i})=>window.__atmo.toolReview.sceneAt({time:toolLive.time+i/60,at:toolLive.at+i*1000/60}),{toolLive,i});
   // Clock remains fixed; let the worker's submitted image reach the OffscreenCanvas placeholder.
   await page.waitForTimeout(150);
   await page.screenshot({path:path.join(frames,String(i).padStart(4,'0')+'.png')});
  }
  assert(!errors.length,errors.join('\n'));
  cp.execFileSync('ffmpeg',['-v','error','-y','-framerate','60','-i',path.join(frames,'%04d.png'),
   '-vf','scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p',
   '-c:v','libx264','-preset','fast','-crf','16','-profile:v','main','-level:v','4.0',
   '-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709',
   '-movflags','+faststart',path.join(out,'navigation.mp4')]);
  fs.writeFileSync(path.join(out,'timeline.json'),JSON.stringify(manifest,null,2));
  console.log('PASS fresh actual-frontend PNG and controlled-clock MP4 export:',out);
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
