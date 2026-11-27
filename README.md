# Mocha Wallpaper

A tiny live-wallpaper app: it shows a web page, image or video behind your desktop icons.
It lives in the system tray (purple crescent icon) and starts with Windows.

```
C:\_wallpaperz\
  app\           the program (MochaWallpaper.exe) – don't edit
  source\        C# source code
  wallpapers\    your wallpaper library – one folder per wallpaper
  config.json    remembers the selected wallpaper and options
```

## Adding a wallpaper

**Easiest:** right-click the tray icon → **Add wallpaper file…** or **Add wallpaper folder…**.
It is copied into `wallpapers\` and applied right away.

**By hand:** drop it into `C:\_wallpaperz\wallpapers\` (tray → *Open wallpapers folder*).
It shows up in the tray's **Wallpapers** menu the next time you open it, with no restart needed.

What counts as a wallpaper:

| You have | Put it in `wallpapers\` as |
|---|---|
| An image (`.jpg .png .webp .gif .bmp`) | a loose file, or a folder containing it |
| A video (`.mp4 .webm`, plays muted and looped) | a loose file, or a folder containing it |
| An animated web wallpaper | a folder with an `index.html` (plus its images/scripts) |
| A Wallpaper Engine **web** wallpaper | its folder as-is (the `project.json` `"file"` entry is used) |

Inside a folder the app picks, in order: `project.json` → `index.html` → any `.html` → first video → first image
(files named `preview.*` are ignored). The menu shows the `project.json` title, or the folder name.

Wallpaper Engine *scene* wallpapers (`scene.pkg`) are a proprietary format and will not play.

## Tray menu

- **Wallpapers** – pick one (double-click the tray icon to cycle to the next)
- **Reload** – re-open the current wallpaper (after editing its files)
- **Pause / Resume** – stops rendering entirely (~0% CPU/GPU)
- **Pause when a fullscreen app runs** – on by default, so games get the GPU
- **Start with Windows**
- **Exit** – brings back your normal static Windows wallpaper

## Writing your own animated wallpaper

Any web page works. Keep it full-screen (`100vw × 100vh`, no scrollbars) and reference files with relative
paths: the folder is served as `https://wallpaper.local/`. Look at `wallpapers\mocha-forest\index.html` for an
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
You need the [.NET 9 SDK](https://dotnet.microsoft.com/download/dotnet/9.0) and the WebView2 runtime (already part of
Windows 11). If the app is running, exit it from the tray first (the .exe is locked while it runs), then:

```powershell
cd C:\_wallpaperz\source
dotnet publish -c Release -o C:\_wallpaperz\app
```

Start `app\MochaWallpaper.exe` and tick **Start with Windows** in the tray menu to run it at every logon.

## Blender prototype (`wallpapers\proto-blossom`)

A test of a textured, physically lit style for the 3D wallpapers: Blossom Hill rebuilt with Blender models, PBR photo
textures (terrain splatting, normal maps), photo skies cross-fading through the day, planar-reflection water, soft
shadows and baked ambient occlusion. It is self-contained (does not use `kit3d.js`). Same URL options as the other 3D
scenes where they make sense: `?tod=0.5`, `?day=4`, `?fps=30`, `?hd=1`, `?cam=x,y,z,lx,ly,lz`.

Rebuilding its files (`tools\proto\`):

```powershell
python -I tools\proto\fetch.py          # CC0 textures, skies and models from Poly Haven -> tools\proto\_src (not in git)
python -I tools\proto\textures.py       # blossom/leaf cards, sky panoramas (sun painted out), terrain textures -> tex\
& "C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" -b --factory-startup -P tools\proto\blender_assets.py
```

`blender_assets.py` builds pagoda, hall, three houses, torii, lanterns, pier, boat and five trees, bakes ambient
occlusion into their vertex colours with Cycles and exports `assets\buildings.glb` and `assets\nature.glb`
(add `-- --fast` to skip the bake).
