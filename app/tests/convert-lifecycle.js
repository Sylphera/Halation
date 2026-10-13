// Real audio preview lifecycle: idle/hidden graphs must sleep and playback must resume.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {serve,launch,openApp}=require('./common'),{createHost}=require('./host'),{makeFixtures,toolOptions}=require('./fixtures');
(async()=>{
 const fixtures=makeFixtures(),server=serve(),browser=await launch(),host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),'hal-convert-life-')),toolOptions(fixtures));
 try {
  const app=await openApp(browser,server,host,{init:()=>{const Original=AudioContext;window.__audioGraphs=[];window.__wavePaints=0;const clear=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...a){if(this.canvas.classList.contains("wave"))__wavePaints++;return clear.apply(this,a);};window.AudioContext=class extends Original{constructor(...a){super(...a);__audioGraphs.push(this);}};}}),page=app.page;
  await app.tab('convert');await page.evaluate(()=>__shell.ensureApp('convert'));const f=page.frames().find(f=>f.url().endsWith('/convert.html'));
  // Init scripts are inherited by tool frames. Keep the original source on disk, just as a native picker does.
  await f.evaluate(p=>__halApp.takeAudio({path:p,name:'song one.wav'}),path.join(fixtures.FIX,'song one.wav'));
  await f.locator('#preview .player .play').waitFor();await f.waitForFunction(()=>__audioGraphs.length>0&&__wavePaints>0);
  await f.waitForFunction(()=>__audioGraphs.every(c=>c.state==='suspended'));
  await f.locator('#preview .play').click();await f.waitForFunction(()=>__audioGraphs.some(c=>c.state==='running'));
  await page.evaluate(()=>__shell.show('home'));await f.waitForFunction(()=>__audioGraphs.every(c=>c.state==='suspended'));
  await page.evaluate(()=>__shell.show('convert'));await f.locator('#preview .play').click();await f.waitForFunction(()=>__audioGraphs.some(c=>c.state==='running'));
  await f.waitForFunction(()=>__audioGraphs.every(c=>c.state==='suspended'),null,{timeout:8000});
  await f.evaluate(()=>{const ac=__audioGraphs[0],resume=ac.resume.bind(ac);ac.resume=()=>new Promise((resolve,reject)=>setTimeout(()=>resume().then(resolve,reject),300));document.querySelector('#preview .play').click();parent.__shell.show('home');});
  await f.waitForFunction(()=>__ui.away);await page.waitForTimeout(450);
  assert.equal(await f.evaluate(()=>__audioGraphs[0].state),'suspended','An in-flight resume must not reactivate hidden audio');
  await page.evaluate(()=>__shell.show('convert'));
  await f.locator('#changeBtn').click();
  await f.evaluate(p=>__halApp.takeAudio({path:p,name:'song two.wav'}),path.join(fixtures.FIX,'song two.wav'));
  await f.waitForFunction(()=>__audioGraphs.length===2&&__audioGraphs[0].state==='closed'&&__audioGraphs[1].state==='suspended');
  assert.deepEqual(app.errors,[]);console.log('PASS idle, hidden, resumed and ended Converter audio; replaced graph closed');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
