// Grade preview resize must not retain a full set of render targets per old size.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {serve,launch,openApp}=require('./common'),{createHost}=require('./host'),{makeFixtures,toolOptions}=require('./fixtures');
(async()=>{
 const fixtures=makeFixtures(),server=serve(),browser=await launch(),host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),'halation-grade-resources-')),toolOptions(fixtures));
 try{
  const context=await browser.newContext({reducedMotion:'reduce'});
  await context.addInitScript(()=>{const p=WebGL2RenderingContext.prototype,create=p.createTexture,del=p.deleteTexture,textures=window.__gradeTextures=new Set();p.createTexture=function(...args){const t=create.apply(this,args);textures.add(t);return t;};p.deleteTexture=function(t){textures.delete(t);return del.call(this,t);};window.__gradeThumbPaint=0;const put=CanvasRenderingContext2D.prototype.putImageData;CanvasRenderingContext2D.prototype.putImageData=function(...args){if(this.canvas.id.startsWith('th-'))__gradeThumbPaint++;return put.apply(this,args);};});
  if(process.env.HAL_GRADE_LEGACY_POOL==='1')await context.route('**/grade.js',r=>{const code=fs.readFileSync(path.join(__dirname,'../dist/grade.js'),'utf8'),anchor='purge(t => t.w === pw && t.h === ph);';assert(code.includes(anchor));return r.fulfill({contentType:'text/javascript',body:code.replace(anchor,'/* Measured legacy resize-pool control. */')});});
  const app=await openApp({newPage:async options=>{const p=await context.newPage();await p.setViewportSize(options.viewport);return p;}},server,host),page=app.page;
  await app.tab('grade');await page.evaluate(()=>__shell.ensureApp('grade'));const f=page.frames().find(f=>f.url().endsWith('/grade.html'));
  await f.locator('#imgIn').setInputFiles(path.join(fixtures.FIX,'small.png'));
  await f.waitForFunction(()=>document.querySelectorAll('[id^="tw-"].skel').length===0&&__gradeThumbPaint>=document.querySelectorAll('[id^="th-"]').length&&__gradeThumbPaint>0&&document.querySelector('#gl').width>0);await page.waitForTimeout(200);
  const viewport=page.viewportSize();
  const initial=await f.evaluate(()=>({textures:__gradeTextures.size,width:document.querySelector('#gl').width})),counts=[];
  for(let i=0;i<5;i++){
   const old=await f.evaluate(()=>document.querySelector('#gl').width);
   await page.setViewportSize({width:1100+i*50,height:700+i*20});
   await f.waitForFunction(old=>document.querySelector('#gl').width!==old,old);await page.waitForTimeout(100);counts.push(await f.evaluate(()=>__gradeTextures.size));
  }
  await page.setViewportSize(viewport);await f.waitForFunction(w=>document.querySelector('#gl').width===w,initial.width);await page.waitForTimeout(100);
  const final=await f.evaluate(()=>__gradeTextures.size);console.log('Grade texture counts: '+JSON.stringify({initial:initial.textures,counts,final}));
  assert(final<=initial.textures+1,'Old preview sizes must not accumulate render-target textures');assert.deepEqual(app.errors,[]);
  const painted=await f.evaluate(()=>__gradeThumbPaint),looks=await f.locator('[id^="th-"]').count();
  await f.evaluate(async()=>{const {TEXT,schemaDefaults}=await import('./grader.js'),state=await __halApp.session.capture();state.layers=[{id:'resize-text',type:'text',on:true,amt:100,p:{...schemaDefaults(TEXT),text:'Resource regression'}}];await __halApp.session.restore(state);});
  await f.waitForFunction(n=>__gradeThumbPaint>=n&&document.querySelectorAll('[id^="tw-"].skel').length===0,painted+looks);await page.waitForTimeout(100);
  const textInitial=await f.evaluate(()=>__gradeTextures.size),textCounts=[];
  for(let i=0;i<5;i++){
   const old=await f.evaluate(()=>document.querySelector('#gl').width);await page.setViewportSize({width:1100+i*50,height:700+i*20});
   await f.waitForFunction(old=>document.querySelector('#gl').width!==old,old);await page.waitForTimeout(100);textCounts.push(await f.evaluate(()=>__gradeTextures.size));
  }
  await page.setViewportSize(viewport);await f.waitForFunction(w=>document.querySelector('#gl').width===w,initial.width);await page.waitForTimeout(100);
  const textFinal=await f.evaluate(()=>__gradeTextures.size);console.log('Grade text texture counts: '+JSON.stringify({initial:textInitial,counts:textCounts,final:textFinal}));
  assert(textFinal<=textInitial+1,'Text textures for old preview sizes must not accumulate');assert.deepEqual(app.errors,[]);
  console.log('PASS Grade resize cycles retain bounded render-target and text-texture pools');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
