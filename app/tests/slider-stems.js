// Lane defaults use the same common infrastructure, with real native input events.
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {serve,launch,openApp}=require('./common'),{createHost}=require('./host');
(async()=>{const server=serve(),browser=await launch(),host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),'hal-lane-default-')));try{
 const app=await openApp(browser,server,host),page=app.page;
 await page.route('**/stems.js',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'../dist/stems.js'),'utf8').replace('window.__stems =','window.__testStems={up};window.__stems =')}));
 await app.tab('stems');await app.appReady('stems');const f=page.frames().find(f=>f.url().includes('stems.html'));
 await f.evaluate(()=>{const it={id:'defaults',name:'fixture.wav',mode:'hq4',state:'running',pct:0,times:[]};__stems.Q.items.push(it);__testStems.up.select(it);});
 const rs=f.locator('.lane-v .vol');await rs.first().waitFor();const count=await rs.count();assert(count>=2);
 for(let i=0;i<count;i++){const r=rs.nth(i);assert.equal(await r.getAttribute('data-def'),'0');assert.equal(await r.evaluate(r=>r.style.getPropertyValue('--default-position')), '');await r.press('ArrowLeft');assert.equal(await r.inputValue(),'-0.5');await r.dblclick();assert.equal(await r.inputValue(),'0');}
 const r=rs.first();await r.press('Enter');await f.locator('.lane-v .numedit').fill('-0.5');await f.locator('.lane-v .numedit').press('Enter');assert.equal(await r.inputValue(),'-0.5');
 await f.evaluate(()=>{const it={id:'defaults-four',name:'fixture-four.wav',mode:'htdemucs',state:'running',pct:0,times:[]};__stems.Q.items.push(it);__testStems.up.select(it);});
 assert.equal(await rs.count(),4);for(let i=0;i<4;i++){assert.equal(await rs.nth(i).getAttribute('data-def'),'0');assert.equal(await rs.nth(i).evaluate(r=>r.style.getPropertyValue('--default-position')), '');}
 assert.deepEqual(app.errors,[]);console.log('OK '+count+' Vocal Remover lane sliders: exact reset, adjacent keyboard/typed steps');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
