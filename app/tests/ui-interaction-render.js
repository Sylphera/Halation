// Compatible retained UI evidence. Source component rAF stays on a clock installed BEFORE mount.
// Latest user output format: native PNG and Windows-compatible MP4/H.264, not historical WebM.
const fs=require('fs'),path=require('path'),assert=require('assert'),cp=require('child_process'),crypto=require('crypto');
const {serve,launch,openApp,painted,until}=require('./common');const {createHost}=require('./host');
const os=require('os'),review=require('./visual-review');
const geometry=require('./ui-review-config'),OUT=geometry.out;fs.mkdirSync(OUT,{recursive:true});
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
async function encode(dir,file){cp.execFileSync('ffmpeg',['-v','error','-y','-framerate','60','-i',path.join(dir,'%04d.png'),'-vf','scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p','-c:v','libx264','-preset','fast','-crf','16','-profile:v','main','-level:v','4.0','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-movflags','+faststart',file]);}
async function render(browser,server,host,name){
 const wrapper={newPage:async opts=>{const p=await browser.newPage(opts);await p.clock.install({time:new Date()});return p;}};
 const app=await openApp(wrapper,server,host,{width:geometry.width,height:geometry.height,scale:geometry.previewDpr,motion:true}),{page}=app;
 page.__reviewSources={'shell.js':crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../dist/shell.js'))).digest('hex')};
 await page.waitForFunction(()=>window.__atmo?.review?.scene()?.frame>2);await painted(page);
 assert(await until(()=>page.evaluate(()=>!window.__motion.busy()),5000,20));
 const liveBefore=await review.state(page),clock=await review.prepareTimeline(page,undefined,16,true);
 const live=await page.evaluate(()=>window.__atmo.review.scene()),toolLive=await page.evaluate(()=>window.__atmo.toolReview.scene());
 const replay=await page.evaluate(s=>window.__atmo.review.sceneAt(s),live),toolReplay=await page.evaluate(s=>window.__atmo.toolReview.sceneAt(s),toolLive);
 assert.deepStrictEqual(replay,live);assert.deepStrictEqual(toolReplay,toolLive);
 const prepared=await review.state(page);assert.deepStrictEqual(prepared.viewport,liveBefore.viewport);assert.deepStrictEqual(prepared.root,liveBefore.root);assert(prepared.viewport.width===geometry.width&&prepared.viewport.height===geometry.height&&prepared.viewport.dpr===geometry.previewDpr);
 const fonts=await page.evaluate(()=>({faces:[...document.fonts].map(f=>({family:f.family,weight:f.weight,status:f.status})),body:getComputedStyle(document.body).fontFamily,zoom:getComputedStyle(document.body).zoom}));assert(fonts.zoom==='1');
 const dir=path.join(OUT,name+'-frames');fs.mkdirSync(dir,{recursive:true});
 const report={name,base:'b87fd93',scope:'physical drop plus new external Drape canvas navigation deformation; source grain2 and own tool shader unchanged',geometry,fonts,preview:'CSS layout1920x1080 unchanged; DPR0.5 physical960x540 reduces test render pixels. Grain/detail may differ from native DPR1; not a native-detail approval image.',live,replay,toolLive,toolReplay,liveBefore,prepared,frames:120,fps:60,events:[],sceneFrames:[],waveFrames:[],sources:prepared.sources,clock:'Installed before mount; unmodified Drape component rAF/bias/time executes on controlled page clock',encoding:'Shared encoder VP9 lossless RGB plus extra H264 Main/yuv420p BT709 limited CRF16 faststart; no application color compensation',nativeWindowsPlayback:'Separate local observation required; this renderer makes no local playback claim'};
 const fire=async (type,image=false,x=790,y=500)=>page.evaluate(({type,image,x,y,png})=>{const dt=new DataTransfer();dt.items.add(image?new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],'review.png',{type:'image/png'}):new File(['x'],'drag.wav',{type:'audio/wav'}));window.dispatchEvent(new DragEvent(type,{dataTransfer:dt,clientX:x,clientY:y,bubbles:true,cancelable:true}));},{type,image,x,y,png:PNG});
 let last=live.time;
 for(let n=0;n<120;n++){
  if(name==='navigation'&&[12,34,40,82].includes(n)){
   const tab=n===12?'grade':n===34?'settings':'home';await page.evaluate(tab=>document.querySelector('.rail .tab[data-tab='+tab+']').click(),tab);report.events.push({frame:n,tab});
  }
  if(name==='drop'){
   if(n===12){await fire('dragenter');report.events.push({frame:n,action:'dragenter'});}
   if(n===30){await fire('dragover',false,590,520);report.events.push({frame:n,action:'dragover'});}
   if(n===50){await fire('drop',true);report.events.push({frame:n,action:'image drop'});}
   if(n===92){await page.evaluate(()=>document.querySelector('#homeChoiceActs [data-to=cancel]').click());report.events.push({frame:n,action:'cancel image choice'});}
  }
  await review.stepTimeline(page,clock,n);
  const scene=await page.evaluate(()=>window.__atmo.review.scene());assert(scene.time>=0&&scene.time>=last,'Drape source time rewound in evidence');last=scene.time;report.sceneFrames.push(scene);
  report.waveFrames.push(await page.evaluate(()=>{const c=document.querySelector('.drape-host .drape-wave'),s=getComputedStyle(c),m=new DOMMatrixReadOnly(s.transform);return {transform:s.transform,scaleX:m.a,scaleY:m.d,width:document.querySelector('.drape-host canvas').width,height:document.querySelector('.drape-host canvas').height,toolTransform:getComputedStyle(document.querySelector('.tool-atmo')).transform};}));
  await page.evaluate(({s,n})=>window.__atmo.toolReview.sceneAt({time:s.time+n/60,at:s.at+n*1000/60}),{s:toolLive,n});
  await page.waitForTimeout(150);await page.screenshot({path:path.join(dir,String(n).padStart(4,'0')+'.png')});
  if([0,24,60,119].includes(n))await page.screenshot({path:path.join(OUT,name+'-'+n+'.png')});
 }
 assert(report.waveFrames.every(s=>s.scaleX>=.999&&s.scaleX<=1.019&&s.scaleY>=.999&&s.scaleY<=1.009&&s.toolTransform==='none'),'Wave stays bounded and tool canvas stays untouched');
 if(name==='navigation'){assert(report.waveFrames.some(s=>s.scaleX>1.005),'Navigation footage must show actual Drape deformation');assert(report.waveFrames[119].transform==='none','Navigation canvas must return exactly to approved resting pose');}
 assert(!app.errors.length,app.errors.join('\n'));report.errors=app.errors;fs.writeFileSync(path.join(OUT,name+'-timeline.json'),JSON.stringify(report,null,2));
 await page.close();review.encodeVideo(dir,path.join(OUT,name+'.webm'),60);await encode(dir,path.join(OUT,name+'.mp4'));
}
async function nativeStills(browser,server,host){
 const app=await openApp(browser,server,host,{width:geometry.width,height:geometry.height,scale:geometry.nativeDpr,motion:true}),{page}=app;
 page.__reviewSources={'shell.js':crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../dist/shell.js'))).digest('hex')};
 const out=path.join(OUT,'native-stills');fs.mkdirSync(out,{recursive:true});const states=[];
 const shot=async name=>{await painted(page);assert(await until(()=>page.evaluate(()=>!window.__motion.busy()),5000,20));const state=await review.state(page);assert(state.viewport.width===1920&&state.viewport.height===1080&&state.viewport.dpr===1);const fonts=await page.evaluate(()=>({faces:[...document.fonts].map(f=>({family:f.family,weight:f.weight,status:f.status})),body:getComputedStyle(document.body).fontFamily,zoom:getComputedStyle(document.body).zoom}));assert(fonts.zoom==='1');await page.screenshot({path:path.join(out,name+'.png')});states.push({name,state,fonts});};
 await page.waitForFunction(()=>window.__atmo?.review?.scene()?.frame>2);await shot('home');
 const drag=async(type,image=false)=>page.evaluate(({type,image,png})=>{const e=document.querySelector('#homeDrop'),r=e.getBoundingClientRect(),dt=new DataTransfer();dt.items.add(image?new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],'review.png',{type:'image/png'}):new File(['x'],'drag.wav',{type:'audio/wav'}));window.dispatchEvent(new DragEvent(type,{dataTransfer:dt,clientX:r.x+r.width/2,clientY:r.y+r.height/2,bubbles:true,cancelable:true}));},{type,image,png:PNG});
 await drag('dragenter');await shot('home-drag');await drag('drop',true);await shot('image-choice');await page.locator('#homeChoiceActs [data-to=cancel]').click();
 await app.tab('library');await shot('library-own-background');assert(!app.errors.length,app.errors.join('\n'));
 fs.writeFileSync(path.join(out,'context.json'),JSON.stringify({geometry,states,detail:'Native DPR1 stills only; preview DPR0.5 may differ in grain/sharpness. No resized frame, CSS zoom or application changes.',errors:app.errors},null,2));await page.close();
}
(async()=>{const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hal-ui-render-')),host=createHost(tmp),server=serve(),browser=await launch();try{for(const name of ['navigation','drop'])await render(browser,server,host,name);await nativeStills(browser,server,host);console.log('PASS CSS1920x1080 DPR0.5 preview MP4 and separate native DPR1 PNGs; unchanged Drape source time monotonic');}finally{await browser.close();server.close();fs.rmSync(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
