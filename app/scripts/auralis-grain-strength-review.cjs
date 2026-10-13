// Preview-only tuning panel; no product Settings UI or benchmark capture.
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.connectOverCDP(process.env.HAL_PERF_CDP||'http://127.0.0.1:9247');
 try{
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));
  if(!page)throw Error('Native Preview missing');
  if(!await page.evaluate(()=>!!document.querySelector('.auralis-host canvas')?.__auralisReview?.setGrainStrength)){
   await page.addInitScript(()=>{window.__halVisualTest=true;});await page.reload();
   await page.waitForFunction(()=>document.querySelector('.auralis-host canvas')?.__auralisReview?.setGrainStrength);
  }
  await page.evaluate(()=>{
   document.getElementById('auralis-grain-strength-review')?.remove();
   const panel=document.createElement('aside');panel.id='auralis-grain-strength-review';
   panel.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483647;background:var(--surface,#18181e);color:var(--text,#fff);padding:14px 18px;border:1px solid var(--border,#555);border-radius:10px;font:13px system-ui;pointer-events:auto;width:270px';
   const label=document.createElement('label');label.htmlFor='auralis-grain-strength';label.textContent='Static grain strength';
   const value=document.createElement('output');value.style.cssText='float:right;font-variant-numeric:tabular-nums';
   const slider=document.createElement('input');slider.id=label.htmlFor;slider.type='range';slider.min='0';slider.max='300';slider.step='1';slider.style.cssText='display:block;width:100%;margin:12px 0';
   const strength=document.querySelector('.auralis-host canvas').__auralisState().grainStrength;slider.value=localStorage.getItem('auralis-grain-review-strength')||String(Math.round((strength>=0?strength:.5)*100));
   const hint=document.createElement('div');hint.style.opacity='.7';hint.textContent='320 px · 15 Hz ·50% = approved intensity';
   function update(){value.value=slider.value+'%';document.querySelector('.auralis-host canvas').__auralisReview.setGrainStrength(Number(slider.value)/100);window.__auralisGrainReviewSelection=Number(slider.value)/100;localStorage.setItem('auralis-grain-review-strength',slider.value);}
   slider.addEventListener('input',update);panel.append(label,value,slider,hint);document.body.append(panel);update();
  });
  console.log('Native grain slider ready:0–300%;15Hz unchanged;50% approved intensity.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
