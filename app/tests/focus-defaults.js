// Real pointer drags and keyboard navigation on the actual frontend; no captures.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {serve,launch,openApp}=require('./common'),{createHost}=require('./host');
(async()=>{const server=serve(),browser=await launch(),host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),'hal-focus-default-')));
try{
 const app=await openApp(browser,server,host),page=app.page;
 const focus=el=>el.evaluate(el=>{const s=getComputedStyle(el);return {visible:el.matches(':focus-visible'),outline:s.outlineStyle,width:s.outlineWidth,color:s.outlineColor,neutral:getComputedStyle(document.documentElement).getPropertyValue('--text-3'),shadow:s.boxShadow};});
 const keyboardFocus=async(el)=>{await page.keyboard.press('Tab');await el.focus();const s=await focus(el);assert.equal(s.visible,true);if(await el.evaluate(e=>e.type==='range')){assert.equal(s.outline,'none');/* Chromium does not expose native thumb paint through getComputedStyle; its visual indicator is reviewed in Preview. */}else{assert.notEqual(s.outline,'none');assert.equal(s.width,'1px');assert.equal(s.color,'rgb(144, 143, 137)');}};
 await app.tab('home');const home=page.locator('#hcards .hcard').first();await home.click();assert.equal((await focus(home)).outline,'none','mouse Home button has no ring');
 await app.tab('home');await keyboardFocus(home);console.log('OK Home: mouse ring suppressed, keyboard neutral focus-visible');
 for(const [tool,selector] of [['visualizer','#f-coverSize'],['grade','input[data-k="exp"]'],['removebg','#intensity']]){
  await app.tab(tool);await app.appReady(tool);const frame=page.frames().find(f=>f.url().includes(tool+'.html'));
  if(tool==='grade'){await frame.locator('.tabs [data-tab="tools"]').click();await frame.locator('.tool[data-key="adjust"] > summary').click();}
  const r=frame.locator(selector);
  await r.evaluate(r=>{const d=r.closest('details');if(d){d.open=true;d.dispatchEvent(new Event('motion:open'));}r.value=String(+r.min+(+r.max-+r.min)*.8);r.dispatchEvent(new Event('input',{bubbles:true}));});
  await r.scrollIntoViewIfNeeded();const b=await r.boundingBox(),data=await r.evaluate(r=>({min:+r.min,max:+r.max,value:+r.value,def:__ui.rangeDefault(r)}));
  const pos=v=>b.x+7+(v-data.min)/(data.max-data.min)*(b.width-14),y=b.y+b.height/2,x=pos(data.def);
  await page.mouse.move(pos(data.value),y);await page.mouse.down();await page.mouse.move(x+4,y,{steps:8});assert.notEqual(+(await r.inputValue()),data.def,tool+' real drag beside default has no snap');
  assert.equal((await focus(r)).outline,'none',tool+' pointer focus stays quiet');
  await page.mouse.move(x+10,y);assert.notEqual(+(await r.inputValue()),data.def,tool+' drag breaks away');await page.mouse.up();
  await r.dblclick({position:{x:b.width-18,y:b.height/2}});assert.equal(+(await r.inputValue()),data.def,tool+' real double click resets');
  await keyboardFocus(r);await r.press('ArrowRight');assert.notEqual(+(await r.inputValue()),data.def,tool+' keyboard takes the adjacent step');
  const button=frame.locator('button:not(:disabled):visible').first();await keyboardFocus(button);await button.click();assert.equal((await focus(button)).outline,'none');
  console.log('OK '+tool+': normal native drag, real double click, keyboard step, pointer/keyboard focus');
 }
 assert.deepEqual(app.errors,[]);
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
