#!/usr/bin/env pwsh

[CmdletBinding()]
param(
  [string]$Version = $env:COPILOT_INSIGHTS_VERSION,
  [switch]$Force,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$repo = "jackbatzner/copilot-insights"
$headers = @{
  Accept = "application/vnd.github+json"
  "User-Agent" = "copilot-insights-installer"
}

if ($env:GITHUB_TOKEN) {
  $headers.Authorization = "Bearer $($env:GITHUB_TOKEN)"
}

function Normalize-Tag([string]$rawVersion) {
  if (-not $rawVersion) {
    return $null
  }

  if ($rawVersion.StartsWith("v")) {
    return $rawVersion
  }

  return "v$rawVersion"
}

function Invoke-GitHubJson([string]$uri) {
  return Invoke-RestMethod -Headers $headers -Uri $uri
}

function Get-ReleaseMetadata([string]$requestedVersion) {
  $releaseUri = if ($requestedVersion) {
    "https://api.github.com/repos/$repo/releases/tags/$(Normalize-Tag $requestedVersion)"
  } else {
    "https://api.github.com/repos/$repo/releases/latest"
  }

  $release = Invoke-GitHubJson $releaseUri
  $tag = $release.tag_name
  if (-not $tag) {
    throw "Could not resolve a release tag from GitHub."
  }

  $version = $tag.TrimStart("v")
  $packageName = "copilot-insights-$version.tgz"
  $packageAsset = $release.assets | Where-Object name -eq $packageName | Select-Object -First 1
  $checksumsAsset = $release.assets | Where-Object name -eq "checksums.txt" | Select-Object -First 1

  if (-not $packageAsset) {
    throw "Release asset '$packageName' was not found for $tag."
  }

  if (-not $checksumsAsset) {
    throw "Release asset 'checksums.txt' was not found for $tag."
  }

  return [pscustomobject]@{
    Tag          = $tag
    Version      = $version
    PackageName  = $packageName
    PackageUrl   = $packageAsset.browser_download_url
    ChecksumsUrl = $checksumsAsset.browser_download_url
  }
}

function Get-InstalledVersion([string]$globalRoot) {
  $packageJson = Join-Path $globalRoot "copilot-insights\package.json"
  if (-not (Test-Path $packageJson)) {
    return $null
  }

  return (Get-Content -Raw $packageJson | ConvertFrom-Json).version
}

function Remove-StaleInstall([string]$globalRoot, [string]$globalPrefix) {
  if ($env:VOLTA_HOME) {
    throw "Volta-managed installs need manual cleanup first. Run 'volta uninstall copilot-insights' and rerun this installer."
  }

  & npm uninstall -g copilot-insights | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Continuing after npm uninstall reported no existing global install."
  }

  $pathsToDelete = @(
    (Join-Path $globalRoot "copilot-insights"),
    (Join-Path $globalPrefix "copilot-insights"),
    (Join-Path $globalPrefix "copilot-insights.cmd"),
    (Join-Path $globalPrefix "copilot-insights.ps1")
  )

  foreach ($path in $pathsToDelete) {
    if (-not (Test-Path $path)) {
      continue
    }

    try {
      Remove-Item -Recurse -Force $path
    } catch {
      Write-Warning "Could not remove '$path'. Close any shells using copilot-insights, then rerun the installer."
    }
  }

  Get-ChildItem $globalRoot -Filter ".copilot-insights-*" -Force -ErrorAction SilentlyContinue |
    ForEach-Object {
      try {
        Remove-Item -Recurse -Force $_.FullName
      } catch {
        Write-Warning "Could not remove '$($_.FullName)'."
      }
    }
}

function Get-ExpectedChecksum([string]$checksumsPath, [string]$packageName) {
  foreach ($line in Get-Content $checksumsPath) {
    if ($line -match "^([0-9a-fA-F]{64})\s+\*?(.+)$" -and $matches[2] -eq $packageName) {
      return $matches[1].ToLowerInvariant()
    }
  }

  throw "Could not find a checksum for '$packageName' in checksums.txt."
}

$globalRoot = (& npm root -g).Trim()
$globalPrefix = (& npm prefix -g).Trim()
$release = Get-ReleaseMetadata $Version
$installedVersion = Get-InstalledVersion $globalRoot

Write-Host "Resolved release: $($release.Tag)"

if ($installedVersion -and $installedVersion -eq $release.Version -and -not $Force) {
  Write-Host "Copilot Insights $installedVersion is already installed."
  Write-Host "Use -Force to reinstall the same version."
  exit 0
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "copilot-insights-install-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempRoot | Out-Null

try {
  $packagePath = Join-Path $tempRoot $release.PackageName
  $checksumsPath = Join-Path $tempRoot "checksums.txt"

  Invoke-WebRequest -Headers $headers -Uri $release.PackageUrl -OutFile $packagePath
  Invoke-WebRequest -Headers $headers -Uri $release.ChecksumsUrl -OutFile $checksumsPath

  $expectedChecksum = Get-ExpectedChecksum $checksumsPath $release.PackageName
  $actualChecksum = (Get-FileHash -Algorithm SHA256 $packagePath).Hash.ToLowerInvariant()

  if ($expectedChecksum -ne $actualChecksum) {
    throw "Checksum verification failed for $($release.PackageName)."
  }

  Write-Host "Checksum verified for $($release.PackageName)."

  if ($DryRun) {
    Write-Host "Dry run only. Skipping global install."
    exit 0
  }

  Remove-StaleInstall $globalRoot $globalPrefix

  & npm install -g $packagePath
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed."
  }

  Write-Host "Installed Copilot Insights $($release.Version)."
} finally {
  if (Test-Path $tempRoot) {
    Remove-Item -Recurse -Force $tempRoot -ErrorAction SilentlyContinue
  }
}
