// Grade thumbnail readback lifecycle. Functional checks, no visual artifacts.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {serve,launch,openApp}=require('./common'),{createHost}=require('./host'),{makeFixtures,toolOptions}=require('./fixtures');
(async()=>{
 const fixtures=makeFixtures(),server=serve(),browser=await launch(),host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),'halation-grade-thumbs-')),toolOptions(fixtures));
 try{
  const context=await browser.newContext({reducedMotion:'reduce'});
  await context.addInitScript(()=>{
   const p=WebGL2RenderingContext.prototype,read=p.readPixels,fence=p.fenceSync,wait=p.clientWaitSync,del=p.deleteSync,bind=p.bindBuffer,delBuffer=p.deleteBuffer;
   const probe=window.__thumbProbe={syncs:new Set(),buffers:new Set(),workers:new Set(),workerStarts:0,asyncReads:0,held:false,painted:0};
   const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);probe.workers.add(this);probe.workerStarts++;}terminate(){probe.workers.delete(this);return super.terminate();}};
   p.bindBuffer=function(target,buffer){if(target===this.PIXEL_PACK_BUFFER&&buffer)probe.buffers.add(buffer);return bind.call(this,target,buffer);};
   p.deleteBuffer=function(buffer){probe.buffers.delete(buffer);return delBuffer.call(this,buffer);};
   p.readPixels=function(...args){if(typeof args[6]==='number')probe.asyncReads++;return read.apply(this,args);};
   p.fenceSync=function(...args){const sync=fence.apply(this,args);probe.syncs.add(sync);return sync;};
   p.clientWaitSync=function(...args){return probe.held?this.TIMEOUT_EXPIRED:wait.apply(this,args);};
   p.deleteSync=function(sync){probe.syncs.delete(sync);return del.call(this,sync);};
   const put=CanvasRenderingContext2D.prototype.putImageData;CanvasRenderingContext2D.prototype.putImageData=function(...args){if(this.canvas.id.startsWith('th-'))probe.painted++;return put.apply(this,args);};
  });
  const app=await openApp({newPage:async options=>{const p=await context.newPage();await p.setViewportSize(options.viewport);return p;}},server,host),page=app.page;
  await app.tab('grade');await page.evaluate(()=>__shell.ensureApp('grade'));const f=page.frames().find(f=>f.url().endsWith('/grade.html'));
  const bytes=[...fs.readFileSync(path.join(fixtures.FIX,'small.png'))];
  await f.evaluate(async bytes=>{__thumbProbe.held=true;await __halApp.loadImage(new File([new Uint8Array(bytes)],'first.png',{type:'image/png'}));},bytes);
  await f.waitForFunction(()=>__thumbProbe.syncs.size===1);
  await page.evaluate(()=>__shell.show('downloader'));
  await f.waitForFunction(()=>__ui.away&&__thumbProbe.syncs.size===0);
  assert.equal(await f.evaluate(()=>__thumbProbe.buffers.size),0,'Hidden Grade releases pending pixel buffer');
  assert.equal(await f.evaluate(()=>__thumbProbe.workers.size),0,'Hidden Grade terminates thumbnail worker');
  const count=await f.evaluate(()=>__thumbProbe.painted);await page.waitForTimeout(150);
  assert.equal(await f.evaluate(()=>__thumbProbe.painted),count,'Hidden Grade paints no thumbnail');
  await f.evaluate(()=>{__thumbProbe.held=false;});await app.tab('grade');
  await f.waitForFunction(()=>document.querySelectorAll('[id^="tw-"].skel').length===0&&__thumbProbe.asyncReads>1&&__thumbProbe.syncs.size===0,null,{timeout:15000});
  assert.equal(await f.evaluate(()=>__thumbProbe.buffers.size),0,'Completed readbacks release buffers');
  const expected=await f.locator('[id^="th-"]').count();assert.equal(await f.evaluate(()=>__thumbProbe.painted),expected,'Every look, including the interrupted one, eventually paints');
  await f.evaluate(async bytes=>{__thumbProbe.held=true;await __halApp.loadImage(new File([new Uint8Array(bytes)],'second.png',{type:'image/png'}));},bytes);
  await f.waitForFunction(()=>__thumbProbe.syncs.size===1);
  await f.evaluate(async bytes=>{await __halApp.loadImage(new File([new Uint8Array(bytes)],'third.png',{type:'image/png'}));},bytes);
  await page.waitForTimeout(100);const before=await f.evaluate(()=>__thumbProbe.painted);await f.evaluate(()=>{__thumbProbe.held=false;});
  await f.waitForFunction(()=>document.querySelectorAll('[id^="tw-"].skel').length===0&&__thumbProbe.syncs.size===0,null,{timeout:15000});
  assert.equal(await f.evaluate(()=>__thumbProbe.painted)-before,expected,'Stale readback is discarded after source replacement');
  assert.equal(await f.evaluate(()=>__thumbProbe.buffers.size),0);await f.waitForFunction(()=>__thumbProbe.workers.size===0);assert(await f.evaluate(()=>__thumbProbe.workerStarts)>0,'LUTs were prepared in a worker');assert.deepEqual(app.errors,[]);
  console.log('PASS asynchronous thumbnail readback, hidden cancellation/resume, all looks, source replacement and complete fence/buffer cleanup');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
