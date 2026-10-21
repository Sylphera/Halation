param(
    [switch]$Run,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$exe = (Resolve-Path (Join-Path $PSScriptRoot '..\target\release\halation-slint.exe')).Path
$scenes = @('empty', 'home', 'cycle')
$repeats = 2
$runPlan = @()
for ($repeat = 1; $repeat -le $repeats; $repeat++) {
    $order = if ($repeat % 2) { $scenes } else { @($scenes[2], $scenes[1], $scenes[0]) }
    foreach ($scene in $order) {
        $runPlan += [pscustomobject]@{ repeat = $repeat; scene = $scene }
    }
}
$visibleWaitSeconds = 30
$durationSeconds = 110
$sampleSeconds = 1
$sourceFiles = @(
    'slint/Cargo.toml', 'slint/Cargo.lock', 'slint/build.rs',
    'slint/src/app.rs', 'slint/src/profile.rs', 'slint/src/library.rs',
    'slint/ui/app.slint', 'slint/ui/pages/home.slint',
    'slint/ui/components/button.slint', 'slint/ui/components/rail-item.slint',
    'slint/src/backdrop.rs', 'slint/scripts/measure-memory.ps1'
)
$sourceHashes = @($sourceFiles | ForEach-Object {
    $path = Join-Path $repoRoot $_
    [ordered]@{ path = $_; sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
})
$expectedSourceState = (& git -C $repoRoot status --porcelain)

if (-not $OutputDirectory) {
    $nonce = [Guid]::NewGuid().ToString('N').Substring(0, 10)
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutputDirectory = Join-Path $repoRoot ".tools\ui-rebuild-native\response-memory-$stamp-$nonce"
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)

$sha = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
$head = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not read the source HEAD.' }

$existing = Get-CimInstance Win32_Process -Filter "Name = 'halation-slint.exe'" |
    Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $exe }
if ($existing) {
    throw "A process is already running from this exact binary path (PID $($existing.ProcessId)); refusing to start another."
}

Write-Output "Executable: $exe"
Write-Output "SHA-256: $sha"
Write-Output "Source HEAD: $head"
Write-Output "Runtime: winit + Skia requested explicitly by the application; actual GPU/CPU presentation path is not inferred."
Write-Output "Scenes: $($scenes -join ', '); $repeats runs each; order: $($runPlan.scene -join ', '); $durationSeconds s sampling per run at $sampleSeconds s intervals."
Write-Output "Metrics: PerfProc WorkingSet (total resident), WorkingSetPrivate (private resident), PrivateBytes (commit), and PercentProcessorTime; independent counters, not interchangeable."
Write-Output "Window metadata: IsWindowVisible, client rectangle, and per-window DPI; no image/frame capture or input injection."
Write-Output "Output: $OutputDirectory"

if (-not $Run) {
    Write-Output 'Dry run only. No process or output directory was created. Pass -Run to authorize the bounded native runs.'
    exit 0
}

if (Test-Path -LiteralPath $OutputDirectory) {
    throw "Output path already exists; preserving it: $OutputDirectory"
}
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$profileRoot = Join-Path $OutputDirectory 'profiles'
New-Item -ItemType Directory -Path $profileRoot | Out-Null

if (-not ('HalationResponseMemoryNative' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HalationResponseMemoryNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern uint GetDpiForWindow(IntPtr hwnd);
}
'@
}

$samples = New-Object 'System.Collections.Generic.List[object]'
$runs = New-Object 'System.Collections.Generic.List[object]'
$runFailure = $null
$baselineGeometry = $null
$measurementStartedUtc = [DateTime]::UtcNow.ToString('o')
$oldProfileEnv = $env:HALATION_SLINT_PROFILE
try {
    foreach ($scheduledRun in $runPlan) {
            $repeat = $scheduledRun.repeat
            $scene = $scheduledRun.scene
            if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $sha) {
                throw 'Release executable changed during the measurement; refusing to mix binaries.'
            }
            $profile = Join-Path $profileRoot "$scene-$repeat"
            New-Item -ItemType Directory -Path $profile | Out-Null
            $env:HALATION_SLINT_PROFILE = $profile
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = $exe
            $psi.Arguments = "--diagnostic-scene=$scene"
            $psi.WorkingDirectory = $repoRoot
            $psi.UseShellExecute = $false
            $psi.CreateNoWindow = $false
            $process = [Diagnostics.Process]::Start($psi)
            if (-not $process) { throw "Failed to start scene '$scene' run $repeat." }
            try {
            $ownedPid = $process.Id
            $start = [Diagnostics.Stopwatch]::StartNew()
            $processPath = $process.MainModule.FileName
            $processStart = $process.StartTime.ToUniversalTime().ToString('o')
            $window = [IntPtr]::Zero
            $visible = $false
            while ($start.Elapsed.TotalSeconds -lt $visibleWaitSeconds) {
                $process.Refresh()
                if ($process.HasExited) { throw "Scene '$scene' PID $ownedPid exited before showing its native window (exit $($process.ExitCode))." }
                $window = $process.MainWindowHandle
                if ($window -ne [IntPtr]::Zero) {
                    $visible = [HalationResponseMemoryNative]::IsWindowVisible($window)
                    if ($visible) { break }
                }
                Start-Sleep -Milliseconds 250
            }
            if (-not $visible) { throw "Scene '$scene' PID $ownedPid did not expose a visible native window within $visibleWaitSeconds seconds." }
            $visibleElapsed = $start.Elapsed.TotalSeconds

            $rect = New-Object HalationResponseMemoryNative+RECT
            $sizeDeadline = (Get-Date).AddSeconds(10)
            do {
                $process.Refresh()
                $window = $process.MainWindowHandle
                if (-not [HalationResponseMemoryNative]::GetClientRect($window, [ref]$rect)) {
                    throw "Could not read client bounds for owned PID $ownedPid."
                }
                if (($rect.Right - $rect.Left) -gt 0 -and ($rect.Bottom - $rect.Top) -gt 0) { break }
                Start-Sleep -Milliseconds 200
            } while ((Get-Date) -lt $sizeDeadline)
            $windowMetadata = [ordered]@{
                handle = ('0x{0:X}' -f $window.ToInt64())
                visible = $visible
                clientWidth = $rect.Right - $rect.Left
                clientHeight = $rect.Bottom - $rect.Top
                dpi = [HalationResponseMemoryNative]::GetDpiForWindow($window)
            }
            $geometry = '{0}x{1}@{2}dpi' -f $windowMetadata.clientWidth, $windowMetadata.clientHeight, $windowMetadata.dpi
            if ($null -eq $baselineGeometry) { $baselineGeometry = $geometry }
            elseif ($geometry -ne $baselineGeometry) {
                throw "Window geometry/DPI differs ($geometry; expected $baselineGeometry); stopping rather than comparing confounded runs."
            }
            $logPath = Join-Path $profile 'halation-slint.log'
            $createdDeadline = (Get-Date).AddSeconds(15)
            while ((-not (Test-Path -LiteralPath $logPath)) -and (Get-Date) -lt $createdDeadline) {
                if ($process.HasExited) { throw "Scene '$scene' exited before writing its startup log." }
                Start-Sleep -Milliseconds 100
            }
            $startupLog = if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Raw } else { '' }
            if ($startupLog -notmatch 'window created') { throw "Scene '$scene' visible window did not report successful application setup in its startup log." }
            $start.Restart()

            $runs.Add([pscustomobject]@{
                scene = $scene
                repeat = $repeat
                pid = $ownedPid
                executable = $processPath
                processStartUtc = $processStart
                window = $windowMetadata
                profile = $profile
                samplingStartUtc = [DateTime]::UtcNow.ToString('o')
                processStartToVisibleSeconds = $visibleElapsed
                firstPresentedFrameDirectlyObserved = $false
            })

                while ($start.Elapsed.TotalSeconds -lt $durationSeconds -and -not $process.HasExited) {
                    $process.Refresh()
                    $counter = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "IDProcess = $ownedPid" -ErrorAction Stop
                    if (-not $counter) { throw "PerfProc counters unavailable for owned PID $ownedPid." }
                    $elapsed = [Math]::Round($start.Elapsed.TotalSeconds, 2)
                    if ($elapsed -lt 15) { $phase = 'startup-and-warmup' }
                    elseif ($scene -eq 'cycle' -and $elapsed -lt 90) { $phase = 'page-cycling' }
                    elseif ($scene -eq 'cycle' -and $elapsed -lt 105) { $phase = 'post-cycle-settle' }
                    elseif ($elapsed -lt 25) { $phase = 'settled-window' }
                    else { $phase = 'idle-observation' }
                    $samples.Add([pscustomobject]@{
                        scene = $scene
                        repeat = $repeat
                        pid = $ownedPid
                        elapsedSeconds = $elapsed
                        phase = $phase
                        workingSetBytes = [int64]$counter.WorkingSet
                        workingSetPrivateBytes = [int64]$counter.WorkingSetPrivate
                        privateBytesCommit = [int64]$counter.PrivateBytes
                        percentProcessorTime = [double]$counter.PercentProcessorTime
                        sampledUtc = [DateTime]::UtcNow.ToString('o')
                    })
                    Start-Sleep -Seconds $sampleSeconds
                }
                if ($process.HasExited) { throw "Scene '$scene' PID $ownedPid exited during sampling (exit $($process.ExitCode))." }
            }
            catch {
                $innerFailure = "$($_.Exception.Message) @ $($_.InvocationInfo.PositionMessage)"
                throw
            }
            finally {
                if (-not $process.HasExited) {
                    [void]$process.CloseMainWindow()
                    if (-not $process.WaitForExit(8000)) {
                        $closeMessage = "Owned PID $ownedPid did not close normally after WM_CLOSE. It was not force-terminated."
                        if ($innerFailure) { throw "$innerFailure | $closeMessage" }
                        throw $closeMessage
                    }
                }
                $process.Dispose()
            }
    }
}
catch {
    $runFailure = "$($_.Exception.Message) @ $($_.InvocationInfo.PositionMessage)"
    Set-Content -LiteralPath (Join-Path $OutputDirectory 'failure.txt') -Value $runFailure -Encoding UTF8
    throw
}
finally {
    if ($null -eq $oldProfileEnv) { Remove-Item Env:HALATION_SLINT_PROFILE -ErrorAction SilentlyContinue }
    else { $env:HALATION_SLINT_PROFILE = $oldProfileEnv }
    if ($Run -and (Test-Path -LiteralPath $OutputDirectory)) {
        $samples | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'samples.csv') -NoTypeInformation -Encoding UTF8
        $partialStatus = 'sampling-finished'
        if ($null -ne $runFailure) { $partialStatus = 'failed-or-interrupted' }
        $partial = [ordered]@{
            status = $partialStatus
            failure = [string]$runFailure
            sourceHead = $head
            executable = $exe
            executableSha256 = $sha
            measurementStartedUtc = $measurementStartedUtc
            runs = $runs.ToArray()
            sampleCount = $samples.Count
        }
        $partial | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'partial-manifest.json') -Encoding UTF8
    }
}

$summary = foreach ($group in ($samples | Group-Object scene, repeat, phase)) {
    $rows = @($group.Group)
    $sortedTotal = @($rows | ForEach-Object workingSetBytes | Sort-Object)
    $sortedPrivateResident = @($rows | ForEach-Object workingSetPrivateBytes | Sort-Object)
    $sortedCommit = @($rows | ForEach-Object privateBytesCommit | Sort-Object)
    $middle = [int][Math]::Floor($rows.Count / 2)
    $medianTotal = if ($rows.Count % 2) { $sortedTotal[$middle] } else { ($sortedTotal[$middle - 1] + $sortedTotal[$middle]) / 2 }
    $medianPrivateResident = if ($rows.Count % 2) { $sortedPrivateResident[$middle] } else { ($sortedPrivateResident[$middle - 1] + $sortedPrivateResident[$middle]) / 2 }
    $medianCommit = if ($rows.Count % 2) { $sortedCommit[$middle] } else { ($sortedCommit[$middle - 1] + $sortedCommit[$middle]) / 2 }
    [pscustomobject]@{
        scene = $rows[0].scene
        repeat = $rows[0].repeat
        phase = $rows[0].phase
        samples = $rows.Count
        totalResidentMinBytes = $sortedTotal[0]
        totalResidentMedianBytes = $medianTotal
        totalResidentMaxBytes = $sortedTotal[-1]
        privateResidentMinBytes = $sortedPrivateResident[0]
        privateResidentMedianBytes = $medianPrivateResident
        privateResidentMaxBytes = $sortedPrivateResident[-1]
        privateCommitMinBytes = $sortedCommit[0]
        privateCommitMedianBytes = $medianCommit
        privateCommitMaxBytes = $sortedCommit[-1]
    }
}
$summary | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'summary.csv') -NoTypeInformation -Encoding UTF8

foreach ($source in $sourceHashes) {
    $current = (Get-FileHash -LiteralPath (Join-Path $repoRoot $source.path) -Algorithm SHA256).Hash
    if ($current -ne $source.sha256) { throw "Source file changed during the measurement: $($source.path)" }
}
if ((& git -C $repoRoot status --porcelain) -join "`n" -ne ($expectedSourceState -join "`n")) {
    throw 'Worktree status changed during the measurement; refusing to label the runs as one source state.'
}

$metadata = [ordered]@{
    schemaVersion = 1
    status = 'completed'
    measurementStartedUtc = $measurementStartedUtc
    sourceHead = $head
    executable = $exe
    executableSha256 = $sha
    sourceFileSha256 = $sourceHashes
    workingTree = $expectedSourceState
    requestedFrameworkBackend = 'winit'
    requestedRenderer = 'skia'
    actualGpuOrCpuPresentationPath = 'not observed'
    perfCounterProvider = 'Win32_PerfFormattedData_PerfProc_Process, filtered by exact owned IDProcess'
    counterUnits = 'bytes for memory fields; PercentProcessorTime is provider percentage'
    firstPresentedFrameDirectlyObserved = $false
    firstVisibleWindowSampleIsNotAFramePresentMeasurement = $true
    samplingIntervalSeconds = $sampleSeconds
    durationPerWindowSeconds = $durationSeconds
    phaseDefinitionsSeconds = [ordered]@{
        warmup = '0 <= elapsed < 15'
        settledWindow = '15 <= elapsed < 25 (empty/home)'
        pageCycling = '15 <= elapsed < 90 (cycle scenario runs a bounded 90-step native diagnostic timer)'
        postCycleSettle = '90 <= elapsed < 105 (cycle)'
        idleObservation = 'remaining interval'
    }
    repeats = $repeats
    scenes = $scenes
    runOrder = @($runPlan)
    windowsVersion = [Environment]::OSVersion.VersionString
    processArchitecture = [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
    commonWindowGeometry = $baselineGeometry
    runs = $runs.ToArray()
    summaryCsv = 'summary.csv'
    rawSamplesCsv = 'samples.csv'
}
$metadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'manifest.json') -Encoding UTF8
$samples | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'samples.csv') -NoTypeInformation -Encoding UTF8
Write-Output "Completed. Raw samples: $(Join-Path $OutputDirectory 'samples.csv')"
Write-Output "Manifest: $(Join-Path $OutputDirectory 'manifest.json')"
Write-Output 'No captures, input injection, force termination, or renderer-path inference was used.'
