// Tauri patches the installer's bundle-type marker, then restores the portable binary.
// Every other byte must match. Usage: node installer-parity.js <installed.exe> <portable.exe>
const assert=require('assert/strict'),fs=require('fs');
const [installedFile,portableFile]=process.argv.slice(2);
assert(installedFile&&portableFile,'Installed executable and portable are required');
const installed=fs.readFileSync(installedFile),portable=fs.readFileSync(portableFile);
assert.equal(installed.length,portable.length,'Executable sizes match');
if(!installed.equals(portable)){
 const original=Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK'),nsis=Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS');
 const offset=portable.indexOf(original);
 assert(offset>=0,'Portable has the Tauri bundle-type marker');
 assert.equal(portable.indexOf(original,offset+original.length),-1,'Portable marker is unambiguous');
 assert(installed.subarray(offset,offset+nsis.length).equals(nsis),'Installer has the NSIS marker at the same offset');
 original.copy(installed,offset);
 assert(installed.equals(portable),'Installer and portable match byte-for-byte except the Tauri bundle-type marker');
}
console.log('PASS installer and portable contain the same executable (only the Tauri NSIS bundle-type marker may differ)');
