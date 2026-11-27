# Builds dist\MochaWallpaperSetup.exe: publishes the app self-contained (no .NET install needed on the target PC),
# stages it next to the bundled wallpaper categories, and runs the Inno Setup compiler on MochaWallpaper.iss.
# Needs the .NET 10 SDK and Inno Setup 6 (winget install JRSoftware.InnoSetup).
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = Split-Path $here
$staging = Join-Path $here 'staging'

$iscc = @("$env:LocalAppData\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 not found. Install it with: winget install JRSoftware.InnoSetup' }

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }

dotnet publish (Join-Path $root 'source') -c Release -r win-x64 --self-contained true -o (Join-Path $staging 'app') `
    -p:PublishReadyToRun=true -p:DebugType=none
if ($LASTEXITCODE) { throw 'dotnet publish failed' }

# Bundle every category folder; skip work folders (_todos, _test …) and the user's own imports.
foreach ($cat in Get-ChildItem (Join-Path $root 'wallpapers') -Directory) {
    if ($cat.Name.StartsWith('_') -or $cat.Name -eq 'imported') { continue }
    Copy-Item $cat.FullName (Join-Path $staging "wallpapers\$($cat.Name)") -Recurse
}

& $iscc /Qp (Join-Path $here 'MochaWallpaper.iss')
if ($LASTEXITCODE) { throw 'Inno Setup failed' }
Get-Item (Join-Path $root 'dist\MochaWallpaperSetup.exe') | Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } }
