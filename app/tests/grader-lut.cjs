// Full 33^3 LUT byte hashes captured from edf8a82, independent of the optimized arithmetic.
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),assert=require('assert/strict');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'grader-lut-baseline.json'),'utf8'));
const math=fs.readFileSync(path.join(__dirname,'../dist/grade-color.js'),'utf8').replace(/export \{[^}]+\};?/, '');
const source=math+'\n'+fs.readFileSync(path.join(__dirname,'../dist/grader.js'),'utf8').replace(/^import[^\n]+\n/, '').replace(/const c01[^\n]+\n/, '').replace(/function hexRGB[^\n]+\n/, '').replace(/const lum[^\n]+\n/, '').replace(/export \{[^}]+\};?/, '')+'\n;globalThis.grading={makeGrader,buildLUT,LOOKS};';
const context={window:{__ui:{}},t:x=>x};vm.runInNewContext(source,context);const {makeGrader,buildLUT,LOOKS}=context.grading;
for(const sample of fixture.samples){
 const p=sample.look?LOOKS.find(l=>l.id===sample.look).g:sample.parameters;
 const fn=makeGrader(p),data=new Uint8Array(33**3*4);let i=0;
 for(let b=0;b<33;b++)for(let g=0;g<33;g++)for(let r=0;r<33;r++){
  const out=fn(r/32,g/32,b/32);data[i++]=out[0]*255+.5;data[i++]=out[1]*255+.5;data[i++]=out[2]*255+.5;data[i++]=255;
 }
 assert.equal(crypto.createHash('sha256').update(data).digest('hex'),sample.hash,sample.look||sample.name);
 assert.equal(crypto.createHash('sha256').update(buildLUT(p)).digest('hex'),sample.hash,'Worker LUT '+(sample.look||sample.name));
}
assert.equal(fixture.samples.filter(s=>s.look).length,LOOKS.length,'Every built-in look is covered');
console.log('PASS '+fixture.samples.length+' full-resolution 3D LUTs byte-identical to edf8a82');
