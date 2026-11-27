; Inno Setup script for Mocha Wallpaper. Don't compile this by hand: run installer\build.ps1, which publishes the
; app self-contained into installer\staging\ first and then calls the Inno Setup compiler.
;
; Installs per user (no admin rights) into %LocalAppData%\Programs\Mocha Wallpaper with the same layout as the
; repository, so the app finds its library and config next to itself:
;   app\          MochaWallpaper.exe + the bundled .NET runtime
;   wallpapers\   downloaded by the app from GitHub on its first start (animated\, 3d\ …); imports go to imported\
;   config.json   written by the app
;
; The setup ships no wallpapers on purpose, so it rarely needs a new build: wallpapers pushed to the repository
; reach every user through the tray's "Get new wallpapers", new app versions through "Check for app updates".

#define AppName "Mocha Wallpaper"
#define AppExe "MochaWallpaper.exe"
#define Staging "staging"
#define AppVersion GetVersionNumbersString(Staging + "\app\" + AppExe)

[Setup]
AppId={{6C1F0B6E-4D7A-4F38-9C1B-6E2A9D3B5F71}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppName}
VersionInfoVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\dist
OutputBaseFilename=MochaWallpaperSetup
SetupIconFile=app.ico
UninstallDisplayIcon={app}\app\{#AppExe}
UninstallDisplayName={#AppName}
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes
CloseApplications=no

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "de"; MessagesFile: "compiler:Languages\German.isl"

[CustomMessages]
en.Autostart=Start {#AppName} when I sign in to Windows
de.Autostart={#AppName} bei der Anmeldung an Windows starten
en.NoWebView={#AppName} needs the Microsoft Edge WebView2 Runtime, which is missing on this PC.%n%nInstall it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and run this setup again.
de.NoWebView={#AppName} braucht die Microsoft Edge WebView2 Runtime, die auf diesem PC fehlt.%n%nInstalliere sie von https://go.microsoft.com/fwlink/p/?LinkId=2124703 und starte dieses Setup danach erneut.

[Messages]
en.FinishedLabel={#AppName} lives in the system tray: look for the purple crescent at the bottom right (maybe behind the ^ arrow). On its first start it downloads the wallpapers, which takes a few seconds. Then right-click the crescent to pick one.
de.FinishedLabel={#AppName} läuft im Infobereich der Taskleiste: Du findest den lila Halbmond dort unten rechts (eventuell hinter dem ^-Pfeil). Beim ersten Start lädt es die Wallpaper herunter, das dauert ein paar Sekunden. Danach wählst du mit einem Rechtsklick auf den Halbmond eines aus.

[Tasks]
Name: "autostart"; Description: "{cm:Autostart}"

[InstallDelete]
; Replace the program files completely on an update, so no stale runtime files are left behind.
; Wallpapers the user imported and config.json are kept.
Type: filesandordirs; Name: "{app}\app"

[Files]
Source: "{#Staging}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\{#AppName}"; Filename: "{app}\app\{#AppExe}"; WorkingDir: "{app}\app"
; Same name and place the app's own "Start with Windows" menu item uses, so both control the same shortcut.
Name: "{userstartup}\{#AppName}"; Filename: "{app}\app\{#AppExe}"; WorkingDir: "{app}\app"; Tasks: autostart

[Run]
Filename: "{app}\app\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall

[UninstallDelete]
; Everything the app created itself: config, imported wallpapers, the autostart shortcut it may have made
; from the tray menu, and the WebView2 browser cache.
Type: filesandordirs; Name: "{app}"
Type: files; Name: "{userstartup}\{#AppName}.lnk"
Type: filesandordirs; Name: "{localappdata}\MochaWallpaper"

[Code]
function WebViewInstalled(): Boolean;
var
  Version: String;
  Key: String;
begin
  Key := 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result :=
    (RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function InitializeSetup(): Boolean;
begin
  Result := WebViewInstalled();
  if not Result then
    SuppressibleMsgBox(CustomMessage('NoWebView'), mbError, MB_OK, IDOK);
end;

// Ask a running copy to quit cleanly (it restores the normal Windows wallpaper), then make sure it is gone,
// because its files are about to be replaced or removed.
procedure StopRunningApp(Exe: String);
var
  Code: Integer;
begin
  if FileExists(Exe) then
  begin
    if Exec(Exe, '--exit', '', SW_HIDE, ewWaitUntilTerminated, Code) then
      Log('Asked running app to exit, code ' + IntToStr(Code));
    Sleep(1500);
  end;
  if Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM MochaWallpaper.exe', '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Log('taskkill exit code ' + IntToStr(Code))
  else
    Log('taskkill could not start: ' + SysErrorMessage(Code));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopRunningApp(ExpandConstant('{app}\app\MochaWallpaper.exe'));
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  StopRunningApp(ExpandConstant('{app}\app\MochaWallpaper.exe'));
  Result := True;
end;
