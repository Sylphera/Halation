// Source preparation fidelity and lifecycle; no UI captures or visual artifacts.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {serve,launch,openApp}=require('./common'),{createHost}=require('./host'),{makeFixtures,toolOptions}=require('./fixtures');
(async()=>{
 const FX=makeFixtures(),server=serve(),browser=await launch();
 const inputs=[path.join(FX.FIX,'subject.png'),path.join(FX.FIX,'small.png'),path.join(FX.MEDIA,'art.jpg'),path.join(FX.MEDIA,'thumb.webp')];
 const run=async fallback=>{
  const context=await browser.newContext({reducedMotion:'reduce'}),host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),'halation-grade-source-')),toolOptions(FX));
  await context.addInitScript(()=>{const NativeWorker=Worker;const probe=window.__sourceProbe={workers:new Set(),starts:0,uploads:0,closes:0};window.Worker=class extends NativeWorker{constructor(url,...args){super(url,...args);if(String(url).includes('grade-image-worker')){probe.workers.add(this);probe.starts++;}}terminate(){probe.workers.delete(this);return super.terminate();}};const close=ImageBitmap.prototype.close;ImageBitmap.prototype.close=function(){probe.closes++;return close.call(this);};const upload=WebGL2RenderingContext.prototype.texImage2D;WebGL2RenderingContext.prototype.texImage2D=function(...args){if(args.at(-1) instanceof ImageBitmap)probe.uploads++;return upload.apply(this,args);};});
  await context.route('**/grade.js',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'../scripts/fixtures/grade-image-source.js'),'utf8')}));
  if(!fallback)await context.route('**/grade-image-worker.js',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'../scripts/fixtures/grade-image-worker.js'),'utf8')}));
  if(fallback)await context.route('**/grade-image-worker.js',r=>r.fulfill({contentType:'text/javascript',body:'self.onmessage=()=>self.postMessage({error:"forced fallback"});'}));
  const app=await openApp({newPage:async options=>{const p=await context.newPage();await p.setViewportSize(options.viewport);return p;}},server,host);await app.tab('grade');await app.page.evaluate(()=>__shell.ensureApp('grade'));const f=app.page.frames().find(f=>f.url().endsWith('/grade.html'));
  const hashes=[];for(const file of inputs){await f.locator('#imgIn').setInputFiles(file);await f.waitForFunction(name=>document.querySelector('#imgName').textContent.startsWith(name),path.basename(file));hashes.push(await f.evaluate(async()=>{const result=await __halApp.result();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await result.blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');}));}
  assert.equal(await f.evaluate(()=>__sourceProbe.workers.size),0);if(!fallback){const p=await f.evaluate(()=>({uploads:__sourceProbe.uploads,closes:__sourceProbe.closes}));assert(p.uploads>=inputs.length);assert(p.closes>=p.uploads);}
  if(!fallback){
   const workerCode=fs.readFileSync(path.join(__dirname,'../scripts/fixtures/grade-image-worker.js'),'utf8');
   await context.route('**/grade-image-worker.js',r=>r.fulfill({contentType:'text/javascript',body:workerCode+'\nconst actual=self.onmessage;self.onmessage=e=>setTimeout(()=>actual(e),200);'}));
   const bytes=[...fs.readFileSync(inputs[1])],uploaded=await f.evaluate(()=>__sourceProbe.uploads);
   await f.evaluate(bytes=>{window.__sourcePending=__halApp.loadImage(new File([new Uint8Array(bytes)],'hidden.png',{type:'image/png'}));},bytes);
   await f.waitForFunction(()=>__sourceProbe.workers.size===1);await app.page.evaluate(()=>__shell.show('downloader'));
   await f.waitForFunction(()=>__ui.away&&__sourceProbe.workers.size===0);assert.equal(await f.evaluate(()=>__sourceProbe.uploads),uploaded,'Hidden preparation must not upload a preview');
   await app.tab('grade');await f.evaluate(()=>__sourcePending);assert.equal(await f.evaluate(()=>__sourceProbe.workers.size),0);assert.equal(await f.evaluate(()=>__sourceProbe.uploads),uploaded+1,'Returning prepares exactly one source');
   await f.evaluate(bytes=>{window.__sourcePending=__halApp.loadImage(new File([new Uint8Array(bytes)],'closed.png',{type:'image/png'}));},bytes);
   await f.waitForFunction(()=>__sourceProbe.workers.size===1);await f.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));await f.evaluate(()=>__sourcePending);
   assert.equal(await f.evaluate(()=>__sourceProbe.workers.size),0,'Page teardown terminates the worker');assert.equal(await f.evaluate(()=>__sourceProbe.uploads),uploaded+1,'Teardown cannot publish a late bitmap');
  }
  assert.deepEqual(app.errors,[]);await context.close();return hashes;
 };
 try{const original=await run(true),worker=await run(false);assert.deepEqual(worker,original,'Full-size exported PNG bytes must match original upload');console.log('PASS source worker/full-size fallback PNG byte identity for PNG, JPEG and WebP; workers and bitmaps disposed');}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
