param(
  [string]$ManifestUrl = $env:MINDORY_RELEASE_MANIFEST_URL,
  [string]$ManifestPath = $env:MINDORY_RELEASE_MANIFEST_PATH,
  [string]$Source = "",
  [string]$MindoryHome = $env:MINDORY_HOME,
  [string]$ReleaseChannel = $env:MINDORY_INSTALL_RELEASE_CHANNEL
)

$ErrorActionPreference = "Stop"

trap {
  Write-Error "Mindory bootstrap interrupted or failed. No further install steps will run. Use the repair command after relaunch to inspect staged state. $($_.Exception.Message)"
  exit 130
}

if ([string]::IsNullOrWhiteSpace($MindoryHome)) {
  $MindoryHome = Join-Path $HOME ".mindory"
}
if ([string]::IsNullOrWhiteSpace($ReleaseChannel)) {
  $ReleaseChannel = "stable"
}

function New-MindoryDirectory {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Get-ManifestValue {
  param([string]$Path, [string]$Key)
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -like "$Key=*" } | Select-Object -Last 1
  if ($null -eq $line) {
    return ""
  }
  return $line.Substring($Key.Length + 1)
}

function Invoke-Download {
  param([string]$Url, [string]$OutputPath)
  Invoke-WebRequest -Uri $Url -OutFile $OutputPath -UseBasicParsing
}

function Invoke-MindoryInstaller {
  param([string]$ReleaseDir)
  $binary = Join-Path $ReleaseDir "bin/mindory-installer"
  $cli = Join-Path $ReleaseDir "packages/installer/dist/cli.js"
  $packageJson = Join-Path $ReleaseDir "package.json"

  if (Test-Path -LiteralPath $binary) {
    & $binary wizard
    exit $LASTEXITCODE
  }
  if ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $cli)) {
    & node $cli wizard
    exit $LASTEXITCODE
  }
  if ((Get-Command pnpm -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $packageJson)) {
    Push-Location $ReleaseDir
    try {
      & pnpm --filter "@mindory/installer" typecheck
      if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
      }
      & node "packages/installer/dist/cli.js" wizard
      exit $LASTEXITCODE
    } finally {
      Pop-Location
    }
  }
  throw "Could not find a Mindory installer entrypoint in $ReleaseDir."
}

$downloadsDir = Join-Path $MindoryHome "install/downloads"
$releasesDir = Join-Path $MindoryHome "install/releases"
New-MindoryDirectory $downloadsDir
New-MindoryDirectory $releasesDir
New-MindoryDirectory (Join-Path $MindoryHome "config")
New-MindoryDirectory (Join-Path $MindoryHome "logs")

if (-not [string]::IsNullOrWhiteSpace($Source)) {
  Invoke-MindoryInstaller -ReleaseDir $Source
  exit 0
}

$manifestFile = Join-Path $downloadsDir "manifest-$ReleaseChannel.env"
if (-not [string]::IsNullOrWhiteSpace($ManifestPath)) {
  Copy-Item -LiteralPath $ManifestPath -Destination $manifestFile -Force
} elseif (-not [string]::IsNullOrWhiteSpace($ManifestUrl)) {
  Invoke-Download -Url $ManifestUrl -OutputPath $manifestFile
} else {
  throw "Provide -ManifestUrl, -ManifestPath, -Source or MINDORY_RELEASE_MANIFEST_URL."
}

$releaseVersion = Get-ManifestValue -Path $manifestFile -Key "MINDORY_RELEASE_VERSION"
$bundleUrl = Get-ManifestValue -Path $manifestFile -Key "MINDORY_RELEASE_BUNDLE_URL"
$bundleSha256 = Get-ManifestValue -Path $manifestFile -Key "MINDORY_RELEASE_BUNDLE_SHA256"

if ([string]::IsNullOrWhiteSpace($releaseVersion) -or [string]::IsNullOrWhiteSpace($bundleUrl) -or [string]::IsNullOrWhiteSpace($bundleSha256)) {
  throw "Manifest is missing release version, bundle URL or bundle SHA-256."
}

$bundlePath = Join-Path $downloadsDir "mindory-$releaseVersion.tar.gz"
$releaseDir = Join-Path $releasesDir $releaseVersion
Invoke-Download -Url $bundleUrl -OutputPath $bundlePath

$actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $bundlePath).Hash.ToLowerInvariant()
if ($actualSha256 -ne $bundleSha256.ToLowerInvariant()) {
  throw "Checksum mismatch for $bundlePath. Expected $bundleSha256, got $actualSha256."
}

New-MindoryDirectory $releaseDir
tar -xzf $bundlePath -C $releaseDir
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Invoke-MindoryInstaller -ReleaseDir $releaseDir
