// Benchmark-only instrumentation/ablations. Never imported by production.
module.exports=function installAblation(){
 const cfg={drape:true,atmosphere:true,live:true,scale:1,fps:0,keepalive:true,video:true,depth:true,shadows:true};
 const contexts=[],seen=new WeakSet(),locations=new WeakMap(),sizes=new WeakMap(),targets=new WeakMap(),meta=new WeakMap(),workers=[];
 const draws={};let css=null,deadlines=new WeakMap();
 const kind=c=>c.closest?.('.drape-host')?'drape':c.classList?.contains('tool-atmo')?'atmosphere':'tool';
 function track(gl,type){if(!gl||!type.includes('webgl')||seen.has(gl))return;seen.add(gl);const data={live:{},created:{},deleted:{},uploads:[],passes:{},boundTexture:null};meta.set(gl,data);contexts.push({ref:new WeakRef(gl),type,data});}
 for(const T of [window.HTMLCanvasElement,window.OffscreenCanvas])if(T){const get=T.prototype.getContext;T.prototype.getContext=function(type,...a){const gl=get.call(this,type,...a);track(gl,type);return gl;};}
 for(const dim of ['width','height']){const d=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,dim);Object.defineProperty(HTMLCanvasElement.prototype,dim,{...d,set(v){if(kind(this)==='drape'){const s=sizes.get(this)||{};s[dim]=v;sizes.set(this,s);v=Math.max(1,Math.round(v*cfg.scale));}d.set.call(this,v);}});}
 for(const T of [window.WebGLRenderingContext,window.WebGL2RenderingContext])if(T){
  const location=T.prototype.getUniformLocation;T.prototype.getUniformLocation=function(p,n){const l=location.call(this,p,n);if(l)locations.set(l,n);return l;};
  const uniform=T.prototype.uniform2f;T.prototype.uniform2f=function(l,x,y){if(kind(this.canvas)==='drape'&&locations.get(l)==='u_resolution'){x=this.canvas.width;y=this.canvas.height;}return uniform.call(this,l,x,y);};
  const bind=T.prototype.bindFramebuffer;T.prototype.bindFramebuffer=function(target,fb){targets.set(this,fb);return bind.call(this,target,fb);};
  const viewport=T.prototype.viewport;T.prototype.viewport=function(x,y,w,h){if(kind(this.canvas)==='drape'&&!targets.get(this)){w=this.canvas.width;h=this.canvas.height;}return viewport.call(this,x,y,w,h);};
  for(const name of ['Texture','Framebuffer','Program','Buffer','Shader','Renderbuffer']){
   const create=T.prototype['create'+name],remove=T.prototype['delete'+name],live=new WeakSet();
   T.prototype['create'+name]=function(...a){const x=create.apply(this,a),m=meta.get(this);if(x&&m){live.add(x);m.live[name]=(m.live[name]||0)+1;m.created[name]=(m.created[name]||0)+1;}return x;};
   T.prototype['delete'+name]=function(x){const m=meta.get(this);if(x&&live.has(x)&&m){live.delete(x);m.live[name]--;m.deleted[name]=(m.deleted[name]||0)+1;}return remove.call(this,x);};
  }
  for(const name of ['texImage2D','texImage3D','generateMipmap','compileShader','linkProgram'])if(T.prototype[name]){const fn=T.prototype[name];T.prototype[name]=function(...a){const start=performance.now(),r=fn.apply(this,a),m=meta.get(this);if(m){const image=a.at(-1);m.uploads.push({name,at:start,cpuMs:performance.now()-start,width:name==='texImage2D'&&a.length<9?image?.width||image?.naturalWidth:a[3],height:name==='texImage2D'&&a.length<9?image?.height||image?.naturalHeight:a[4],depth:name==='texImage3D'?a[5]:undefined});}return r;};}
  for(const k of ['drawArrays','drawElements']){const draw=T.prototype[k];T.prototype[k]=function(...a){const type=kind(this.canvas),now=performance.now(),target=targets.get(this)||this.canvas;if((type==='drape'&&!cfg.drape)||(type==='atmosphere'&&!cfg.atmosphere)||(type==='tool'&&!cfg.live))return;
    if(type==='drape'&&cfg.fps){const step=1000/cfg.fps,due=deadlines.get(target)??now;if(now+1<due)return;deadlines.set(target,now-due<step?due+step:now+step);}
    draws[type]=(draws[type]||0)+1;const m=meta.get(this);if(m){const pass=targets.get(this)?'offscreen':'screen';m.passes[pass]=(m.passes[pass]||0)+1;}return draw.apply(this,a);};}
 }
 for(const name of ['fillRect','drawImage','putImageData','clearRect']){const fn=CanvasRenderingContext2D.prototype[name];CanvasRenderingContext2D.prototype[name]=function(...a){if(this.canvas.id==='composition-keepalive'&&!cfg.keepalive)return;if(this.canvas.id!=='composition-keepalive'&&!cfg.live)return;return fn.apply(this,a);};}
 function workerProbe(){let enabled=true,state={};const refs=[],seen=new WeakSet();let draws=0;
  const get=OffscreenCanvas.prototype.getContext;OffscreenCanvas.prototype.getContext=function(type,...a){const gl=get.call(this,type,...a);if(gl&&type.includes('webgl')&&!seen.has(gl)){seen.add(gl);refs.push(new WeakRef(gl));}return gl;};
  for(const T of [self.WebGLRenderingContext,self.WebGL2RenderingContext])if(T)for(const k of ['drawArrays','drawElements']){const fn=T.prototype[k];T.prototype[k]=function(...a){if(enabled){draws++;return fn.apply(this,a);}};}
  self.addEventListener('message',e=>{const d=e.data;if(d?.__gpuProbe){if(d.__gpuProbe.query){postMessage({__gpuSnapshot:{draws,contexts:refs.flatMap(r=>{const g=r.deref();return g?[{width:g.drawingBufferWidth,height:g.drawingBufferHeight,lost:g.isContextLost()}]:[]})},query:d.__gpuProbe.query});}else{enabled=d.__gpuProbe.atmosphere;self.dispatchEvent(new MessageEvent('message',{data:{__gpuSynthetic:true,set:{...state,visible:enabled&&state.visible!==false}}}));}e.stopImmediatePropagation();return;}if(d?.set){if(!d.__gpuSynthetic)Object.assign(state,d.set);if(!enabled)d.set.visible=false;}},true);
 }
 const blobSources=new Map(),createURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL);
 URL.createObjectURL=blob=>{const url=createURL(blob);blobSources.set(url,blob);return url;};
 URL.revokeObjectURL=url=>{blobSources.delete(String(url));return revokeURL(url);};
 const WorkerOriginal=Worker;let queryId=0;
 window.Worker=class extends WorkerOriginal{
  constructor(url,...a){let wrapped=null;const source=blobSources.get(String(url));
   // Inline the original Blob: importScripts(url) races with immediate URL.revokeObjectURL after new Worker.
   if(source&&a[0]?.type!=='module')wrapped=URL.createObjectURL(new Blob(['('+workerProbe.toString()+')();\n',source],{type:'text/javascript'}));
   super(wrapped||url,...a);this.__gpuWrapped=!!wrapped;this.__gpuURL=wrapped;this.__gpuPending=new Map();
   if(wrapped){workers.push(new WeakRef(this));this.addEventListener('message',e=>{if(e.data?.__gpuSnapshot){this.__gpuSnapshot=e.data.__gpuSnapshot;this.__gpuPending.get(e.data.query)?.();this.__gpuPending.delete(e.data.query);e.stopImmediatePropagation();}},true);this.addEventListener('message',()=>this.__gpuReleaseURL(),{once:true});}
  }
  __gpuReleaseURL(){if(this.__gpuURL){URL.revokeObjectURL(this.__gpuURL);this.__gpuURL=null;}}
  terminate(){this.__gpuReleaseURL();return super.terminate();}
  postMessage(d,...a){if(d?.canvas)this.__gpuAtmosphere=true;return super.postMessage(d,...a);}
 };
 window.__gpuAblation={
  async refresh(){await Promise.all(workers.flatMap(r=>{const w=r.deref();if(!w?.__gpuAtmosphere||w.__alive===false)return [];const id=++queryId;return [new Promise(resolve=>{const timer=setTimeout(()=>{w.__gpuPending.delete(id);resolve();},250);w.__gpuPending.set(id,()=>{clearTimeout(timer);resolve();});w.postMessage({__gpuProbe:{query:id}});})];}));},
  set(next){Object.assign(cfg,next);deadlines=new WeakMap();for(const r of workers){const w=r.deref();if(w?.__gpuAtmosphere&&w.__alive!==false)w.postMessage({__gpuProbe:{atmosphere:cfg.atmosphere}});}for(const {ref} of contexts){const g=ref.deref();if(!g||kind(g.canvas)!=='drape')continue;const s=sizes.get(g.canvas);if(s){g.canvas.width=s.width;g.canvas.height=s.height;g.viewport(0,0,g.canvas.width,g.canvas.height);g.uniform2f(g.getUniformLocation(g.getParameter(g.CURRENT_PROGRAM),'u_resolution'),g.canvas.width,g.canvas.height);}}
   if(!css){css=document.createElement('style');document.head.append(css);}css.textContent=(cfg.depth?'':'*{backdrop-filter:none!important;filter:none!important}')+(cfg.shadows?'':'*{box-shadow:none!important;text-shadow:none!important}');if(!cfg.video)for(const m of document.querySelectorAll('audio,video'))m.pause();dispatchEvent(new Event('resize'));
  },
  snapshot(){return {config:{...cfg},executedDraws:{...draws},dpr:devicePixelRatio,viewport:{width:innerWidth,height:innerHeight},contexts:contexts.flatMap(({ref,type,data})=>{const g=ref.deref();return g?[{type,kind:kind(g.canvas),id:g.canvas.id,width:g.drawingBufferWidth,height:g.drawingBufferHeight,lost:g.isContextLost(),live:{...data.live},created:{...data.created},deleted:{...data.deleted},uploads:data.uploads.slice(),passes:{...data.passes}}]:[]}),workerContexts:workers.flatMap(r=>{const w=r.deref();return w?.__gpuAtmosphere&&w.__alive!==false?[w.__gpuSnapshot||{unavailable:true}]:[]}),media:[...document.querySelectorAll('audio,video')].map(m=>({tag:m.tagName,paused:m.paused,ready:m.readyState,width:m.videoWidth,height:m.videoHeight}))};}
 };
};
