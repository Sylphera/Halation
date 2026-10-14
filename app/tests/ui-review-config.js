// Confirmed user's actual 1920x1080 window at100% Windows scale. Evidence only, no CSS zoom or upscaling.
const path=require('path');
const width=1920,height=1080,previewDpr=.5,nativeDpr=1;
const out=path.resolve(__dirname,'../../review/ui-drape-wave-drop-1920x1080');
module.exports={width,height,previewDpr,nativeDpr,out,previewWidth:960,previewHeight:540,nativeWidth:1920,nativeHeight:1080,previewLevel:'4.0',nativeLevel:'4.2'};
