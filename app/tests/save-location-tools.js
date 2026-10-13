// Current 1.1.0 tool exports through the shared policy. No visual captures.
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { serve, launch, openApp, until } = require('./common');
const { createHost } = require('./host');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halation-save-tools-'));
  const ff = process.env.FFMPEG || 'ffmpeg';
  const image = path.join(root, 'picture.png'), audio = path.join(root, 'song.wav');
  execFileSync(ff, ['-v','error','-f','lavfi','-i','color=c=red:s=32x32','-frames:v','1',image]);
  execFileSync(ff, ['-v','error','-f','lavfi','-i','sine=f=440:d=0.2','-ac','2',audio]);
  const tools = { systemFfmpeg: ff, ffmpegSource: ff, convertFiles: [image] };
  const host = createHost(root, {tools}), server = serve(), browser = await launch();
  let app;
  try {
    app = await openApp(browser, server, host);
    const {page} = app, manual = path.join(root, 'Album'); fs.mkdirSync(manual);
    await app.tab('convert'); await app.appReady('convert');
    const cv = page.frameLocator('#v-convert');
    await cv.locator('#browseBtn').click();
    assert(await until(() => cv.locator('#convertBtn').isEnabled()));
    await cv.locator('#choices label.out:has(input[value="webp"])').click();
    host.setSaveDestination(path.join(manual,'converted.webp'));
    await cv.locator('#convertBtn').click();
    await page.locator('#saveLocationChoice').waitFor({state:'visible'});
    assert.equal(await page.locator('#saveLocationChoice input:checked').inputValue(),'ask-every-time');
    await page.locator('#saveLocationChoice [value=continue]').click();
    assert(await until(() => fs.existsSync(path.join(manual,'converted.webp')),20000));
    assert(await until(async () => (await page.evaluate(() => __hal.invoke('state_get',{key:'exportLocation'})))?.lastManualDirectory === manual));
    assert.equal(await cv.locator('#dest').count(),0,'no Converter destination preference');
    await app.tab('stems'); await app.appReady('stems');
    const st = page.frames().find(f => /stems\.html/.test(f.url()));
    // Already separated audio: exercise the real Vocal Remover export/FFmpeg pipeline without a model download.
    const item = {name:'song.wav', mode:'hq4', res:{dir:root, files:{vocals:audio,instrumental:audio},peak:{vocals:0.5,instrumental:0.5},source:{rate:44100}}};
    await st.evaluate(it => __stems.exportItem(it,null,['vocals']),item);
    assert(fs.existsSync(path.join(manual,'song (vocals).wav')));
    assert.equal(host.log.filter(x=>x[0]==='dialog').at(-1)[2],manual,'Vocal Remover inherits Converter directory');
    assert.equal(await page.frameLocator('#v-stems').locator('#dest').count(),0,'no Vocal Remover folder preference');
    host.setSaveDestination(null);
    await st.evaluate(async it => { try { await __stems.exportItem(it,null,['instrumental']); throw Error('Expected cancellation'); } catch(e) { if (!e.cancelled) throw e; } },item);
    assert.equal((await page.evaluate(()=>__hal.invoke('state_get',{key:'exportLocation'}))).lastManualDirectory,manual);
    await page.evaluate(()=>__hal.exportLocation.setMode('halation-folder'));
    const dialogs = host.log.filter(x=>x[0]==='dialog').length;
    await st.evaluate(it => __stems.exportItem(it,null,['vocals','instrumental']),item);
    assert(fs.existsSync(path.join(host.base,'Exports','Stems','song','song (vocals).wav')));
    assert(fs.existsSync(path.join(host.base,'Exports','Stems','song','song (instrumental).wav')));
    assert.equal(host.log.filter(x=>x[0]==='dialog').length,dialogs);
    await app.tab('convert');
    const fr = page.frames().find(f=>/convert\.html/.test(f.url()));
    await fr.evaluate(async image=>{ await __convert.addFiles([{path:image,name:'managed.png'}]); for (const it of __convert.C.items) if(it.state !== 'done') it.target='webp'; __convert.convert(); },image);
    assert(await until(()=>fs.readdirSync(host.dir('Exports','Converted')).some(f=>/\.webp$/.test(f)),20000));
    assert.equal(host.log.filter(x=>x[0]==='dialog').length,dialogs);
    host.setSaveDestination(path.join(manual,'immediate.png'));
    const immediate = await page.evaluate(async () => {
      const write = __hal.exportLocation.setMode('ask-every-time');
      const mode = __hal.settings().saveMode;
      const exportPromise = __hal.saveOutput(new Blob(['immediate']), 'immediate.png');
      await write;
      return {mode, path:await exportPromise};
    });
    assert.equal(immediate.mode,'ask-every-time','Settings mode changes synchronously');
    assert.equal(immediate.path,path.join(manual,'immediate.png'),'the next export waits for persistence');
    assert.equal(host.log.filter(x=>x[0]==='open_path').length,0);
    assert.equal(app.errors.length,0,app.errors.join('\n'));
    console.log('PASS 1.1.0 Converter + Vocal Remover: first choice, shared directory, cancel, immediate mode switching, managed outputs, no second preference');
  } finally { if(app) await app.page.close(); await browser.close(); server.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
