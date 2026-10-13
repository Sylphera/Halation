// First-start language selection in the existing Welcome; no visual captures.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {serve,launch,openApp,until,locale}=require('./common'),{createHost}=require('./host');
(async()=>{
 const server=serve(),browser=await launch(),newPage=browser.newPage.bind(browser);
 let systemLocale='en-US';
 browser.newPage=async options=>{
  const page=await newPage(options);await page.addInitScript(value=>Object.defineProperty(navigator,'language',{get:()=>value}),systemLocale);return page;
 };
 try {
  for(const [system,initial,chosen] of [['es-ES','es','es'],['es-MX','es','en'],['en-US','en','es'],['fr-FR','en','en'],['','en','en'],[null,'en','en']]){
   systemLocale=system;
   const host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),'halation-welcome-language-')));host.begin();
   const state=()=>JSON.parse(fs.readFileSync(path.join(host.base,'Settings/app.json'),'utf8'));
   const app=await openApp(browser,server,host,{welcome:true}),page=app.page;
   await page.waitForFunction(()=>document.querySelector('#welcome').dataset.phase==='language');
   assert.equal(await page.locator('#wLanguage input:checked').inputValue(),initial);
   assert.equal(await page.locator('#wTitle').textContent(),initial==='es'?'Idioma':'Language');
   assert.deepEqual(await page.locator('#wLanguage b').allTextContents(),['English','Español']);
   assert.equal(await page.locator('#wOk').textContent(),initial==='es'?'Continuar':'Continue');
   assert.equal(await page.locator('#wSkip').isVisible(),false);assert.equal(await page.locator('#wIntro').isVisible(),false);
   assert(!state().settings,'Locale preselection is not saved before confirmation');
   await page.keyboard.press('Escape');assert.equal(await page.locator('#welcome').getAttribute('data-phase'),'language');assert(!state().settings);
   for(const selection of ['en','es',initial]){
    await page.locator(`#wLanguage input[value="${selection}"]`).check();
    assert.equal(await page.locator('#wTitle').textContent(),selection==='es'?'Idioma':'Language');
    assert.equal(await page.locator('#wOk').textContent(),selection==='es'?'Continuar':'Continue');
    assert.deepEqual(await page.locator('#wLanguage b').allTextContents(),['English','Español']);
    assert(!state().settings,'Live text changes do not save the preference');
   }
   await page.locator(`#wLanguage input[value="${chosen}"]`).check();
   assert.equal(await page.locator('#wTitle').textContent(),chosen==='es'?'Idioma':'Language');
   assert.equal(await page.locator('#wOk').textContent(),chosen==='es'?'Continuar':'Continue');
   await page.click('#wOk');await page.waitForFunction(()=>document.querySelector('#welcome').dataset.phase==='welcome');
   assert.equal(state().settings.language,chosen);assert.equal(await page.evaluate(()=>window.__i18n.lang()),chosen);
   const {L}=locale(chosen);
   const translated=async()=>{
    const visible=await page.locator('#welcome [data-i18n]').evaluateAll(elements=>elements.filter(el=>el.getClientRects().length).map(el=>[el.dataset.i18n,el.textContent]));
    for(const [key,text] of visible)assert.equal(text,L(key),key+' localized');
   };
   await translated();assert.equal(await page.locator('#wTitle').textContent(),L('welcome.introTitle'));
   assert.equal(await page.locator('#wProgress').getAttribute('aria-label'),L('welcome.step1'));
   await page.click('#wOk');await page.waitForFunction(()=>document.querySelector('#welcome').dataset.phase==='identity');await translated();
   assert.equal(await page.locator('#wName').getAttribute('placeholder'),L('welcome.namePh'));
   assert.equal(await page.locator('#wProgress').getAttribute('aria-label'),L('welcome.step2'));
   await page.click('#wSkip');await page.waitForFunction(()=>document.querySelector('#welcome').dataset.phase==='ready');await translated();
   await page.click('#wOk');await page.locator('#welcome').waitFor({state:'hidden'});
   // Settings remains the existing way to change language after onboarding.
   const other=chosen==='es'?'en':'es';await app.tab('settings');await page.locator('#setLanguage').selectOption(other);
   await page.waitForFunction(lang=>window.__i18n?.lang()===lang&&!document.body.classList.contains('booting'),other);
   assert.equal(state().settings.language,other);assert.equal(await page.locator('#welcome').isVisible(),false);
   await page.close();host.begin();systemLocale=initial==='es'?'en-US':'es-ES';
   const next=await openApp(browser,server,host,{welcome:true});assert.equal(await next.page.locator('#welcome').isVisible(),false);assert.equal(await next.page.evaluate(()=>window.__i18n.lang()),other);
   await next.page.evaluate(()=>window.__shell.welcome());await next.page.waitForFunction(()=>document.querySelector('#welcome').dataset.phase==='welcome');
   assert.equal(await next.page.locator('#wLanguage').isVisible(),false,'Saved language skips the selector even if Welcome is explicitly reopened');
   assert.deepEqual(app.errors,[]);assert.deepEqual(next.errors,[]);await next.page.close();
   console.log('PASS locale '+JSON.stringify(system)+': '+initial+' preselected, '+chosen+' saved; localized Welcome sequence, Settings change and subsequent launch skip language selection');
  }
  // Native write failure does not advance or pretend the preference was saved.
  systemLocale='es-ES';const host=createHost(fs.mkdtempSync(path.join(os.tmpdir(),'halation-welcome-language-failure-')));host.begin();
  const call=host.call.bind(host);let fail=true;host.call=async(...args)=>args[0]==='state_set'&&args[1]?.key==='settings'&&fail?{__error:'Disk full'}:call(...args);
  const app=await openApp(browser,server,host,{welcome:true});await app.page.waitForFunction(()=>document.querySelector('#welcome').dataset.phase==='language');
  await app.page.click('#wOk');assert(await until(()=>app.page.locator('#wLanguageStatus').isVisible(),3000));
  assert.equal(await app.page.locator('#welcome').getAttribute('data-phase'),'language');assert.equal(await app.page.locator('#wOk').isEnabled(),true);
  fail=false;await app.page.click('#wOk');await app.page.waitForFunction(()=>document.querySelector('#welcome').dataset.phase==='welcome');
  assert.equal(await app.page.evaluate(()=>window.__i18n.lang()),'es');assert.deepEqual(app.errors,[]);
  console.log('PASS failed preference write stays on language choice and can retry');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
