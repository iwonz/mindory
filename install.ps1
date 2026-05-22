param(
  [string]$ManifestUrl = $env:MINDORY_RELEASE_MANIFEST_URL,
  [string]$ManifestPath = $env:MINDORY_RELEASE_MANIFEST_PATH,
  [string]$PublicKeyPath = $env:MINDORY_RELEASE_PUBLIC_KEY_PATH,
  [string]$PublicKeyPem = $env:MINDORY_RELEASE_PUBLIC_KEY_PEM,
  [string]$Source = "",
  [string]$MindoryHome = $env:MINDORY_HOME,
  [string]$ReleaseChannel = $env:MINDORY_INSTALL_RELEASE_CHANNEL,
  [switch]$VerifyOnly
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

function Get-UnsignedManifestText {
  param([string]$Path)
  $lines = Get-Content -LiteralPath $Path | Where-Object { $_ -notlike "MINDORY_RELEASE_MANIFEST_SIGNATURE=*" }
  return (($lines -join "`n") + "`n")
}

function Get-TrustedPublicKeyPath {
  param([string]$ManifestFile)
  if (-not [string]::IsNullOrWhiteSpace($PublicKeyPath)) {
    if (-not (Test-Path -LiteralPath $PublicKeyPath)) {
      throw "Release public key file does not exist: $PublicKeyPath"
    }
    return $PublicKeyPath
  }
  if (-not [string]::IsNullOrWhiteSpace($PublicKeyPem)) {
    $temporaryPublicKey = "$ManifestFile.public.$PID.pem"
    [System.IO.File]::WriteAllText($temporaryPublicKey, $PublicKeyPem.Replace("\n", "`n"), [System.Text.UTF8Encoding]::new($false))
    return $temporaryPublicKey
  }
  $sidecar = "$ManifestFile.public.pem"
  if (Test-Path -LiteralPath $sidecar) {
    return $sidecar
  }
  throw "Missing trusted release manifest public key. Set MINDORY_RELEASE_PUBLIC_KEY_PATH or MINDORY_RELEASE_PUBLIC_KEY_PEM."
}

function Test-ManifestSignatureWithOpenSsl {
  param(
    [string]$ManifestFile,
    [string]$PublicKeyFile,
    [string]$SignatureBase64
  )
  if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
    return $false
  }
  $unsignedFile = "$ManifestFile.unsigned.$PID"
  $signatureFile = "$ManifestFile.signature.$PID"
  try {
    [System.IO.File]::WriteAllText($unsignedFile, (Get-UnsignedManifestText -Path $ManifestFile), [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllBytes($signatureFile, [Convert]::FromBase64String($SignatureBase64))
    & openssl dgst -sha256 -verify $PublicKeyFile -signature $signatureFile $unsignedFile | Out-Null
    return ($LASTEXITCODE -eq 0)
  } finally {
    if (Test-Path -LiteralPath $unsignedFile) {
      Remove-Item -LiteralPath $unsignedFile -Force
    }
    if (Test-Path -LiteralPath $signatureFile) {
      Remove-Item -LiteralPath $signatureFile -Force
    }
  }
}

function Test-ManifestSignatureWithDotNet {
  param(
    [string]$ManifestFile,
    [string]$PublicKeyFile,
    [string]$SignatureBase64
  )
  $rsa = [System.Security.Cryptography.RSA]::Create()
  try {
    $publicKeyText = [System.IO.File]::ReadAllText($PublicKeyFile)
    if (-not ($rsa | Get-Member -Name ImportFromPem -MemberType Method -ErrorAction SilentlyContinue)) {
      return $false
    }
    $rsa.ImportFromPem($publicKeyText.ToCharArray())
    $data = [System.Text.Encoding]::UTF8.GetBytes((Get-UnsignedManifestText -Path $ManifestFile))
    $signatureBytes = [Convert]::FromBase64String($SignatureBase64)
    return $rsa.VerifyData(
      $data,
      $signatureBytes,
      [System.Security.Cryptography.HashAlgorithmName]::SHA256,
      [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
    )
  } catch {
    return $false
  } finally {
    $rsa.Dispose()
  }
}

function Test-MindoryReleaseManifestSignature {
  param([string]$ManifestFile)
  $algorithm = Get-ManifestValue -Path $ManifestFile -Key "MINDORY_RELEASE_MANIFEST_SIGNATURE_ALGORITHM"
  $expectedPublicKeySha256 = Get-ManifestValue -Path $ManifestFile -Key "MINDORY_RELEASE_PUBLIC_KEY_SHA256"
  $signatureBase64 = Get-ManifestValue -Path $ManifestFile -Key "MINDORY_RELEASE_MANIFEST_SIGNATURE"
  if ($algorithm -ne "RSA-SHA256") {
    throw "Unsupported or missing release manifest signature algorithm: $algorithm"
  }
  if ([string]::IsNullOrWhiteSpace($expectedPublicKeySha256) -or [string]::IsNullOrWhiteSpace($signatureBase64)) {
    throw "Release manifest is missing public key hash or signature."
  }

  $publicKeyFile = Get-TrustedPublicKeyPath -ManifestFile $ManifestFile
  $temporaryPublicKey = $false
  if ($publicKeyFile -like "$ManifestFile.public.$PID.pem") {
    $temporaryPublicKey = $true
  }
  try {
    $actualPublicKeySha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $publicKeyFile).Hash.ToLowerInvariant()
    if ($actualPublicKeySha256 -ne $expectedPublicKeySha256.ToLowerInvariant()) {
      throw "Release public key SHA-256 mismatch. Expected $expectedPublicKeySha256, got $actualPublicKeySha256."
    }
    if ((Test-ManifestSignatureWithDotNet -ManifestFile $ManifestFile -PublicKeyFile $publicKeyFile -SignatureBase64 $signatureBase64) -or
        (Test-ManifestSignatureWithOpenSsl -ManifestFile $ManifestFile -PublicKeyFile $publicKeyFile -SignatureBase64 $signatureBase64)) {
      Write-Host "Verified Mindory release manifest signature."
      return
    }
    throw "Manifest signature verification failed."
  } finally {
    if ($temporaryPublicKey -and (Test-Path -LiteralPath $publicKeyFile)) {
      Remove-Item -LiteralPath $publicKeyFile -Force
    }
  }
}

function Invoke-Download {
  param([string]$Url, [string]$OutputPath)
  Invoke-WebRequest -Uri $Url -OutFile $OutputPath -UseBasicParsing
}

function Copy-OrDownload {
  param([string]$Source, [string]$OutputPath)
  if ($Source.StartsWith("file://")) {
    $uri = [System.Uri]$Source
    $localPath = $uri.LocalPath
    if (-not (Test-Path -LiteralPath $localPath)) {
      throw "Release bundle file does not exist: $localPath"
    }
    Copy-Item -LiteralPath $localPath -Destination $OutputPath -Force
    return
  }
  if (Test-Path -LiteralPath $Source) {
    Copy-Item -LiteralPath $Source -Destination $OutputPath -Force
    return
  }
  Invoke-Download -Url $Source -OutputPath $OutputPath
}

function Expand-MindoryRelease {
  param(
    [string]$BundlePath,
    [string]$ReleaseVersion,
    [string]$ReleaseDir,
    [string]$ReleasesDir
  )

  $stagingDir = Join-Path $ReleasesDir "$ReleaseVersion.staging.$PID"
  $previousDir = Join-Path $ReleasesDir "$ReleaseVersion.previous.$PID"
  if (Test-Path -LiteralPath $stagingDir) {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force
  }
  if (Test-Path -LiteralPath $previousDir) {
    Remove-Item -LiteralPath $previousDir -Recurse -Force
  }
  New-MindoryDirectory $stagingDir

  Write-Host "Extracting Mindory release $ReleaseVersion into a staging directory..."
  tar -xzf $BundlePath -C $stagingDir
  if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force
    throw "Failed to extract release bundle. The installed release directory was not changed."
  }

  $extractedRoot = Join-Path $stagingDir "mindory-$ReleaseVersion"
  if (-not (Test-Path -LiteralPath $extractedRoot)) {
    $extractedRoot = $stagingDir
  }

  if (Test-Path -LiteralPath $ReleaseDir) {
    Move-Item -LiteralPath $ReleaseDir -Destination $previousDir
  }

  try {
    Move-Item -LiteralPath $extractedRoot -Destination $ReleaseDir
  } catch {
    if (Test-Path -LiteralPath $previousDir) {
      Move-Item -LiteralPath $previousDir -Destination $ReleaseDir
    }
    if (Test-Path -LiteralPath $stagingDir) {
      Remove-Item -LiteralPath $stagingDir -Recurse -Force
    }
    throw "Failed to promote staged release. Previous release directory was restored when present. $($_.Exception.Message)"
  }

  if (Test-Path -LiteralPath $stagingDir) {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force
  }
  if (Test-Path -LiteralPath $previousDir) {
    Remove-Item -LiteralPath $previousDir -Recurse -Force
  }
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
  $manifestPublicKeyPath = "$ManifestPath.public.pem"
  if (Test-Path -LiteralPath $manifestPublicKeyPath) {
    Copy-Item -LiteralPath $manifestPublicKeyPath -Destination "$manifestFile.public.pem" -Force
  }
} elseif (-not [string]::IsNullOrWhiteSpace($ManifestUrl)) {
  Invoke-Download -Url $ManifestUrl -OutputPath $manifestFile
} else {
  throw "Provide -ManifestUrl, -ManifestPath, -Source or MINDORY_RELEASE_MANIFEST_URL."
}

Test-MindoryReleaseManifestSignature -ManifestFile $manifestFile

$releaseVersion = Get-ManifestValue -Path $manifestFile -Key "MINDORY_RELEASE_VERSION"
$bundleUrl = Get-ManifestValue -Path $manifestFile -Key "MINDORY_RELEASE_BUNDLE_URL"
$bundleSha256 = Get-ManifestValue -Path $manifestFile -Key "MINDORY_RELEASE_BUNDLE_SHA256"

if ([string]::IsNullOrWhiteSpace($releaseVersion) -or [string]::IsNullOrWhiteSpace($bundleUrl) -or [string]::IsNullOrWhiteSpace($bundleSha256)) {
  throw "Manifest is missing release version, bundle URL or bundle SHA-256."
}

$bundlePath = Join-Path $downloadsDir "mindory-$releaseVersion.tar.gz"
$releaseDir = Join-Path $releasesDir $releaseVersion
Copy-OrDownload -Source $bundleUrl -OutputPath $bundlePath

$actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $bundlePath).Hash.ToLowerInvariant()
if ($actualSha256 -ne $bundleSha256.ToLowerInvariant()) {
  throw "Checksum mismatch for $bundlePath. Expected $bundleSha256, got $actualSha256."
}

Write-Host "Verified Mindory release bundle checksum for $releaseVersion."
if ($VerifyOnly -or $env:MINDORY_BOOTSTRAP_VERIFY_ONLY -eq "true" -or $env:MINDORY_BOOTSTRAP_VERIFY_ONLY -eq "1") {
  Write-Host "Mindory bootstrap verification passed for $releaseVersion."
  exit 0
}

Expand-MindoryRelease -BundlePath $bundlePath -ReleaseVersion $releaseVersion -ReleaseDir $releaseDir -ReleasesDir $releasesDir

Invoke-MindoryInstaller -ReleaseDir $releaseDir
