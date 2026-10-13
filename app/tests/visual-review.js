// Shared capture contract: native pixels, recorded live geometry/state, full context for diagnostic crops.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {execFileSync}=require('child_process');
const attached=new WeakMap();let locatorInstalled=false;
const sources=Object.fromEntries(['atmosphere.js','auralis.js','blue-noise.js','shell.css','motion.js','tokens.css','processes.js','index.html'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../dist',f))).digest('hex')]));
async function waitPresentation(page){
 const end=Date.now()+15000;
 while(Date.now()<end){
  const ready=await page.evaluate(async()=>{
   const s=await (window.__atmo?.review||window.__atmo?.grainTest)?.scene?.(),c=document.querySelector('.atmo canvas')||document.querySelector('.atmo'),g=document.querySelector('.grain canvas');
   if(s?.renderer==='auralis')return c.width===s.width&&c.height===s.height&&s.bufferWidth===s.width&&s.bufferHeight===s.height&&s.viewport[2]===s.width&&s.viewport[3]===s.height;
   if(c?.hidden&&(!g||g.parentElement.hidden))return true;
   return !!s&&c.width===s.width&&c.height===s.height&&g.width===Math.round(innerWidth*devicePixelRatio)&&g.height===Math.round(innerHeight*devicePixelRatio);
  });
  if(ready)return;
  await new Promise(r=>setTimeout(r,50));
 }
 throw Error('Review cannot start before the OffscreenCanvas presentation matches its WebGL drawing dimensions');
}
async function state(page){
 const root=await page.evaluate(()=>{
  const rect=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,transform:s.transform,zoom:s.zoom};};
  return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visualScale:visualViewport.scale},root:{body:rect(document.body),html:rect(document.documentElement)},motion:document.documentElement.dataset.motion||'',systemReduce:matchMedia('(prefers-reduced-motion: reduce)').matches,variant:window.__atmo?.variant,
   canvas:[...document.querySelectorAll('canvas')].map(e=>({className:e.className,width:e.width,height:e.height,css:rect(e)}))};
 });
 const scene=await page.evaluate(()=>(window.__atmo?.review||window.__atmo?.grainTest)?.scene?.()).catch(()=>null);
 const toolScene=await page.evaluate(()=>(window.__atmo?.toolReview||window.__atmo?.grainTest)?.scene?.()).catch(()=>null);
 const frames=await Promise.all(page.frames().filter(f=>f!==page.mainFrame()).map(async f=>({url:f.url(),...await f.evaluate(()=>{
  const css=e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:b.x,y:b.y,width:b.width,height:b.height,transform:s.transform,zoom:s.zoom};};
  return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},canvas:[...document.querySelectorAll('canvas')].map(e=>({id:e.id,width:e.width,height:e.height,css:css(e)}))};
 }).catch(()=>({unavailable:true}))})));
 return {...root,frames,scene,toolScene,sources:{...sources,...page.__reviewSources}};
}
function pngSize(buf){return buf.length>24&&buf.subarray(1,4).toString()==='PNG'?{width:buf.readUInt32BE(16),height:buf.readUInt32BE(20)}:null;}
async function capture(page,original,options={},element=false){
 await waitPresentation(page);
 const before=await state(page),diagnostic=element||!!(options.clip||options.mask?.length||options.style||options.omitBackground||options.fullPage||options.scale==='css'||options.type==='jpeg'||/\.jpe?g$/i.test(options.path||''));
 if(options.animations==='disabled')throw Error('Visual review cannot disable animations during capture');
 const result=await original({...options,animations:'allow',scale:options.scale||'device'});
 const after=await state(page);
 if(JSON.stringify(before.viewport)!==JSON.stringify(after.viewport))throw Error('Viewport/DPR changed during visual capture');
 const size=pngSize(result),v=before.viewport;
 if(!diagnostic&&size&&(size.width!==Math.round(v.width*v.dpr)||size.height!==Math.round(v.height*v.dpr)))throw Error('Screenshot physical dimensions do not match the live viewport/DPR');
 const metadata={kind:diagnostic?'diagnostic-detail':'full-live-viewport',before,after,pixels:size,options:{clip:options.clip||null,scale:options.scale||'device',fullPage:!!options.fullPage,masked:!!options.mask?.length},nativeRuntime:'Frontend in Chromium with test backend; does not certify Windows WebView2/GPU or an external user session.'};
 if(options.path){
  fs.writeFileSync(options.path+'.review.json',JSON.stringify(metadata,null,2));
  if(diagnostic){
   const context=options.path+'.context.png',png=await attached.get(page).original({path:context,type:'png',animations:'allow',scale:'device'});
   fs.writeFileSync(context+'.review.json',JSON.stringify({kind:'full-live-viewport',state:await state(page),pixels:pngSize(png),detail:options.path},null,2));
  }
 }
 return result;
}
async function attach(page){
 if(attached.has(page))return;
 const original=page.screenshot.bind(page);attached.set(page,{original});
 await page.addInitScript(()=>window.__halVisualTest=true);
 page.screenshot=options=>capture(page,original,options);
 if(!locatorInstalled){
  const proto=Object.getPrototypeOf(page.locator('html')),shot=proto.screenshot;
  proto.screenshot=function(options){const p=this.page();return attached.has(p)?capture(p,o=>shot.call(this,o),options,true):shot.call(this,options);};
  locatorInstalled=true;
 }
}
async function prepareTimeline(page,phase,leadMs=16,clockInstalled=false){
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForFunction(()=>!window.__motion?.busy?.()&&document.getAnimations().every(a=>a.playState!=='running'||a.effect.getTiming().iterations===Infinity),null,{timeout:15000});
 const epoch=Date.now();if(!clockInstalled)await page.clock.install({time:new Date(epoch)});await page.clock.pauseAt(new Date(Date.now()+leadMs));
 const css=[];
 for(const f of page.frames()){
  const phases=await f.evaluate(replay=>{
   const G=window.gsap;if(G){G.ticker.remove(G.updateRoot);G.ticker.sleep();window.__reviewRootTime=G.globalTimeline.time();}
   window.__reviewAnimations=new Map();
   return document.getAnimations().map(a=>{
    let e=a.effect.target,parts=[];while(e&&e.nodeType===1){if(e.id){parts.unshift('#'+e.id);break;}parts.unshift(e.tagName+':'+Array.from(e.parentElement?.children||[]).indexOf(e));e=e.parentElement;}
    const name=a.animationName||a.constructor.name,key=parts.join('/')+'|'+name+'|'+(a.transitionProperty||'');
    const match=replay?.find(p=>p.key===key),time=match?match.time:(a.currentTime||0);
    a.pause();a.currentTime=time;window.__reviewAnimations.set(a,{at:0,time});return {key,name,time};
   });
  },phase?.[css.length]);css.push(phases);
 }
 return {css,clockMs:0};
}
async function stepTimeline(page,clock,frame,fps=60){
 const ms=Math.floor(frame*1000/fps);if(ms>clock.clockMs)await page.clock.runFor(ms-clock.clockMs);clock.clockMs=ms;
 for(const f of page.frames())await f.evaluate(({seconds,ms})=>{
  const G=window.gsap;if(G){G.ticker.sleep();G.updateRoot(window.__reviewRootTime+seconds);}
  for(const a of document.getAnimations()){
   if(!window.__reviewAnimations.has(a))window.__reviewAnimations.set(a,{at:ms,time:a.currentTime||0});
   const b=window.__reviewAnimations.get(a);a.pause();a.currentTime=b.time+ms-b.at;
  }
 },{seconds:frame/fps,ms:frame*1000/fps});
}
function encodeVideo(frames,output,fps=60){
 // VP9 RGB is pixel-exact both in FFmpeg and Chromium. H.264 RGB is misinterpreted by Chromium.
 execFileSync('ffmpeg',['-v','error','-y','-framerate',String(fps),'-i',path.join(frames,'%04d.png'),'-c:v','libvpx-vp9','-lossless','1','-pix_fmt','gbrp','-colorspace','rgb','-color_range','pc','-deadline','realtime','-cpu-used','8','-row-mt','1','-threads','2',output]);
}
module.exports={attach,state,pngSize,prepareTimeline,stepTimeline,waitPresentation,encodeVideo};
