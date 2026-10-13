// Real tool inputs/edits through the mocked backend. No image capture infrastructure.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),{execSync}=require('child_process');
const {serve,launch,openApp,until}=require('./common'),{createHost}=require('./host'),{makeFixtures,toolOptions}=require('./fixtures');
(async()=>{
 console.log('PREPARE media fixtures');
 const FX=makeFixtures(),options=toolOptions(FX);options.tools.systemFfmpeg=execSync('command -v ffmpeg').toString().trim();
 console.log('PREPARE host/browser');
 const host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),'halation-session-media-')),options),server=serve(),browser=await launch();
 const saved=path.join(host.base,'Sessions/Session.halation-session');
 host.setSessionOptions({sessionSavePath:saved});
 // This flow tests save/open, not the first-use choice dialog; retain native picker cancellation/error coverage.
 fs.writeFileSync(path.join(host.base,'Settings/app.json'),JSON.stringify({settings:{version:2,language:'en',artistName:'Saved Artist',links:{},saveMode:'ask-every-time',saveLocationChosen:true},profiles:{references:['Saved reference']}}));host.begin();
 try{
  console.log('PREPARE app');const app=await openApp(browser,server,host),page=app.page;console.log('READY app');
  const image=path.join(FX.FIX,'small.png'),audio=path.join(FX.FIX,'song one.wav'),video=path.join(FX.FIX,'clip720.webm');
  for(const id of ['grade','visualizer','upscale','framegrab','interp','removebg','downloader','covertest']){console.log('TAB '+id);await app.tab(id);console.log('ENSURE '+id);try { await Promise.race([page.evaluate(id=>window.__shell.ensureApp(id),id),new Promise((_,reject)=>setTimeout(()=>reject(Error('Tool readiness timeout '+id)),15000))]); }catch(e){console.log(app.errors);console.log(host.log.slice(-12));throw e;}console.log('READY '+id);}
  await page.evaluate(async p=>{const a=await window.__shell.ensureApp('grade'),b=await window.__shell.invoke('session_file_read',{path:p});const f=new File([b],'Original English.png',{type:'image/png'});f.__halPath=p;await a.loadImage(f);await a.session.restore({...await a.session.capture(),layers:[{id:'L',type:'adjust',on:true,amt:100,p:{exposure:.7}}],thumbnail:40});},image);
  console.log('INPUT grade');
  await page.evaluate(async ([img,aud])=>{const a=await window.__shell.ensureApp('visualizer');for(const [p,mime,method]of [[img,'image/png','setCover'],[aud,'audio/wav','loadAudio']]){const b=await window.__shell.invoke('session_file_read',{path:p}),f=new File([b],p.split(/[\\/]/).pop(),{type:mime});f.__halPath=p;await a[method](f,f.name);}const d=await a.session.capture();d.settings.title='Saved setting';d.clip.title='Artist title';await a.session.restore(d);},[image,audio]);
  console.log('INPUT visualizer');
  await page.evaluate(async p=>{const a=await window.__shell.ensureApp('upscale');await a.setInput({path:p,name:'Original English.png'});const d=await a.session.capture();d.options.scale=2;d.options.format='jpg';d.queue=[{source:{path:p,name:'Queue English.png',type:'image/png'},upscale:true,cutout:false}];await a.session.restore(d);},image);
  console.log('INPUT upscale');
  await page.evaluate(async p=>{await window.__shell.session.video({path:p,name:'Clip.webm'});const a=await window.__shell.ensureApp('framegrab');await a.session.restore({...await a.session.capture(),video:{path:p,name:'Clip.webm'},n:12,layout:'16:9',queue:[{n:3,sel:true},{n:7,sel:false}],sound:{volume:.23,muted:true}});},video);
  console.log('INPUT framegrab');
  await page.evaluate(async p=>{const a=await window.__shell.ensureApp('interp');await a.session.restore({...await a.session.capture(),input:{path:p,name:'Clip.webm'},options:{mode:'target',fps:90,quality:'high'},at:.5,brush:17,painting:true});},video);
  console.log('INPUT interp');
  await page.evaluate(async p=>{const a=await window.__shell.ensureApp('removebg'),b=await window.__shell.invoke('session_file_read',{path:p});const f=new File([b],'Mask source.png',{type:'image/png'});f.__halPath=p;const d=await a.session.capture();d.options.mode='brush';await a.session.restore(d);await a.setInput({blob:f,path:p,name:f.name});const s=await a.session.capture();s.alpha=[...await window.__shell.session.decode(s.alpha)];s.alpha[0]=13;s.refs=[{x:2,y:4,c:[10,20,30],sign:1}];s.selection=s.alpha.slice();s.applied=1;await a.session.restore(s);},image);
  await page.evaluate(async p=>{const a=await window.__shell.ensureApp('covertest'),b=await window.__shell.invoke('session_file_read',{path:p}),f=new File([b],'Cover English.png',{type:'image/png'});f.__halPath=p;await a.takeImage({blob:f,path:p,name:f.name});const d=await a.session.capture();d.view.fields.title='My cover';d.view.platform='spotify';await a.session.restore({...d,covers:[]});},image);
  await page.evaluate(async()=>{const a=await window.__shell.ensureApp('downloader');await a.session.restore({url:'https://example.test/user-content',info:null,quality:'720',audioFormat:'mp3',queue:[{kind:'audio',url:'https://example.test/file',title:'Pending English title',fmt:'mp3',sub:'MP3'}]});});
  console.log('INPUT all');const before=await page.evaluate(()=>window.__shell.session.capture());assert.equal(before.dirty,true);assert.equal(await page.evaluate(()=>window.__shell.session.save()),true);console.log('SAVED media');
  console.log('STATE after save',await page.evaluate(async()=>({dirty:(await window.__shell.session.capture()).dirty,busy:window.__shell.sessionWorking()})));
  assert(await until(()=>page.evaluate(()=>!window.__shell.sessionWorking().length),20000),'Input analyses finish before Open');
  const cancelled=page.evaluate(()=>window.__shell.session.open());await until(async()=>await page.locator('#modal').isVisible(),1500);if(await page.locator('#modal').isVisible()){console.log('CANCEL modal',await page.locator('#mTitle').textContent(),await page.locator('#mText').textContent());await page.click('#mCancel');}assert.equal(await cancelled,false,'Cancelled file picker keeps current work');
  host.setSessionOptions({sessionOpenPath:saved});const jobsBefore=host.log.filter(([cmd])=>cmd==='proc_start'||cmd==='encode_start').length;
  let openingDone=false;const opening=page.evaluate(()=>window.__shell.session.open()).finally(()=>openingDone=true);const warning=await until(async()=>openingDone||await page.locator('#modal').isVisible(),20000);if(warning&&!openingDone){console.log('RESTORE warning: '+await page.locator('#mText').textContent());await page.click('#mOk');}assert.equal(await opening,true,await page.locator('#syncText').textContent());
  const after=await page.evaluate(()=>window.__shell.session.capture());
  for(const id of Object.keys(before.tools))assert.deepEqual(after.tools[id],before.tools[id],id+' round trip');
  const newProcesses=host.log.filter(([cmd])=>cmd==='proc_start'||cmd==='encode_start').slice(jobsBefore);
  for(const [cmd,args] of newProcesses){
   assert.equal(cmd,'proc_start','Open does not start an encoder');
   assert.equal(args.tool,'ffmpeg');assert.equal(args.job,null,'Open does not restart a job');
   assert.deepEqual(args.args,['-hide_banner','-nostdin','-loglevel','error','-ss','0.000000','-i',video,'-an','-frames:v','1','-f','image2','-c:v','png','-y',path.join(host.localDir('workspace'),'temp','loose','frame.png')],'Only the restored video preview frame may be generated');
  }
  assert.equal(await page.frameLocator('#v-downloader').locator('[data-act="retry"]').count(),1,'Recovered Downloader job is explicitly executable');
  assert.deepEqual(app.errors,[]);console.log('PASS media, Grade layers, Visualizer audio/cover, masks, frames, selections, parameters and queues round trip without restarting jobs');
  await page.evaluate(async()=>{await window.__shell.session.start('grade');const a=await window.__shell.ensureApp('grade'),d=await a.session.capture();d.thumbnail=45;await a.session.restore(d);await window.__shell.session.completed('grade');});assert.equal((await page.evaluate(()=>window.__shell.session.capture())).dirty,true,'Edits made after export starts stay dirty');
  await page.evaluate(async()=>{await window.__shell.session.start('grade');await window.__shell.session.completed('grade');});
  assert.equal((await page.evaluate(()=>window.__shell.session.capture())).dirty,false,'Completed work has no pending changes');
  host.setSessionOptions({sessionWriteError:'Disk full'});assert.equal(await page.evaluate(()=>window.__shell.session.save()),false);assert((await page.locator('#syncText').textContent()).includes('Disk full'));host.setSessionOptions({sessionWriteError:null,sessionSavePath:null});assert.equal(await page.evaluate(()=>window.__shell.session.save(true)),false);
  host.setSessionOptions({sessionSavePath:saved});console.log('PASS save errors/cancellation keep the app open, and export completion distinguishes later edits');
  const missing=JSON.parse(fs.readFileSync(saved,'utf8'));missing.tools.grade.source.path=path.join(FX.TMP,'missing-source.png');const partial=page.evaluate(v=>window.__shell.session.restore(v),missing);await page.locator('#modal').waitFor({state:'visible'});assert((await page.locator('#mText').textContent()).includes('missing-source.png'));await page.click('#mOk');await partial;
  const rest=await page.evaluate(()=>window.__shell.session.capture());assert.equal(rest.tools.grade.source,null);assert.deepEqual(rest.tools.grade.layers,before.tools.grade.layers);assert.equal(rest.tools.visualizer.clip.title,before.tools.visualizer.clip.title);
  assert.deepEqual(app.errors,[]);console.log('PASS a missing source is reported while other tools and editable layers restore');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
