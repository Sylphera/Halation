# System GPU/CPU/RAM sampler for one verified native instance. Writes JSONL, never touches UI.
param([Parameter(Mandatory)][int]$RootProcessId,[Parameter(Mandatory)][string]$Executable,[Parameter(Mandatory)][string]$Output,[string]$StopFile,[int]$MaxSamples=0)
$ErrorActionPreference='Stop'
$rootProcess=Get-Process -Id $RootProcessId
if($rootProcess.Path -ne [IO.Path]::GetFullPath($Executable)){throw 'Benchmark executable/PID mismatch'}
$rootIdentity=Get-CimInstance Win32_Process -Filter ('ProcessId='+$RootProcessId)
if([Math]::Abs(($rootProcess.StartTime-$rootIdentity.CreationDate).TotalMilliseconds) -gt 1){throw 'Root PID changed during validation'}
$rootStarted=$rootIdentity.CreationDate.ToUniversalTime().ToString('O')
$known=@{}
$writer=[IO.StreamWriter]::new([IO.Path]::GetFullPath($Output),$false,[Text.UTF8Encoding]::new($false))
$writer.AutoFlush=$true
function Emit($value){$writer.WriteLine(($value|ConvertTo-Json -Depth 12 -Compress))}
try {
 $sets=@(Get-Counter -ListSet '*GPU*')
 $paths=@($sets.Paths|Where-Object {$_ -match '^\\GPU Engine\(\*\)\\Utilization Percentage$|^\\GPU Process Memory\(\*\)\\(Dedicated Usage|Shared Usage)$|^\\GPU Adapter Memory\(\*\)\\(Dedicated Usage|Shared Usage)$'})
 if($paths.Count -lt 5){throw 'GPU counters unavailable/localized: expected GPU Engine, GPU Process Memory, GPU Adapter Memory. No zero fallback.'}
 Emit @{kind='metadata';schema=1;rootPid=$RootProcessId;rootStarted=$rootStarted;executable=$rootProcess.Path;utc=[DateTime]::UtcNow.ToString('O');paths=$paths;adapters=@(Get-CimInstance Win32_VideoController|Select-Object Name,PNPDeviceID,DriverVersion);samplerPid=$PID}
 $previousUtc=$null;$count=0
 # Reopen wildcard queries each interval: a continuous query retains the instance set
 # from startup and can omit a later DirectML/child-process GPU allocation.
 while($true) {
  $pair=@(Get-Counter -Counter $paths -SampleInterval 1 -MaxSamples 2 -ErrorAction Continue -ErrorVariable counterErrors)
  if($pair.Count -ne 2){throw 'GPU query did not supply a priming and measured sample'}
  $previousUtc=$pair[0].Timestamp.ToUniversalTime()
  $counterSet=$pair[1]
  if($StopFile -and (Test-Path -LiteralPath $StopFile)){throw [OperationCanceledException]::new('Sampler stopped')}
  $now=$counterSet.Timestamp.ToUniversalTime()
  $all=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CreationDate,ExecutablePath,CommandLine,KernelModeTime,UserModeTime,WorkingSetSize,PrivatePageCount)
  $currentRoot=$all|Where-Object {$_.ProcessId -eq $RootProcessId}
  if(!$currentRoot -or $currentRoot.CreationDate.ToUniversalTime().ToString('O') -ne $rootStarted){throw 'Native instance exited or PID reused'}
  $members=@{};$members[$RootProcessId]=$currentRoot
  # Keep known descendants after an intermediate parent exits, but reject reused PIDs.
  foreach($item in $all){if($known.ContainsKey([int]$item.ProcessId) -and $known[[int]$item.ProcessId] -eq $item.CreationDate){$members[[int]$item.ProcessId]=$item}}
  do {$added=0;foreach($item in $all){if(!$members.ContainsKey([int]$item.ProcessId) -and $members.ContainsKey([int]$item.ParentProcessId) -and $item.CreationDate -ge $members[[int]$item.ParentProcessId].CreationDate){$members[[int]$item.ProcessId]=$item;$added++}}} while($added)
  foreach($item in $members.Values){$known[[int]$item.ProcessId]=$item.CreationDate}
  $byPid=@{};foreach($item in $all){$byPid[[int]$item.ProcessId]=$item}
  $engines=@();$memory=@();$adapters=@();$external=@();$dwm=@();$invalid=@()
  foreach($sample in $counterSet.CounterSamples){
   if($sample.Status -notin @(0,1)){$invalid+=@{instance=$sample.InstanceName;status=$sample.Status};continue}
   $instance=$sample.InstanceName.ToLowerInvariant();$value=$sample.CookedValue
   if($instance -match '^pid_(\d+)_(luid_0x[0-9a-f]+_0x[0-9a-f]+_phys_\d+)(?:_eng_(\d+)_engtype_(.+))?$'){
    $owner=[int]$Matches[1];$adapter=$Matches[2];$engine=$Matches[3];$type=$Matches[4]
    if($sample.Path -match '\\utilization percentage$'){
     $row=@{pid=$owner;adapter=$adapter;engine=$engine;type=$type;percent=$value;instance=$instance}
     if($members.ContainsKey($owner)){$engines+=$row}elseif($byPid[$owner].Name -eq 'dwm.exe'){$dwm+=$row}elseif($value -ge .05){$row.name=$byPid[$owner].Name;$external+=$row}
    }elseif($members.ContainsKey($owner)){$memory+=@{pid=$owner;adapter=$adapter;counter=($sample.Path.Split('\')[-1]);bytes=$value;instance=$instance}}
   }elseif($sample.Path -match '\\gpu adapter memory\('){$adapters+=@{instance=$instance;counter=($sample.Path.Split('\')[-1]);bytes=$value}}
  }
  $processes=@($members.Values|ForEach-Object {@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;name=$_.Name;created=$_.CreationDate.ToUniversalTime().ToString('O');path=$_.ExecutablePath;command=$_.CommandLine;cpuSeconds=([double]$_.KernelModeTime+[double]$_.UserModeTime)/1e7;workingSetBytes=[double]$_.WorkingSetSize;privateBytes=[double]$_.PrivatePageCount}})
  Emit @{kind='sample';utc=$now.ToString('O');fromUtc=$previousUtc;priming=($null -eq $previousUtc);processes=$processes;engines=$engines;gpuMemory=$memory;adapterMemory=$adapters;dwm=$dwm;external=$external;invalid=$invalid;pdhWarnings=@($counterErrors|ForEach-Object {$_.Exception.Message})}
  $counterErrors=@()
  $previousUtc=$now.ToString('O');$count++
  if($MaxSamples -gt 0 -and $count -ge $MaxSamples){throw [OperationCanceledException]::new('Sampler complete')}
 }
} catch [OperationCanceledException] { } catch {Emit @{kind='error';utc=[DateTime]::UtcNow.ToString('O');message=$_.Exception.Message};throw} finally {$writer.Dispose()}
