// Exact first-frame and interrupted-path checks through the real frontend/scheduler.
const fs=require('fs'),os=require('os'),path=require('path');
const {serve,launch,openApp,sleep,until}=require('./common');
const {createHost}=require('./host');
const {prepareTimeline,stepTimeline,waitPresentation}=require('./visual-review');
let failed=0;const ok=(c,s)=>{console.log((c?'OK   ':'FAIL ')+s);if(!c)failed++;};
const OUT=process.env.ISLAND_CONTINUITY_OUT||'/tmp/halation-island-continuity';fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'halation-continuity-')),host=createHost(root),server=serve(),browser=await launch();
 const app=await openApp(browser,server,host,{width:1480,height:940,motion:true}),p=app.page;
 await sleep(1200);await p.evaluate(()=>window.__jobs.readResources());await waitPresentation(p);
 ok(await until(()=>p.evaluate(()=>{const e=document.querySelector('#procIsland'),h=document.querySelector('.head').getBoundingClientRect(),s=document.querySelector('#procSlot').getBoundingClientRect();return e.classList.contains('docked')&&!window.__motion.busy()&&Math.abs(e.getBoundingClientRect().left-s.left)<.05;}),5000),'The initial toolbox anchor has settled before activity');
 const clock=await prepareTimeline(p),scene=await p.evaluate(()=>window.__atmo.grainTest.scene());
 await p.evaluate(s=>window.__atmo.grainTest.sceneAt(s),scene);
 const state=()=>p.evaluate(()=>{const e=document.querySelector('#procIsland'),bg=e.querySelector('.isl-bg'),r=bg.getBoundingClientRect(),m=e.querySelector('.isl-mark').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,markX:m.x,markY:m.y,expanded:e.classList.contains('expanded'),closing:e.classList.contains('closing'),clip:e.style.clipPath,opacity:getComputedStyle(bg).opacity, radius:(()=>{const css=getComputedStyle(bg),tf=new DOMMatrix(css.transform),r=css.borderTopLeftRadius.split(" ").map(parseFloat);return [r[0]*Math.hypot(tf.a,tf.b),(r[1]??r[0])*Math.hypot(tf.c,tf.d)];})()};});
 const near=(a,b)=>['x','y','w','h','markX','markY'].every(k=>Math.abs(a[k]-b[k])<.1);
 let frame=0;const samples=[];
 const advance=async n=>{for(let i=0;i<n;i++){await stepTimeline(p,clock,++frame);samples.push({frame,...await state()});}};
 const idle=await state();
 await p.evaluate(()=>{
  window.__continuitySurface=document.querySelector('#procIsland .isl-bg');
  const h=window.__shell.jobs.submit({tool:'grade',kind:'export-image',lane:'cpu',title:'cover.png',run:ctx=>{ctx.progress(.37,'Encoding');return new Promise(r=>window.__continuityRelease=r);}});h.done.catch(()=>{});
 });
 const birth=await state();ok(near(idle,birth),'Activity first frame preserves the toolbox position, size and state-icon anchor');
 // Opening the manager dismisses a transient "started" notification by design. Compare the stable running
 // header on both sides of open/close, rather than comparing that notification's Show action to live progress.
 await advance(12);await p.evaluate(()=>window.__procs.closePill(true));
 await advance(35);const active=await state();
 ok(Math.abs(active.x+active.w/2-740)<1,'Activity settles at the center');
 ok(samples.every(s=>s.x>=active.x-.1&&s.x<=idle.x+.1),'Departure stays within its start/end positions, without overshoot');
 ok(samples[0].x>idle.x-50,'First rendered departure frame is a small displacement, not a replacement at the center');
 const compact=await state();await p.evaluate(()=>document.querySelector('#procBtn').click());const openFirst=await state();
 ok(near(compact,openFirst),'Opening the Process Manager preserves the exact initial surface and icon position');
 await advance(5);const opening=await state();await p.evaluate(()=>window.__procs.closeTray({restore:false}));
 ok(near(opening,await state()),'Closing during expansion starts from the current rendered geometry');
 await advance(4);const closing=await state();await p.evaluate(()=>document.querySelector('#procBtn').click());
 ok(near(closing,await state()),'Reopening during collapse preserves position, size and header anchor');
 await advance(35);const expanded=await state();ok(expanded.expanded&&!expanded.closing&&expanded.w===400,'Interrupted expansion finishes as one 400 px Process Manager surface');
 await p.screenshot({path:path.join(OUT,'expanded.png')});
 await p.evaluate(()=>window.__procs.closeTray({restore:false}));ok(near(expanded,await state()),'A full close starts without a position/size jump');
 await advance(15);ok(await p.evaluate(()=>+getComputedStyle(document.querySelector('.isl-menu')).opacity<.02),'The expanded menu fades away before the surface folds into the pill');
 await advance(20);ok(near(compact,await state()),'Full close returns to the exact compact surface and icon anchor');
 await p.evaluate(()=>{window.__continuityRelease();});await p.evaluate(()=>Promise.resolve());await advance(5);
 await p.evaluate(()=>{window.__shell.jobs.clearFinished();window.__procs.closePill(true);window.__procs.paintIsland();});
 const returning=await state();await advance(35);const docked=await state();
 ok(near(idle,docked),'Returning to rest restores the original toolbox slot and icon geometry');
 ok(returning.x<docked.x,'Return starts from the active position and travels back to the toolbox');
 ok(await p.evaluate(()=>window.__continuitySurface===document.querySelector('#procIsland .isl-bg')),'Every transition uses the same surface node');
 ok(samples.every(s=>!s.clip&&s.opacity==='1'),'The surface stays opaque and uses no animated clip-path');
 ok(samples.every(s=>s.radius.every(r=>Math.abs(r-14)<.15)),'The bubble keeps a round 14 px edge throughout departure, expansion and folding');
 ok(!app.errors.length,'No page errors: '+app.errors.join(' / '));
 fs.writeFileSync(path.join(OUT,'continuity.json'),JSON.stringify({idle,birth,active,compact,openFirst,expanded,docked,samples,failed,errors:app.errors},null,2));
 await browser.close();server.close();fs.rmSync(root,{recursive:true,force:true});process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exit(1);});
