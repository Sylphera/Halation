// MP4 review requested by the user: compare source/decoded RGB and actual Chromium presentation separately.
const fs=require('fs'),path=require('path'),assert=require('assert'),cp=require('child_process');
const {launch}=require('./common'),{PNG}=require(cp.execSync('npm root -g').toString().trim()+'/pngjs');
const ROOT=process.argv[2];if(!ROOT)throw Error('Usage: node app/tests/island-video-review.js <render-directory>');
const DIR=path.join(ROOT,'island-rendered'),VIDEO=path.join(ROOT,'island-rendered.mp4');
const files=fs.readdirSync(DIR).filter(n=>/^\d+\.png$/.test(n)).sort();
function rgb(file){const p=PNG.sync.read(fs.readFileSync(file)),b=Buffer.alloc(p.width*p.height*3);for(let i=0,j=0;i<p.data.length;i+=4){b[j++]=p.data[i];b[j++]=p.data[i+1];b[j++]=p.data[i+2];}return b;}
function diff(a,b){assert.equal(a.length,b.length);let max=0,total=0,above3=0,maxOffset=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d>max){max=d;maxOffset=i;}if(d>3)above3++;total+=d;}return {max,mean:total/a.length,above3,above3Fraction:above3/a.length,maxOffset};}
(async()=>{
 const png=PNG.sync.read(fs.readFileSync(path.join(DIR,files[0]))),bytes=png.width*png.height*3,cache=new Map(),samples=[3,31,40,70,175,185,files.length-4];
 let index=0,pending=Buffer.alloc(0),stderr='',maximum=0,totalMean=0;
 await new Promise((resolve,reject)=>{
  const child=cp.spawn('ffmpeg',['-v','error','-i',VIDEO,'-sws_flags','bilinear+accurate_rnd+full_chroma_int','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
  child.stderr.on('data',d=>stderr+=d);child.on('error',reject);
  child.stdout.on('data',d=>{pending=Buffer.concat([pending,d]);while(pending.length>=bytes){try{const frame=pending.subarray(0,bytes),error=diff(frame,rgb(path.join(DIR,files[index])));maximum=Math.max(maximum,error.max);totalMean+=error.mean;if(samples.some(s=>index>=s&&index<=s+2))cache.set(index,Buffer.from(frame));index++;pending=pending.subarray(bytes);}catch(e){child.kill();reject(e);}}});
  child.on('close',code=>code?reject(Error(stderr)):resolve());
 });assert.equal(index,files.length);assert.equal(pending.length,0);
 const browser=await launch();try{
  const page=await browser.newPage(),video=fs.readFileSync(VIDEO);
  await page.route('http://review.test/**',route=>{
   if(!route.request().url().endsWith('.mp4'))return route.fulfill({status:200,contentType:'text/html',body:'<video muted playsinline preload="auto" src="/video.mp4"></video><canvas></canvas>'});
   const range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||'');
   if(!range)return route.fulfill({status:200,contentType:'video/mp4',headers:{'Accept-Ranges':'bytes','Content-Length':String(video.length)},body:video});
   const start=+range[1],end=range[2]?+range[2]:video.length-1;
   return route.fulfill({status:206,contentType:'video/mp4',headers:{'Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${video.length}`},body:video.subarray(start,end+1)});
  });
  await page.goto('http://review.test/');await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
  const presented=[];
  for(const frame of samples){
   const result=await page.evaluate(frame=>new Promise((resolve,reject)=>{
    const v=document.querySelector('video'),c=document.querySelector('canvas');c.width=v.videoWidth;c.height=v.videoHeight;
    const timeout=setTimeout(()=>reject(Error('No presented H.264 frame')),5000);
    function shown(now,meta){if(meta.mediaTime<frame/60-.008){v.requestVideoFrameCallback(shown);return;}v.pause();clearTimeout(timeout);const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(v,0,0);const a=ctx.getImageData(0,0,c.width,c.height).data,b=new Uint8Array(c.width*c.height*3);for(let i=0,j=0;i<a.length;i+=4){b[j++]=a[i];b[j++]=a[i+1];b[j++]=a[i+2];}let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));resolve({mediaTime:meta.mediaTime,presentedFrames:meta.presentedFrames,rgb:btoa(s)});}
    v.pause();v.requestVideoFrameCallback(shown);v.currentTime=frame/60+.00001;
   }),frame);
   const actual=Math.round(result.mediaTime*60);assert(actual>=frame&&actual<=frame+2,'player skipped the requested segment: '+JSON.stringify({requested:frame,actual,mediaTime:result.mediaTime}));
   const decodedError=diff(Buffer.from(result.rgb,'base64'),cache.get(actual)),sourceError=diff(Buffer.from(result.rgb,'base64'),rgb(path.join(DIR,files[actual])));
   const pixels=Buffer.from(result.rgb,'base64'); const diagnostic=new PNG({width:png.width,height:png.height}); for(let i=0,j=0;i<pixels.length;i+=3,j+=4){diagnostic.data[j]=pixels[i];diagnostic.data[j+1]=pixels[i+1];diagnostic.data[j+2]=pixels[i+2];diagnostic.data[j+3]=255;} fs.writeFileSync(path.join(ROOT,'player-'+actual+'.png'),PNG.sync.write(diagnostic));
   presented.push({requested:frame,actual,mediaTime:result.mediaTime,presentedFrames:result.presentedFrames,decodedError,sourceError});
  }
  const report={codec:'MP4 H.264 High 4.2 YUV420 BT.709 limited, faststart, CRF 10; exact RGB reference is native PNG',frames:index,sourceDecoded:{max:maximum,mean:totalMean/index},presented,sourceRgbExact:maximum===0};
  fs.writeFileSync(path.join(ROOT,'video-rgb.json'),JSON.stringify(report,null,2));console.log('MP4 RGB comparison and presented Chromium frames:',JSON.stringify(report));await page.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
