// Functional checks only: no screenshots or video. Run with tests/common.js's Chromium.
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { serve, launch, openApp, until } = require('./common');
const { createHost } = require('./host');
(async () => {
  const server = serve(), browser = await launch();
  try {
    // Isolated native ranges, exercising the same script and CSS as every tool.
    for (const dpr of [1, 2]) {
      const page = await browser.newPage({ deviceScaleFactor: dpr, reducedMotion: 'reduce' });
      await page.goto(`http://localhost:${server.address().port}/removebg.html`);
      await page.evaluate(() => {
        const box = document.createElement('div'); box.id = 'range-tests';
        box.style = 'position:fixed;inset:0;z-index:99999;background:var(--panel);padding:30px';
        box.innerHTML = '<div class="f"><label data-scrub for="test-range">Test</label><output for="test-range">0</output><input id="test-range" type="range" min="-100" max="100" step="0.1" data-def="0" value="25" style="width:314px"></div>';
        document.body.append(box);
        window.rangeEvents = [];
        const r = document.getElementById('test-range');
        for (const kind of ['input', 'change']) r.addEventListener(kind, () => { rangeEvents.push([kind, +r.value]); r.previousElementSibling.textContent = r.value; });
      });
      const r = page.locator('#test-range');
      assert.equal(await r.inputValue(), '25', 'initialization preserves restored value');
      const values = await page.evaluate(() => {
        const r = document.getElementById('test-range'), ui = __ui, rows = [];
        for (const [min,max,step,def,ratio] of [[-100,100,0.1,0,0.5],[0,1,0.01,1,1],[0,100,1,50,0.5],[0,100,1,100,1],[-180,180,1,-35,145/360],[0,20,0.5,1,0.05],[1,8,0.01,1,0],[0,2,0.05,0.2,0.1]]) {
          Object.assign(r,{min:String(min),max:String(max),step:String(step)}); r.dataset.def=def;
          rows.push([ui.rangeDefault(r),def]);
        }
        Object.assign(r,{min:'-100',max:'100',step:'0.1'});r.dataset.def='0';
        return rows;
      });
      for(const [v,def] of values)assert.equal(v,def);
      const bounds = await r.boundingBox(), x = bounds.x + bounds.width/2, y = bounds.y + bounds.height/2;
      // A real native drag can choose adjacent values on either side: no detent.
      await page.mouse.move(x + 20, y); await page.mouse.down();
      await page.mouse.move(x + 1, y);assert.notEqual(await r.inputValue(), '0', 'no pointer snap beside default');
      await page.mouse.move(x - 1, y);assert.notEqual(await r.inputValue(), '0', 'no pointer snap on opposite side');
      await page.mouse.up();
      assert.equal(await r.evaluate(r=>r.style.getPropertyValue('--default-position')), '', 'no visual default marker');
      await r.press('ArrowLeft');
      await page.evaluate(() => { const r=document.getElementById('test-range');r.value='0';rangeEvents=[]; });
      await r.press('ArrowRight'); assert.equal(await r.inputValue(), '0.1', 'keyboard can choose adjacent step');
      await r.press('Shift+ArrowRight'); assert.equal(await r.inputValue(), '1.1');
      await r.press('Enter'); await page.locator('#range-tests .numedit').fill('-0.1');
      await page.locator('#range-tests .numedit').press('Enter'); assert.equal(await r.inputValue(), '-0.1');
      await page.evaluate(() => { rangeEvents=[]; });
      await r.dispatchEvent('dblclick');
      assert.equal(await r.inputValue(), '0');
      assert.deepEqual(await page.evaluate(() => rangeEvents), [['input',0],['change',0]], 'reset emits one input/change pair');
      await r.dblclick({position:{x:bounds.width-20,y:bounds.height/2}});
      assert.equal(await r.inputValue(),'0','real double click from the far end restores exactly');
      await page.evaluate(() => { const r=document.getElementById('test-range');r.value='25';r.disabled=true;rangeEvents=[]; });
      await r.dispatchEvent('dblclick'); assert.equal(await r.inputValue(), '25');
      assert.deepEqual(await page.evaluate(() => rangeEvents), []);
      await page.evaluate(() => { const r=document.getElementById('test-range');r.disabled=false;r.dataset.def='-35'; });
      await page.locator('#range-tests label').dispatchEvent('dblclick'); assert.equal(await r.inputValue(), '-35');
      await page.close();
      console.log(`OK common ranges: DPR ${dpr}, defaults, native pointer, keyboard, typing, reset, disabled`);
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halation-defaults-')), host = createHost(root);
    const state = path.join(host.base, 'Settings', 'app.json');
    fs.writeFileSync(state, JSON.stringify({settings:{language:'en',saveMode:'auto'},grade:{previewPct:35,updatedAt:1},removebg:{feather:2.5}}));
    const app = await openApp(browser, server, host);
    let count=0;
    for (const tool of ['visualizer','grade','removebg','framegrab','interp','upscale']) {
      await app.tab(tool); await app.appReady(tool);
      const frame = app.page.frames().find(f => f.url().includes(tool+'.html'));
      if(tool==='grade') {
        const keys=await frame.locator('.tool').evaluateAll(ds=>ds.map(d=>d.dataset.key));
        for(const key of keys) {
          await frame.locator(`.tool[data-key="${key}"]`).evaluate(d=>{d.open=true;d.dispatchEvent(new Event('motion:open'));});
          await frame.waitForFunction(key=>[...document.querySelectorAll('.tool')].find(d=>d.dataset.key===key).querySelector('input[type=range]')?.dataset.def, key);
          const defaults=await frame.locator(`.tool[data-key="${key}"] input[type=range]`).evaluateAll(rs=>rs.map(r=>[r.value,__ui.rangeDefault(r),r.dataset.def,r.style.getPropertyValue('--default-position')]));
          for(const [v,def,raw,marker] of defaults){assert.equal(+v,def,`${key} default must remain unchanged`);assert.equal(def,+raw,`${key} declared default must align to step`);assert.equal(marker,'');}
        }
        // Add an adjustment layer through Grade's own action; its amount uses the same infrastructure.
        await frame.locator('.tool[data-key="adjust"]').evaluate(d=>{d.open=true;d.dispatchEvent(new Event('motion:open'));d.querySelector('[data-dact="add"]').click();});
        await frame.waitForFunction(()=>document.querySelector('.lamt input')?.dataset.def);
        const amount=frame.locator('.lamt input').first();
        await amount.evaluate(r=>{r.value='50';r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}));});
        await amount.dispatchEvent('dblclick');assert.equal(await amount.inputValue(),'100','layer amount resets through normal input/change');
      }
      const ranges = await frame.evaluate(() => [...document.querySelectorAll('input[type=range]')].map(r=>({id:r.id,def:r.dataset.def,marker:r.style.getPropertyValue('--default-position')})));
      for(const r of ranges) { if(['seek','scrub','videoSeek'].includes(r.id)) {assert.equal(r.def,undefined);continue;} assert.ok(r.def!=null,`${tool}/${r.id} missing reset default`);assert.equal(r.marker,'');count++; }
      if(tool==='grade') {
        assert.equal(await frame.locator('#thumbPct').inputValue(),'35','saved Grade value survives initialization');
        await frame.locator('#thumbPct').dispatchEvent('dblclick');assert.equal(await frame.locator('#thumbPct').inputValue(),'100');
        await frame.locator('#thumbPct').evaluate(r=>{r.value='40';r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}));});
        assert.ok(await until(async ()=>(await host.call('state_get',{key:'grade'}))?.previewPct===40),'chosen Grade value saved');
        await frame.goto(frame.url()); await app.appReady(tool); assert.equal(await frame.locator('#thumbPct').inputValue(),'40','chosen value survives reload');
        const restored=await frame.evaluate(async()=>{const a=__halApp,d=await a.session.capture();d.thumbnail=65;await a.session.restore(d);const saved=await a.session.capture();return [document.getElementById('thumbPct').value,saved.thumbnail,document.getElementById('thumbPct').dataset.def];});
        assert.deepEqual(restored,['65',65,'100'],'session capture/restore keeps chosen value and immutable default separately');
      }
      if(tool==='removebg') {
        const r=frame.locator('#feather');assert.equal(await r.inputValue(),'2.5');
        await r.dispatchEvent('dblclick');assert.equal(await r.inputValue(),'1');
        assert.ok(await until(async ()=>(await host.call('state_get',{key:'removebg'}))?.feather===1),'RemoveBG reset persists');
      }
      if(tool==='visualizer') {
        const r=frame.locator('#f-coverSize');await r.evaluate(r=>{r.value='40';r.dispatchEvent(new Event('input',{bubbles:true}));});
        await r.dispatchEvent('dblclick');assert.equal(await r.inputValue(),'52');
      }
      console.log(`OK real tool: ${tool}, ${ranges.length} range instances audited`);
    }
    await app.tab('home');
    await app.page.evaluate(()=>{const c=document.createElement('canvas');c.width=240;c.height=120;window.sharedImage=c;window.cropPromise=__hal.crop({image:c,ratio:'free',autoFocus:false});});
    await app.page.locator('#cropDlg').waitFor({state:'visible'});
    for(const [id,value,def] of [['cropZoom',2,1],['cropRot',12.3,0]]){
      const r=app.page.locator('#'+id);await r.evaluate((r,v)=>{r.value=v;r.dispatchEvent(new Event('input',{bubbles:true}));},value);
      await r.dispatchEvent('dblclick');assert.equal(await r.inputValue(),String(def));
    }
    await app.page.locator('#cropCancel').click();
    await app.page.evaluate(()=>{window.cutPromise=__hal.cutoutDialog({image:sharedImage,edit:{}});});
    await app.page.locator('#cutDlg').waitFor({state:'visible'});
    const divider=app.page.locator('#cutDlg .cmp .div'),stage=app.page.locator('#cutDlg .cmp');
    await divider.press('ArrowRight');assert.equal(await divider.getAttribute('aria-valuenow'),'52','comparator keyboard bypasses detent');
    const cb=await stage.boundingBox(),db=await divider.boundingBox(),cx=cb.x+cb.width/2,cy=cb.y+cb.height/2;
    await app.page.mouse.move(db.x+db.width/2,cy);await app.page.mouse.down();await app.page.mouse.move(cx+4,cy);
    assert.ok(await divider.evaluate(d=>parseFloat(d.style.left)>50&&parseFloat(d.style.left)<51),'comparator keeps fractional pointer position; aria-valuenow is rounded for speech');
    await app.page.mouse.move(cx+10,cy);assert.notEqual(await divider.getAttribute('aria-valuenow'),'50');await app.page.mouse.up();
    await divider.dblclick();assert.equal(await divider.getAttribute('aria-valuenow'),'50','comparator double click resets divider');
    assert.equal(await app.page.locator('#cutSize').getAttribute('data-def'),'10','Cutout brush default is computed from source dimensions');
    for(const [id,value,def] of [['cutSize',80,10],['cutFeather',4.5,0],['cutShift',-2.5,0]]){
      const r=app.page.locator('#'+id);assert.equal(await r.evaluate(r=>r.style.getPropertyValue('--default-position')), '');
      await r.evaluate((r,v)=>{r.value=v;r.dispatchEvent(new Event('input',{bubbles:true}));},value);
      await r.dispatchEvent('dblclick');assert.equal(await r.inputValue(),String(def));
    }
    await app.page.locator('#cutCancel').click();
    console.log('OK shared Crop/Cutout: real dialogs, rotation, zoom, decimal edges, image-dependent brush default');
    assert.ok(app.errors.length===0,app.errors.join('\n'));
    await app.page.close();
    console.log(`OK ${count} default-bearing tool instances (plus 5 shared Crop/Cutout sliders); no capture artifacts`);
  } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
