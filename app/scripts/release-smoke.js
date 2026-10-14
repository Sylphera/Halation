// Deterministic checks of the final PE and Tauri's embedded assets; no CDP or captures.
// Usage: node app/scripts/release-smoke.js <portable.exe> <version> [release/build]
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),zlib=require('zlib');
const [binary,version,build=path.join(__dirname,'../src-tauri/target/release/build')]=process.argv.slice(2);
assert(binary&&version,'Portable executable and expected version are required');
const exe=fs.readFileSync(binary),dist=path.join(__dirname,'../dist');
assert.equal(exe.toString('ascii',0,2),'MZ','Windows executable');
const pe=exe.readUInt32LE(0x3c);
assert.equal(exe.toString('ascii',pe,pe+4),'PE\0\0','PE signature');
assert.equal(exe.readUInt16LE(pe+4),0x8664,'x64 executable');
const assets=[];
for(const entry of fs.readdirSync(build).filter(name=>name.startsWith('halation-'))){
 const root=path.join(build,entry,'out/tauri-codegen-assets');
 if(!fs.existsSync(root))continue;
 for(const file of fs.readdirSync(root)){
  const bytes=fs.readFileSync(path.join(root,file));
  // Cached or test-build assets only count if those exact bytes occur in the final executable.
  if(exe.indexOf(bytes)<0)continue;
  try{assets.push(zlib.brotliDecompressSync(bytes));}catch{assets.push(bytes);}
 }
}
for(const file of ['sessions.js','shell.js','common.js','modules.js','motion.js','grade.css','covertest.js','covertest.css','ui.css','shell.css','locales/en.json','locales/es.json']){
 const source=fs.readFileSync(path.join(dist,file));
 assert(assets.some(bytes=>bytes.equals(source)),file+' from this checkout is embedded in the final executable');
 console.log('PASS final embedded asset: '+file);
}
const en=JSON.parse(fs.readFileSync(path.join(dist,'locales/en.json'),'utf8'));
assert.equal(en['set.version'],'{name} {version} · Free software (GPL-3.0)');
assert(!Object.keys(en).some(key=>key.startsWith('intro.')||key==='tab.intro'),'Title Intro is absent from the final locale');
assert(!fs.existsSync(path.join(dist,'intro.html'))&&!fs.existsSync(path.join(dist,'ui-shadows.js')),'Removed UI runtimes are absent from the packaged frontend');
assert(['auralis-renderer.js','atmosphere.js.LEGAL.txt'].every(f=>!fs.existsSync(path.join(dist,f)))&&['drape.js','blue-noise.js','atmosphere.js'].every(f=>fs.existsSync(path.join(dist,f))),'Drape ships as plain drape.js + blue-noise.js + atmosphere.js, without the old bundle or renderer');
const shell=fs.readFileSync(path.join(dist,'shell.js'),'utf8');
assert(shell.includes('t("set.version", { name: info.name, version: info.version })'),'About renders the embedded license label');
for(const command of ['session_state','session_replace','session_recovery','session_recovery_write','session_discard','session_write','session_read','session_file_put']){
 assert(exe.includes(Buffer.from(command)),'Native command '+command+' exists in the final executable');
}
assert.equal(require('../src-tauri/tauri.conf.json').version,version);
console.log('PASS final embedded license and Sessions frontend/native commands (runtime behavior is covered separately)');
