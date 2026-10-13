// Technical file/decoder checks. Native Windows app opening is verified separately by the coordinator.
const fs=require('fs'),path=require('path'),assert=require('assert'),cp=require('child_process');
const {PNG}=require(path.join(cp.execSync('npm root -g').toString().trim(),'pngjs'));
const out=path.resolve(__dirname,'../../review/auralis-grain2-windows'),video=path.join(out,'navigation.mp4');
const rgb=file=>{const p=PNG.sync.read(fs.readFileSync(file),{checkCRC:true}),b=Buffer.alloc(p.width*p.height*3);for(let i=0,j=0;i<p.data.length;i+=4){b[j++]=p.data[i];b[j++]=p.data[i+1];b[j++]=p.data[i+2];}return {p,b};};
(async()=>{
 const images=[];
 for(const file of ['home.png','grade.png','home-1920.png']){const {p}=rgb(path.join(out,file));images.push({file,width:p.width,height:p.height,bytes:fs.statSync(path.join(out,file)).size,pngCRC:true});}
 const probe=JSON.parse(cp.execFileSync('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',video]));
 const v=probe.streams.find(s=>s.codec_type==='video');assert(v.codec_name==='h264'&&v.profile==='Main'&&v.pix_fmt==='yuv420p'&&v.color_space==='bt709'&&v.color_range==='tv');
 const buf=fs.readFileSync(video),atoms=[];let at=0;
 while(at<buf.length){let size=buf.readUInt32BE(at);const type=buf.toString('ascii',at+4,at+8);if(size===1)size=Number(buf.readBigUInt64BE(at+8));if(!size)size=buf.length-at;atoms.push({type,offset:at,size});at+=size;}
 assert(atoms.find(a=>a.type==='moov').offset<atoms.find(a=>a.type==='mdat').offset,'MP4 faststart');
 const bytes=v.width*v.height*3,frames=path.join(out,'source-frames');let pending=Buffer.alloc(0),index=0,stderr='';const diffs=[];
 await new Promise((resolve,reject)=>{
  const child=cp.spawn('ffmpeg',['-v','error','-i',video,'-f','rawvideo','-pix_fmt','rgb24','pipe:1']);child.on('error',reject);child.stderr.on('data',d=>stderr+=d);
  child.stdout.on('data',d=>{pending=Buffer.concat([pending,d]);while(pending.length>=bytes){try{
   const source=rgb(path.join(frames,String(index).padStart(4,'0')+'.png')).b,actual=pending.subarray(0,bytes);let sum=0,max=0;const counts=new Uint32Array(256);
   for(let i=0;i<bytes;i++){const delta=Math.abs(actual[i]-source[i]);sum+=delta;max=Math.max(max,delta);counts[delta]++;}
   let total=0,p95=0;for(let i=0;i<256;i++){total+=counts[i];if(total>=bytes*.95){p95=i;break;}}
   diffs.push({frame:index,meanAbsoluteChannelError:sum/bytes,p95AbsoluteChannelError:p95,maxAbsoluteChannelError:max});index++;pending=pending.subarray(bytes);
  }catch(e){child.kill();reject(e);}}});child.on('close',c=>c?reject(Error(stderr)):resolve());
 });assert(index===100&&+v.nb_read_frames===100&&!pending.length);
 fs.writeFileSync(path.join(out,'codec-validation.json'),JSON.stringify({images,probe,atoms,decodedFrames:index,diffs,
  differencePolicy:'H264 yuv420p is intentionally lossy/chroma-subsampled. RGB differences are recorded; app colors/shader were not changed to compensate.',
  nativeWindowsAppOpening:'Technical checks do not certify local Photos/Media Player opening; coordinator observes those apps separately.'},null,2));
 console.log('PASS PNG CRC/native sizes; MP4 H264 Main/yuv420p/BT709 limited/faststart;100 decoded frames. RGB mean error range',Math.min(...diffs.map(x=>x.meanAbsoluteChannelError)),Math.max(...diffs.map(x=>x.meanAbsoluteChannelError)));
})().catch(e=>{console.error(e);process.exit(1);});
