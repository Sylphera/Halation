// Actual frontend comparison: original main tool backdrop and corrected tool backdrop, same phase/geometry.
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto'),assert=require('assert');
const {serve,launch,openApp,painted,until}=require('./common'),{newHost}=require('./scan');
const {PNG}=require(path.join(cp.execSync('npm root -g').toString().trim(),'pngjs'));
const out=path.resolve(__dirname,'../../review/drape-tools');fs.mkdirSync(out,{recursive:true});
const original=cp.execFileSync('C:/Program Files/Git/cmd/git.exe',['show','98eea81:app/dist/atmosphere.js'],{encoding:'utf8'});
(async()=>{
 const server=serve(),browser=await launch();
 try{
  const captures=[];
  for(const baseline of [true,false]){
   const {host}=newHost('en');
   const context=await browser.newContext({viewport:{width:1280,height:800}});
   if(baseline)await context.route('**/atmosphere.js',r=>r.fulfill({contentType:'text/javascript',body:original}));
   const app=await openApp(context,server,host,{width:1280,height:800,motion:true});const {page,tab,errors}=app;
   if(baseline)page.__reviewSources={baselineAtmosphereSHA256:crypto.createHash('sha256').update(original).digest('hex')};
   await tab('grade');await painted(page);await until(()=>page.evaluate(()=>!window.__motion.busy()),5000,20);
   assert(await until(async()=>{const states=await Promise.all(page.frames().map(f=>f.evaluate(()=>{const tweens=window.gsap?.globalTimeline?.getChildren(true,true,false)||[];return tweens.every(t=>!t.isActive()||t.repeat()===-1)&&document.getAnimations().every(a=>a.playState!=="running"||a.effect.getTiming().iterations===Infinity);}).catch(()=>true)));return states.every(Boolean);},5000,25),'All finite UI animations settled');
   await Promise.all(page.frames().map(f=>f.evaluate(()=>document.fonts.ready)));
   await page.waitForTimeout(500);
   await page.waitForFunction(async()=>{const s=await window.__atmo.grainTest.scene();return s?.mode==='tool'&&s.mix===1;});
   const scene=await page.evaluate(async()=>{const s=await window.__atmo.grainTest.scene();return window.__atmo.grainTest.sceneAt({...s,time:40,at:s.at+500,pulse:0});});
   await page.evaluate(()=>window.__atmo.grainTest.renderAt(4));
   const grainPixels=await page.evaluate(()=>window.__atmo.grainTest.renderAt(4,{width:1280,height:800}));
   const grainMetrics=await page.evaluate(()=>window.__atmo.grainTest.metrics());
   const grainGLHash=crypto.createHash('sha256').update(Buffer.from(grainPixels)).digest('hex');
   const raw=await page.evaluate(()=>{
    const names=['.tool-atmo','.grain canvas'];
    return names.map((name,i)=>{const e=document.querySelector(name)||(i===0?document.querySelector('canvas.atmo'):null),c=document.createElement('canvas');c.width=e.width;c.height=e.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(e,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data;let s='';for(let k=0;k<data.length;k+=32768)s+=String.fromCharCode(...data.subarray(k,k+32768));return {name,width:c.width,height:c.height,rgba:btoa(s)};});
   });
   const rawManifest=raw.map(r=>({name:r.name,width:r.width,height:r.height,sha256:crypto.createHash('sha256').update(Buffer.from(r.rgba,'base64')).digest('hex')}));
   await page.screenshot({path:path.join(out,baseline?'main-tool.png':'restored-tool.png')});
   await page.screenshot({path:path.join(out,baseline?'main-tool-repeat.png':'restored-tool-repeat.png')});
   if(!baseline){
    assert(await page.evaluate(()=>{const h=document.querySelector('.drape-host');return getComputedStyle(h).visibility==='hidden'&&getComputedStyle(h).opacity==='0'&&getComputedStyle(document.querySelector('.grain')).opacity==='0.5';}),'No Drape in tools, original quieter grain');
    await tab('home');await until(()=>page.evaluate(()=>!window.__motion.busy()),5000,20);
    // Controlled renderer must also be stepped to finish the existing background spring.
    await page.evaluate(async()=>{const s=await window.__atmo.grainTest.scene();await window.__atmo.grainTest.sceneAt({time:s.time,at:s.at+500,pulse:0});});
    assert(await until(()=>page.evaluate(()=>{const h=document.querySelector('.drape-host');return getComputedStyle(h).visibility==='visible'&&getComputedStyle(h).opacity==='1'&&getComputedStyle(document.querySelector('.grain')).opacity==='0';}),5000,20));
    await page.screenshot({path:path.join(out,'returned-home.png')});
   }
   captures.push({baseline,scene,raw:rawManifest,grainGLHash,grainMetrics,errors});assert(!errors.length,errors.join('\n'));await context.close();
  }
  const before=PNG.sync.read(fs.readFileSync(path.join(out,'main-tool.png'))),after=PNG.sync.read(fs.readFileSync(path.join(out,'restored-tool.png')));
  assert.strictEqual(after.width,before.width);assert.strictEqual(after.height,before.height);
  let changed=0,max=0;for(let i=0;i<before.data.length;i+=4)for(let k=0;k<3;k++){const d=Math.abs(before.data[i+k]-after.data[i+k]);if(d)changed++;max=Math.max(max,d);}
  const rawExact=JSON.stringify(captures[0].raw)===JSON.stringify(captures[1].raw);
  const repeated=['main-tool','restored-tool'].map(n=>{const a=PNG.sync.read(fs.readFileSync(path.join(out,n+'.png'))),b=PNG.sync.read(fs.readFileSync(path.join(out,n+'-repeat.png')));let changes=0,maxDelta=0;for(let i=0;i<a.data.length;i++){const d=Math.abs(a.data[i]-b.data[i]);if(d)changes++;maxDelta=Math.max(maxDelta,d);}return {name:n,changes,maxDelta};});
  fs.writeFileSync(path.join(out,'parity.json'),JSON.stringify({captures,rawExact,repeated,changedChannels:changed,maxDelta:max,width:before.width,height:before.height},null,2));
  console.log('Diagnostic raw tool/grain pixel hashes equal:',rawExact,'full viewport repeated:',JSON.stringify(repeated));
  console.log('Grain GL direct pixels equal:',captures[0].grainGLHash===captures[1].grainGLHash);
  assert(rawExact,'Raw restored tool and grain must be pixel-exact to main');
  assert.strictEqual(changed,0,'Restored steady-state tool viewport must be pixel-exact to main at the same phase');
  console.log('PASS original tool viewport RGB exact at time40/grain4; Home Drape / tools no Drape / returned Home');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
