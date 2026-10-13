// Geometry and runtime locale checks only; manual Chromium approval remains required.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {serve,launch,openApp,until,locale}=require('./common'),{createHost}=require('./host');
(async()=>{
 const server=serve(),browser=await launch();
 try {
  const host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),'halation-session-ui-')));
  host.begin();const app=await openApp(browser,server,host),page=app.page;
  for(const width of [1480,900]){
   await page.setViewportSize({width,height:900});
   for(const dock of [true,false]){
    const g=await page.evaluate(dock=>{
     window.__shell.st.settings.showProcesses=dock;window.__procs.paintIsland();
     const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,cx:r.x+r.width/2,cy:r.y+r.height/2};};
     return {head:rect('.head'),island:rect('#procIsland'),box:rect('#toolbox'),mark:dock?rect('.isl-mark'):null,buttons:['#keysBtn','#openBase','#langBtn','#sessionBtn'].map(rect)};
    },dock);
    assert.equal(g.island.width,dock?184:148);assert.equal(g.box.width,144);
    assert.equal(g.head.right-g.island.right,16);assert.equal(g.island.right-g.box.right,2);
    for(let i=0;i<g.buttons.length;i++){
     assert.equal(g.buttons[i].width,36);assert.equal(g.buttons[i].cy,g.head.cy);
     assert.equal(g.buttons[i].cx-g.island.left,20+36*(i+(dock?1:0)));
    }
    if(dock){assert.equal(g.mark.cx-g.island.left,20);assert.equal(g.mark.cy,g.head.cy);}
   }
  }
  await page.evaluate(()=>{window.__shell.st.settings.showProcesses=true;window.__procs.paintIsland();});
  await page.click('#procBtn');
  assert(await until(()=>page.evaluate(()=>{const r=document.querySelector('#procIsland').getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<.5;}),3000));
  await page.evaluate(()=>window.__shell.processes.close());
  console.log('PASS equal 36px slots, shared vertical center, original 16px right anchor, hidden Status and centered expanded island at two viewport widths');
  const en=locale('en').en,es=locale('es').dict;
  for(const key of Object.keys(en).filter(k=>k.startsWith('session.'))){
   assert.equal(typeof es[key],'string',key+' Spanish translation');
   assert.deepEqual([...en[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...es[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort());
  }
  await app.tab('grade');await page.evaluate(()=>window.__shell.ensureApp('grade'));
  await page.frameLocator('#v-grade').locator('body').evaluate(async()=>{const {TEXT,schemaDefaults}=await import('./grader.js'),a=window.__halApp,d=await a.session.capture();d.layers=[{id:'user-text',type:'text',on:true,amt:100,p:{...schemaDefaults(TEXT),text:'User title'}}];await a.session.restore(d);parent.__shell.session.schedule('grade');});
  for(const lang of ['en','es','en']){
   if(await page.evaluate(()=>window.__i18n.lang())!==lang){
    await page.click('#langBtn');await page.click(`#langMenu [data-lang="${lang}"]`);
    await page.waitForFunction(async lang=>window.__i18n?.lang()===lang&&!document.body.classList.contains('booting')&&(await window.__shell?.loadedApp('grade')?.session.capture())?.layers[0].p.text==='User title'&&!window.__shell.session.restoring,lang);
   }
   const {L}=locale(lang);
   await page.click('#sessionBtn');
   for(const [action,key] of [['save','session.save'],['saveAs','session.saveAs'],['open','session.open']])assert.equal(await page.locator(`[data-session="${action}"]`).textContent(),L(key));
   assert.equal(await page.locator('#sessionBtn').getAttribute('title'),L('session.save'));
   assert.equal(await page.locator('#sessionBtn').getAttribute('aria-label'),L('session.save'));
   await page.click('#sessionBtn');
   await page.frameLocator('#v-grade').locator('#thumbPct').evaluate(e=>{e.value=String(+e.value<=5?100:+e.value-5);e.dispatchEvent(new Event('input',{bubbles:true}));});
   const close=page.evaluate(()=>window.__shell.session.close());await page.locator('#modal').waitFor({state:'visible'});
   assert.equal(await page.locator('#mTitle').textContent(),L('session.closeTitle'));assert.equal(await page.locator('#mOk').textContent(),L('session.save'));assert.equal(await page.locator('#mAlt').textContent(),L('session.exit'));
   await page.click('#mCancel');assert.equal(await close,false);
   const call=host.call.bind(host);let release;host.call=async (...args)=>{if(args[0]==='session_write')await new Promise(r=>release=r);return call(...args);};
   const saving=page.evaluate(()=>window.__shell.session.save());
   assert(await until(()=>typeof release==='function',3000));assert.equal(await page.locator('#syncText').textContent(),L('session.saving'));release();assert.equal(await saving,true);host.call=call;
   assert.equal(await page.locator('#syncText').textContent(),L('session.saved'));
   for(const message of ['Unsupported or invalid Halation Session','Session file was not selected','Cannot read Halation Session']){
    host.setSessionOptions({sessionWriteError:message});assert.equal(await page.evaluate(()=>window.__shell.session.save()),false);
    const expected=await page.evaluate(message=>window.t('session.failed',{error:message}),message);
    assert.equal(await page.locator('#syncText').textContent(),expected);assert.equal(await page.locator('#modal').isVisible(),false);
    if(lang==='es')assert(!expected.includes(message),'Own native error is translated');
   }
   host.setSessionOptions({sessionWriteError:null});
   assert.equal(await page.evaluate(()=>window.__i18n.error('Unsupported or invalid Halation Session')),L('session.invalid'));
   await page.frameLocator('#v-grade').locator('#thumbPct').evaluate(e=>{e.value=String(+e.value<=5?100:+e.value-5);e.dispatchEvent(new Event('input',{bubbles:true}));});
   await page.evaluate(()=>window.__shell.session.recovery());await page.reload();
   await page.locator('#modal').waitFor({state:'visible'});
   assert.equal(await page.locator('#mTitle').textContent(),L('session.recoverTitle'));assert.equal(await page.locator('#mText').textContent(),L('session.recoverText'));assert.equal(await page.locator('#mOk').textContent(),L('session.recover'));assert.equal(await page.locator('#mCancel').textContent(),L('session.discard'));
   await page.click('#mOk');assert(await until(()=>page.evaluate(async()=>(await window.__shell.loadedApp('grade')?.session.capture())?.layers[0].p.text==='User title'&&!window.__shell.session.restoring),5000));
   assert.equal((await page.evaluate(()=>window.__shell.session.capture())).dirty,true);
   console.log('PASS runtime '+lang+': menu, accessibility, dirty close, saving/saved/error Status and recovery dialog; user content survives language reload');
  }
  assert.deepEqual(app.errors,[]);
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
