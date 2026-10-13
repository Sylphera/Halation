// Exercise the actual capture helper without a decoder/model or visual artifacts.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../dist/framegrab.js'),'utf8');
 const begin=source.indexOf('async function sessionVideo()'),end=source.indexOf('window.__halApp =',begin);
 assert(begin>=0&&end>begin);
 const calls=[],F={video:null},HAL={session:{ref:async(src,name)=>{calls.push({src,name});return {path:src.path||'persisted-blob',name};}}};
 const c={F,HAL};vm.runInNewContext(source.slice(begin,end)+';this.capture=sessionVideo',c);
 assert.equal(await c.capture(),null);assert.equal(calls.length,0);
 const existing={path:'original.mp4',name:'original.mp4'};F.video=existing;await c.capture();assert.equal(calls[0].src,existing);
 let ready;const disk=new Promise(r=>ready=r),blob={arrayBuffer(){throw Error('Must not upload the original blob twice');}};
 F.video={path:null,name:'browser.webm',disk,blob};const pending=c.capture();await Promise.resolve();assert.equal(calls.length,1,'Wait for the existing copy');
 F.video={path:'replacement.mp4',name:'replacement.mp4'};ready({path:'workspace/browser.webm',name:'browser.webm'});
 const ref=await pending;assert.equal(ref.path,'workspace/browser.webm');assert.equal(ref.name,'browser.webm','An in-flight capture keeps its own video');assert.equal(calls[1].src.path,ref.path);
 F.video={path:null,name:'fallback.webm',disk:Promise.reject(Error('Disk copy failed')),blob};await c.capture();assert.equal(calls[2].src,blob,'A usable browser video can still be persisted after copy failure');
 HAL.session.ref=async()=>{throw Error('Session storage failed');};await assert.rejects(c.capture(),/Session storage failed/);
 console.log('PASS Frame Grab session shares the existing disk copy, waits safely and preserves blob fallback/errors');
})().catch(e=>{console.error(e);process.exitCode=1});
