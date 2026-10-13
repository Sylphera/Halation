// Shared session lifecycle and tool adapters, without captures or video.
const fs=require("fs"),path=require("path"),os=require("os"),assert=require("assert/strict");
const {serve,launch,openApp,until}=require("./common"),{createHost}=require("./host");
(async()=>{
 const server=serve(),browser=await launch();
 try{
  const host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),"halation-sessions-")));
  const appPath=path.join(host.base,"Settings/app.json"),saved=path.join(host.base,"Sessions/Session.halation-session"),recovery=path.join(host.base,"Sessions/.recovery.json");
  fs.writeFileSync(appPath,JSON.stringify({settings:{language:"es",version:2,artistName:"Artist"},toolDefaults:{grade:{imageSize:"2000",imageFormat:"jpg"}},profiles:{references:[]},intro:{quality:"high",grid:true},grade:{previewPct:25,current:{layers:[]}},framegrab:{volume:.1,muted:true},upscale:{scale:2,model:"art"}}));
  host.begin();let app=await openApp(browser,server,host),page=app.page;
  for(const id of ["visualizer","grade","downloader","upscale","framegrab","interp","removebg","covertest"]){await app.tab(id);await page.evaluate(id=>window.__shell.ensureApp(id),id);}
  assert.deepEqual(app.errors,[]);
  let snap=await page.evaluate(()=>window.__shell.session.capture());
  assert.equal(snap.dirty,false,"Merely opening every tool does not create dirty work");
  assert(!("intro" in snap.tools));assert.equal(snap.tools.grade.thumbnail,100);assert.deepEqual(snap.tools.framegrab.sound,{volume:.8,muted:false});
  console.log("PASS normal launch resets every temporary option; opening tools stays clean");
  await app.tab("grade");
  await page.frameLocator("#v-grade").locator('body').evaluate(()=>{document.querySelector('#thumbPct').value="55";document.querySelector('#thumbPct').dispatchEvent(new Event('input',{bubbles:true}));});
  await page.frameLocator("#v-framegrab").locator('body').evaluate(()=>{document.querySelector('#vol').value="0.3";document.querySelector('#vol').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#muteBtn').disabled=false;document.querySelector('#muteBtn').click();});
  snap=await page.evaluate(()=>window.__shell.session.capture());assert.equal(snap.dirty,true);
  assert.equal(snap.tools.grade.thumbnail,55);assert.deepEqual(snap.tools.framegrab.sound,{volume:.3,muted:true});
  assert.equal(await page.evaluate(()=>window.__shell.session.save()),true);
  assert(fs.existsSync(saved));let disk=JSON.parse(fs.readFileSync(saved,"utf8"));assert.equal(disk.version,1);assert(!("intro" in disk.tools));
  assert.equal((await page.evaluate(()=>window.__shell.session.capture())).dirty,false);
  host.setSessionOptions({sessionSavePath:path.join(host.base,"Sessions/Other.halation-session")});assert.equal(await page.evaluate(()=>window.__shell.session.save(true)),true);
  host.emit("close-requested",null);assert(await until(()=>host.session.quit===1,5000));assert(!fs.existsSync(recovery));await page.close();
  host.begin();app=await openApp(browser,server,host);page=app.page;await app.tab("grade");await page.evaluate(()=>window.__shell.ensureApp("grade"));
  snap=await page.evaluate(()=>window.__shell.session.capture());assert.equal(snap.tools.grade.thumbnail,100);assert.equal(snap.dirty,false);
  host.setSessionOptions({sessionOpenPath:saved});const opened=await page.evaluate(()=>window.__shell.session.open());assert.equal(opened,true,await page.locator('#syncText').textContent()+JSON.stringify(app.errors));
  snap=await page.evaluate(()=>window.__shell.session.capture());assert(!("intro" in snap.tools));assert.equal(snap.tools.grade.thumbnail,disk.tools.grade.thumbnail);assert.deepEqual(snap.tools.framegrab.sound,disk.tools.framegrab.sound);assert.equal(snap.active,"grade");
  assert.equal(snap.dirty,false);
  const picks=host.log.filter(([cmd])=>cmd==='session_pick').length;assert.equal(await page.evaluate(()=>window.__shell.session.save()),true);assert.equal(host.log.filter(([cmd])=>cmd==='session_pick').length,picks,'Save writes directly to the associated file');
  console.log("PASS Save, Save As, clean close, clean restart and Open restore classified presentation values");
  await page.frameLocator("#v-grade").locator('#thumbPct').evaluate(e=>{e.value="65";e.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.evaluate(()=>window.__shell.session.recovery());assert(fs.existsSync(recovery));await page.close();host.begin();
  app=await openApp(browser,server,host);page=app.page;await page.locator('#modal').waitFor({state:'visible'});assert.equal(await page.locator('#mTitle').textContent(),"¿Recuperar la sesión anterior?");
  await page.click('#mOk');assert(await until(async()=>await page.evaluate(()=>window.__shell.active()==='grade'),10000));
  snap=await page.evaluate(()=>window.__shell.session.capture());assert.equal(snap.tools.grade.thumbnail,65);assert.equal(snap.dirty,true);console.log("PASS unexpected termination offers explicit recovery and restores unsaved work");
  host.emit('close-requested',null);await page.locator('#modal').waitFor({state:'visible'});assert.equal(await page.locator('#mOk').textContent(),"Guardar sesión");assert.equal(await page.locator('#mAlt').textContent(),"Salir sin guardar");await page.click('#mCancel');assert.equal(host.session.quit,0);
  await page.evaluate(()=>window.__shell.session.recovery());await page.close();host.begin();app=await openApp(browser,server,host);page=app.page;await page.locator('#modal').waitFor({state:'visible'});await page.click('#mCancel');assert(await until(()=>!fs.existsSync(recovery),3000));await app.tab("grade");await page.evaluate(()=>window.__shell.ensureApp("grade"));assert.equal((await page.evaluate(()=>window.__shell.session.capture())).dirty,false);
  await page.evaluate(()=>{window.__closeHandle=window.__hal.jobs.submit({tool:'interp',kind:'interpolate',title:'Active job',lane:'gpu',host:'page',run:async ctx=>{window.__activeStarted=true;await new Promise(r=>ctx.signal.addEventListener('abort',r,{once:true}));window.__cancelCleanup=true;await new Promise(r=>window.__finishSessionCleanup=r);ctx.check();}});});
  assert(await until(()=>page.evaluate(()=>window.__activeStarted),5000));
  host.emit('close-requested',null);await page.locator('#modal').waitFor({state:'visible'});assert((await page.locator('#mText').textContent()).includes('se cancelarán'));assert((await page.locator('#mText').textContent()).includes('AI Interpolate'));await page.click('#mAlt');
  assert(await until(()=>page.evaluate(()=>window.__cancelCleanup),3000));assert.equal(host.session.quit,0);await page.evaluate(()=>window.__finishSessionCleanup());assert(await until(()=>host.session.quit===1,5000));
  await page.close();host.begin();app=await openApp(browser,server,host);page=app.page;host.emit('close-requested',null);assert(await until(()=>host.session.quit===1,5000));assert.equal(await page.locator('#modal').isVisible(),false);
  const permanent=JSON.parse(fs.readFileSync(appPath,'utf8'));assert.equal(permanent.settings.language,'es');assert.equal(permanent.settings.artistName,'Artist');assert.equal(permanent.toolDefaults.grade.imageSize,'2000');assert.deepEqual(permanent.profiles.references,[]);assert(!permanent.intro&&!permanent.framegrab&&!permanent.upscale);
  assert.deepEqual(app.errors,[]);console.log("PASS Discard recovery starts clean; idle close has no dialog; dirty close can cancel; active close warns and awaits cancellation cleanup; preferences remain separate");
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
