// Cover source URLs must not survive removal. Functional checks only.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {serve,launch,openApp}=require('./common'),{createHost}=require('./host'),{makeFixtures,toolOptions}=require('./fixtures');
(async()=>{
 const fixtures=makeFixtures(),server=serve(),browser=await launch(),host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),'halation-cover-resources-')),toolOptions(fixtures));
 try{
  const context=await browser.newContext({reducedMotion:'reduce'});
  await context.addInitScript(()=>{const create=URL.createObjectURL,revoke=URL.revokeObjectURL,urls=window.__coverURLs=new Set();URL.createObjectURL=function(...args){const u=create.apply(this,args);urls.add(u);return u;};URL.revokeObjectURL=function(u){urls.delete(u);return revoke.call(this,u);};});
  const app=await openApp({newPage:async options=>{const p=await context.newPage();await p.setViewportSize(options.viewport);return p;}},server,host),page=app.page;
  await app.tab('covertest');await page.evaluate(()=>__shell.ensureApp('covertest'));const f=page.frames().find(f=>f.url().endsWith('/covertest.html'));
  const initial=await f.evaluate(()=>__coverURLs.size),counts=[];
  for(let i=0;i<5;i++){
   await f.locator('#imgIn').setInputFiles(path.join(fixtures.FIX,'small.png'));await f.evaluate(()=>__halApp.flush());
   await f.locator('#covers [data-act="remove"]').click();await f.evaluate(()=>__halApp.flush());counts.push(await f.evaluate(()=>__coverURLs.size));
  }
  console.log('Cover add/remove source URL counts: '+JSON.stringify({initial,counts}));
  assert(counts.every(n=>n===initial),'Every removed cover must release its original URL as well as derived crops');assert.deepEqual(app.errors,[]);
  console.log('PASS five Cover Test add/remove cycles retain no source/crop URLs');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
