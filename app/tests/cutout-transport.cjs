// Actual service transport: teardown must reject pending calls and stop further model reads.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
(async()=>{
 const code=fs.readFileSync(path.join(__dirname,'../dist/services.js'),'utf8');
 const start=code.indexOf('let worker = null, starting = null, seq = 0, life = 0, noGpu = false;');
 const end=code.indexOf('function engine()',start);assert(start>=0&&end>start);
 let reads=0,terminated=0,resolveRead;const sent=[];
 const ctx=vm.createContext({Map,Promise,Error,setTimeout,clearTimeout,invoke:async()=>{reads++;return new Promise(r=>resolveRead=r);}});
 vm.runInContext(code.slice(start,end),ctx);
 ctx.fake={postMessage:(m)=>sent.push(m),terminate:()=>terminated++};vm.runInContext('worker=fake',ctx);
 const pending=vm.runInContext('call("encode",{})',ctx);
 const rejected=assert.rejects(pending,/stopped/);
 const loading=vm.runInContext('modelFile("encoder","model.onnx")',ctx);
 const aborted=assert.rejects(loading,/stopped/);
 vm.runInContext('stop()',ctx);resolveRead(new ArrayBuffer(4));
 assert.equal(vm.runInContext('calls.size',ctx),0,'Stopped worker must release pending callbacks');
 await Promise.all([rejected,aborted]);
 assert.equal(terminated,1);assert.equal(reads,1);assert.equal(sent.length,1);
 assert.equal(vm.runInContext('calls.size',ctx),0);assert.equal(vm.runInContext('worker',ctx),null);
 assert.equal(vm.runInContext('idleTimer',ctx),0);
 console.log('PASS Cutout teardown rejects pending calls, clears timers and prevents late model sends');
})().catch(e=>{console.error(e);process.exitCode=1});
