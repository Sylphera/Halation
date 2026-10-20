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
$ProfileRoot = [System.IO.Path]::GetFullPath($ProfileRoot)

function Invoke-BetaCli {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [string]$ProfileRootOverride
    )

    $token = [guid]::NewGuid().ToString('N')
    $stdout = Join-Path ([System.IO.Path]::GetTempPath()) "halation-slint-$token.stdout"
    $stderr = Join-Path ([System.IO.Path]::GetTempPath()) "halation-slint-$token.stderr"
    $previousProfile = [Environment]::GetEnvironmentVariable('HALATION_SLINT_PROFILE', 'Process')
    $overrideProfile = $PSBoundParameters.ContainsKey('ProfileRootOverride')
    try {
        if ($overrideProfile) {
            [Environment]::SetEnvironmentVariable('HALATION_SLINT_PROFILE', $ProfileRootOverride, 'Process')
        }
        # These metadata-only CLI commands return before BackendSelector/AppWindow creation.
        $process = Start-Process -FilePath $exe `
            -ArgumentList $Arguments `
            -Wait `
            -PassThru `
            -RedirectStandardOutput $stdout `
            -RedirectStandardError $stderr
        if ($process.ExitCode -ne 0) {
            $details = if (Test-Path -LiteralPath $stderr) {
                [System.IO.File]::ReadAllText($stderr, [System.Text.Encoding]::UTF8)
            } else {
                "exit code $($process.ExitCode)"
            }
            throw "Metadata command failed ($($Arguments -join ' ')): $details"
        }
        [System.IO.File]::ReadAllText($stdout, [System.Text.Encoding]::UTF8).Trim()
    } finally {
        [Environment]::SetEnvironmentVariable('HALATION_SLINT_PROFILE', $previousProfile, 'Process')
        foreach ($temporaryFile in @($stdout, $stderr)) {
            if (Test-Path -LiteralPath $temporaryFile) {
                Remove-Item -LiteralPath $temporaryFile -Force
            }
        }
    }
}

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
    } finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
}

# This uses an environment variable instead of a spaced command-line argument. --print-profile is
# metadata-only; verify it does not create the isolated profile directory.
$profileExistedBefore = Test-Path -LiteralPath $ProfileRoot
$reportedProfile = Invoke-BetaCli -Arguments @('--print-profile') -ProfileRootOverride $ProfileRoot
$profileExistedAfter = Test-Path -LiteralPath $ProfileRoot
if ([System.IO.Path]::GetFullPath($reportedProfile) -ne $ProfileRoot) {
    throw "The executable resolved a different profile: $reportedProfile"
}
if ($profileExistedBefore -ne $profileExistedAfter) {
    throw 'The metadata-only profile check unexpectedly changed profile-directory existence.'
}

$versionOutput = Invoke-BetaCli -Arguments @('--version')
if ([string]::IsNullOrWhiteSpace($versionOutput)) {
    throw "The release executable returned no version string: $exe."
}
$exeHash = Get-Sha256Hex -Path $exe
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path (Split-Path -Parent $exe) 'beta-manifest.json'
}

$manifest = [ordered]@{
    product = 'Halation native beta'
    version = $versionOutput
    executable = (Resolve-Path -LiteralPath $exe).Path
    executable_sha256 = $exeHash
    profile_root = $ProfileRoot
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
    # The human explicitly opts in; the process inherits the exact profile through its environment.
    $previousProfile = [Environment]::GetEnvironmentVariable('HALATION_SLINT_PROFILE', 'Process')
    try {
        [Environment]::SetEnvironmentVariable('HALATION_SLINT_PROFILE', $ProfileRoot, 'Process')
        $process = Start-Process -FilePath $exe -WorkingDirectory $crateRoot -PassThru
        Write-Output "Launched native beta PID $($process.Id)."
    } finally {
        [Environment]::SetEnvironmentVariable('HALATION_SLINT_PROFILE', $previousProfile, 'Process')
    }
} else {
    Write-Output 'Not launched. Pass -Launch only when a human is ready to review the native window.'
}
