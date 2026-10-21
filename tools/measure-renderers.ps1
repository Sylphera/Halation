param(
    [switch]$Run,
    [int]$DurationSeconds = 60,
    [string[]]$Variants,
    [string]$OutputDirectory
)

# Diagnostic renderer comparison (empty scene and Home). Same counters as measure-memory.ps1.
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$targets = Join-Path $repoRoot '.tools'
$catalog = @(
    [pscustomobject]@{ id = 'skia-d3d'; target = 'target-skia'; renderer = 'skia-d3d' },
    [pscustomobject]@{ id = 'skia-opengl-desktop'; target = 'target-opengl'; renderer = 'skia-opengl' },
    [pscustomobject]@{ id = 'skia-opengl-es'; target = 'target-opengl'; renderer = 'skia-opengl-es' },
    [pscustomobject]@{ id = 'software'; target = 'target-multi'; renderer = 'software' }
)
if ($Variants) { $catalog = @($catalog | Where-Object { $Variants -contains $_.id }) }
$scenes = @('empty', 'home')
$repeats = 2
$visibleWaitSeconds = 30
$sampleSeconds = 1
$graphicsPattern = '^(d3d12|d3d11|d3d9|dxgi|vulkan-1|opengl32|libegl|libgles|nvoglv|atio6axx|ig9icd|igxelpicd|amdvlk|nvgpucomp|nvwgf2um|d3d12core)'

$plan = @()
for ($repeat = 1; $repeat -le $repeats; $repeat++) {
    $variantOrder = if ($repeat % 2) { $catalog } else { @($catalog | Sort-Object -Property id -Descending) }
    foreach ($variant in $variantOrder) {
        $sceneOrder = if ($repeat % 2) { $scenes } else { @($scenes[1], $scenes[0]) }
        foreach ($scene in $sceneOrder) {
            $plan += [pscustomobject]@{ repeat = $repeat; variant = $variant; scene = $scene }
        }
    }
}
foreach ($v in $catalog) {
    $path = Join-Path $targets "$($v.target)\release\halation-slint.exe"
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing binary for $($v.id): $path" }
    $v | Add-Member -NotePropertyName exe -NotePropertyValue (Resolve-Path $path).Path -Force
    $v | Add-Member -NotePropertyName exeBytes -NotePropertyValue (Get-Item $path).Length -Force
    $v | Add-Member -NotePropertyName sha256 -NotePropertyValue (Get-FileHash $path -Algorithm SHA256).Hash -Force
}
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $targets ("renderer-compare-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)

Write-Output "Variants: $(($catalog | ForEach-Object { "$($_.id) ($([math]::Round($_.exeBytes/1MB,2)) MB)" }) -join ', ')"
Write-Output "Runs: $($plan.Count); $DurationSeconds s each; output: $OutputDirectory"
if (-not $Run) { Write-Output 'Dry run only.'; exit 0 }

if (-not ('HalationRendererNative' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HalationRendererNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
}
'@
}

New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$samples = New-Object 'System.Collections.Generic.List[object]'
$runs = New-Object 'System.Collections.Generic.List[object]'
$oldProfile = $env:HALATION_SLINT_PROFILE
$oldRenderer = $env:HALATION_RENDERER
try {
    foreach ($step in $plan) {
        $variant = $step.variant; $scene = $step.scene; $repeat = $step.repeat
        $label = "$($variant.id)/$scene/$repeat"
        $profile = Join-Path $OutputDirectory "profiles\$($variant.id)-$scene-$repeat"
        New-Item -ItemType Directory -Path $profile -Force | Out-Null
        $env:HALATION_SLINT_PROFILE = $profile
        $env:HALATION_RENDERER = $variant.renderer
        $stderr = Join-Path $profile 'stderr.txt'
        $process = Start-Process -FilePath $variant.exe -ArgumentList "--diagnostic-scene=$scene" `
            -RedirectStandardError $stderr -PassThru
        $record = [ordered]@{
            variant = $variant.id; renderer = $variant.renderer; scene = $scene; repeat = $repeat
            pid = $process.Id; exeBytes = $variant.exeBytes; status = 'ok'
        }
        try {
            $clock = [Diagnostics.Stopwatch]::StartNew()
            $window = [IntPtr]::Zero
            $rect = New-Object HalationRendererNative+RECT
            $clientSeconds = $null
            while ($clock.Elapsed.TotalSeconds -lt $visibleWaitSeconds) {
                $process.Refresh()
                if ($process.HasExited) { throw "exited before a window (exit $($process.ExitCode))" }
                $window = $process.MainWindowHandle
                if ($window -ne [IntPtr]::Zero -and [HalationRendererNative]::IsWindowVisible($window)) {
                    [void][HalationRendererNative]::GetClientRect($window, [ref]$rect)
                    if (($rect.Right - $rect.Left) -gt 0 -and ($rect.Bottom - $rect.Top) -gt 0) {
                        $clientSeconds = $clock.Elapsed.TotalSeconds
                        break
                    }
                }
                Start-Sleep -Milliseconds 50
            }
            if ($null -eq $clientSeconds) { throw "no visible window with a non-zero client area within $visibleWaitSeconds s" }
            $record.secondsToClient = [math]::Round($clientSeconds, 3)
            $record.client = '{0}x{1}@{2}dpi' -f ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top), [HalationRendererNative]::GetDpiForWindow($window)
            $clock.Restart()
            while ($clock.Elapsed.TotalSeconds -lt $DurationSeconds -and -not $process.HasExited) {
                $counter = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "IDProcess = $($process.Id)" -ErrorAction Stop
                if ($counter) {
                    $elapsed = [math]::Round($clock.Elapsed.TotalSeconds, 2)
                    $samples.Add([pscustomobject]@{
                        variant = $variant.id; scene = $scene; repeat = $repeat
                        elapsedSeconds = $elapsed
                        phase = if ($elapsed -lt 15) { 'warmup' } else { 'settled' }
                        workingSetBytes = [int64]$counter.WorkingSet
                        workingSetPrivateBytes = [int64]$counter.WorkingSetPrivate
                        privateBytesCommit = [int64]$counter.PrivateBytes
                        percentProcessorTime = [double]$counter.PercentProcessorTime
                    })
                }
                Start-Sleep -Seconds $sampleSeconds
            }
            if ($process.HasExited) { throw "exited during sampling (exit $($process.ExitCode))" }
            $process.Refresh()
            $record.graphicsModules = @($process.Modules | ForEach-Object { $_.ModuleName } |
                Where-Object { $_ -match $graphicsPattern } | Sort-Object -Unique) -join ';'
        }
        catch {
            $record.status = "failed: $($_.Exception.Message)"
        }
        finally {
            if (-not $process.HasExited) {
                [void]$process.CloseMainWindow()
                if (-not $process.WaitForExit(8000)) { $record.closeNote = 'did not close after WM_CLOSE (own PID, not force-terminated)'; Write-Warning "PID $($process.Id) of $label is still running; close it by PID." }
            }
            $process.Dispose()
        }
        $logPath = Join-Path $profile 'halation-slint.log'
        $record.log = if (Test-Path $logPath) { (Get-Content $logPath -Raw).Trim() -replace '\r?\n', ' | ' } else { '' }
        $record.stderr = if (Test-Path $stderr) { ((Get-Content $stderr -Raw) -as [string]).Trim() } else { '' }
        $runs.Add([pscustomobject]$record)
        Write-Output "$label : $($record.status)"
    }
}
finally {
    if ($null -eq $oldProfile) { Remove-Item Env:HALATION_SLINT_PROFILE -ErrorAction SilentlyContinue } else { $env:HALATION_SLINT_PROFILE = $oldProfile }
    if ($null -eq $oldRenderer) { Remove-Item Env:HALATION_RENDERER -ErrorAction SilentlyContinue } else { $env:HALATION_RENDERER = $oldRenderer }
    $samples | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'samples.csv') -NoTypeInformation -Encoding UTF8
    $runs | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'runs.json') -Encoding UTF8
}
Write-Output "Done: $OutputDirectory"
