// Actual tool functions, synthetic progress/result input; no model or visual capture.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {serve,launch,openApp,sleep}=require('./common'),{createHost}=require('./host');
(async()=>{const server=serve(),browser=await launch(),host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),'hal-stems-life-')));
try{
 const app=await openApp(browser,server,host),page=app.page;
 await page.route('**/stems.js',r=>{const source=fs.readFileSync(path.join(__dirname,'../dist/stems.js'),'utf8');assert(source.includes('window.__stems ='));return r.fulfill({contentType:'text/javascript',body:source.replace('window.__stems =','window.__testStems={up,byJob};window.__stems =')});});
 await page.evaluate(async()=>{__shell.show('stems');await __shell.ensureApp('stems');});await sleep(500);
 const f=page.frames().find(f=>f.url().endsWith('/stems.html'));
 await f.evaluate(()=>{
  const it={id:'lifecycle',name:'fixture.wav',mode:'hq4',state:'running',pct:0,times:[]};__stems.Q.items.push(it);__testStems.byJob.set('fixture-job',it);__testStems.up.select(it);
  window.__laneDraws=0;const raw=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...a){__laneDraws++;return raw.apply(this,a);};
 });await sleep(400);
 await page.evaluate(()=>__shell.show('home'));await sleep(400);
 const hidden=await f.evaluate(async()=>{
  __laneDraws=0;let mutations=0;const o=new MutationObserver(ms=>mutations+=ms.length);o.observe(document.querySelector('#lanes'),{attributes:true,childList:true,subtree:true});
  for(let i=1;i<=20;i++)__stems.onProgress({job:'fixture-job',chunk:i,chunks:20,total:20,from:i-1,device:'gpu',peaks:{vocals:[.5],instrumental:[.3]}});
  await Promise.resolve();o.disconnect();return {draws:__laneDraws,mutations,pct:__stems.Q.sel.pct,filled:__stems.Q.sel.wave.filled};
 });assert.equal(hidden.pct,1);assert.equal(hidden.filled,20);assert.equal(hidden.draws,0,'Hidden progress must not redraw waveforms');assert.equal(hidden.mutations,0,'Hidden progress must not animate or rebuild lanes');
 await f.evaluate(()=>{
  window.__reads=0;const hal=window.__hal||parent.__hal,invoke=hal.invoke;hal.invoke=(cmd,...args)=>{if(cmd!=='read_path')return invoke(cmd,...args);__reads++;const b=new ArrayBuffer(46),v=new DataView(b),text=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));text(0,'RIFF');v.setUint32(4,38,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,44100,true);v.setUint32(28,88200,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,2,true);return Promise.resolve(b);};
  const it=__stems.Q.sel;it.state='done';it.res={files:{vocals:'v.wav',instrumental:'i.wav'},seconds:1,time:{total:1},source:{}};__testStems.up.select(it);
 });await sleep(150);assert.equal(await f.evaluate(()=>__reads),0,'Hidden result must not read/decode audio previews');
 await page.evaluate(()=>__shell.show('stems'));await f.waitForFunction(()=>!!__stems.P.buf);assert.equal(await f.evaluate(()=>__reads),2,'Visible result lazily reads each track once');assert(await f.evaluate(()=>__laneDraws>0),'Waveforms resume from the latest logical state');
 await page.evaluate(()=>__shell.show('home'));await sleep(100);await page.evaluate(()=>__shell.show('stems'));await sleep(300);assert.equal(await f.evaluate(()=>__reads),2,'Retained decoded preview is reused');
 assert.deepEqual(app.errors,[]);console.log('PASS hidden stems progress, exact logical state, deferred result decode and resume');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1});
