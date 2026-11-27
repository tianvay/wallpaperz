# TODO

## Blossom Hill: Blender-/PBR-Neuaufbau (`wallpapers/proto-blossom`)

Stand 2026-11-27: Technische Demo, vom Nutzer als „für eine Demo okay“ abgenommen. Noch nicht committet.
Ziel: Blossom Hill im neuen Grafikstil mit allen Features des Originals (`wallpapers/mocha-blossom`); danach ggf.
weitere 3D-Szenen umstellen.

### Was steht
- Pipeline in `tools/proto/` (Ablauf im README, Abschnitt „Blender prototype“):
  - `fetch.py` lädt CC0-Texturen, Himmel und Modelle von Poly Haven nach `tools/proto/_src/` (gitignored).
  - `textures.py` malt Blüten- und Blattkarten, bereitet die Himmelspanoramen auf (Sonne herausretuschiert, Sonnen-
    richtung aus dem HDR → `tex/skies.json`) und kopiert die Geländetexturen.
  - `blender_assets.py` (Blender 5.3, per winget installiert, läuft headless in ca. 10 s) baut Gebäude und Bäume,
    brennt Umgebungsverdeckung (AO) mit Cycles in die Vertexfarben und exportiert `assets/buildings.glb` und `assets/nature.glb`.
- `scene.js` ist eigenständig und nutzt `kit3d.js` nicht: Gelände mit Textur-Splatting (Fototextur, auf die
  Catppuccin-Palette eingefärbt), Steinmauern an den Terrassen, Water.js-Spiegelung, Tageszeit mit überblendeten
  Fotohimmeln plus eigener Sonne, Wolken, Mocha-Nacht mit Sternen und Mond, leuchtende Fenster und Laternen,
  Bloom, Farbkorrektur, Blütenblätter, Boote auf Kreisbahnen.
- Leistung: ca. 6 ms pro Bild bei 1024×768 auf einer RTX 4080 Super (anfangs 19 ms). Schatten werden nur jedes
  dritte Bild neu berechnet, die Spiegelung hat 512². Größe des Ordners: ca. 35 MB.
- Vorher-/Nachher-Bilder: `tools/_out/proto/` (gitignored); Aufnahme per Headless-Edge
  (`msedge --headless=new --use-angle=d3d11 --enable-gpu --screenshot=…`). Das Skript dafür lag im Scratchpad;
  bei Bedarf als `tools/proto/shots.py` neu anlegen.

### Als Nächstes
1. **Kamerafahrt wie im Original**: entlang des Sees bzw. Flusses fliegen, mit Blick voraus und nur leichtem Zug zur
   Mitte (Original: `kit3d.js` ab ca. Zeile 511, `path(t)` auf dem Seering r≈565, `lookAhead`, `centerPull: 0.32`,
   `hover`). Derzeit kreist die Kamera nur und blickt dabei immer auf den Tempel (`fly()` in `scene.js`).
2. **Features aus `mocha-blossom` übernehmen** (dort jeweils ein Abschnitt `// ---------- …`):
   - Echte Uhrzeit: Laternen am Pilgerpfad leuchten im Lauf der Stunde nacheinander auf, zur vollen Stunde schlägt
     die Tempelglocke die Stunde und jedes Haus lässt eine Himmelslaterne steigen (`W.clock`, `struck`).
   - Zifferblatt-Landschaft: Von oben gesehen ist das Land ein Zifferblatt mit vier Klöstern auf den Gipfeln bei
     12/3/6/9 Uhr samt Ritual, wenn der Minutenzeiger sie erreicht, dazu Stundenschreine und ein Pilgerrundweg.
   - Pilgerpfad mit Steinstufen, Rastplätzen in den Kurven und einem Torii-Tunnel vor dem Tor; Pavillon am See.
   - Lavendelfelder und Bauernweiler am anderen Ufer; Kiefern bzw. runde grüne Bäume weiter draußen.
   - Schwimmende Laternen auf dem See, Himmelslaternen in der Nacht.
   - Seeflotte: zwölf Stege, sechs verschiedene Boote (Sampans mit Bootsmann) kreuz und quer über den See, mit Kielwasser.
   - Nebel über dem See, rosa Wolken, Vögel, Glühwürmchen.
   - Weiler: dichte Gruppen von Stadthäusern auf den Terrassen statt verstreuter Einzelhäuser.
3. **Leistung**: einfachere Version (LOD) für entfernte Bäume; kleine Objekte nicht in der Spiegelung rendern; mit
   `?fps`/Auflösung auf einem schwächeren Rechner testen.
4. **Größe**: Texturen als KTX2/Basis komprimieren; Normal- und ARM-Maps der Gebäude auf 512² verkleinern.
5. **Feinschliff**: Der Weg ist im Gelände kaum zu sehen; die Terrassenwände zeigen eher Fels als die Steinmauer-Textur
   (Mischung `wallF` im Terrain-Shader prüfen); der Sandstreifen am Ufer ist zu gleichförmig; Kamera und Lichtrichtung
   bei Sonnenuntergang abstimmen.
6. **Verteilung** (aus der Beratung): Die App eigenständig mit .NET veröffentlichen, Installer mit Inno Setup,
   Code-Signatur (z. B. Azure Trusted Signing), Wallpaper als einzelne Download-Pakete.

### Stolpersteine (schon gelöst, nicht wieder einbauen)
- Vertexfarben-AO: Blender-Objekte vor dem Bake auseinanderlegen und bereits exportierte Objekte löschen, sonst
  verdecken sie sich am Ursprung gegenseitig. Blüten nicht mitbaken (Cycles sieht kein Alpha); ihre Schattierung wird
  per Verlauf gesetzt. Flächen vor dem Bake unterteilen (`densify`), sonst liegen die Eckpunkte in Balken und werden schwarz.
- Vor `join()` jedes Objekt auf genau eine UV-Ebene namens `UVMap` bringen, sonst lesen die Blüten falsche UVs
  und verschwinden.
- three.js: AO-Vertexfarben auf RGB kürzen (Alpha ist undefiniert); `alphaToCoverage` aus, solange der
  EffectComposer kein MSAA hat; bei Laubkarten die Normale auf der Rückseite nicht umdrehen.
- Die Seite muss mit einem anfangs 0×0 großen Fenster klarkommen (`fit()` in jedem Frame).
- Der `wallpapers`-Server aus `.claude/launch.json` belegt Port 8767; läuft schon einer (andere Sitzung), direkt
  `http://127.0.0.1:8767/proto-blossom/` öffnen.
