# Publishes a new app version: builds the setup and attaches it to a GitHub release tagged v<Version>, where
# installed copies find it through "Check for app updates" and the download link in the README always points.
# Bump <Version> in source\MochaWallpaper.csproj first and commit + push. Needs the GitHub CLI (gh), logged in.
# New or changed wallpapers need no release: pushing them to main is enough.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = Split-Path $here

$version = ([xml](Get-Content (Join-Path $root 'source\MochaWallpaper.csproj'))).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
if (-not $version) { throw 'No <Version> in MochaWallpaper.csproj' }
$tag = "v$version"

gh release view $tag 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { throw "Release $tag exists already: bump <Version> in source\MochaWallpaper.csproj first." }
if (git -C $root status --porcelain) { throw 'Uncommitted changes: commit and push them first, so the release matches main.' }

& (Join-Path $here 'build.ps1')
gh release create $tag (Join-Path $root 'dist\MochaWallpaperSetup.exe') --target main --title "Mocha Wallpaper $version" `
    --notes "Download **MochaWallpaperSetup.exe** below and run it. Already installed? Right-click the tray crescent and choose *Check for app updates*."
if ($LASTEXITCODE) { throw 'gh release create failed' }
