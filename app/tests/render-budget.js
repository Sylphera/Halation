// Functional lifecycle regressions; no screenshots, video, or visual approval substitute.
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),assert=require('assert/strict');
const {serve,launch,openApp}=require('./common'),{createHost}=require('./host');
async function nativeBridgeTest(){
 const events={},state={focused:null,minimized:null};let focused=false,minimized=false;
 let nativeFocusChanged;const native={isFocused:async()=>focused,isMinimized:async()=>minimized,onFocusChanged:fn=>nativeFocusChanged=fn,onResized(){}};
 const context={T:{window:{getCurrentWindow:()=>native}},window:{__renderBudget:{setFocused:v=>state.focused=v,setMinimized:v=>state.minimized=v}},addEventListener:(name,fn)=>events[name]=fn,console};
 const shell=fs.readFileSync(path.join(__dirname,'../dist/shell.js'),'utf8');
 vm.runInNewContext(shell.slice(shell.indexOf('const nativeWindow ='),shell.indexOf('// Tools left behind,')),context);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(state.focused,false);
 // Foreground can predate listener registration after reload: only the WebView focus event arrives.
 focused=true;await events.focus();assert.equal(state.focused,true,'DOM focus refreshes actual native state after reload');
 await nativeFocusChanged({payload:false});assert.equal(state.focused,true,'A stale native event cannot override the current native focus query');
 focused=false;await events.blur();assert.equal(state.focused,false);
 minimized=true;await events.resize();assert.equal(state.minimized,true);
 console.log('PASS native focus bridge refreshes stale reload state without a native focus event');
}
function clockTest(){
 let now=0,id=0,focused=true;const pending=new Map(),events={},attrs={};
 const styleValues=new Map();const root={dataset:{},style:{setProperty:(k,v)=>styleValues.set(k,v),getPropertyValue:k=>styleValues.get(k)}},doc={documentElement:root,hidden:false,hasFocus:()=>focused,addEventListener:(n,f)=>events[n]=f};
 const context={window:null,document:doc,navigator:{hardwareConcurrency:12,deviceMemory:8},performance:{now:()=>now},matchMedia:()=>({matches:false,addEventListener(){}}),MutationObserver:class{observe(){}},addEventListener:(n,f)=>events[n]=f,clearTimeout:i=>pending.delete(i),cancelAnimationFrame:i=>pending.delete(i)};
 context.setTimeout=(fn,ms)=>{pending.set(++id,{fn,at:now+Math.max(1,ms)});return id;};context.requestAnimationFrame=fn=>{pending.set(++id,{fn:()=>fn(now),at:(Math.floor(now/(1000/144))+1)*(1000/144)});return id;};context.window=context;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/render-budget.js'),'utf8'),context);
 const advance=ms=>{const end=now+ms;for(let n=0;n<10000;n++){const next=[...pending].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;pending.delete(next[0]);next[1].fn();}now=end;};
 const b=context.__renderBudget;let calls=0;const task=b.add(()=>calls++);task.start();advance(1000);assert(calls>=55&&calls<=62,'High decoration capped at60, independent of144Hz display');
 task.setFps(8);calls=0;advance(1000);assert(calls>=7&&calls<=9,'Explicit 8Hz budget');task.setFps(4);calls=0;advance(1000);assert(calls>=3&&calls<=5,'Explicit 4Hz under load');assert.throws(()=>task.setFps(0),/Invalid decorative/);assert.throws(()=>task.setFps(NaN),/Invalid decorative/);task.setFps(60);
 b.setLoad(3);calls=0;advance(1000);assert(calls>=28&&calls<=32);assert.equal(b.profile.name,'medium');task.setFps(15);calls=0;advance(1000);assert(calls>=14&&calls<=16,'Drape15Hz cadence is preserved under three-job pressure');task.setFps(60);
 b.setMinimized(true);const paused=calls;advance(2000);assert.equal(calls,paused);assert.equal(pending.size,0,'No clock while minimized');b.setMinimized(false);advance(200);assert(calls>paused);
 focused=false;events.blur();advance(2);calls=0;advance(1000);assert(calls<=6,'Unfocused decoration at5Hz');focused=true;events.focus();advance(2);b.setLoad(0);
 b.setFocused(false);focused=true;events.focus();advance(2);assert.equal(b.focused,false,'Native focus overrides stale WebView document focus');assert.equal(styleValues.get('--decorative-play-state'),'paused');b.setFocused(true);assert.equal(b.focused,true);assert.equal(styleValues.get('--decorative-play-state'),'running');
 task.dispose();advance(100);assert.equal(b.state().tasks,0);assert.equal(pending.size,0,'Dispose sleeps');
 let once=0;const single=b.add(()=>once++,{continuous:false});single.request();advance(200);assert.equal(once,1);single.dispose();console.log('PASS frame budget:60/30Hz,5Hz blur, minimize/resume, one-shot/dispose');
}
(async()=>{clockTest();await nativeBridgeTest();const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hal-budget-regression-')),host=createHost(tmp,{tools:{systemFfmpeg:process.env.FFMPEG||'ffmpeg',ffmpegSource:process.env.FFPROBE?path.join(path.dirname(process.env.FFPROBE),'ffmpeg.exe'):undefined}}),server=serve(),browser=await launch();
try{
 const app=await openApp({newPage:async o=>{const p=await browser.newPage(o);await p.addInitScript(()=>{window.__rafCount=0;window.__rafSources={};const raf=requestAnimationFrame;window.requestAnimationFrame=f=>raf(t=>{window.__rafCount++;window.__rafSources[f.name]=(window.__rafSources[f.name]||0)+1;f(t)});window.__audioContexts=[];const AC=AudioContext;window.AudioContext=class extends AC{constructor(...a){super(...a);window.__audioContexts.push(new WeakRef(this));}};});return p;}},server,host);
 const {page}=app,show=async id=>{await page.evaluate(async id=>{window.__shell.show(id);await window.__shell.ensureApp(id)},id);await page.waitForTimeout(350);};
 await show('visualizer');const vis=page.frames().find(f=>f.url().endsWith('/visualizer.html'));await page.waitForTimeout(2500);const start=await vis.evaluate(()=>window.__rafCount);await page.waitForTimeout(500);assert.equal(await vis.evaluate(()=>window.__rafCount),start,'Empty visible Visualizer has no perpetual rAF');
 await show('convert');const cv=page.frames().find(f=>f.url().endsWith('/convert.html')),wav=path.join(tmp,'tone.wav'),rate=22050,len=rate*4,buf=Buffer.alloc(44+len*2);buf.write('RIFF');buf.writeUInt32LE(buf.length-8,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(rate,24);buf.writeUInt32LE(rate*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(len*2,40);fs.writeFileSync(wav,buf);
 await page.evaluate(p=>window.__hal.invoke('session_allow_video',{path:p}),wav);await cv.evaluate(p=>window.__halApp.takeAudio({path:p,name:'tone.wav'}),wav);await cv.locator('.play').waitFor();await cv.locator('.play').click();await page.waitForTimeout(300);await show('home');await page.waitForTimeout(2500);const hidden=await cv.evaluate(()=>window.__rafCount);await page.waitForTimeout(600);assert.equal(await cv.evaluate(()=>window.__rafCount),hidden,'Hidden Converter stops audio/waveform and framing loops');
 await show('convert');await cv.locator('.play').click();await page.waitForTimeout(200);await page.evaluate(()=>window.__renderBudget.setMinimized(true));await page.waitForTimeout(2500);const min=await cv.evaluate(()=>window.__rafCount);await page.waitForTimeout(400);assert.equal(await cv.evaluate(()=>window.__rafCount),min,'Active tool pauses when native minimized signal arrives');await page.evaluate(()=>window.__renderBudget.setMinimized(false));
 // Replace the audio preview repeatedly: only its current context/observer may survive.
 for(let i=0;i<6;i++){
  await cv.locator('#changeBtn').click();
  await cv.waitForFunction(()=>window.__convert.C.items.length===0);
  await cv.evaluate(p=>window.__halApp.takeAudio({path:p,name:'replacement-'+Date.now()+'.wav'}),wav);
  await cv.locator('.play').waitFor();await page.waitForTimeout(100);
 }
 assert((await cv.evaluate(()=>window.__audioContexts.length))>=7,'Every replacement decoded its own audio preview');
 const contexts=await cv.evaluate(()=>window.__audioContexts.flatMap(r=>r.deref()?[r.deref().state]:[]));assert(contexts.filter(s=>s!=='closed').length<=1,'Repeated preview replacement closes AudioContexts');
 assert.deepEqual(app.errors,[]);console.log('PASS idle Visualizer; hidden Converter; native minimize/resume lifecycle');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1});
