// Grade's internal loading/rendering paths. Functional checks only; no visual capture.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {serve,launch,openApp}=require('./common'),{createHost}=require('./host'),{makeFixtures,toolOptions}=require('./fixtures');
(async()=>{
 const FX=makeFixtures(),host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),'halation-grade-runtime-')),toolOptions(FX)),server=serve(),browser=await launch();
 try{
  const context=await browser.newContext({reducedMotion:'reduce'});
  await context.addInitScript(()=>{
   const urls=window.__gradeURLs=new Set(),create=URL.createObjectURL,revoke=URL.revokeObjectURL;
   URL.createObjectURL=function(...a){const url=create.apply(this,a);urls.add(url);return url;};URL.revokeObjectURL=function(url){urls.delete(url);return revoke.call(this,url);};
   window.__shaderCompiles=0;const compile=WebGL2RenderingContext.prototype.compileShader;WebGL2RenderingContext.prototype.compileShader=function(...a){window.__shaderCompiles++;return compile.apply(this,a);};
  });
  // Keep the usual host/bootstrap while attaching instrumentation before the page loads.
  const app=await openApp({newPage:async options=>{const page=await context.newPage();await page.setViewportSize(options.viewport);return page;}},server,host),page=app.page;
  await app.tab('grade');await page.evaluate(()=>window.__shell.ensureApp('grade'));
  const f=page.frames().find(f=>f.url().includes('grade.html'));
  const initial=await f.evaluate(()=>window.__shaderCompiles);
  assert(initial>=1&&initial<=5,'Opening an empty tool prepares only its vertex shader and basic preview passes');
  const bytes=fs.readFileSync(path.join(FX.FIX,'small.png'));
  await f.evaluate(async bytes=>{await window.__halApp.loadImage(new File([new Uint8Array(bytes)],'small.png',{type:'image/png'}));},Array.from(bytes));
  for(let i=0;i<5;i++)await f.evaluate(async bytes=>{await window.__halApp.loadImage(new File([new Uint8Array(bytes)],'replacement.png',{type:'image/png'}));},Array.from(bytes));
  assert.equal(await f.evaluate(()=>window.__gradeURLs.size),1,'Replacing media keeps only the current source Object URL');
  await f.evaluate(()=>window.__halApp.loadImage(new File(['invalid PNG'],'invalid.png',{type:'image/png'})));
  assert.equal(await f.evaluate(()=>window.__gradeURLs.size),1,'Failed decode releases its URL and retains the current image');
  const outputs=await f.evaluate(async()=>{
   const {FX,fxDefaults}=await import('./grader.js'),a=window.__halApp,base=await a.session.capture();base.output.size='orig';const sizes=[];
   for(const fx of Object.keys(FX)){
    await a.session.restore({...base,layers:[{id:'effect',type:'fx',fx,on:true,amt:100,p:fxDefaults(fx)}]});
    const result=await a.result(),img=await window.__img.load(result.blob);sizes.push([fx,img.naturalWidth,img.naturalHeight]);URL.revokeObjectURL(img.__url);
   }
   return sizes;
  });
  assert(outputs.length>10);for(const [fx,w,h]of outputs)assert.deepEqual([w,h],[96,96],fx+' keeps original export dimensions');
  assert.deepEqual(app.errors,[]);console.log('PASS empty Grade shader loading, five replacements, failed decode cleanup, '+outputs.length+' effects rendered/exported at original dimensions without errors');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
