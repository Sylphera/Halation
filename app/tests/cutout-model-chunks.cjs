const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto');
(async()=>{
 const loaded=[],answers=[],ort={env:{wasm:{}},InferenceSession:{create:async b=>{loaded.push(Buffer.from(b));return {inputNames:[],outputNames:[],release:async()=>{}};}}};
 const context=vm.createContext({ort,Uint8Array,Float32Array,Map,performance,self:{postMessage:m=>answers.push(m)}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/cutout-worker.js'),'utf8').replace(/import \* as ort from [^;]+;/,''),context);
 let id=0;const send=async(type,data)=>{await context.self.onmessage({data:{id:++id,type,data}});const r=answers.pop();if(!r.ok)throw Error(r.error);return r.out;};
 const parts=async(key,bytes)=>{for(let at=0;at<=bytes.length;at+=512<<10){const part=bytes.subarray(at,at+(512<<10)),done=part.length<(512<<10);await send('file',{key,bytes:Uint8Array.from(part).buffer,offset:at,done});if(done)break;}};
 const bytes=crypto.randomBytes((512<<10)*2+17),wasm=Buffer.from([0,97,115,109]);
 await parts('wasm',wasm);await parts('decoder',bytes);await send('init',{config:{},backend:'wasm'});
 assert.deepEqual(Buffer.from(ort.env.wasm.wasmBinary),wasm);assert.deepEqual(loaded[0],bytes);assert.equal(vm.runInContext('files.size',context),0);
 await parts('encoder',bytes);await send('encoder',{});assert.deepEqual(loaded[1],bytes);assert.equal(vm.runInContext('files.size',context),0);
 await assert.rejects(send('file',{key:'encoder',bytes:new ArrayBuffer(1),offset:17,done:true}),/order/);
 await send('file',{key:'encoder',bytes:new ArrayBuffer(1),offset:0,done:false});await assert.rejects(send('encoder',{}),/incomplete/);
 await parts('encoder',bytes);await send('encoder',{});assert.deepEqual(loaded[2],bytes);
 console.log('PASS worker model chunks preserve bytes, free staging, reject incomplete/out-of-order input and retry');
})().catch(e=>{console.error(e);process.exitCode=1});
