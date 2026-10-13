// Reproducible runtime/resource measurement. No screenshots or video; only disposable mocked profiles.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { serve, openApp, chromium } = require('../tests/common');
const { createHost } = require('../tests/host');
const gpuSampler=require('./performance-gpu.cjs'),installAblation=require('./performance-ablation.cjs');
const label = process.argv[2] || 'before';
assert(/^[a-z0-9-]+$/i.test(label));
const out = path.resolve(__dirname, '../../docs/performance/frame-budget-111');
fs.mkdirSync(out, { recursive: true });
const component=process.env.HAL_PERF_COMPONENT||null,phase=process.env.HAL_PERF_PHASE||null;assert(!phase||['workers','auralis'].includes(phase));
const reuseLabel=process.env.HAL_PERF_REUSE_LABEL;assert(!reuseLabel||component==='retained-followup','Reuse is restricted to the retained-input follow-up');
function asset(file){let data=fs.readFileSync(file);
 if(process.env.HAL_PERF_MODEL_WHOLE==='1'&&path.basename(file)==='cutout-worker.js')return fs.readFileSync(path.join(__dirname,'fixtures/cutout-worker-whole.js'));
 if(process.env.HAL_PERF_MODEL_WHOLE==='1'&&path.basename(file)==='services.js'){let code=data.toString();const init=/      await modelFile\("wasm", st.cutout.wasm\);\r?\n      await modelFile\("decoder", st.cutout.decoder\);\r?\n      return call\("init", \{ config: MODEL, backend \}\);/;assert(init.test(code),'Whole-model control init anchor');code=code.replace(init,'      const [wasm,decoder]=await Promise.all([st.cutout.wasm,st.cutout.decoder].map(path=>invoke("read_path",{path}))); return call("init",{wasm,decoder,config:MODEL,backend},[wasm,decoder]);');const encoder='modelFile("encoder", e.encoderPath).then(() => call("encoder", {}))';assert(code.includes(encoder),'Whole-model control encoder anchor');data=Buffer.from(code.replace(encoder,'invoke("read_path",{path:e.encoderPath}).then(encoder=>call("encoder",{encoder},[encoder]))'));}

 if((process.env.HAL_PERF_GRADE_ORIGINAL_UPLOAD==='1'||process.env.HAL_PERF_GRADE_BITMAP==='1')&&path.basename(file)==='grade.js')data=Buffer.from(require('./fixtures/grade-source-control.cjs')(data.toString()));
 if(process.env.HAL_PERF_GRADE_BITMAP_WORKER==='1'&&path.basename(file)==='grade-lut-worker.js')data=Buffer.from(data.toString()+'\nconst original=self.onmessage;self.onmessage=async e=>{if(!e.data.source)return original(e);try{const bitmap=await createImageBitmap(e.data.source,{imageOrientation:"flipY",premultiplyAlpha:"none"});self.postMessage({bitmap},[bitmap]);}catch(error){self.postMessage({error:String(error)});}};');
 if(process.env.HAL_PERF_GRADE_BITMAP==='1'&&path.basename(file)==='grade.js'){const before='    uploadSource(el, el.naturalWidth, el.naturalHeight); uploadMask(null);';assert(data.toString().includes(before),'Grade bitmap control anchor');data=Buffer.from(data.toString().replace(before,'    const bitmap=await '+(process.env.HAL_PERF_GRADE_BITMAP_WORKER==='1'?'new Promise((resolve,reject)=>{const worker=new Worker(new URL("./grade-lut-worker.js",import.meta.url),{type:"module"});const timer=setTimeout(()=>{worker.terminate();reject(new Error("bitmap timeout"));},30000);worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();data.error?reject(new Error(data.error)):resolve(data.bitmap);};worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(new Error(e.message));};worker.postMessage({source:file});})':'createImageBitmap(el,{imageOrientation:"flipY",premultiplyAlpha:"none"})')+'; try { uploadSource(bitmap,el.naturalWidth,el.naturalHeight); } finally { bitmap.close(); } G.lastSrc={el,w:el.naturalWidth,h:el.naturalHeight}; uploadMask(null);'));}
 if(component==='keepalive'&&process.env.HAL_PERF_FORCE_KEEPALIVE==='1'&&path.basename(file)==='composition-keepalive.js'){const anchor='!hasLiveScene()';assert(data.toString().includes(anchor),'Keepalive force control anchor missing');data=Buffer.from(data.toString().replace(anchor,'true /* benchmark-only forced keepalive */'));}
 if(process.env.HAL_PERF_COPY_KB&&path.basename(file)==='services.js'){const kb=+process.env.HAL_PERF_COPY_KB;assert([256,512,1024,8192].includes(kb));const before='const chunk = 512 << 10;';assert(data.toString().includes(before),'Video copy chunk control anchor missing');data=Buffer.from(data.toString().replace(before,`const chunk = ${kb} << 10;`));}
 if(process.env.HAL_PERF_RETAINED_NO_AUTORUN==='1'&&path.basename(file)==='stems.js'){const anchor='else up.runAll(null);';assert(data.toString().includes(anchor),'Stems autorun control anchor missing');data=Buffer.from(data.toString().replace(anchor,'else { /* Retained-input control: keep the file waiting without automatically separating. */ }'));}
 if((process.env.HAL_PERF_RETAINED_NO_AUTORUN==='1'||process.env.HAL_PERF_NO_CUTOUT_PREP==='1')&&path.basename(file)==='removebg.js'){const anchor='else if (HAL && await HAL.cutoutReady()) ensureSam(false);';assert(data.toString().includes(anchor),'RemoveBG embedding control anchor missing');data=Buffer.from(data.toString().replace(anchor,'else { /* Retained-input control: no speculative model embedding. */ }'));}
 if(component==='process-ui'&&path.basename(file)==='shell.js'&&process.env.HAL_PERF_DOCK_LEGACY==='1')data=Buffer.from(data.toString().replace('tween?.parent && !tween.paused() ? Math.max(0, 1 - tween.progress()) : 0','tween ? Math.max(0, 1 - tween.progress()) : 0'));
 if(component==='process-ui'&&path.basename(file)==='processes.js'){let code=data.toString();for(const name of ['paint','fitTitle','place','resizeSurface','followSurface','render','patch','paintSys','onJobs'])code=code.replace(new RegExp('function '+name+'\\(([^)]*)\\) \\{','g'),m=>m+'window.__processUiCalls.'+name+'=(window.__processUiCalls.'+name+'||0)+1;');code=code.replace('const before = lastSig &&','window.__processUiCalls.renderVisible=(window.__processUiCalls.renderVisible||0)+1;const before = lastSig &&');data=Buffer.from(code);}
if(component==='auralis-grain'&&path.basename(file)==='auralis-renderer.js')return Buffer.from('window.__auralisGrainReference='+fs.readFileSync(path.join(__dirname,'fixtures/auralis-grain-reference.json'),'utf8')+';\n'+fs.readFileSync(path.join(__dirname,'auralis-grain-experiment.js'),'utf8')); if(component==='auralis-animated'&&path.basename(file)==='auralis-renderer.js')return fs.readFileSync(path.join(__dirname,'auralis-animated-experiment.js')); if(['field-half','field-half-30'].includes(component)&&path.basename(file)==='auralis-renderer.js'){data=Buffer.from(data.toString().replace(/budget.add\(draw,\{fps:30\}\)/,'budget.add(draw,{fps:'+(component==='field-half'?60:30)+'})'));}return data;}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const duration = +(process.env.HAL_PERF_MS || 5000), soak = +(process.env.HAL_PERF_SOAK_MS || 180000);
// A sampler uses the original rAF in the shell only: it is excluded from application-loop counts.
function instrument() {
  window.__processUiCalls={};window.__processUiEvents=0;
  const rawRAF = requestAnimationFrame.bind(window), rawCancel = cancelAnimationFrame.bind(window);
  const workerRefs=[],audioRefs=[],urls=new Set();
  const p = window.__budgetProbe = { raf: 0, timers: 0, style: 0, matrix: 0, draws: {}, uniforms: 0, messages: 0, long: [], times: [], rafSources: {},rafOrigins:{} };
  document.addEventListener('change',e=>{if(e.target?.id==='imgIn'&&location.pathname.endsWith('/grade.html'))p.gradeSource={input:performance.now()};},true);
  const pending = new Map(), names = new WeakMap();
  window.requestAnimationFrame = fn => {
    let source = names.get(fn);
    if (!source) { source = fn.name || new Error().stack.split('\n')[2]?.trim() || 'anonymous'; names.set(fn, source); p.rafOrigins[source]=new Error().stack.split('\n').slice(1,5).join('\n'); }
    const id = rawRAF(t => { pending.delete(id); p.raf++; p.rafSources[source] = (p.rafSources[source] || 0) + 1; fn(t); });
    pending.set(id, source); return id;
  };
  window.cancelAnimationFrame = id => { pending.delete(id); rawCancel(id); };
  const timers = new Map();
  for (const kind of ['Timeout', 'Interval']) {
    const set = window['set' + kind].bind(window), clear = window['clear' + kind].bind(window);
    window['set' + kind] = (fn, ms, ...args) => {
      const id = set(() => { if (kind === 'Timeout') timers.delete(id); p.timers++; if (typeof fn === 'function') fn(...args); else (0, eval)(fn); }, ms);
      timers.set(id, { kind, ms }); return id;
    };
    window['clear' + kind] = id => { timers.delete(id); clear(id); };
  }
  const refs = [];
  for (const key of ['ResizeObserver', 'MutationObserver', 'IntersectionObserver']) {
    const Original = window[key]; if (!Original) continue;
    window[key] = class extends Original {
      constructor(fn) { super(fn); this.__observing = false; refs.push({ key, ref: new WeakRef(this) }); }
      observe(...args) { this.__observing = true; return super.observe(...args); }
      disconnect() { this.__observing = false; return super.disconnect(); }
    };
  }
  const style = getComputedStyle; window.getComputedStyle = function(...a) { p.style++; return style.apply(this, a); };
  p.canvas2D={};
  for(const name of ['drawImage','putImageData','fillRect','clearRect','fill','stroke']){
    const fn=CanvasRenderingContext2D.prototype[name];
    CanvasRenderingContext2D.prototype[name]=function(...args){const key=(this.canvas.id||this.canvas.className||'canvas')+':'+name;p.canvas2D[key]=(p.canvas2D[key]||0)+1;return fn.apply(this,args);};
  }
  const Matrix = window.DOMMatrixReadOnly;
  window.DOMMatrixReadOnly = class extends Matrix { constructor(...a) { super(...a); p.matrix++; } };
  for (const T of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if (T) {
    const upload=T.prototype.texImage2D;T.prototype.texImage2D=function(...a){const g=this.canvas.id==='gl'&&p.gradeSource&&!p.gradeSource.uploadEnd&&a.length===6?p.gradeSource:null;if(g)g.uploadStart=performance.now();const out=upload.apply(this,a);if(g)g.uploadEnd=performance.now();return out;};
    const draw = T.prototype.drawArrays;
    T.prototype.drawArrays = function(...a) { const key = this.canvas.closest?.('.auralis-host') ? 'auralis' : this.canvas.id || this.canvas.className || 'canvas'; p.draws[key] = (p.draws[key] || 0) + 1; const out=draw.apply(this,a);if(this.canvas.id==='gl'&&p.gradeSource?.uploadEnd&&!p.gradeSource.firstDraw){p.gradeSource.firstDraw=performance.now();p.gradeSource.endToEndMs=p.gradeSource.firstDraw-p.gradeSource.input;}return out; };
    for (const k of ['uniform1f','uniform2f','uniform3f','uniform3fv']) { const fn = T.prototype[k]; T.prototype[k] = function(...a) { p.uniforms++; return fn.apply(this,a); }; }
  }
  const OriginalWorker=Worker;window.Worker=class extends OriginalWorker{constructor(...a){super(...a);this.__alive=true;workerRefs.push(new WeakRef(this));this.addEventListener('message',()=>{p.receivedMessages=(p.receivedMessages||0)+1;});}terminate(){this.__alive=false;return super.terminate();}};
  const OriginalAudio=AudioContext;window.AudioContext=class extends OriginalAudio{constructor(...a){super(...a);audioRefs.push(new WeakRef(this));}};
  const createURL=URL.createObjectURL,revokeURL=URL.revokeObjectURL;URL.createObjectURL=function(...a){const u=createURL.apply(this,a);urls.add(u);return u;};URL.revokeObjectURL=function(u){urls.delete(u);return revokeURL.call(this,u);};
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function(...a) { p.messages++; return post.apply(this,a); };
  new PerformanceObserver(l => p.long.push(...l.getEntries().map(e => ({ at:e.startTime, ms:e.duration,attribution:e.attribution.map(a=>({name:a.name,container:a.containerId,src:a.containerSrc})) })))).observe({type:'longtask'});
  if (window === top) { let sampling=true,id=0;const sample=t=>{if(!sampling)return;p.times.push(t);if(p.times.length>30000)p.times.splice(0,20000);id=rawRAF(sample);};p.setSampling=on=>{if(sampling===on)return;sampling=on;if(on)id=rawRAF(sample);else rawCancel(id);};id=rawRAF(sample); }
  const ipc={},events={};
  function connectProbe(){const t=window.__TAURI__;if(!t?.core?.invoke)return setTimeout(connectProbe,10);const invoke=t.core.invoke;t.core.invoke=function(cmd,...a){ipc[cmd]=(ipc[cmd]||0)+1;return invoke.call(this,cmd,...a);};const listen=t.event?.listen;if(listen)t.event.listen=function(name,fn,...a){return listen.call(this,name,(...args)=>{events[name]=(events[name]||0)+1;fn(...args);},...a);};}if(window===top)connectProbe();
  p.snapshot = () => ({ processUiCalls:{...window.__processUiCalls},processUiEvents:window.__processUiEvents,ipc:{...ipc},events:{...events}, ...p, snapshot:undefined,setSampling:undefined, workers:workerRefs.filter(r=>r.deref()?.__alive).length,audioContexts:audioRefs.flatMap(r=>r.deref()?[r.deref().state]:[]),objectURLs:urls.size, t:performance.now(), times:p.times.slice(), long:p.long.slice(), draws:{...p.draws}, rafSources:{...p.rafSources}, focus:document.hasFocus(),hover:[...document.querySelectorAll(':hover')].map(e=>e.id||e.className).filter(x=>typeof x==='string'),glides:[...document.querySelectorAll('.hover-selector,#railPill')].map(e=>({element:e.className,progress:e._gl?.t.progress(),active:e._gl?.t.isActive(),parent:!!e._gl?.t.parent,to:e._gl?.to})),budget:window.__renderBudget?.state(),activeRAF:[...pending.values()], activeTimers:[...timers.values()], observers:refs.flatMap(x => x.ref.deref()?.__observing ? [x.key] : []), canvases:[...document.querySelectorAll('canvas')].map(c=>({id:c.id,cls:c.className,width:c.width,height:c.height,auralis:c.__auralisState?.()})), away:window.__ui?.away, hidden:document.hidden, animations:document.getAnimations().filter(a=>a.playState==='running').length });
}
function quantile(xs, q) { return xs.length ? xs[Math.min(xs.length-1, Math.floor(xs.length*q))] : null; }
(async () => {
 const native=!!process.env.HAL_PERF_CDP;
 const windowControl=(state,extra=[])=>require('child_process').execFileSync((process.env.HAL_PERF_POWERSHELL||'pwsh'),['-NoProfile','-File',path.resolve(__dirname,'performance-window.ps1'),'-ProcessId',process.env.HAL_PERF_NATIVE_PID,'-Executable',process.env.HAL_PERF_NATIVE_EXE,'-State',state,...extra],{windowsHide:true});
 const browser = native ? await chromium.connectOverCDP(process.env.HAL_PERF_CDP) : await chromium.launch({ executablePath:process.env.CHROME, headless:false, args:['--autoplay-policy=no-user-gesture-required'] });
 const server=serve();let gpu;
 const bcdp = await browser.newBrowserCDPSession();
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'hal-budget-'));
 const host = createHost(tmp, { tools:{systemFfmpeg:process.env.FFMPEG || 'ffmpeg',ffmpegSource:process.env.FFPROBE ? path.join(path.dirname(process.env.FFPROBE),'ffmpeg.exe') : undefined} });
 fs.writeFileSync(path.join(host.base,'Settings/app.json'), JSON.stringify({ settings:{language:'en',artistName:'Performance fixture'} }));
 const crypto=require('crypto'),distRoot=process.env.HAL_PERF_DIST||path.resolve(__dirname,'../dist');const codeHashes=Object.fromEntries(fs.readdirSync(distRoot).filter(f=>/\.(js|css|html)$/.test(f)).sort().map(f=>[f,crypto.createHash('sha256').update(asset(path.join(distRoot,f))).digest('hex')]));
 const result = { label, harnessHash:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'), codeHashes, base:'edf8a82', environment:{instrumentationHashes:Object.fromEntries(['performance-ablation.cjs','performance-gpu.cjs','performance-gpu.ps1','performance-window.ps1'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,f))).digest('hex')])),platform:process.platform,cpus:os.cpus()[0]?.model,logicalCores:os.cpus().length,ramGB:os.totalmem()/2**30, duration,soak, mode:native?'native WebView2 Preview, real Rust backend; rAF opportunity != presented FPS':'headed Chromium, hardware ANGLE, mocked backend; rAF opportunity != presented FPS',componentOverride:component,phase,dist:process.env.HAL_PERF_DIST||'working tree'}, scenarios:[], errors:[] };
 const save = () => fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(result,null,2));
 try {
  let app;
 if(native){
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://tauri.localhost'));assert(page,'Native Preview required');
 const dist=process.env.HAL_PERF_DIST||path.resolve(__dirname,'../dist');
 if(reuseLabel){assert(/^[a-z0-9-]+$/i.test(reuseLabel));const prior=JSON.parse(fs.readFileSync(path.join(out,reuseLabel+'.json')));assert.deepEqual(prior.errors,[]);assert.deepEqual(prior.codeHashes,codeHashes,'Loaded product assets must match the prior measurement');assert(prior.scenarios.some(s=>s.name==='retained-after-rest'&&s.focusValid));result.environment.reusedRetainedInputs={label:reuseLabel,inputs:prior.environment.retainedInputs};}
 if(!reuseLabel){
 await page.context().route('http://tauri.localhost/**',async r=>{const u=new URL(r.request().url()),file=path.resolve(dist,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));assert(file.startsWith(path.resolve(dist)+path.sep));const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png'};if(fs.existsSync(file))await r.fulfill({status:200,body:asset(file),contentType:types[path.extname(file)]||'application/octet-stream'});else await r.fulfill({status:404,body:'Missing asset'});});
 await page.addInitScript(instrument);await page.addInitScript(installAblation);if(component==='auralis-cache'||component==='keepalive')await page.addInitScript(()=>{window.__halVisualTest=true});await page.addInitScript(()=>{window.__halSkipWelcome=true;window.__halRestMs=30000;window.__halUnloadMs=300000;});
 }
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));if(!reuseLabel)await page.reload();else await page.evaluate(()=>window.__budgetProbe.setSampling(true));await page.waitForFunction(()=>window.__hal?.ready);await page.evaluate(()=>window.__hal.ready);const paths=await page.evaluate(()=>window.__hal.invoke('paths'));assert.match(paths.base,/com.halation.preview.*performance-111/);result.environment.nativePaths=paths;result.environment.appInfo=await page.evaluate(()=>window.__hal.invoke('app_info'));result.environment.window=JSON.parse(windowControl('benchmark-restore').toString());app={page,errors};
 }else{
 app = await openApp({newPage:async options=>{const page=await browser.newPage(options);if(process.env.HAL_PERF_DIST)await page.route('http://localhost:**/*',async r=>{const u=new URL(r.request().url()),file=path.resolve(process.env.HAL_PERF_DIST,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));if(fs.existsSync(file))await r.fulfill({path:file});else await r.fulfill({status:404,body:'Missing asset'});});await page.addInitScript(instrument);await page.addInitScript(installAblation);return page;}},server,host,{motion:true,width:1480,height:940,restMs:30000,unloadMs:300000});
  }
  const {page}=app;
  if(native)await page.evaluate(async()=>{window.__nativeFocusEvents=[];const w=window.__TAURI__.window.getCurrentWindow();await w.onFocusChanged(async e=>{const at=performance.now();window.__nativeFocusEvents.push({at,rawFocused:e.payload,focused:await w.isFocused()});});});
  if(native){await page.waitForFunction(()=>window.__shell?.session);if(await page.locator('#modal').evaluate(e=>e.open)){assert.match(await page.locator('#modal').innerText(),/Recover previous session/);await page.locator('#mCancel').click();}}
  await page.evaluate(()=>window.__shell.session.ready);
  if(native){gpu=gpuSampler.start({pid:+process.env.HAL_PERF_NATIVE_PID,executable:process.env.HAL_PERF_NATIVE_EXE,file:path.join(out,label+'-gpu.jsonl')});result.environment.windowsGpu=await gpu.ready();}
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  result.environment.browser=await browser.version(); result.environment.gpu=(await bcdp.send('SystemInfo.getInfo')).gpu;
  const traceCategories=['toplevel','devtools.timeline','disabled-by-default-devtools.timeline',...(process.env.HAL_PERF_PROFILE==='1'?['v8','disabled-by-default-v8.gc']:[])];
  async function state() {
   await page.evaluate(async()=>{await Promise.all([window,...[...document.querySelectorAll('iframe.view')].map(f=>f.contentWindow)].map(w=>w?.__gpuAblation?.refresh()));});
   const realms=await page.evaluate(()=>[window,...[...document.querySelectorAll('iframe.view')].map(f=>f.contentWindow)].flatMap(w=>{try{return w?.__budgetProbe?[{gpu:w.__gpuAblation?.snapshot(),url:w===window?'shell':w.location.pathname.split('/').pop(),...w.__budgetProbe.snapshot()}]:[]}catch{return []}}));
   const jobs=await page.evaluate(()=>window.__hal.jobs.list().map(j=>({id:j.id,tool:j.tool,kind:j.kind,state:j.state,title:j.title,stage:j.stage,waitingFor:j.waitingFor})));
   return { realms,jobs, metrics:Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value])), processes:(await bcdp.send('SystemInfo.getProcessInfo')).processInfo };

  }
  async function measure(name,action=async()=>{},ms=duration) {
   if(phase==='workers'&&!['ten-tools-three-worker-jobs','three-jobs-activity-open','three-jobs-navigation'].includes(name)){await action();return;}
   if(ms>30000){await sleep(ms-5000);ms=5000;}
   const traced=!name.includes('hardware-idle');if(traced)await browser.startTracing(page,{categories:traceCategories});
   const profiling=name==='grade-load'||(process.env.HAL_PERF_PROFILE==='1'&&name==='framegrab-load')||(process.env.HAL_PERF_PROFILE==='1'&&(name==='product-pressure-isolated'||(/^retained-/.test(name)||name.startsWith('ten-open-tools-loaded-media-hidden'))));if(profiling){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
   const a=await state();a.frameStart=await page.evaluate(()=>performance.now());const t=Date.now(); await action(); await sleep(ms); const b=await state(),wall=b.metrics.Timestamp-a.metrics.Timestamp;
   const realms=b.realms.map(x=>{const z=a.realms.find(y=>y.url===x.url)||{t:0,raf:0,timers:0,style:0,matrix:0,uniforms:0,messages:0,draws:{},rafSources:{}}; const cutoff=x.url==='shell'?a.frameStart:z.t;const frameGaps=x.times.filter(t=>t>=cutoff).flatMap((t,i,all)=>i&&t-all[i-1]>33?[{at:t,ms:t-all[i-1]}]:[]);const gaps=x.times.filter(t=>t>=cutoff).map((t,i,all)=>i?t-all[i-1]:0).slice(1).sort((a,b)=>a-b);return {...x,frameGaps,gpuActivity:x.gpu?{passes:x.gpu.contexts.map((c,i)=>Object.fromEntries(Object.entries(c.passes).map(([k,v])=>[k,v-(z.gpu?.contexts?.[i]?.passes?.[k]||0)]))),uploads:x.gpu.contexts.flatMap(c=>c.uploads.filter(u=>u.at>=z.t)),workerDraws:x.gpu.workerContexts.map((w,i)=>(w.draws||0)-(z.gpu?.workerContexts?.[i]?.draws||0))}:null,times:undefined,long:undefined,ipc:Object.fromEntries(Object.entries(x.ipc).map(([k,v])=>[k,v-(z.ipc?.[k]||0)])),events:Object.fromEntries(Object.entries(x.events).map(([k,v])=>[k,v-(z.events?.[k]||0)])),canvas2D:Object.fromEntries(Object.entries(x.canvas2D||{}).map(([k,v])=>[k,v-(z.canvas2D?.[k]||0)]).filter(([,v])=>v)),raf:x.raf-z.raf,timers:x.timers-z.timers,style:x.style-z.style,matrix:x.matrix-z.matrix,uniforms:x.uniforms-z.uniforms,messages:x.messages-z.messages,receivedMessages:(x.receivedMessages||0)-(z.receivedMessages||0),draws:Object.fromEntries(Object.entries(x.draws).map(([k,v])=>[k,v-(z.draws[k]||0)])),rafSources:Object.fromEntries(Object.entries(x.rafSources).map(([k,v])=>[k,v-(z.rafSources[k]||0)]).filter(([,v])=>v)),pacing:{samples:gaps.length,opportunitiesPerSecond:gaps.length/((x.t-z.t)/1000),meanMs:gaps.length?gaps.reduce((s,x)=>s+x,0)/gaps.length:null,p95Ms:quantile(gaps,.95),p99Ms:quantile(gaps,.99),maxMs:gaps.at(-1)||null},longTasks:x.long.filter(e=>e.at>=cutoff)};});
   const delta={}; for(const k of ['Timestamp','TaskDuration','ScriptDuration','LayoutCount','LayoutDuration','RecalcStyleCount','RecalcStyleDuration'])delta[k]=b.metrics[k]-a.metrics[k];
   const processes=b.processes.map(x=>({...x,cpuPercentOneCore:100*(x.cpuTime-(a.processes.find(y=>y.id===x.id)?.cpuTime||x.cpuTime))/wall}));
   if(native&&phase==='auralis'&&['home-idle','hardware-idle-home','auralis-tool-focused','auralis-navigation-focused','auralis-resize-settled','auralis-restore-geometry'].includes(name)&&!b.realms[0].budget.focused){result.focusFailure={name,before:a.realms[0].budget,after:b.realms[0].budget,native:JSON.parse(windowControl('inspect').toString()),page:await page.evaluate(async()=>({nativeFocused:await window.__TAURI__.window.getCurrentWindow().isFocused(),events:window.__nativeFocusEvents,documentFocus:document.hasFocus()}))};save();throw Error('Focused Home lost native focus: '+JSON.stringify(result.focusFailure));}
   const processUi={calls:Object.fromEntries(Object.entries(b.realms[0].processUiCalls||{}).map(([k,v])=>[k,v-(a.realms[0].processUiCalls?.[k]||0)])),jobsEvents:(b.realms[0].processUiEvents||0)-(a.realms[0].processUiEvents||0)};
    const ended=Date.now();const item={name,traced,processUi,jobs:{before:a.jobs,after:b.jobs},utcStart:new Date(t).toISOString(),utcEnd:new Date(ended).toISOString(),windowsGpu:gpu?.summary(t,ended),seconds:wall,frameSampleStart:a.frameStart,traceStart:a.metrics.Timestamp,traceEnd:b.metrics.Timestamp,realms,delta,heapMB:b.metrics.JSHeapUsedSize/2**20,dom:await cdp.send('Memory.getDOMCounters'),processes};const trace=traced?JSON.parse((await browser.stopTracing()).toString()).traceEvents:[];if(profiling){const detail=trace.filter(e=>e.ph==='M'||(e.dur||0)>=10000||/GC|Compile/.test(e.name));const file=label+'-'+name+'-trace-detail.json';fs.writeFileSync(path.join(out,file),JSON.stringify(detail));item.traceDetailFile=file;}item.trace=Object.fromEntries(['Layout','UpdateLayoutTree','Paint','RasterTask','CompositeLayers','DrawFrame'].map(n=>{const es=trace.filter(e=>e.name===n);return [n,{count:es.length,totalMs:es.reduce((s,e)=>s+(e.dur||0)/1000,0)}]}));if(profiling){const {profile}=await cdp.send('Profiler.stop'),hits=new Map();for(let i=0;i<(profile.samples||[]).length;i++){const id=profile.samples[i];hits.set(id,(hits.get(id)||0)+(profile.timeDeltas[i]||0));}const profileFile=label+'-'+name+'-cpu-profile.json';fs.writeFileSync(path.join(out,profileFile),JSON.stringify(profile));item.cpuProfileFile=profileFile;item.cpuProfile=profile.nodes.map(n=>({id:n.id,scriptId:n.callFrame.scriptId,function:n.callFrame.functionName,url:n.callFrame.url,line:n.callFrame.lineNumber+1,column:n.callFrame.columnNumber+1,selfMs:(hits.get(n.id)||0)/1000})).filter(n=>n.selfMs).sort((a,b)=>b.selfMs-a.selfMs).slice(0,30);}
   if(native){item.focusWindow={from:a.realms[0].t,to:b.realms[0].t,before:a.realms[0].budget,after:b.realms[0].budget,events:await page.evaluate(([from,to])=>window.__nativeFocusEvents.filter(e=>e.at>=from&&e.at<=to),[a.realms[0].t,b.realms[0].t])};item.focusValid=item.focusWindow.before.focused&&item.focusWindow.after.focused&&!item.focusWindow.events.some(e=>!e.focused);}
   result.scenarios.push(item);save();console.log(name,JSON.stringify({pacing:realms[0].pacing,draws:realms[0].draws,style:realms[0].style,cpu:processes.reduce((s,x)=>s+x.cpuPercentOneCore,0),heap:item.heapMB}));return item;
  }
  const show=async id=>{await page.evaluate(async id=>{window.__shell.show(id);if(window.__modules.byId(id)?.src)await window.__shell.ensureApp(id);},id);await sleep(900);};
  async function fileInput(id,selector,file){
   if(!native)return page.frames().find(f=>f.url().endsWith('/'+id+'.html')).locator(selector).setInputFiles(file);
   // WebView2's Playwright payload fallback rebuilds File bytes with atob/Uint8Array.from on the UI thread.
   // CDP's native file input keeps the browser/OS file path, like a local picker selection.
   const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
   const owner=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#v-'+id});
   const {node}=await cdp.send('DOM.describeNode',{nodeId:owner.nodeId,depth:1,pierce:true});
   const input=await cdp.send('DOM.querySelector',{nodeId:node.contentDocument.nodeId,selector});assert(input.nodeId,'Missing native file input '+id+selector);
   return cdp.send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[file]});
  }
  if(native&&(phase==='auralis'||component==='auralis-animated')){windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.focused,null,{timeout:5000});}
  await sleep(process.env.HAL_PERF_ANIMATED_QUICK?1000:phase==='auralis'?15000:5000);if(!process.env.HAL_PERF_ANIMATED_QUICK&&!['auralis-product','auralis-grain','process-ui','keepalive','retained','retained-followup'].includes(component))await measure('home-idle');
  if(native&&!component&&!phase){await page.evaluate(()=>window.__budgetProbe.setSampling(false));await sleep(3000);await measure('hardware-idle-home',async()=>{},20000);await page.evaluate(()=>window.__budgetProbe.setSampling(true));}
  async function setDpr(dpr){
   const size=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
   if(dpr)await cdp.send('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:dpr,mobile:false});else await cdp.send('Emulation.clearDeviceMetricsOverride');
   // DPR alone does not fire the original renderer's ResizeObserver. Restore identical CSS geometry before measuring.
   await page.evaluate(async()=>{const host=document.querySelector('.auralis-host canvas').parentElement,old=host.style.width;host.style.width='calc(100% - 1px)';await new Promise(r=>setTimeout(r,80));host.style.width=old;});
   await page.waitForTimeout(200);
   const actual=await page.evaluate(()=>{const c=document.querySelector('.auralis-host canvas'),p=window.__renderBudget?.profile;return {w:c.width,h:c.height,architecture:c.__auralisState?.().architecture,cssW:c.parentElement.clientWidth,cssH:c.parentElement.clientHeight,dpr:devicePixelRatio,cap:p?.dpr??2,scale:p?.scale??1};});
   if(actual.architecture==='tiny-field-blue-noise'){assert.equal(actual.w,actual.cssW,'DPR does not multiply presentation');assert.equal(actual.h,actual.cssH);const state=await page.evaluate(()=>document.querySelector('.auralis-host canvas').__auralisState());assert.equal(Math.max(state.fieldWidth,state.fieldHeight),320,'DPR does not multiply procedural field');}else if(actual.architecture==='tiny-direct'){const density=192/Math.max(actual.cssW,actual.cssH);assert.equal(actual.w,Math.round(actual.cssW*density),'Tiny-field DPR must not multiply the procedural buffer');assert.equal(actual.h,Math.round(actual.cssH*density));}else{assert.equal(actual.w,Math.round(actual.cssW*Math.min(actual.dpr,actual.cap)*actual.scale),'Legacy DPR must change the physical canvas buffer');assert.equal(actual.h,Math.round(actual.cssH*Math.min(actual.dpr,actual.cap)*actual.scale));}return actual;
  }
  if(component==='auralis-grain'){
   assert(native,'Grain GPU comparison requires native Preview');
   const grain=process.env.HAL_PERF_GRAIN||'none',finalPass=grain!=='none'||process.env.HAL_PERF_GRAIN_FINAL==='1',atmosphere=process.env.HAL_PERF_GRAIN_ATMOSPHERE!=='0';assert(['none','legacy','cheap'].includes(grain));
   const activate=async()=>{windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.focused,null,{timeout:5000});};
   const checked=async name=>{await activate();await sleep(2000);let sample=await measure(name,async()=>{},10000);if(!sample.focusValid){await activate();await sleep(2000);sample=await measure(name+'-focus-retry',async()=>{},10000);}assert(sample.focusValid,'Grain interval interrupted: '+name);const a=sample.realms[0].canvases.find(c=>c.auralis).auralis;assert.equal(a.fieldWidth,320);assert.equal(a.config.fps,15);const rate=a.finalPass?(sample.realms[0].draws.auralis||0)/sample.seconds/2:(sample.realms[0].draws.auralis||0)/sample.seconds;assert(rate>14&&rate<16,'Actual presentations must sustain15Hz: '+rate);assert.equal(a.config.grain,grain);return sample;};
   await activate();await page.evaluate(({grain,finalPass,atmosphere})=>{window.__auralisGrainExperiment.set({grain,finalPass,edge:320,fps:15});window.__gpuAblation.set({atmosphere});const c=document.querySelector('.tool-atmo');if(c)c.style.visibility=atmosphere?'':'hidden';window.__grainPausedAnimations=document.getAnimations();window.__grainPausedAnimations.forEach(a=>a.pause());},{grain,finalPass,atmosphere});await sleep(3000);
   const prefix='grain-'+grain+(finalPass?'-native-final':'-tiny-direct')+'-atmosphere-'+(atmosphere?'on':'off');await checked(prefix+'-isolated');
   await page.evaluate(()=>window.__grainPausedAnimations.forEach(a=>a.play()));await checked(prefix+'-home-total');
   result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;
  }
  async function retainedJobs(){
   assert(native,'Real retained-input jobs require native Preview');
   const checked=async(name,action,ms=10000)=>{windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.focused);await sleep(1000);const s=await measure(name,action||(async()=>{}),ms);assert(s.focusValid,'Retained follow-up lost native focus: '+name);return s;};
   await page.waitForFunction(()=>!window.__hal.jobs.list().some(j=>['running','queued','held'].includes(j.state)),null,{timeout:60000});
   await show('downloader');await checked('retained-ten-inputs-no-jobs');
   await page.evaluate(()=>{window.__realFixture=[];for(let i=0;i<3;i++){
    const h=window.__hal.jobs.submit({tool:['convert','downloader','framegrab'][i],kind:'real-ffmpeg-fixture',title:'Real FFmpeg encode '+(i+1),lane:'light',host:'page',run:async ctx=>{const p=await ctx.proc('ffmpeg',['-nostdin','-v','error','-re','-f','lavfi','-i','testsrc2=size=1280x720:rate=30','-t','180','-c:v','libx264','-preset','fast','-threads','2','-progress','pipe:1','-f','null','-'],line=>{const m=/^out_time_us=(\d+)/.exec(line);if(m)ctx.progress(+m[1]/180e6,'Encoding');});const code=await p.done;if(code!==0&&!ctx.signal.aborted)throw Error('FFmpeg fixture failed '+code);}});window.__realFixture.push(h.id);
   }});
   await page.waitForFunction(()=>window.__realFixture.every(id=>window.__hal.jobs.get(id).state==='running'),null,{timeout:15000});await sleep(2000);
   await checked('retained-ten-inputs-three-real-jobs');await page.evaluate(()=>window.__shell.processes.open());await sleep(1000);await checked('retained-three-real-jobs-processes-open');
   if(process.env.HAL_PERF_PROGRESS_ABLATION==='1'){
    await page.evaluate(()=>{const m=window.__motion;window.__originalProgressBar=m.bar;m.bar=(el,p)=>{if(!el?.closest('#procTray'))return window.__originalProgressBar(el,p);const v=Math.max(0,Math.min(1,+p||0));m.gsap.killTweensOf(el);el.style.setProperty('--v',String(v));el.dataset.v=String(v);el.dataset.gs='1';el.style.transition='none';m.gsap.set(el,{x:0,xPercent:(v-1)*100});};document.querySelectorAll('#procTray .prog i').forEach(e=>m.gsap.killTweensOf(e));});
    await sleep(1000);await checked('retained-process-progress-instant-control');await page.evaluate(()=>{window.__motion.bar=window.__originalProgressBar;delete window.__originalProgressBar;});
   }
   await page.evaluate(()=>window.__shell.processes.close());
   await checked('retained-three-real-jobs-navigation',async()=>{for(const id of ['grade','stems','covertest','framegrab','convert','visualizer','downloader'])await show(id);},3000);
   await page.evaluate(()=>window.__realFixture.forEach(id=>window.__hal.jobs.cancel(id)));await page.waitForFunction(()=>window.__realFixture.every(id=>!['running','queued'].includes(window.__hal.jobs.get(id).state)),null,{timeout:20000});await sleep(3000);await checked('retained-jobs-cancelled');
  }
  if(component==='retained-followup'){
   assert(reuseLabel,'Follow-up requires the verified retained-input measurement');
   await retainedJobs();result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;
  }
  if(component==='retained'){
   assert(native,'Retained-media attribution requires native Preview');
   const ids=(process.env.HAL_PERF_RETAINED_TOOLS||'grade,framegrab,covertest,convert,visualizer,stems,removebg,upscale,interp').split(',');assert(ids.every(id=>['grade','framegrab','covertest','convert','visualizer','stems','removebg','upscale','interp'].includes(id)));
   const cp=require('child_process'),image=path.join(tmp,'retained-image.png'),video=path.join(tmp,'retained-video.webm'),wav=path.join(tmp,'retained-audio.wav');
   cp.execFileSync(process.env.FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=2048x2048','-frames:v','1','-y',image],{windowsHide:true});
   cp.execFileSync(process.env.FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=1280x720:rate=30:duration=8','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-g','60','-y',video],{windowsHide:true});
   cp.execFileSync(process.env.FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=220:sample_rate=22050:duration=12','-y',wav],{windowsHide:true});
   result.environment.retainedInputs={image:{width:2048,height:2048},video:{width:1280,height:720,fps:30,seconds:8},audio:{rate:22050,seconds:12},tools:ids,noAutorunControl:process.env.HAL_PERF_RETAINED_NO_AUTORUN==='1',downloader:'Unsubmitted URL draft, not a local media file'};
   await page.evaluate(p=>window.__hal.invoke('session_allow_video',{path:p}),wav);
   const activate=async()=>{windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.focused);};
   const checked=async(name,action,ms=6000)=>{let s;for(let attempt=0;attempt<3;attempt++){await activate();await sleep(500);s=await measure(name+(attempt?'-focus-retry-'+attempt:''),action||(async()=>{}),ms);if(s.focusValid)break;if(action)break;}assert(s.focusValid,'Retained-media interval lost native focus: '+name);return s;};
   await show('downloader');const downloader=page.frames().find(f=>f.url().endsWith('/downloader.html'));await downloader.locator('#url').fill('https://example.invalid/performance-fixture');await sleep(3000);await checked('retained-neutral-baseline');
   let loaded=0;
   for(const id of ids){
    await show(id);const f=page.frames().find(f=>f.url().endsWith('/'+id+'.html'));await checked('retained-'+id+'-load',async()=>{
     if(id==='stems')await f.locator('#autoExport').uncheck();
     if(id==='convert'||id==='stems')await f.evaluate(p=>window.__halApp.takeAudio({path:p,name:'retained-audio.wav'}),wav);
     else if(id==='visualizer'){await fileInput(id,'#artIn',image);await fileInput(id,'#audIn',wav);}
     else{if(id==='removebg')await f.evaluate(()=>window.__rb.setMode('brush'));await fileInput(id,id==='framegrab'?'#videoIn':id==='interp'?'#vidIn':'#imgIn',id==='framegrab'||id==='interp'?video:image);if(id==='covertest')await f.evaluate(()=>window.__halApp.flush());}
     await sleep(1200);
    },1000);
    if(id==='stems'&&process.env.HAL_PERF_STEMS_CACHE==='1'){
     assert(process.env.HAL_PERF_RETAINED_NO_AUTORUN!=='1','Cache test requires actual model inference');
     await page.waitForFunction(()=>!window.__hal.jobs.list().some(j=>['running','queued','held'].includes(j.state)),null,{timeout:180000});
     const outputs=await f.evaluate(()=>window.__stems.Q.items.map(it=>({state:it.state,device:it.res?.device,files:it.res?.files})));
     assert(outputs.some(it=>it.state==='done'&&it.files),'A real separation must complete before testing model cache');
     result.environment.stemsCache={idleSeconds:30,outputs};
     await show('downloader');await checked('stems-model-cache-warm',null,12000);
     await sleep(35000);await checked('stems-model-cache-expired',null,10000);
     result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;
    }
    if(id==='framegrab'){

     await f.waitForFunction(()=>window.__halApp.state().shown.exact&&!window.__halApp.state().loading,null,{timeout:60000});
     const ref=await f.evaluate(async()=>(await window.__halApp.session.capture()).video);
     const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
     assert.equal(hash(ref.path),hash(video),'Session video must preserve the complete original file');
     result.environment.retainedInputs.framegrabSession={sha256:hash(video),bytes:fs.statSync(video).size,reference:ref.path};
    }
    if(process.env.HAL_PERF_GRADE_LOAD_ONLY==='1'){assert.deepEqual(ids,['grade']);result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;}
    loaded++;await sleep(2500);await checked('retained-'+id+'-visible');await show('downloader');await sleep(2000);const hidden=await checked('retained-'+id+'-hidden');hidden.loadedMediaTools=loaded;save();
    if([1,3,5,9].includes(loaded)){const s=await checked('retained-'+loaded+'-media-plus-url');s.loadedMediaTools=loaded;save();}
   }
   if(ids.length===9){await checked('retained-ten-input-navigation',async()=>{for(const id of ['grade','stems','covertest','framegrab','convert','visualizer','downloader'])await show(id);},3000);await show('downloader');await sleep(35000);await checked('retained-after-rest');if(process.env.HAL_PERF_RETAINED_JOBS==='1')await retainedJobs();}
   result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;
  }
  if(component==='keepalive'){
   assert(native,'Keepalive attribution requires native Preview');const scene=process.env.HAL_PERF_KEEPALIVE_SCENE||'tool';assert(['static','home','tool','waiting'].includes(scene));result.environment.keepaliveControl={scene,forced:process.env.HAL_PERF_FORCE_KEEPALIVE==='1'};
   windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.focused);await page.mouse.move(700,500);
   if(scene==='tool')await show('grade');
   if(scene==='static'){await page.evaluate(()=>{document.getAnimations().forEach(a=>a.pause());window.__gpuAblation.set({auralis:false});});}
   if(scene==='waiting'){await page.evaluate(()=>{window.__auralisPressureJobs=Array.from({length:3},(_,i)=>window.__hal.jobs.submit({tool:'convert',kind:'keepalive-waiting',title:'Waiting '+i,lane:'light',host:'page',needs:{ramMB:1e9},run:async()=>{throw Error('Waiting fixture must never run');}}).id);});await page.waitForFunction(()=>window.__auralisPressureJobs.every(id=>window.__hal.jobs.get(id).waitingFor==='ram'));}
   await sleep(8000);
   for(const enabled of [true,false]){await page.evaluate(enabled=>window.__gpuAblation.set({keepalive:enabled}),enabled);windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.focused);await sleep(2000);const before=await page.evaluate(()=>({active:window.__compositionKeepalive?.active,writes:window.__compositionKeepalive?.writes}));const sample=await measure('keepalive-'+scene+'-'+(enabled?'on':'off'),async()=>{},10000);sample.keepalive={enabled,before,after:await page.evaluate(()=>({active:window.__compositionKeepalive?.active,writes:window.__compositionKeepalive?.writes}))};save();assert(sample.focusValid,'Keepalive interval lost native focus');}
   await page.evaluate(()=>window.__gpuAblation.set({auralis:true,keepalive:true}));result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;
  }
  if(component==='process-ui'){
   assert(native,'Process attribution requires native Preview');
   const kind=process.env.HAL_PERF_PROCESS_STATE||'waiting',open=process.env.HAL_PERF_PROCESS_OPEN==='1',cancel=process.env.HAL_PERF_DOCK_CANCEL==='1';assert(['idle','running','waiting','held','progress'].includes(kind));
   result.environment.processExperiment={kind,open,cancel,legacyDock:process.env.HAL_PERF_DOCK_LEGACY==='1'};
   windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.focused);await page.mouse.move(700,500);
   await page.evaluate(kind=>{window.__shell.on('jobs',()=>window.__processUiEvents++);window.__auralisPressureJobs=kind==='idle'?[]:Array.from({length:3},(_,i)=>window.__hal.jobs.submit({tool:'convert',kind:'process-native-fixture',title:'Process '+i,lane:'light',host:'page',held:kind==='held',needs:kind==='waiting'?{ramMB:1e9}:{},run:ctx=>new Promise(resolve=>{const start=performance.now(),progress=kind==='progress'?setInterval(()=>ctx.progress((performance.now()-start)/120000,'Encoding'),20):0;const timer=setTimeout(done,120000);function done(){clearTimeout(timer);clearInterval(progress);resolve();}ctx.signal.addEventListener('abort',done,{once:true});})}).id);},kind);
   if(kind!=='idle')await page.waitForFunction(kind=>window.__auralisPressureJobs.every(id=>{const j=window.__hal.jobs.get(id);return kind==='running'||kind==='progress'?j.state==='running':kind==='held'?j.state==='held':j.state==='queued'&&j.waitingFor==='ram';}),kind);
   await sleep(8000);if(open)await page.evaluate(()=>window.__shell.processes.open());await sleep(1000);
   // Keep Auralis animated at its product cadence; isolate the known Home mark contribution only.
   await page.evaluate(()=>document.getAnimations().filter(a=>a.effect?.target?.closest?.('#v-home')).forEach(a=>a.pause()));
   if(cancel){await page.locator('.rail .tab[data-tab=home]').hover();await sleep(500);await page.locator('.rail .tab[data-tab=grade]').hover();await sleep(35);result.cancelledGlide=await page.evaluate(()=>{const p=document.querySelector('.rail .hover-selector'),t=p._gl?.t;const state={active:t?.isActive(),progress:t?.progress()};window.__motion.gsap.killTweensOf(p);return state;});assert(result.cancelledGlide.active&&result.cancelledGlide.progress<1);await page.mouse.move(700,500);}
   await sleep(1500);windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.focused);const sample=await measure('process-'+kind+'-'+(open?'open':'closed')+(cancel?'-cancelled-hover':''),async()=>{},10000);assert(sample.focusValid,'Process interval lost native focus');
   result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;
  }
  if(component==='home-decoration'){
   assert(native,'Home composition attribution requires native Preview');
   await show('home');
   const checked=async name=>{windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.focused);await sleep(3000);const s=await measure(name,async()=>{},10000);assert(s.focusValid,'Home decoration interval lost focus');return s;};
   if(!await page.evaluate(()=>document.getAnimations().some(a=>a.effect?.target?.matches?.('.levitate')))){
    await checked('home-static-logo-product');
    result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;
   }
   await checked('home-css-ambient-native-cadence');
   for(const fps of [30,15]){
    await page.evaluate(fps=>{window.__homeAmbientControl?.dispose();const a=document.getAnimations().find(a=>a.effect?.target?.matches?.('.levitate'));if(!a)throw Error('Home mark animation missing');a.pause();const phase=a.currentTime,start=performance.now();window.__homeAmbientControl=__renderBudget.add(now=>{a.currentTime=phase+now-start;},{fps});window.__homeAmbientControl.start();},fps);
    await checked('home-css-ambient-sampled-'+fps+'hz');
   }
   await page.evaluate(()=>{window.__homeAmbientControl.dispose();delete window.__homeAmbientControl;document.getAnimations().filter(a=>a.effect?.target?.matches?.('.levitate')).forEach(a=>a.play());});
   result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;
  }
  if(component==='auralis-product'){
   assert(native,'Product GPU verification requires native Preview');
   const which=process.env.HAL_PERF_PRODUCT_SCENARIO||'home';assert(['home','isolated','pressure','navigation','tool','suspend','resize'].includes(which));
   const activate=async()=>{windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.focused,null,{timeout:5000});};
   const checked=async(name,action=async()=>{},ms=10000)=>{await activate();const s=await measure(name,action,ms);assert(s.focusValid,'Focused product interval interrupted: '+name);return s;};
   await activate();await sleep(3000);
   if(which==='home'){
    await checked('product-home-normal');
   }else if(which==='isolated'||which==='pressure'){
    if(which==='pressure'){
     await page.evaluate(()=>{window.__auralisPressureJobs=Array.from({length:3},(_,i)=>window.__hal.jobs.submit({tool:['convert','framegrab','grade'][i],kind:'auralis-pressure-fixture',title:'Auralis budget fixture '+i,lane:'light',host:'page',run:ctx=>new Promise(resolve=>{const timer=setTimeout(resolve,60000);ctx.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});})}).id);});
     await page.waitForFunction(()=>window.__hal.jobs.list().filter(j=>j.kind==='auralis-pressure-fixture'&&j.state==='running').length===3&&window.__renderBudget.profile.name!=='high');
    }
    await page.evaluate(()=>document.getAnimations().forEach(a=>a.pause()));await sleep(3000);
    const sample=await checked(which==='pressure'?'product-pressure-isolated':'product-home-isolated');
    if(which==='pressure'){const a=sample.realms[0].canvases.find(c=>c.auralis).auralis;assert.equal(a.targetFps,15,'Job pressure must preserve accepted motion cadence');const rate=(sample.realms[0].draws.auralis||0)/sample.seconds/(a.split?2:1);assert(rate>13&&rate<16,'Visible Home must actually sustain15Hz: '+rate);await page.evaluate(()=>window.__auralisPressureJobs.forEach(id=>window.__hal.jobs.cancel(id)));await page.waitForFunction(()=>!window.__hal.jobs.list().some(j=>j.kind==='auralis-pressure-fixture'&&j.state==='running'));}
    await page.evaluate(()=>{window.__budgetProbe.setSampling(false);});if(which==='isolated')await checked('product-home-isolated-hardware-idle',async()=>{},10000);
   }else if(which==='navigation'){
    await show('grade');await show('home');await activate();await sleep(2000);
    await checked('product-navigation',async()=>{for(const id of ['grade','home','convert','grade','home','convert','home'])await show(id);},8000);
   }else if(which==='tool'){
    await show('grade');await activate();await sleep(2000);const s=await checked('product-tool-visible');assert.equal(s.realms[0].draws.auralis||0,0);
   }else if(which==='suspend'){
    await page.evaluate(()=>window.__budgetProbe.setSampling(false));
    windowControl('minimize');await page.waitForFunction(()=>!window.__renderBudget.visible);await sleep(2000);const min=await measure('product-minimized-hardware-idle',async()=>{},10000);min.suspensionValid=!min.focusWindow.before.visible&&!min.focusWindow.after.visible;save();assert(min.suspensionValid,'Minimized interval interrupted by window restoration');assert.equal(min.realms[0].draws.auralis||0,0);assert.equal(min.realms[0].budget.visible,false);
    await activate();
    const focusBrowser=await chromium.launch({executablePath:process.env.CHROME,headless:false});
    try{const other=await focusBrowser.newPage();await other.goto('about:blank');await other.bringToFront();const focusCDP=await focusBrowser.newBrowserCDPSession(),focusPid=(await focusCDP.send('SystemInfo.getProcessInfo')).processInfo.find(p=>p.type==='browser').id;windowControl('blur',['-BlurProcessId',String(focusPid),'-BlurExecutable',process.env.CHROME]);await page.waitForFunction(()=>!window.__renderBudget.focused);await sleep(2000);const blur=await measure('product-unfocused-hardware-idle',async()=>{},10000);assert.equal(blur.realms[0].draws.auralis||0,0);assert.equal(blur.realms[0].budget.focused,false);}finally{await focusBrowser.close();}
    await activate();
   }else if(which==='resize'){
    await checked('product-resize',()=>windowControl('resize-cycle'),8000);windowControl('resize-once');await sleep(1000);await checked('product-resize-settled');windowControl('benchmark-restore');
   }
   result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;
  }
  if(component==='auralis-animated'){
   const focused=async()=>{assert(await page.evaluate(()=>window.__renderBudget.focused),'Animated benchmark requires actual native focus');};
   const activate=async()=>{if(native)windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.focused,null,{timeout:5000});};
   await activate();await focused();
   await page.evaluate(()=>{window.__pausedHomeAnimations=document.getAnimations();window.__pausedHomeAnimations.forEach(a=>a.pause());window.__auralisExperiment.pause();});
   await sleep(1000);if(!process.env.HAL_PERF_ANIMATED_QUICK)await measure('animated-static-control-hardware-idle',async()=>{},20000);
   const variants=process.env.HAL_PERF_ANIMATED_VARIANTS?JSON.parse(process.env.HAL_PERF_ANIMATED_VARIANTS):[{mode:'direct',edge:96,fps:8},{mode:'direct',edge:128,fps:8},{mode:'direct',edge:192,fps:8},{mode:'direct',edge:256,fps:8},{mode:'direct',edge:192,fps:15},{mode:'direct',edge:192,fps:30},{mode:'interpolate',edge:128,fps:15,hz:2},{mode:'interpolate',edge:192,fps:30,hz:4},{mode:'lookup',edge:192,fps:15}];
   assert(Array.isArray(variants)&&variants.length&&variants.every(v=>['direct','interpolate','lookup'].includes(v.mode)&&Number.isFinite(v.edge)&&v.edge>=64&&v.edge<=1024&&v.fps>=2&&v.fps<=30));
   for(const variant of variants){
    await activate();await focused();await page.evaluate(v=>window.__auralisExperiment.set(v),variant);await sleep(2000);
    const name='animated-'+variant.mode+'-'+variant.edge+'-'+variant.fps;let sample=await measure(name,async()=>{},15000);if(!sample.focusValid){await activate();await sleep(3000);sample=await measure(name+'-focus-retry',async()=>{},15000);}
    if(process.env.HAL_PERF_RESOLUTION_SWEEP==='1'){assert(sample.focusValid,'Isolated resolution interval interrupted');await page.evaluate(()=>window.__pausedHomeAnimations.forEach(a=>a.play()));await activate();await sleep(2000);let home=await measure(name+'-home-total',async()=>{},15000);if(!home.focusValid){await activate();await sleep(3000);home=await measure(name+'-home-total-focus-retry',async()=>{},15000);}assert(home.focusValid,'Normal Home resolution interval interrupted');await page.evaluate(()=>document.getAnimations().forEach(a=>a.pause()));}
   }
   await activate();await page.evaluate(()=>{window.__auralisExperiment.set({mode:'direct',edge:192,fps:15});window.__pausedHomeAnimations?.forEach(a=>a.play());});
   await sleep(1000);if(!process.env.HAL_PERF_ANIMATED_QUICK)await measure('animated-normal-home-hardware-idle',async()=>{},20000);assert([...new Set(variants.map(v=>v.mode))].every(mode=>result.scenarios.some(s=>s.name.startsWith('animated-'+mode+'-')&&s.focusValid)),'Each architecture needs a complete focus-valid measurement');
   result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;
  }
  if(component==='auralis-cache'){
   const pause=()=>page.evaluate(()=>{window.__pausedHomeAnimations=document.getAnimations();window.__pausedHomeAnimations.forEach(a=>a.pause());});
   await pause();await sleep(4000);await measure('cache-static-no-home-animation',async()=>{},20000);
   for(const edge of [256,384,512]){
    await measure('cache-generate-field-'+edge,async()=>{await page.evaluate(edge=>{const c=document.querySelector('.auralis-host canvas');for(let i=0;i<4;i++)c.__auralisReview.renderAt({time:i*1.4,frame:0,fieldEdge:edge});},edge);},3000);
   }
   for(const count of [2,3,4]){
    await measure('cache-prepare-'+count,async()=>{await page.evaluate(count=>{
     const original=document.querySelector('.auralis-host canvas'),parent=original.parentElement;window.__cachePrototype={original,canvases:[],animations:[]};
     for(let i=0;i<count;i++){original.__auralisReview.renderAt({time:i*1.4,frame:0,fieldEdge:512});const c=document.createElement('canvas');c.width=original.width;c.height=original.height;c.className='auralis-cache-prototype';c.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';c.getContext('2d',{alpha:false}).drawImage(original,0,0);parent.append(c);window.__cachePrototype.canvases.push(c);}
     original.style.visibility='hidden';
    },count);},3000);
    await measure('cache-retained-'+count,async()=>{},15000);
    await page.evaluate(()=>{const p=window.__cachePrototype,n=p.canvases.length;for(let i=1;i<n;i++){const points=[{offset:0,opacity:0},{offset:(i-1)/n,opacity:0},{offset:i/n,opacity:1}];if(i<n-1)points.push({offset:(i+1)/n,opacity:1},{offset:(i+1)/n+.0001,opacity:0},{offset:1,opacity:0});else points.push({offset:1,opacity:0});p.animations.push(p.canvases[i].animate(points,{duration:n*20000,iterations:Infinity,easing:'linear'}));}});
    await sleep(4000);await measure('cache-crossfade-'+count,async()=>{},20000);
    await page.evaluate(()=>{const p=window.__cachePrototype;p.animations.forEach(a=>a.cancel());p.canvases.forEach(c=>{c.width=c.height=1;c.remove()});p.original.style.visibility='';p.original.__auralisReview.renderAt({time:0,frame:0,fieldEdge:512});delete window.__cachePrototype;});
   }
   await page.evaluate(()=>{const c=document.querySelector('.auralis-host canvas');window.__cacheTransform=c.animate([{transform:'scale(1.015) translate(-.3%,0)'},{transform:'scale(1.025) translate(.3%,-.2%)'}],{duration:40000,iterations:Infinity,direction:'alternate',easing:'ease-in-out'});});await sleep(4000);await measure('cache-compositor-transform',async()=>{},20000);await page.evaluate(()=>{window.__cacheTransform.cancel();window.__pausedHomeAnimations.forEach(a=>a.play());});
   result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;
  }
  if(phase==='auralis'&&process.env.HAL_PERF_FOCUS_FOLLOWUP==='1'){
   await show('visualizer');windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.focused);await sleep(2000);await measure('auralis-tool-focused',async()=>{},10000);
   await show('home');windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.focused);await sleep(2000);await measure('auralis-navigation-focused',async()=>{for(const id of ['visualizer','home','visualizer','home','visualizer','home']){await page.evaluate(id=>window.__shell.show(id),id);await sleep(85);}},10000);
   windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.focused);await measure('auralis-resize-settled',async()=>{windowControl('resize-once');},10000);
   await measure('auralis-restore-geometry',async()=>{windowControl('benchmark-restore');},10000);
   result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;
  }
  if(phase==='auralis'){

   await page.evaluate(()=>window.__budgetProbe.setSampling(false));await sleep(3000);await measure('hardware-idle-home',async()=>{},20000);await page.evaluate(()=>window.__budgetProbe.setSampling(true));
   await page.evaluate(()=>{window.__gpuAblation.set({auralis:false});window.__hideAuralis=document.createElement('style');window.__hideAuralis.textContent='.auralis-host,.auralis-host *{visibility:hidden!important}';document.head.append(window.__hideAuralis);});await sleep(5000);await measure('home-without-auralis',async()=>{},15000);
   await page.evaluate(()=>{window.__hideAuralis.remove();window.__gpuAblation.set({auralis:true});});await sleep(5000);await show('visualizer');await show('home');
   await measure('auralis-motion',async()=>{for(let i=0;i<12;i++){await page.evaluate(id=>window.__shell.show(id),i%2?'home':'visualizer');await sleep(450);}},10000);
   await measure('auralis-navigation',async()=>{for(const id of ['visualizer','home','visualizer','home','visualizer','home']){await page.evaluate(id=>window.__shell.show(id),id);await sleep(85);}},15000);
   await show('visualizer');await sleep(3000);await measure('auralis-tool-visible',async()=>{},15000);await show('home');await sleep(3000);
   const focusBrowser=await chromium.launch({executablePath:process.env.CHROME,headless:false}),other=await focusBrowser.newPage();await other.goto('about:blank');await other.bringToFront();windowControl('blur');await sleep(2000);assert(await page.evaluate(()=>!window.__renderBudget.focused),'Native focus loss must reach the render budget');await measure('auralis-unfocused',async()=>{},15000);await focusBrowser.close();windowControl('restore');await sleep(2000);
   windowControl('minimize');await sleep(2000);await measure('auralis-minimized',async()=>{},15000);assert(await page.evaluate(()=>!window.__renderBudget.visible));windowControl('restore');await sleep(3000);
   await measure('auralis-resize',async()=>{windowControl('resize-cycle');},15000);await sleep(3000);await measure('auralis-sleep-after-resize',async()=>{},20000);
   result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;
  }
  if(component==='dpr-sweep'){await page.evaluate(()=>window.__gpuAblation.set({fps:60,scale:1}));for(const dpr of [1,1.25,1.5,2]){await setDpr(dpr);await sleep(5000);await measure('gpu-dpr-'+String(dpr).replace('.','p'),async()=>{},15000);}await setDpr(null);result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;}
  if(component){assert(['field-half','field-half-30'].includes(component));await sleep(5000);await measure('auralis-'+component,async()=>{},20000);await page.evaluate(()=>window.__budgetProbe.setSampling(false));await sleep(3000);await measure('hardware-idle-'+component,async()=>{},20000);result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;}
  if(process.env.HAL_PERF_GPU_ONLY==='1'||process.env.HAL_PERF_GPU_SUITE==='1'){
   const seconds=+(process.env.HAL_PERF_GPU_MS||15000),settle=+(process.env.HAL_PERF_GPU_SETTLE_MS||5000);
   async function ablate(name,config){await page.evaluate(c=>window.__gpuAblation.set(c),{auralis:true,atmosphere:true,live:true,scale:1,fps:0,...config});await sleep(settle);await measure(name,async()=>{},seconds);}
   await ablate('gpu-home-full',{});
   await ablate('gpu-home-no-auralis',{auralis:false});
   await ablate('gpu-home-no-atmosphere',{atmosphere:false});
   await ablate('gpu-home-no-backgrounds',{auralis:false,atmosphere:false});
   await ablate('gpu-home-full-repeat',{});
   await page.addStyleTag({content:'*{backdrop-filter:none!important;filter:none!important;box-shadow:none!important;text-shadow:none!important}'});
   await ablate('gpu-home-no-css-depth',{});
   // Remove exactly this benchmark stylesheet before resolution experiments.
   await page.evaluate(()=>{for(const s of document.querySelectorAll('style'))if(s.textContent.startsWith('*{backdrop-filter:none!important'))s.remove();});
   for(const fps of [60,30])for(const scale of [1,.75,.5,.35])await ablate('gpu-auralis-cap-'+fps+'hz-output-scale-'+String(scale).replace('.','p'),{fps,scale});
   for(const dpr of [1,1.25,1.5,2]){await setDpr(dpr);await ablate('gpu-dpr-'+String(dpr).replace('.','p'),{fps:60});}
   await cdp.send('Emulation.clearDeviceMetricsOverride');
   await page.evaluate(()=>window.__gpuAblation.set({auralis:true,atmosphere:true,scale:1,fps:0}));
   await show('visualizer');await ablate('gpu-tool-static',{});await ablate('gpu-tool-no-auralis',{auralis:false});await ablate('gpu-tool-no-backgrounds',{auralis:false,atmosphere:false});await page.evaluate(()=>window.__gpuAblation.set({keepalive:false}));await sleep(settle);await measure('gpu-tool-no-keepalive',async()=>{},seconds);await page.evaluate(()=>window.__gpuAblation.set({auralis:true,atmosphere:true,keepalive:true}));
   if(process.env.HAL_PERF_GPU_ONLY==='1'){result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;}await show('home');
  }
  if(process.env.HAL_PERF_LOADED_ONLY!=='1'){
  await page.evaluate(()=>window.__shell.welcome());await sleep(800);if(await page.locator('#welcome').getAttribute('data-phase')==='language'){await page.locator('#wLanguage input[value=en]').check();await page.locator('#wOk').click();await page.waitForFunction(()=>document.querySelector('#welcome').dataset.phase==='welcome');}await measure('welcome-active');await page.locator('#wSkip').click();await page.waitForFunction(()=>document.querySelector('#welcome').dataset.phase==='ready');await page.waitForFunction(()=>!window.__motion.busy());await page.locator('#wOk').click();await page.waitForFunction(()=>!document.querySelector('#welcome').open);await sleep(500);
  await show('visualizer');await measure('one-tool-idle');
  const tools=await page.evaluate(()=>window.__modules.MODULES.filter(m=>m.src).map(m=>m.id)); assert.equal(tools.length,10);
  for(const id of tools)await show(id); await measure('ten-tools-visible-one');
  await show('home');await measure('ten-tools-hidden');
  await measure('rapid-navigation',async()=>{for(const id of ['grade','convert','stems','home','removebg','framegrab','home']){await page.evaluate(id=>window.__shell.show(id),id);await sleep(85);}});
  // Three independent worker tasks: each spends ~1 ms per 10 ms on CPU and emits 100 progress reports/s.
  await page.evaluate(()=>{
   window.__fixtureStop=[];window.__fixtureTicks={};
   for(const tool of ['convert','downloader','framegrab']){window.__hal.jobs.submit({tool,kind:'performance-fixture',title:'CPU/progress fixture',lane:'light',host:'page',run:ctx=>new Promise((resolve,reject)=>{const url=URL.createObjectURL(new Blob(['let n=0;setInterval(()=>{const end=performance.now()+1;let x=1;while(performance.now()<end)x=Math.sin(x)+1;postMessage(++n)},10)'],{type:'text/javascript'}));const w=new Worker(url);URL.revokeObjectURL(url);w.onmessage=e=>{window.__fixtureTicks[tool]=e.data;ctx.progress((e.data%1000)/1000,'Working');};w.onerror=e=>reject(Error(e.message));const stop=()=>{w.terminate();resolve()};ctx.signal.addEventListener('abort',stop,{once:true});window.__fixtureStop.push(stop);})});}
  });
  await sleep(500);assert.equal(await page.evaluate(()=>window.__hal.jobs.list().filter(j=>j.kind==='performance-fixture'&&j.state==='running').length),3);
  await page.waitForFunction(()=>Object.values(window.__fixtureTicks).length===3&&Object.values(window.__fixtureTicks).every(n=>n>=20),null,{timeout:10000});
  await measure('ten-tools-three-worker-jobs');await page.evaluate(()=>window.__shell.processes.open());await sleep(600);await measure('three-jobs-activity-open');
  await measure('three-jobs-navigation',async()=>{for(const id of ['stems','grade','convert','home']){await show(id);}});
  await page.evaluate(()=>{window.__shell.processes.close();window.__fixtureStop.forEach(f=>f());});await sleep(800);if(phase==='workers'){result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;}
  await show('home');
  if(native){
   await page.evaluate(()=>window.__budgetProbe.setSampling(false));
   const focusBrowser=await chromium.launch({executablePath:process.env.CHROME,headless:false});
   try{
    const other=await focusBrowser.newPage();await other.goto('about:blank');
    const focusCDP=await focusBrowser.newBrowserCDPSession(),focusPid=(await focusCDP.send('SystemInfo.getProcessInfo')).processInfo.find(p=>p.type==='browser').id;
    let blurred;
    for(let attempt=0;attempt<3;attempt++){
     windowControl('blur',['-BlurProcessId',String(focusPid),'-BlurExecutable',process.env.CHROME]);await page.waitForFunction(()=>!window.__renderBudget.focused);await sleep(2000);
     blurred=await measure('window-unfocused-hardware-idle'+(attempt?'-retry-'+attempt:''));
     blurred.suspensionValid=!blurred.focusWindow.before.focused&&!blurred.focusWindow.after.focused&&!blurred.focusWindow.events.some(e=>e.focused);save();if(blurred.suspensionValid)break;
    }
    assert(blurred.suspensionValid,'Unfocused interval interrupted by focus restoration');assert.equal(blurred.realms[0].draws.auralis||0,0);
   }finally{await focusBrowser.close();}
   windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.visible&&window.__renderBudget.focused);
   let minimized;
   for(let attempt=0;attempt<3;attempt++){
    windowControl('minimize');await page.waitForFunction(()=>!window.__renderBudget.visible);await sleep(2000);
    minimized=await measure('window-minimized-hardware-idle'+(attempt?'-retry-'+attempt:''));
    minimized.suspensionValid=!minimized.focusWindow.before.visible&&!minimized.focusWindow.after.visible&&!minimized.focusWindow.events.some(e=>e.focused);save();if(minimized.suspensionValid)break;
   }
   assert(minimized.suspensionValid,'Minimized interval interrupted by window restoration');assert.equal(minimized.realms[0].draws.auralis||0,0);
   windowControl('restore');await page.waitForFunction(()=>window.__renderBudget.visible&&window.__renderBudget.focused);await page.evaluate(()=>window.__budgetProbe.setSampling(true));
  }else{
   const other=await browser.newPage();await other.goto('about:blank');await other.bringToFront();await sleep(400);await measure('window-unfocused');await other.close();await page.bringToFront();
   const win=await cdp.send('Browser.getWindowForTarget');await cdp.send('Browser.setWindowBounds',{windowId:win.windowId,bounds:{windowState:'minimized'}});await sleep(800);await measure('window-minimized');await cdp.send('Browser.setWindowBounds',{windowId:win.windowId,bounds:{windowState:'normal'}});await page.bringToFront();
  }
  }else{assert(native,'Loaded-only attribution requires native Preview');for(const id of await page.evaluate(()=>__modules.MODULES.filter(m=>m.src).map(m=>m.id)))await show(id);await show('home');result.environment.loadedOnlyAttribution={cutoutPreparation:process.env.HAL_PERF_NO_CUTOUT_PREP!=='1',modelTransfer:process.env.HAL_PERF_MODEL_WHOLE==='1'?'whole':'512KiB'};}
  await sleep(1000);
  // Real Web Audio preview + navigation, using the existing host's probe (no model/network needed).
  const wav=path.join(tmp,'tone.wav'),rate=22050,len=rate*12,buf=Buffer.alloc(44+len*2);buf.write('RIFF');buf.writeUInt32LE(buf.length-8,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(rate,24);buf.writeUInt32LE(rate*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(len*2,40);for(let i=0;i<len;i++)buf.writeInt16LE(Math.sin(i*2*Math.PI*220/rate)*12000,44+i*2);fs.writeFileSync(wav,buf);
  await show('convert');await page.evaluate(p=>window.__hal.invoke('session_allow_video',{path:p}),wav);const convert=page.frames().find(f=>f.url().endsWith('/convert.html'));await convert.evaluate(p=>window.__halApp.takeAudio({path:p,name:'tone.wav'}),wav);console.log('Converter fixture',await convert.evaluate(()=>window.__convert.C.items.map(i=>({state:i.state,src:i.src,probeError:i.probeError}))));await convert.locator('.play').waitFor();await convert.locator('.play').click();await measure('converter-audio-visible',async()=>{},2000);await show('home');await measure('converter-audio-hidden',async()=>{},2000);

  // Actual media retained across tools. Native runs use already installed engines; the harness does not install them.
  const cp=require('child_process'),fixtures=path.join(tmp,'media');fs.mkdirSync(fixtures);
  const image=path.join(fixtures,'large-cover.png'),video=path.join(fixtures,'clip.webm');
  cp.execFileSync(process.env.FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=2048x2048','-frames:v','1','-y',image]);
  cp.execFileSync(process.env.FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=1280x720:rate=30:duration=8','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-g','60','-y',video]);
  const file=async(id,selector,p)=>{await show(id);const f=page.frames().find(f=>f.url().endsWith('/'+id+'.html'));await fileInput(id,selector,p);await sleep(1200);return f;};
  await measure('grade-load',()=>file('grade','#imgIn',image));await measure('grade-loaded-idle');
  const grade=page.frames().find(f=>f.url().endsWith('/grade.html'));
  await measure('grade-loaded-controls',async()=>{await grade.evaluate(async()=>{document.querySelector('#grid button')?.click();const e=document.querySelector('#layers input[type=range]');if(!e)throw Error('Grade layer slider missing');for(let i=0;i<45;i++){e.value=30+i;e.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(requestAnimationFrame);}e.dispatchEvent(new Event('change',{bubbles:true}));});});
  await show('covertest');const cover=page.frames().find(f=>f.url().endsWith('/covertest.html'));await fileInput('covertest','#imgIn',image);await cover.evaluate(()=>window.__halApp.flush());await measure('three-loaded-tools-visible-cover');
  await show('stems');await page.evaluate(p=>window.__hal.invoke('session_allow_video',{path:p}),wav);const stems=page.frames().find(f=>f.url().endsWith('/stems.html'));await stems.locator('#autoExport').uncheck();await stems.evaluate(p=>window.__halApp.takeAudio({path:p,name:'tone.wav'}),wav);
  await measure('framegrab-load',()=>file('framegrab','#videoIn',video));await measure('framegrab-loaded-idle');
  const fg=page.frames().find(f=>f.url().endsWith('/framegrab.html'));await fg.waitForFunction(()=>window.__halApp.state().shown.exact&&!window.__halApp.state().loading,null,{timeout:60000});
  await measure('framegrab-scrub',async()=>{await fg.evaluate(async()=>{for(let i=0;i<60;i++){window.__halApp.show(i*3);await new Promise(requestAnimationFrame);}});});
  await show('home');await measure('five-loaded-tools-hidden');
  await file('upscale','#imgIn',image);await file('interp','#vidIn',video);
  await show('visualizer');const vis=page.frames().find(f=>f.url().endsWith('/visualizer.html'));await fileInput('visualizer','#artIn',image);await fileInput('visualizer','#audIn',wav);await sleep(1200);
  await show('removebg');const rb=page.frames().find(f=>f.url().endsWith('/removebg.html'));await rb.evaluate(()=>window.__rb.setMode('brush'));await fileInput('removebg','#imgIn',image);await sleep(1200);
  await show('home');await measure('ten-open-tools-loaded-media-hidden',async()=>{},process.env.HAL_PERF_LOADED_ONLY==='1'?10000:duration);
  if(process.env.HAL_PERF_LOADED_ONLY==='1'&&process.env.HAL_PERF_NO_CUTOUT_PREP!=='1'){
   const model=await measure('ten-open-tools-loaded-media-hidden-model-completion',async()=>{await rb.waitForFunction(()=>__rb.R.sam&&!__rb.R.busy,null,{timeout:180000});},2000);
   assert(model.focusValid,'Model completion interval must retain focus');result.environment.cutoutCompleted=await rb.evaluate(async()=>({ready:!!__rb.R.sam,backend:__rb.R.sam?.backend,features:await Promise.all((__rb.R.sam?.feats||[]).map(async f=>({dims:f.dims,bytes:f.data.byteLength,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',f.data))].map(b=>b.toString(16).padStart(2,'0')).join('')})))}));save();
  }
  if(process.env.HAL_PERF_LOADED_ONLY==='1'){assert.equal(result.scenarios.at(-1).focusValid,true,'Loaded attribution must retain native focus');result.errors=app.errors;assert.deepEqual(result.errors,[]);save();return;}
  await measure('loaded-tools-navigation',async()=>{for(const id of ['grade','stems','covertest','framegrab','visualizer','home'])await show(id);});

  if(native){
   const tools=await page.evaluate(()=>window.__hal.tools(false));result.environment.nativeTools=tools;
   await page.evaluate(()=>{window.__realFixture=[];for(let i=0;i<3;i++){
    const h=window.__hal.jobs.submit({tool:['convert','downloader','framegrab'][i],kind:'real-ffmpeg-fixture',title:'Real FFmpeg encode '+(i+1),lane:'light',host:'page',run:async ctx=>{const p=await ctx.proc('ffmpeg',['-nostdin','-v','error','-re','-f','lavfi','-i','testsrc2=size=1280x720:rate=30','-t','40','-c:v','libx264','-preset','fast','-threads','2','-progress','pipe:1','-f','null','-'],line=>{const m=/^out_time_us=(\d+)/.exec(line);if(m)ctx.progress(+m[1]/40e6,'Encoding');});const code=await p.done;if(code!==0&&!ctx.signal.aborted)throw Error('FFmpeg fixture failed '+code);}});window.__realFixture.push(h.id);
   }});await page.waitForFunction(()=>window.__hal.jobs.list().filter(j=>j.kind==='real-ffmpeg-fixture'&&j.state==='running').length===3,null,{timeout:15000});
   await sleep(2000);assert.equal(await page.evaluate(()=>window.__hal.jobs.list().filter(j=>j.kind==='real-ffmpeg-fixture'&&j.state==='running').length),3);await measure('loaded-tools-three-real-ffmpeg-jobs');await measure('loaded-tools-real-jobs-navigation',async()=>{for(const id of ['grade','stems','framegrab','home'])await show(id);},2000);
   await page.evaluate(()=>window.__shell.processes.open());await sleep(1000);assert.equal(await page.evaluate(()=>window.__hal.jobs.list().filter(j=>j.kind==='real-ffmpeg-fixture'&&j.state==='running').length),3);await measure('loaded-tools-real-jobs-processes-open');await page.evaluate(()=>window.__shell.processes.close());
   await page.evaluate(()=>window.__realFixture.forEach(id=>window.__hal.jobs.cancel(id)));await page.waitForFunction(()=>!window.__hal.jobs.list().some(j=>j.kind==='real-ffmpeg-fixture'&&j.state==='running'),null,{timeout:20000});
  }
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await measure('home-cpu-4x');await measure('navigation-cpu-4x',async()=>{for(const id of ['grade','convert','stems','home'])await show(id);});await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  await measure('home-soak',async()=>{},soak);
  result.errors=app.errors;
  assert.deepEqual(result.errors,[]);save();
 } catch(e) { result.errors.push(String(e));save();throw e; } finally { if(native)for(const p of browser.contexts().flatMap(c=>c.pages()))await p.evaluate(()=>{if(window.__originalProgressBar){window.__motion.bar=window.__originalProgressBar;delete window.__originalProgressBar;}[...(window.__auralisPressureJobs||[]),...(window.__realFixture||[])].forEach(id=>window.__hal?.jobs?.cancel(id));}).catch(()=>{});if(gpu)await gpu.stop();if(native)for(const p of browser.contexts().flatMap(c=>c.pages()))await p.evaluate(()=>window.__budgetProbe?.setSampling?.(false)).catch(()=>{});await browser.close();server.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
