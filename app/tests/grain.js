// Calm grain: production shader pixel continuity, low black lift, worker loop and lifecycle, fallback + DPR.
const fs=require('fs'),os=require('os'),path=require('path');
const {serve,launch,openApp,sleep,until}=require('./common');
const {createHost}=require('./host');
const OUT=process.env.GRAIN_OUT||'/tmp/halation-grain';fs.mkdirSync(OUT,{recursive:true});
let failures=0;const ok=(v,s)=>{console.log((v?'OK   ':'FAIL ')+s);if(!v)failures++;};
const alphas=p=>p.filter((_,i)=>i%4===3);
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const delta=(a,b)=>a.map((v,i)=>Math.abs(v-b[i]));
const percentile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1]||0;
function spatialCorrelation(a,width,dx,dy){
 let n=0,s=0,t=0,ss=0,tt=0,st=0;
 for(let y=0;y<width-dy;y++)for(let x=0;x<width-dx;x++){
  const p=a[y*width+x],q=a[(y+dy)*width+x+dx];n++;s+=p;t+=q;ss+=p*p;tt+=q*q;st+=p*q;
 }
 return (st-s*t/n)/Math.sqrt((ss-s*s/n)*(tt-t*t/n));
}
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'halation-grain-')),host=createHost(root),server=serve(),browser=await launch();
 const wrap=fallback=>({newPage:async o=>{const p=await browser.newPage(o);await p.addInitScript(fallback=>{window.__halGrainTest=true;sessionStorage.setItem('hal.atmo',JSON.stringify([0,1,1,40]));if(fallback)HTMLCanvasElement.prototype.transferControlToOffscreen=undefined;},fallback);return p;}});
 const app=await openApp(wrap(false),server,host,{width:1280,height:800,motion:true});const {page}=app;
 ok(await until(()=>page.evaluate(()=>window.__atmo&&window.__atmo.grainTest),5000),'Production worker grain bridge ready');
 await sleep(1500);
 const frames=[];await page.evaluate(()=>{window.__grainRAF=[];window.__grainRun=true;const sample=t=>{window.__grainRAF.push(t);if(window.__grainRun)requestAnimationFrame(sample);};requestAnimationFrame(sample);});
 await sleep(4000);await page.evaluate(()=>window.__grainRun=false);
 const live=await page.evaluate(()=>window.__atmo.grainTest.metrics()),main=await page.evaluate(()=>window.__grainRAF);
 const times=live.samples.slice(1).map((t,i)=>t-live.samples[i]);const dt=main.slice(1).map((t,i)=>t-main[i]);
 const runtime={worker:{draws:live.samples.length,p50:percentile(times,.5),p95:percentile(times,.95),max:Math.max(...times)},main:{frames:main.length,p50:percentile(dt,.5),p95:percentile(dt,.95),max:Math.max(...dt)}};
 console.log('INFO runtime without recorder '+JSON.stringify(runtime));
 ok(live.samples.length>5&&!live.state.still&&live.state.visible,'Grain draws continuously in the worker while visible');
 const count=await page.evaluate(()=>document.querySelector('.grain').children.length);
 ok(count===1&&await page.locator('.grain canvas').count()===1,'A single full-resolution canvas, no noise DOM elements or stepped CSS animation');
 await page.evaluate(()=>window.__motion.setReduce(true));await sleep(100);
 const frozen=await page.evaluate(()=>window.__atmo.grainTest.metrics());await sleep(200);
 const after=await page.evaluate(()=>window.__atmo.grainTest.metrics());
 ok(after.state.still&&after.samples.length===frozen.samples.length&&Math.abs(after.time-frozen.time)<1e-6,'Reduced motion freezes the same grain state');
 await page.evaluate(()=>window.__motion.setReduce(false));await sleep(100);
 const resumed=await page.evaluate(()=>window.__atmo.grainTest.metrics());
 ok(!resumed.state.still&&resumed.time>=frozen.time&&resumed.time-frozen.time<.3,'Resuming keeps phase continuity instead of replacing the pattern');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await sleep(100);
 const hidden=await page.evaluate(()=>window.__atmo.grainTest.metrics());await sleep(200);
 const hidden2=await page.evaluate(()=>window.__atmo.grainTest.metrics());
 ok(!hidden2.state.visible&&hidden2.samples.length===hidden.samples.length&&hidden2.time===hidden.time,'Hidden window stops drawing and holds time');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
 await page.evaluate(()=>window.__shell.show('settings'));await sleep(600);
 await until(()=>page.locator('.grain').evaluate(e=>getComputedStyle(e).opacity==='0.5'),3000);
 const tool=await page.evaluate(()=>window.__atmo.grainTest.metrics());
 ok(!tool.state.still&&tool.state.visible&&await page.locator('.grain').evaluate(e=>getComputedStyle(e).opacity==='0.5'),'Tools keep the lighter amplitude and continuous slow evolution');
 ok(live.backgroundUpdates>1,'Production atmosphere supplies background textures to the grain renderer');
 const get=t=>page.evaluate(t=>window.__atmo.grainTest.renderAt(t,true),t);
 await page.locator('.rail .tab.home').click();await sleep(1000);
 await page.evaluate(()=>window.__atmo.grainTest.freezeBackground());
 const actualGradient=await page.evaluate(()=>window.__atmo.grainTest.renderAt(0,{x:550,y:450}));
 const actualFlat=await page.evaluate(()=>window.__atmo.grainTest.renderAt(0,{x:1140,y:650}));
 ok(mean(alphas(actualGradient))>mean(alphas(actualFlat))*2,'Actual Home background texture gives more grain to the dark silk gradient than the flat corner');
 await page.evaluate(()=>window.__atmo.grainTest.field('dark-gradient'));
 const cachedBackground=(await page.evaluate(()=>window.__atmo.grainTest.metrics())).backgroundUpdates;
 const p0=await get(0),a0=alphas(p0),a1=alphas(await get(1/60)),a4=alphas(await get(4)),a12=alphas(await get(12));
 const d1=delta(a0,a1),d4=delta(a0,a4),black=a0.map(v=>v*64/255);
 const pixels={meanBlack:mean(black),maxBlack:Math.max(...black),adjacentMeanAlpha:mean(d1),adjacentMaxAlpha:Math.max(...d1),fourSecondMeanAlpha:mean(d4),changedAt12s:a0.filter((v,i)=>v!==a12[i]).length/a0.length};
 console.log('INFO pixels '+JSON.stringify(pixels));
 ok(mean(d1)<.035&&Math.max(...d1)<=1,'Adjacent 60 fps frames differ only by tiny intensity steps, never a whole-pattern replacement');
 ok(mean(d4)>.4&&pixels.changedAt12s>.25,'Individual points visibly evolve over seconds instead of remaining static');
 // User calibration now prioritizes effective dithering in dark gradients, with lower grain on flat/bright fields.
 const maxBlack=Math.ceil(.14*255)*64/255;
 ok(live.state.amplitude===.14&&live.state.luminance===.25,'Strong gradient grain keeps the grey emission unchanged');
 ok(pixels.maxBlack<=maxBlack&&pixels.meanBlack>.6&&pixels.meanBlack<3,'Dark gradient gets meaningful grain while peak black lift stays bounded');
 // At any time the field remains deterministic; no time-derived random seed.
 ok(JSON.stringify(await get(0))===JSON.stringify(p0),'Seeking back produces exactly the same point field');
 const seeded=await page.evaluate(()=>window.__atmo.grainTest.metrics());
 ok(seeded.targetFPS===60&&seeded.textureBuilds===1&&seeded.backgroundUpdates===cachedBackground,'60 fps target; time samples reuse seed and background textures');
 await page.evaluate(()=>window.__atmo.grainTest.field('bright-gradient'));
 const brightMean=mean(alphas(await get(0)));
 await page.evaluate(()=>window.__atmo.grainTest.field('flat-dark'));
 const flat=await get(0),flatMean=mean(alphas(flat));
 ok(mean(a0)>flatMean*2.5&&mean(a0)>brightMean*2.5,'Dark gradients get substantially more grain than flat dark and bright gradient surfaces');
 const pattern=[];
 for(const t of [0,4]){
  const a=alphas(await page.evaluate(t=>window.__atmo.grainTest.renderAt(t,{width:256,height:256}),t));
  for(const lag of [1,2,4,8,16,32,64,128])pattern.push({time:t,lag,x:spatialCorrelation(a,256,lag,0),y:spatialCorrelation(a,256,0,lag)});
 }
 ok(pattern.every(p=>Math.abs(p.x)<.035&&Math.abs(p.y)<.035),'Shader grain has no strong axis-aligned repetition at 1–128 pixel spacings across two phases');
 console.log('INFO spatial correlation '+JSON.stringify(pattern));
 await page.setViewportSize({width:1312,height:832});
 ok(await until(()=>page.locator('.grain canvas').evaluate(c=>c.width===1312&&c.height===832),3000),'Worker applies the resized physical dimensions');
 const resized=await get(0);
 ok(JSON.stringify(resized)===JSON.stringify(flat),'Resize retains stationary points when the background weight is unchanged');
 await page.setViewportSize({width:1280,height:800});
 await until(()=>page.locator('.grain canvas').evaluate(c=>c.width===1280&&c.height===800),3000);await get(0);
 const dimensions=await page.locator('.grain canvas').evaluate(c=>({w:c.width,h:c.height,cssW:c.clientWidth,cssH:c.clientHeight}));
 ok(dimensions.w===1280&&dimensions.h===800,'Grain has one sample per physical screen pixel');
 const fallback=await openApp(wrap(true),server,host,{width:1280,height:800,motion:true});
 await fallback.page.evaluate(()=>window.__atmo.grainTest.field('dark-gradient'));
 const fp=await fallback.page.evaluate(()=>window.__atmo.grainTest.renderAt(0,true));
 ok(JSON.stringify(fp)===JSON.stringify(p0),'Without OffscreenCanvas the same shader retains identical grain pixels');
 const high=await openApp(wrap(false),server,host,{width:640,height:400,scale:2,motion:true});
 await high.page.evaluate(()=>window.__atmo.grainTest.renderAt(0));
 const dpr=await high.page.locator('.grain canvas').evaluate(c=>({w:c.width,h:c.height}));
 ok(dpr.w===1280&&dpr.h===800,'DPR 2 preserves physical pixel resolution without enlarged noise blocks');
 ok(![...app.errors,...fallback.errors,...high.errors].length,'No page errors');
 fs.writeFileSync(path.join(OUT,'metrics.json'),JSON.stringify({runtime,pixels,pattern,dimensions,dpr,failures},null,2));
 await browser.close();server.close();fs.rmSync(root,{recursive:true,force:true});
 console.log(failures?'\n'+failures+' failed':'\nAll passed (grain)');process.exitCode=failures?1:0;
})().catch(e=>{console.error(e);process.exit(1);});
