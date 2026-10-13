// Bounded progress motion, interruption and lifecycle; no visual captures.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {serve,launch,openApp,sleep}=require('./common'),{createHost}=require('./host');
(async()=>{const server=serve(),browser=await launch(),host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),'hal-progress-motion-')));
try{
 const {page,errors}=await openApp(browser,server,host,{motion:true});
 await page.evaluate(async()=>{__shell.show('convert');await __shell.ensureApp('convert');});await sleep(1000);
 await page.evaluate(()=>__renderBudget.setFocused(true));
 const frame=page.frames().find(f=>f.url().endsWith('/convert.html'));
 const setup=()=>{const e=document.createElement('i');e.id='motion-test-bar';e.style.cssText='display:block;width:100px;height:3px';document.body.append(e);const m=__motion;m.gsap.set(e,{xPercent:-60});e.dataset.gs='1';e.dataset.v='.4';window.__barWrites=0;window.__barObserver=new MutationObserver(ms=>window.__barWrites+=ms.length);__barObserver.observe(e,{attributes:true,attributeFilter:['style']});};
 await frame.evaluate(setup);
 await frame.evaluate(()=>__motion.bar(document.querySelector('#motion-test-bar'),.405));
 assert(await frame.evaluate(()=>__motion.gsap.getTweensOf(document.querySelector('#motion-test-bar')).length===0),'Subpixel advances have no tween');
 assert.equal(await frame.evaluate(()=>+document.querySelector('#motion-test-bar').dataset.v),.405);
 await frame.evaluate(()=>{window.__barWrites=0;__motion.bar(document.querySelector('#motion-test-bar'),.9);});
 await sleep(80);
 const early=await frame.evaluate(()=>({x:__motion.gsap.getProperty(document.querySelector('#motion-test-bar'),'xPercent'),paused:document.querySelector('#motion-test-bar')._bar.t.paused()}));
 assert(early.paused&&early.x>-59.5&&early.x<-10,'A frame uses the parent clock and advances gradually');
 await frame.evaluate(()=>__motion.bar(document.querySelector('#motion-test-bar'),.7));await sleep(500);
 const settled=await frame.evaluate(()=>({x:__motion.gsap.getProperty(document.querySelector('#motion-test-bar'),'xPercent'),writes:__barWrites,tweens:__motion.gsap.getTweensOf(document.querySelector('#motion-test-bar')).length}));
 assert(Math.abs(settled.x+30)<1e-5,'Interrupted motion reaches the exact latest target');assert(settled.writes<35,'Progress cannot write at display cadence');assert.equal(settled.tweens,0,'Finished paused tween is disposed');
 await frame.evaluate(()=>__motion.bar(document.querySelector('#motion-test-bar'),.2));await sleep(40);await page.evaluate(()=>__renderBudget.setMinimized(true));await sleep(100);
 assert.equal(await frame.evaluate(()=>__motion.gsap.getTweensOf(document.querySelector('#motion-test-bar')).length),0,'Minimize finishes and removes pending progress');
 await page.evaluate(()=>__renderBudget.setMinimized(false));await frame.evaluate(()=>__motion.bar(document.querySelector('#motion-test-bar'),.8));await page.evaluate(()=>__shell.show('home'));await sleep(100);
 assert.equal(await frame.evaluate(()=>__motion.gsap.getTweensOf(document.querySelector('#motion-test-bar')).length),0,'Hidden tool retains no progress tween');
 await frame.evaluate(()=>{__barObserver.disconnect();document.querySelector('#motion-test-bar').remove();});assert.deepEqual(errors,[]);console.log('PASS bounded progress clock, iframe time origin, exact interruption, subpixel updates and suspension');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1});
