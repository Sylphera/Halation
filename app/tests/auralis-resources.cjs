// Auralis (app/dist/auralis.js) without a browser: blue noise, CPU/shader field description, coverage stabiliser,
// GL resources, cadence and lifecycle against a recording WebGL mock. No screenshots or timing claims.
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),cp=require('child_process');
const dist=path.join(__dirname,'../dist'),code=fs.readFileSync(path.join(dist,'auralis.js'),'utf8'),noise=fs.readFileSync(path.join(dist,'blue-noise.js'),'utf8');

/* ===== blue noise ===== */
cp.execFileSync(process.execPath,[path.join(__dirname,'../scripts/blue-noise.js'),'--check'],{stdio:'pipe'});
const bytes=Buffer.from(/"([^"]+)"/.exec(noise)[1],'base64');
assert.equal(bytes.length,128*128,'128×128 threshold map');
const histogram=new Array(256).fill(0);for(const b of bytes)histogram[b]++;
assert(histogram.every(n=>n===64),'Void-and-cluster ranks: every level equally often');
// blue: neighbours differ more than a random field would (low-frequency energy suppressed)
let near=0;for(let y=0;y<128;y++)for(let x=0;x<128;x++)near+=Math.abs(bytes[y*128+x]-bytes[y*128+(x+1)%128]);
assert(near/16384>100,'Adjacent thresholds are anti-correlated: '+(near/16384).toFixed(1));
console.log('PASS blue noise 128×128, uniform ranks, generated file up to date');

/* ===== mock ===== */
function setup({half=true,complete=true,failShader=false,width=1480,height=940,dpr=2}={}){
 let lost=false,id=0,compiles=0,clock=0,timerId=0;const live=new Set(),draws=[],uniforms={},timers=new Map(),listeners={},windowListeners={},subscriptions=new Set(),tasks=[],observers=[],bodyClasses=new Set();
 const allocate=type=>{const value={type,id:++id};live.add(value);return value;},release=x=>live.delete(x);
 let current=null,fbo=null;
 const gl=new Proxy({
  createProgram:()=>allocate('program'),createShader:()=>allocate('shader'),createBuffer:()=>allocate('buffer'),createTexture:()=>allocate('texture'),createFramebuffer:()=>allocate('framebuffer'),
  deleteProgram:release,deleteShader:release,deleteBuffer:release,deleteTexture:release,deleteFramebuffer:release,
  getExtension:n=>half&&/half_float/.test(n)?{HALF_FLOAT_OES:36193}:null,compileShader:()=>compiles++,
  getShaderParameter:()=>!(failShader&&compiles>1),getShaderInfoLog:()=>'injected compile failure',getProgramParameter:(p,k)=>k==='ACTIVE_UNIFORMS'?0:true,
  getUniformLocation:(_,n)=>n,isContextLost:()=>lost,checkFramebufferStatus:()=>complete?'FRAMEBUFFER_COMPLETE':'incomplete',
  useProgram:p=>current=p,bindFramebuffer:(_,f)=>fbo=f,drawArrays:(m,f,n)=>draws.push({program:current,fbo,n}),
  texImage2D:(...a)=>{if(a.at(-1))uniforms.uploads=(uniforms.uploads||0)+1;},getParameter:()=>[0,0,width*dpr,height*dpr]
 },{get:(o,k)=>k in o?o[k]:(/^[A-Z_0-9]+$/.test(k)?k:()=>{})});
 const el=tag=>({tagName:tag,className:'',dataset:{},style:{},hidden:false,width:0,height:0,attrs:{},setAttribute(k,v){this.attrs[k]=v},
  getContext:()=>gl,addEventListener:(n,f)=>listeners[n]=f,removeEventListener:(n,f)=>{if(listeners[n]===f)delete listeners[n];}});
 const host={dataset:{mode:'home',rest:'home'}},surface={clientWidth:width,clientHeight:height,children:[],closest:()=>host,append(...c){this.children.push(...c)}};
 const budget={visible:true,focused:true,reduced:false,profile:{name:'high',dpr:2,scale:1},
  add(fn,options){const t={fn,options:{...options},active:false,start(){this.active=true},request(){this.active=true},stop(){this.active=false},setFps(f){this.options.fps=f},dispose(){this.active=false;this.disposed=true}};tasks.push(t);return t;},
  subscribe(fn){subscriptions.add(fn);return()=>subscriptions.delete(fn)}};
 class Observer{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}
 const context={__renderBudget:budget,__auralisBlueNoise:/"([^"]+)"/.exec(noise)[1],document:{body:{classList:{contains:n=>bodyClasses.has(n)}},createElement:el},
  getComputedStyle:()=>({transform:'none'}),DOMMatrixReadOnly:class{constructor(){this.a=this.d=1}},innerWidth:width,innerHeight:height,devicePixelRatio:dpr,
  performance:{now:()=>clock},ResizeObserver:Observer,MutationObserver:Observer,Float32Array,Uint8Array,atob:s=>Buffer.from(s,'base64').toString('binary'),
  addEventListener(n,f){windowListeners[n]=f},removeEventListener(n,f){if(windowListeners[n]===f)delete windowListeners[n]},
  setTimeout(fn){timers.set(++timerId,fn);return timerId},clearTimeout(i){timers.delete(i)},console};
 context.window=context;vm.createContext(context);vm.runInContext(code,context);
 const task=()=>tasks.at(-1);
 return {context,gl,host,surface,budget,tasks,observers,subscriptions,live,listeners,windowListeners,timers,bodyClasses,draws,uniforms,
  create:options=>context.__auralis.create(surface,options),canvas:()=>surface.children[0],state:()=>surface.children[0].__auralisState(),
  notify(){for(const fn of subscriptions)fn()},flush(){for(const [k,fn] of [...timers]){timers.delete(k);fn()}},setLost:v=>lost=v,
  tick(ms=1000/15){clock+=ms;const t=task();if(t.active)t.fn(clock,budget.profile);}};
}

/* ===== field ===== */
{
 const s=setup(),A=s.context.__auralis,F0=A.field;
 let lo=Infinity,hi=-Infinity;for(let i=0;i<20000;i++){const v=A.snoise(Math.sin(i)*40,Math.cos(i*1.3)*40,i*.01);lo=Math.min(lo,v);hi=Math.max(hi,v);}
 assert(lo>-1.05&&hi<1.05&&hi-lo>1.4,'Simplex noise spans about [-1, 1]: '+lo.toFixed(3)+' '+hi.toFixed(3));
 assert(/const vec2 AXIS=vec2\(0\.79864,0\.60182\)/.test(A.glsl.field),'Folds and clusters on a 37° axis');
 // folds run along the axis: the phase changes several times faster across it than along it
 {let along=0,across=0;const c=Math.cos(F0.angle),s=Math.sin(F0.angle),d=.01;for(let i=0;i<400;i++){const x=Math.sin(i*1.7)*.8,y=Math.cos(i*.9)*.45,t=i*3,p=A.foldPhase(x,y,t);
  along+=Math.abs(A.foldPhase(x+c*d,y+s*d,t)-p);across+=Math.abs(A.foldPhase(x-s*d,y+c*d,t)-p);}
  assert(across/along>2.4,'Folds run along the axis (phase changes over 2.4 times faster across it): '+(across/along).toFixed(2));}
 // the stabiliser keeps the lit share (clusters × sheen × vignette) at its target at every moment of a long run
 const F=A.field,ss=x=>{x=Math.min(1,Math.max(0,x));return x*x*(3-2*x)},lit=(aspect,t,bias)=>{let sum=0,n=0;for(let y=0;y<14;y++)for(let x=0;x<24;x++,n++){const u=(x+.5)/24-.5,w=(y+.5)/14-.5,px=u*aspect*F.zoom,py=w*F.zoom;
  const ax=px*Math.cos(F.angle)+py*Math.sin(F.angle)-t*F.drift,sheen=ss((A.snoise(ax*F.sheenAlong,A.foldPhase(px,py,t)*F.sheenAcross/(2*Math.PI),t*F.sheenRate+3)+.6)/1.4);
  sum+=ss((A.clusterValue(px,py,t)+bias-F.low)/(F.high-F.low))*(F.sheenLow+(1-F.sheenLow)*sheen)*(1-F.vignette*ss((Math.hypot(u*aspect*.75,w)-.18)/.67));}return sum/n;};
 const shares=[];for(let t=0;t<=600;t+=15){const b=A.coverageBias(16/9,t);shares.push(lit(16/9,t,b));assert(b>-.8&&b<.8,'Bias stays in range at '+t);}
 assert(Math.min(...shares)>F.target*.7&&Math.max(...shares)<F.target*1.6,'Lit share steady over ten minutes: '+shares.map(x=>x.toFixed(3)).join(' '));
 console.log('PASS field description: simplex range, folds stretched along 37°, coverage stabiliser over 600 s');
}

/* ===== resources and lifecycle ===== */
for(const half of [true,false]){
 const s=setup({half}),api=s.create({refraction:'vec2 navigationRefraction(vec2 p,vec2 q,float e){return p;}'}),c=s.canvas(),st=s.state;
 assert.equal(c.width,2960);assert.equal(c.height,1880,'Canvas at CSS size × DPR (2), whole pixels');
 assert.equal(st().fieldWidth,320);assert.equal(st().fieldHeight,203,'Field 320 px on the long edge');
 assert.equal(st().fieldStorage,half?'half-float':'rgba8');assert.equal(s.tasks[0].options.fps,15,'15 Hz field');
 assert.deepEqual([...s.live].map(x=>x.type).sort(),['buffer','framebuffer','program','program','program','texture','texture'],'One buffer, field + two presentation programs, field target and noise');
 assert.equal(s.uniforms.uploads,1,'Blue noise uploaded once');assert.equal(st().grainStrength,.5,'Approved 50% grain');
 assert(s.draws.length>=2&&s.draws.at(-2).fbo&&!s.draws.at(-1).fbo,'First image: field into its target, then presentation');
 const t0=st().time,d0=s.draws.length;for(let i=0;i<60;i++)s.tick();
 assert.equal(s.draws.length,d0+120,'Visible focused Home draws field + presentation each tick');assert(st().time>t0);assert.equal(s.live.size,7,'No resource growth');assert.equal(s.uniforms.uploads,1,'No per-frame uploads');
 // the clock delta is capped at 0.1 s
 const t1=st().time;s.tick(5000);assert(Math.abs(st().time-t1-.1)<1e-9,'Delta capped at 0.1 s');
 for(const v of [0,.35,3,12,-2]){c.__auralisReview.setGrainStrength(v);assert.equal(st().grainStrength,Math.max(0,Math.min(3,v)));}c.__auralisReview.setGrainStrength(.5);
 function suspended(name,change,undo){change();s.notify();const before=s.draws.length,t=st().time;for(let i=0;i<10;i++)s.tick();
  assert.equal(s.draws.length,before,name+' does no work');assert.equal(st().time,t);assert.equal(s.tasks[0].active,false);assert.equal(st().state,'suspended');
  undo();s.notify();s.tick();assert.equal(s.draws.length,before+2,name+' resumes');assert.equal(st().time,t,'Resume does not count the time away');}
 suspended('hidden window',()=>s.budget.visible=false,()=>s.budget.visible=true);
 suspended('unfocused window',()=>s.budget.focused=false,()=>s.budget.focused=true);
 suspended('tool at rest',()=>s.host.dataset.rest='tool',()=>s.host.dataset.rest='home');
 suspended('Welcome',()=>s.bodyClasses.add('welcome-active'),()=>s.bodyClasses.delete('welcome-active'));
 // resize: coalesced for 160 ms, then one draw at the new size
 s.surface.clientWidth=1300;s.surface.clientHeight=850;s.observers[0].fn([]);s.surface.clientWidth=1200;s.surface.clientHeight=800;s.observers[0].fn([]);
 assert.equal(s.timers.size,1,'Resize coalesced');s.flush();s.tick();assert.equal(c.width,2400);assert.equal(c.height,1600);assert.equal(st().fieldHeight,213);assert.equal(st().dirty,false);
 // reduced motion: the last image stays, an invalidation draws once
 s.budget.reduced=true;s.notify();const r=s.draws.length;for(let i=0;i<10;i++)s.tick();assert.equal(s.draws.length,r,'Reduced motion keeps the last image');assert.equal(st().state,'sleep');
 s.windowListeners.auralisinvalidate();assert.equal(s.draws.length,r+2,'Invalidation draws once');for(let i=0;i<5;i++)s.tick();assert.equal(s.draws.length,r+2);
 s.budget.reduced=false;s.notify();s.tick();assert.equal(s.tasks[0].active,true);
 // navigation wave: refraction program and 60 Hz presentation while it travels, field still at 15 Hz
 const presentProgram=s.draws.at(-1).program;api.wave(.3,-1);assert.equal(st().fps,60);s.tick(1000/60);assert.notEqual(s.draws.at(-1).program,presentProgram,'Refraction variant while the packet travels');
 const w=s.draws.length;for(let i=0;i<8;i++)s.tick(1000/60);const fields=s.draws.slice(w).filter(d=>d.fbo).length;assert(fields>=1&&fields<=3,'Field keeps its own cadence: '+fields);
 api.wave(0,-1);s.tick(1000/60);assert.equal(st().fps,15);assert.equal(s.draws.at(-1).program,presentProgram);
 // context loss: nothing resurrects it; restoration keeps the phase
 const lostTime=st().time;s.setLost(true);s.listeners.webglcontextlost({preventDefault(){}});s.notify();s.windowListeners.auralisinvalidate();s.observers[0].fn([]);s.flush();
 const ld=s.draws.length;for(let i=0;i<5;i++)s.tick();assert.equal(s.draws.length,ld);assert.equal(s.tasks[0].active,false);assert.equal(st().state,'lost');assert.equal(st().time,lostTime);
 s.live.clear();s.setLost(false);s.listeners.webglcontextrestored();assert.equal(st().time,lostTime,'Restoration keeps the field phase');assert.equal(s.live.size,7,'Resources rebuilt once');
 s.tick();assert(st().time>lostTime);
 api.dispose();api.dispose();assert.equal(s.live.size,0,'Dispose releases every resource');assert.equal(s.subscriptions.size,0);assert.equal(s.timers.size,0);
 assert(s.observers.every(o=>o.disconnected));assert.deepEqual(Object.keys(s.listeners),[]);assert.deepEqual(Object.keys(s.windowListeners),[]);assert.equal(s.tasks[0].disposed,true);
 console.log('PASS resources and lifecycle',half?'(half-float field)':'(8-bit field fallback)');
}
{const s=setup({complete:false});assert.throws(()=>s.create(),/framebuffer incomplete/);assert.equal(s.live.size,0,'A failed field target releases everything');}
{const s=setup({failShader:true});assert.throws(()=>s.create(),/injected compile failure/);assert.equal(s.live.size,0,'A failed shader releases everything');}
{const s=setup({width:600,height:900,dpr:1});s.create();assert.equal(s.state().fieldHeight,320);assert.equal(s.state().fieldWidth,213,'Portrait: 320 px on the long edge');}
console.log('PASS Auralis without a browser: blue noise, field, stabiliser, resources, cadence, suspension, resize, reduced motion, context loss and cleanup');
