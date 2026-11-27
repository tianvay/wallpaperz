# Mocha Wallpaper

A tiny live-wallpaper app: it shows a web page, image or video behind your desktop icons.
It lives in the system tray (purple crescent icon) and starts with Windows.

**Just want to use it?** Download and run
[MochaWallpaperSetup.exe](https://github.com/tianvay/wallpaperz/releases/latest/download/MochaWallpaperSetup.exe).
No admin rights and no .NET install are needed; it installs to `%LocalAppData%\Programs\Mocha Wallpaper` and can be
removed under *Settings → Apps*. On its first start the app downloads all wallpapers from this repository. The setup
is not code-signed yet, so Windows SmartScreen asks once: click *More info → Run anyway*.

```
C:\_wallpaperz\
  app\           the program (MochaWallpaper.exe) – don't edit
  source\        C# source code
  wallpapers\    your wallpaper library
    animated\    2D animated pictures (one folder per wallpaper)
    3d\          real-time 3D scenes (one folder per wallpaper)
    imported\    what you add from the tray menu
  config.json    remembers the selected wallpaper and options
```

## Adding a wallpaper

**Easiest:** right-click the tray icon → **Add wallpaper file…** or **Add wallpaper folder…**.
It is copied into `wallpapers\imported\` and applied right away.

**By hand:** drop it into a category folder such as `C:\_wallpaperz\wallpapers\animated\` (tray → *Open wallpapers folder*).
It shows up in the tray's **Wallpapers** menu the next time you open it, with no restart needed.

Every folder directly inside `wallpapers\` is a category and becomes a submenu (`3d` shows as *3D*). A new
category is just a new folder. A wallpaper placed directly in `wallpapers\` (a loose file, or a folder that is
itself a wallpaper) is listed under *Other*.

What counts as a wallpaper:

| You have | Put it in a category folder as |
|---|---|
| An image (`.jpg .png .webp .gif .bmp`) | a loose file, or a folder containing it |
| A video (`.mp4 .webm`, plays muted and looped) | a loose file, or a folder containing it |
| An animated web wallpaper | a folder with an `index.html` (plus its images/scripts) |
| A Wallpaper Engine **web** wallpaper | its folder as-is (the `project.json` `"file"` entry is used) |

Inside a folder the app picks, in order: `project.json` → `index.html` → any `.html` → first video → first image
(files named `preview.*` are ignored). The menu shows the `project.json` title, or the folder name.

Wallpaper Engine *scene* wallpapers (`scene.pkg`) are a proprietary format and will not play.

## Tray menu

- **Wallpapers** – pick a category (Animated, 3D, …), then a wallpaper (double-click the tray icon to cycle to the
  next one in the same category)
- **Reload** – re-open the current wallpaper (after editing its files)
- **Pause / Resume** – stops rendering entirely (~0% CPU/GPU)
- **Pause when a fullscreen app runs** – on by default, so games get the GPU
- **Start with Windows**
- **Get new wallpapers** – downloads new and changed wallpapers from this repository (see below)
- **Check for app updates** – installs a newer app version from the latest GitHub release; the app restarts by itself
- **Exit** – brings back your normal static Windows wallpaper

## Writing your own animated wallpaper

Any web page works. Keep it full-screen (`100vw × 100vh`, no scrollbars) and reference files with relative
paths: the folder is served as `https://wallpaper.local/`. Look at `wallpapers\animated\mocha-forest\index.html` for an
example: a canvas drawn over the image with clouds, stars, waterfall, river glints and fireflies.
Add `#view=x,y,w,h` to the URL when testing it in a browser to zoom into one region of the image.

## Turning a picture into an animated Mocha wallpaper

Folders whose name starts with `_` (like `wallpapers\_todos`) are work folders and are not listed in the tray.

`tools\` holds the pipeline used for the `mocha-*` wallpapers:

- `mocha.py` recolors any image onto the Catppuccin Mocha palette
  (`python -I mocha.py in.jpg out.jpg`)
- `engine\engine.js` is the shared animation engine. A WebGL layer moves the real pixels through `mask.png`
  (R = water ripples and sparkle, G = sky warp, B = light flicker, A = drifting fog), and a 2D layer adds
  stars, glows, beacons, beams, smoke, clouds, birds, glints and fireflies, configured in each folder's `scene.js`
- `forest_scene.py` writes Mocha Forest's `scene.js` (values copied 1:1 from the original hand-written page,
  which is kept in `tools\_backup\mocha-forest-classic`)
- The original source images are not part of this repository (removed after conversion). To rebuild one of the
  existing scenes from scratch, put its original image back into `wallpapers\_todos` under the file name used in
  `build.py`.
- `build.py` holds one function per scene (masks, coordinates, effects). Run `python -I build.py beach` to rebuild one
  scene, or with no argument to rebuild all of them. Debug overlays of the masks go to `tools\_out\`.

## Building the app

`app\` is build output and is not in git: after a fresh clone, or after changing `source\`, build it yourself.
You need the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) and the WebView2 runtime (already part of
Windows 11). If the app is running, exit it from the tray first (the .exe is locked while it runs), then:

```powershell
cd C:\_wallpaperz\source
dotnet publish -c Release -o C:\_wallpaperz\app
```

Start `app\MochaWallpaper.exe` and tick **Start with Windows** in the tray menu to run it at every logon.

## Building the installer

```powershell
powershell -ExecutionPolicy Bypass -File C:\_wallpaperz\installer\build.ps1
```

This publishes the app self-contained (the .NET runtime is bundled) and compiles `installer\MochaWallpaper.iss` with
[Inno Setup 6](https://jrsoftware.org/isinfo.php) (`winget install JRSoftware.InnoSetup`) into
`dist\MochaWallpaperSetup.exe` (about 40 MB, not in git). The setup ships **no wallpapers**, so it rarely changes.

The setup installs per user with the same layout as this repository (`app\`, `wallpapers\`, `config.json`), offers
autostart, shows the tray-icon hint on its last page, and on update or uninstall first runs
`MochaWallpaper.exe --exit` so the running copy quits cleanly and restores the normal Windows wallpaper.
An update keeps the user's settings and wallpapers; uninstalling removes everything.
`installer\app.ico` comes from `tools\make_icon.py`.

## Publishing

**Wallpapers:** commit and push them to `main`. That's all: *Get new wallpapers* (and the first start of a fresh
install) mirrors `wallpapers\<category>\<wallpaper>\` from the latest `main` through the GitHub API, downloading only
files whose git blob hash differs. Wallpapers deleted from the repository disappear on the next sync; `imported\`,
`_*` work folders and folders the user made themselves are never touched (`wallpapers\.sync.json` lists what the sync
manages). A copy that runs from a git checkout, like `C:\_wallpaperz\app`, refuses to sync or self-update: use git.

**App:** bump `<Version>` in `source\MochaWallpaper.csproj`, commit and push, then run

```powershell
powershell -ExecutionPolicy Bypass -File C:\_wallpaperz\installer\release.ps1
```

It builds the setup and attaches it to a GitHub release `v<Version>` (needs `gh`, logged in). Installed copies find it
through *Check for app updates*, and the download link at the top of this page always points to the newest release.
