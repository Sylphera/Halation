// Functional coordinator checks; no screenshots or frame capture.
const fs=require("fs"),path=require("path"),os=require("os"),vm=require("vm"),assert=require("assert/strict");
const {serve,launch,openApp,until}=require("./common"),{createHost}=require("./host");
(async()=>{
 const events={},calls=[],intervals=[],timeouts=[],element={addEventListener(){}};
 const context={window:{__shell:{ready:Promise.resolve(),invoke:async command=>{calls.push(command);return null;},M:{}}},document:{readyState:"loading",querySelector:()=>element,addEventListener:(name,callback)=>events[name]=callback},setInterval:(fn,ms)=>intervals.push(ms),setTimeout:(fn,ms)=>timeouts.push(ms),clearTimeout(){},Map,Set,WeakMap};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../dist/sessions.js"),"utf8"),context);
 await Promise.resolve();assert.deepEqual(calls,[],"Sessions waits for the shell DOM initialization");
 context.window.__shell.session.schedule("grade");assert.deepEqual(timeouts,[]);
 context.window.__hal={};context.document.readyState="interactive";events.DOMContentLoaded();
 await context.window.__shell.session.ready;
 assert.equal(context.window.__hal.session,context.window.__shell.session);assert.deepEqual(calls,["session_recovery"]);assert.deepEqual(intervals,[180000]);
 assert.deepEqual(timeouts,[900],"An edit arriving before startup completes still gets debounced recovery");
 console.log("PASS early shell readiness cannot initialize Sessions before the shared API exists");
 const server=serve(),browser=await launch();
 try {
  const host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),"halation-runtime-")));host.begin();
  const {page,errors}=await openApp(browser,server,host);
  await page.evaluate(async()=>{
   window.__counts={grade:0,interp:0};window.__values={grade:0,interp:0};
   for(const id of ["grade","interp"])await window.__shell.session.register(id,{capture:async()=>{window.__counts[id]++;return {value:window.__values[id]};}});
   window.__counts={grade:0,interp:0};
   for(let i=0;i<10000;i++){window.__values.grade=i;window.__shell.session.schedule("grade");}
  });
  assert.deepEqual(await page.evaluate(()=>window.__counts),{grade:0,interp:0},"Dirty does not invoke any adapter");
  await page.waitForTimeout(500);
  await page.evaluate(()=>{window.__values.grade=10000;window.__shell.session.schedule("grade");});
  await page.waitForTimeout(500);
  assert.deepEqual(await page.evaluate(()=>window.__counts),{grade:0,interp:0},"Debounce resets before capture");
  assert(await until(()=>page.evaluate(()=>window.__counts.grade===1),3000));
  assert.deepEqual(await page.evaluate(()=>window.__counts),{grade:1,interp:0},"Only dirty adapter is captured");
  const writes=()=>host.log.filter(([cmd])=>cmd==="session_recovery_write").length;
  assert(await until(()=>writes()===1,3000));
  await page.evaluate(()=>{for(let i=0;i<1000;i++)window.__shell.emit("jobs",{progress:i/1000,status:"running"});});
  await page.waitForTimeout(3200);
  assert.equal(writes(),1);assert.deepEqual(await page.evaluate(()=>window.__counts),{grade:1,interp:0},"No progress capture or background polling");
  console.log("PASS O(1) dirty, debounce before capture, unchanged adapter cache, no jobs/progress dirty or polling");
  const buffers=await page.evaluate(async()=>{
   const s=window.__shell.session,original=new Float32Array([0,.125,1,-3.5]),packed=await s.encode(original),again=await s.encode(original),decoded=await s.decode(packed);
   const c=document.createElement("canvas");c.width=2;c.height=1;const pixels=new Uint8ClampedArray([7,17,31,255,99,100,101,255]);c.getContext("2d").putImageData(new ImageData(pixels,2,1),0,0);
   const canvas=await s.encode(c),restored=await s.decode(canvas),after=await s.encode(restored);
   const nested=await s.decode([canvas,canvas]),nestedPixels=nested.map(x=>[...x.getContext("2d").getImageData(0,0,2,1).data]);
   original[2]=.5;const edited=await s.encode(original);
   const legacy=await s.decode({sessionArray:"Uint8Array",values:[0,13,255]});
   const legacyCanvas=await s.decode({sessionCanvas:{width:2,height:1,pixels:[...pixels]}});
   return {packed,again,edited,values:[...decoded],pixels:[...restored.getContext("2d").getImageData(0,0,2,1).data],canvas,after,legacy:[...legacy],legacyPixels:[...legacyCanvas.getContext("2d").getImageData(0,0,2,1).data],nested:nestedPixels};
  });
  assert.deepEqual(buffers.values,[0,.125,1,-3.5]);assert.deepEqual(buffers.pixels,[7,17,31,255,99,100,101,255]);assert.deepEqual(buffers.legacy,[0,13,255]);
  assert.deepEqual(buffers.legacyPixels,buffers.pixels);
  assert.deepEqual(buffers.nested,[buffers.pixels,buffers.pixels]);
  assert(!buffers.packed.values&&!buffers.canvas.sessionCanvas.pixels,"Buffers are referenced, not embedded in JSON");
  assert.deepEqual(buffers.again,buffers.packed);assert.deepEqual(buffers.after,buffers.canvas);assert.notEqual(buffers.edited.file.path,buffers.packed.file.path);
  assert.equal(fs.statSync(buffers.packed.file.path).size,16);assert.deepEqual(errors,[]);
  console.log("PASS lossless referenced arrays/canvases, stable unchanged references, changed bytes get a new file, legacy embedded arrays still decode");
  await page.evaluate(()=>{
   const invoke=window.__shell.invoke;window.__failedRecovery=false;
   window.__shell.invoke=(...args)=>{if(args[0]==="session_recovery_write"&&!window.__failedRecovery){window.__failedRecovery=true;return Promise.reject(Error("Temporary recovery failure"));}return invoke(...args);};
   window.__values.grade=10001;window.__shell.session.schedule("grade");
  });
  assert(await until(()=>page.evaluate(()=>window.__failedRecovery),3000));
  assert(await until(()=>writes()===2,5000));
  assert.deepEqual(await page.evaluate(()=>window.__counts),{grade:2,interp:0},"Retry reuses the captured state instead of recapturing tools");
  console.log("PASS failed recovery retries the cached snapshot without polling or recapturing adapters");
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
