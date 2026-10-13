// Verify source RGB against BOTH the encoded stream and frames presented by Chromium.
const fs=require('fs'),path=require('path'),assert=require('assert'),cp=require('child_process');
const {launch}=require('./common');const {PNG}=require(require('child_process').execSync('npm root -g').toString().trim()+'/pngjs');
const ROOT=process.argv[2];if(!ROOT)throw Error('Usage: node app/tests/review-video.js <review-directory>');
function rgb(file){const p=PNG.sync.read(fs.readFileSync(file)),b=Buffer.alloc(p.width*p.height*3);for(let i=0,j=0;i<p.data.length;i+=4){b[j++]=p.data[i];b[j++]=p.data[i+1];b[j++]=p.data[i+2];}return b;}
async function verify(name,browser){
 const dir=path.join(ROOT,name),video=path.join(ROOT,name+'.webm'),files=fs.readdirSync(dir).filter(n=>/^\d+\.png$/.test(n)).sort(),png=PNG.sync.read(fs.readFileSync(path.join(dir,files[0]))),bytes=png.width*png.height*3;
 let index=0,pending=Buffer.alloc(0),stderr='';
 await new Promise((resolve,reject)=>{
  const child=cp.spawn('ffmpeg',['-v','error','-i',video,'-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
  child.stderr.on('data',d=>stderr+=d);child.on('error',reject);
  child.stdout.on('data',d=>{pending=Buffer.concat([pending,d]);while(pending.length>=bytes){try{assert(pending.subarray(0,bytes).equals(rgb(path.join(dir,files[index]))),'decoded RGB differs at '+index);index++;pending=pending.subarray(bytes);}catch(e){child.kill();reject(e);}}});
  child.on('close',code=>code?reject(Error(stderr)):resolve());
 });assert.strictEqual(index,files.length);assert.strictEqual(pending.length,0);
 const page=await browser.newPage();
 const videoBytes=fs.readFileSync(video);
 await page.route('http://review.test/**',route=>{
  if(!route.request().url().endsWith('.webm'))return route.fulfill({status:200,contentType:'text/html',body:'<video muted playsinline preload="auto" src="/video.webm"></video><canvas></canvas>'});
  const range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||'');
  if(!range)return route.fulfill({status:200,contentType:'video/webm',headers:{'Accept-Ranges':'bytes','Content-Length':String(videoBytes.length)},body:videoBytes});
  const start=+range[1],end=range[2]?+range[2]:videoBytes.length-1;
  return route.fulfill({status:206,contentType:'video/webm',headers:{'Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${videoBytes.length}`},body:videoBytes.subarray(start,end+1)});
 });
 await page.goto('http://review.test/');await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
 const presented=[];
 for(const frame of [3,20,40,70,files.length-4]){
  const result=await page.evaluate(frame=>new Promise((resolve,reject)=>{
   const v=document.querySelector('video'),c=document.querySelector('canvas');c.width=v.videoWidth;c.height=v.videoHeight;
   const timeout=setTimeout(()=>reject(Error('No presented video frame')),5000);
   function presented(now,meta){if(meta.mediaTime<frame/60-.008){v.requestVideoFrameCallback(presented);return;}v.pause();clearTimeout(timeout);const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(v,0,0);const a=ctx.getImageData(0,0,c.width,c.height).data,b=new Uint8Array(c.width*c.height*3);for(let i=0,j=0;i<a.length;i+=4){b[j++]=a[i];b[j++]=a[i+1];b[j++]=a[i+2];}let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));resolve({mediaTime:meta.mediaTime,presentedFrames:meta.presentedFrames,rgb:btoa(s)});}
   v.requestVideoFrameCallback(presented);
   v.currentTime=frame/60+.00001;v.play().catch(reject);
  }),frame);
  const actual=Math.round(result.mediaTime*60);assert(actual>=frame&&actual<=frame+2,'player did not present the requested segment');assert(Buffer.from(result.rgb,'base64').equals(rgb(path.join(dir,files[actual]))),'presented Chromium RGB differs at '+actual);presented.push({requested:frame,actual,mediaTime:result.mediaTime,presentedFrames:result.presentedFrames});
 }
 await page.close();return {name,frames:index,decodedRgbExact:true,presentedRgbExact:true,presented};
}
(async()=>{const browser=await launch();try{const results=[];for(const name of fs.readdirSync(ROOT).filter(n=>n.endsWith('.webm')).map(n=>n.slice(0,-5)))results.push(await verify(name,browser));fs.writeFileSync(path.join(ROOT,'video-rgb.json'),JSON.stringify(results,null,2));console.log('OK source/decoded RGB exact for all frames; Chromium presented RGB exact:',results.map(r=>r.name).join(', '));}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
