# Control only the explicitly named disposable Preview; fail if Windows did not apply the requested state.
param([Parameter(Mandatory)][int]$ProcessId,[Parameter(Mandatory)][string]$Executable,[Parameter(Mandatory)][ValidateSet('minimize','restore','resize-cycle','blur','benchmark-restore','inspect','resize-once')][string]$State,[int]$BlurProcessId=0,[string]$BlurExecutable)
$ErrorActionPreference='Stop'
$process=Get-Process -Id $ProcessId
$expected=[IO.Path]::GetFullPath($Executable)
if($process.Path -ne $expected -or $process.ProcessName -ne 'halation-preview'){throw 'Not the disposable Preview executable'}
Add-Type -TypeDefinition @'
using System;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Text;
public class HalPerfWindow {
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc f,IntPtr p);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
 [DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [StructLayout(LayoutKind.Sequential)]public struct Rect{public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")]public static extern bool GetClientRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")]public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
 public static bool BaselineSize(IntPtr h){Rect r,c;if(!GetWindowRect(h,out r)||!GetClientRect(h,out c))return false;double dpi=GetDpiForWindow(h)/96.0;return SetWindowPos(h,IntPtr.Zero,0,0,(int)Math.Round(1480*dpi)+(r.Right-r.Left)-(c.Right-c.Left),(int)Math.Round(940*dpi)+(r.Bottom-r.Top)-(c.Bottom-c.Top),0x16);}
 public static bool ResizeCycle(IntPtr h){Rect r;if(!GetWindowRect(h,out r))return false;int width=r.Right-r.Left,height=r.Bottom-r.Top;for(int i=0;i<12;i++){if(!SetWindowPos(h,IntPtr.Zero,0,0,width-(i%4)*36,height-(i%3)*24,0x16))return false;System.Threading.Thread.Sleep(80);}return SetWindowPos(h,IntPtr.Zero,0,0,width,height,0x16);}
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern IntPtr GetShellWindow();
 [DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")]static extern bool AttachThreadInput(uint a,uint b,bool attach);
 [DllImport("user32.dll")]static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 public static bool Activate(IntPtr h){ShowWindow(h,9);if(GetForegroundWindow()==h)return true;SetForegroundWindow(h);if(GetForegroundWindow()==h)return true;uint pid;uint foreground=GetWindowThreadProcessId(GetForegroundWindow(),out pid),thread=GetCurrentThreadId();bool attached=foreground!=0&&foreground!=thread&&AttachThreadInput(thread,foreground,true);try{ShowWindow(h,9);SetForegroundWindow(h);if(GetForegroundWindow()!=h){keybd_event(0x12,0,0,UIntPtr.Zero);keybd_event(0x12,0,2,UIntPtr.Zero);SetForegroundWindow(h);}}finally{if(attached)AttachThreadInput(thread,foreground,false);}return GetForegroundWindow()==h;}
 public static string Diagnostic(uint pid){var result=new StringBuilder();EnumWindows((h,p)=>{uint owner;GetWindowThreadProcessId(h,out owner);if(owner==pid||h==GetForegroundWindow()){var title=new StringBuilder(256);GetWindowText(h,title,256);result.Append($"hwnd={h} pid={owner} visible={IsWindowVisible(h)} foreground={h==GetForegroundWindow()} title={title}; ");}return true;},IntPtr.Zero);return result.ToString();}
 public static IntPtr FindVisible(uint pid){IntPtr found=IntPtr.Zero;EnumWindows((h,p)=>{uint owner;GetWindowThreadProcessId(h,out owner);var title=new StringBuilder(256);GetWindowText(h,title,256);if(owner==pid&&IsWindowVisible(h)&&title.Length>0){found=h;return false;}return true;},IntPtr.Zero);return found;}
 public static IntPtr Find(uint pid){IntPtr found=IntPtr.Zero;EnumWindows((h,p)=>{uint owner;GetWindowThreadProcessId(h,out owner);var title=new StringBuilder(256);GetWindowText(h,title,256);if(owner==pid&&title.ToString().StartsWith("Halation")){found=h;return false;}return true;},IntPtr.Zero);return found;}
}
'@
$handle=[HalPerfWindow]::Find($ProcessId)
if($handle -eq [IntPtr]::Zero){throw 'Preview has no native Halation window'}
if($State -eq 'inspect'){
 # Read-only state, no activation.
}elseif($State -eq 'blur'){
 if($BlurProcessId){
  $target=Get-Process -Id $BlurProcessId
  if($target.Path -ne [IO.Path]::GetFullPath($BlurExecutable) -or $target.ProcessName -ne 'chrome'){throw 'Not the explicitly owned blank benchmark browser'}
  $other=[HalPerfWindow]::FindVisible($BlurProcessId)
  if($other -eq [IntPtr]::Zero -or -not [HalPerfWindow]::Activate($other)){throw 'Blank benchmark browser did not acquire foreground'}
 }else{[HalPerfWindow]::SetForegroundWindow([HalPerfWindow]::GetShellWindow())|Out-Null}
 if([HalPerfWindow]::GetForegroundWindow() -eq $handle){throw 'Preview did not lose native foreground focus'}
}elseif($State -eq 'resize-once'){
 $r=[HalPerfWindow+Rect]::new();if(-not [HalPerfWindow]::GetWindowRect($handle,[ref]$r)){throw 'No native bounds'}
 if(-not [HalPerfWindow]::SetWindowPos($handle,[IntPtr]::Zero,0,0,$r.Right-$r.Left-80,$r.Bottom-$r.Top-40,0x16)){throw 'Native settled resize failed'}
}elseif($State -eq 'resize-cycle'){
 if(-not [HalPerfWindow]::ResizeCycle($handle)){throw 'Native resize cycle failed'}
}elseif($State -eq 'minimize'){
 [HalPerfWindow]::ShowWindow($handle,6)|Out-Null
 if(-not [HalPerfWindow]::IsIconic($handle)){throw 'Preview did not minimize'}
}else{
 if(-not [HalPerfWindow]::Activate($handle)){throw ('Preview did not acquire native foreground focus: '+[HalPerfWindow]::Diagnostic($ProcessId))}
 if($State -eq 'benchmark-restore' -and -not [HalPerfWindow]::BaselineSize($handle)){throw 'Preview benchmark client size failed'}
 if([HalPerfWindow]::IsIconic($handle) -or -not [HalPerfWindow]::IsWindowVisible($handle)){throw 'Preview did not restore'}
}
[pscustomobject]@{pid=$ProcessId;handle=$handle.ToInt64();minimized=[HalPerfWindow]::IsIconic($handle);visible=[HalPerfWindow]::IsWindowVisible($handle);foreground=([HalPerfWindow]::GetForegroundWindow() -eq $handle);diagnostic=[HalPerfWindow]::Diagnostic($ProcessId)}|ConvertTo-Json -Compress
