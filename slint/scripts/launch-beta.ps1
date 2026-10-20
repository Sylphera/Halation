param(
    [switch]$Launch,
    [string]$ProfileRoot,
    [string]$ManifestPath
)

$ErrorActionPreference = 'Stop'
$crateRoot = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $crateRoot 'target/release/halation-slint.exe'

if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw "Release executable not found: $exe. Build it first with cargo build --release."
}

if ([string]::IsNullOrWhiteSpace($ProfileRoot)) {
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw 'LOCALAPPDATA is not set; pass -ProfileRoot <directory>.'
    }
    $ProfileRoot = Join-Path $env:LOCALAPPDATA 'Halation/slint-beta'
}

$versionTemp = Join-Path ([System.IO.Path]::GetTempPath()) ("halation-slint-version-" + [guid]::NewGuid().ToString('N'))
$versionStdout = "$versionTemp.stdout"
$versionStderr = "$versionTemp.stderr"
try {
    $versionProcess = Start-Process -FilePath $exe `
        -ArgumentList @('--version') `
        -Wait `
        -PassThru `
        -RedirectStandardOutput $versionStdout `
        -RedirectStandardError $versionStderr
    if ($versionProcess.ExitCode -ne 0) {
        $details = if (Test-Path -LiteralPath $versionStderr) {
            Get-Content -LiteralPath $versionStderr -Raw
        } else {
            "exit code $($versionProcess.ExitCode)"
        }
        throw "Could not query beta version from $exe`: $details"
    }
    $versionOutput = [System.IO.File]::ReadAllText($versionStdout, [System.Text.Encoding]::UTF8)
} finally {
    foreach ($temporaryFile in @($versionStdout, $versionStderr)) {
        if (Test-Path -LiteralPath $temporaryFile) {
            Remove-Item -LiteralPath $temporaryFile -Force
        }
    }
}
if ([string]::IsNullOrWhiteSpace($versionOutput)) {
    throw "The release executable returned no version string: $exe."
}
$exeHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path (Split-Path -Parent $exe) 'beta-manifest.json'
}

$manifest = [ordered]@{
    product = 'Halation native beta'
    version = $versionOutput.Trim()
    executable = (Resolve-Path -LiteralPath $exe).Path
    executable_sha256 = $exeHash
    profile_root = [System.IO.Path]::GetFullPath($ProfileRoot)
    generated_utc = [DateTime]::UtcNow.ToString('o')
    visual_approval = 'pending manual native-window review'
    renderer = 'Slint Skia; runtime path not confirmed until launch'
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ManifestPath -Encoding utf8
Write-Output "Manifest: $ManifestPath"
Write-Output "Version: $($manifest.version)"
Write-Output "Profile: $($manifest.profile_root)"
Write-Output "Executable SHA-256: $exeHash"

if ($Launch) {
    $process = Start-Process -FilePath $exe `
        -ArgumentList @('--profile-root', $manifest.profile_root) `
        -WorkingDirectory $crateRoot `
        -PassThru
    Write-Output "Launched native beta PID $($process.Id)."
} else {
    Write-Output 'Not launched. Pass -Launch only when a human is ready to review the native window.'
}
