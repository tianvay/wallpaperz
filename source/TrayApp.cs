using System.Diagnostics;
using System.Text.Json;
using Microsoft.Win32;

namespace MochaWallpaper;

// Lives one level above the app folder: C:\_wallpaperz\config.json
class Config
{
    public string Selected { get; set; } = "animated/mocha-forest";
    public string LibraryPath { get; set; } = "";
    public bool PauseWhenFullscreen { get; set; } = true;

    public static string Root => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, ".."));
    static string FilePath => Path.Combine(Root, "config.json");

    public string Library => string.IsNullOrWhiteSpace(LibraryPath) ? Path.Combine(Root, "wallpapers") : LibraryPath;

    public static Config Load()
    {
        try { return JsonSerializer.Deserialize<Config>(File.ReadAllText(FilePath)) ?? new Config(); }
        catch { return new Config(); }
    }

    public void Save()
    {
        try { File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true })); }
        catch { }
    }
}

class TrayApp : ApplicationContext
{
    readonly Config cfg = Config.Load();
    readonly NotifyIcon tray;
    readonly List<WallpaperWindow> windows = new();
    readonly System.Windows.Forms.Timer watchdog = new() { Interval = 2000 };
    readonly ToolStripMenuItem wallpapersMenu, pauseItem, autostartItem, fsItem;
    bool userPaused, fsPaused, busy;
    IntPtr host;

    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    public TrayApp()
    {
        MigrateRunKey();
        wallpapersMenu = new ToolStripMenuItem("Wallpapers");
        pauseItem = new ToolStripMenuItem("Pause", null, (_, _) => { userPaused = !userPaused; ApplyPause(); });
        fsItem = new ToolStripMenuItem("Pause when a fullscreen app runs", null, (_, _) =>
        {
            cfg.PauseWhenFullscreen = !cfg.PauseWhenFullscreen; cfg.Save(); fsItem.Checked = cfg.PauseWhenFullscreen;
        }) { Checked = cfg.PauseWhenFullscreen };
        autostartItem = new ToolStripMenuItem("Start with Windows", null, (_, _) => ToggleAutostart()) { Checked = IsAutostart() };

        var menu = new ContextMenuStrip();
        menu.Items.Add(wallpapersMenu);
        menu.Items.Add("Get new wallpapers", null, (_, _) => SyncWallpapers(quiet: false));
        menu.Items.Add("Add wallpaper file…", null, (_, _) => AddFile());
        menu.Items.Add("Add wallpaper folder…", null, (_, _) => AddFolder());
        menu.Items.Add("Open wallpapers folder", null, (_, _) =>
        {
            Directory.CreateDirectory(cfg.Library);
            Process.Start("explorer.exe", cfg.Library);
        });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Reload", null, (_, _) => Rebuild());
        menu.Items.Add(pauseItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(fsItem);
        menu.Items.Add(autostartItem);
        menu.Items.Add("Check for app updates", null, (_, _) => CheckForUpdate());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitApp());
        menu.Opening += (_, _) => FillWallpaperMenu();   // rescans the folder each time the menu opens

        tray = new NotifyIcon { Icon = MakeIcon(), Text = "Mocha Wallpaper", Visible = true, ContextMenuStrip = menu };
        tray.DoubleClick += (_, _) => Next();

        SystemEvents.DisplaySettingsChanged += (_, _) => Rebuild();
        watchdog.Tick += (_, _) => Watch();
        watchdog.Start();
        FillWallpaperMenu();
        ListenForExit();
        // First start after installing: the setup ships no wallpapers, they all come from GitHub.
        if (Library.Scan(cfg.Library).Count == 0 && !GitHub.IsDevCheckout(cfg.Library)) SyncWallpapers(quiet: true);
        else Rebuild();
    }

    void Balloon(string text, ToolTipIcon icon = ToolTipIcon.Info) => tray.ShowBalloonTip(4000, "Mocha Wallpaper", text, icon);

    // quiet: the automatic first download, which says less and always applies a wallpaper at the end.
    async void SyncWallpapers(bool quiet)
    {
        if (busy) return;
        if (GitHub.IsDevCheckout(cfg.Library))
        {
            MessageBox.Show("This copy runs from a git checkout of the repository: update its wallpapers with git pull.", "Mocha Wallpaper");
            return;
        }
        busy = true;
        Balloon(quiet ? "Downloading the wallpapers…" : "Looking for new wallpapers…");
        try
        {
            var r = await WallpaperSync.Run(cfg.Library);
            var titles = Library.Scan(cfg.Library).ToDictionary(w => w.Id, w => w.Title, StringComparer.OrdinalIgnoreCase);
            string Names(List<string> ids) => string.Join(", ", ids.Select(id => titles.TryGetValue(id, out var t) ? t : id));
            if (quiet) Balloon($"{r.Added.Count} wallpapers ready. Right-click the crescent to pick one.");
            else if (!r.Any) Balloon("You already have all wallpapers.");
            else
            {
                var lines = new List<string>();
                if (r.Added.Count > 0) lines.Add("New: " + Names(r.Added));
                if (r.Updated.Count > 0) lines.Add("Updated: " + Names(r.Updated));
                if (r.Removed.Count > 0) lines.Add($"Removed: {r.Removed.Count}");
                Balloon(string.Join("\n", lines));
            }
            bool current = r.Updated.Concat(r.Removed).Any(id => id.Equals(cfg.Selected, StringComparison.OrdinalIgnoreCase));
            if (quiet || current || windows.Count == 0) Rebuild();
        }
        catch (Exception ex)
        {
            Balloon("Could not download wallpapers: " + ex.Message, ToolTipIcon.Warning);
            if (quiet) Rebuild();
        }
        finally { busy = false; }
    }

    async void CheckForUpdate()
    {
        if (busy) return;
        if (GitHub.IsDevCheckout(cfg.Library))
        {
            MessageBox.Show("This copy runs from a git checkout of the repository: rebuild it from source instead.", "Mocha Wallpaper");
            return;
        }
        busy = true;
        try
        {
            var update = await AppUpdate.Check();
            if (update == null) { Balloon($"Mocha Wallpaper {AppUpdate.Current} is up to date."); return; }
            var (version, url) = update.Value;
            if (MessageBox.Show($"Mocha Wallpaper {version} is available (you have {AppUpdate.Current}).\n\nInstall it now? " +
                    "The app restarts by itself, your settings and wallpapers stay.", "Mocha Wallpaper",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            Balloon("Downloading the update…");
            await AppUpdate.Install(url);   // the setup closes this app via --exit and starts the new version
        }
        catch (Exception ex) { Balloon("Could not check for updates: " + ex.Message, ToolTipIcon.Warning); }
        finally { busy = false; }
    }

    readonly EventWaitHandle exitSignal = new(false, EventResetMode.AutoReset, Program.ExitEventName);

    void ListenForExit()
    {
        var ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        new Thread(() => { exitSignal.WaitOne(); ui.Post(_ => ExitApp(), null); }) { IsBackground = true }.Start();
    }

    static Icon MakeIcon()
    {
        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            g.FillEllipse(new SolidBrush(Color.FromArgb(0x1e, 0x1e, 0x2e)), 1, 1, 30, 30);
            g.FillEllipse(new SolidBrush(Color.FromArgb(0xcb, 0xa6, 0xf7)), 6, 6, 20, 20);
            g.FillEllipse(new SolidBrush(Color.FromArgb(0x1e, 0x1e, 0x2e)), 11, 4, 18, 18); // crescent
        }
        return Icon.FromHandle(bmp.GetHicon());
    }

    // Wallpapers > Animated / 3D / … > the wallpapers of that category.
    void FillWallpaperMenu()
    {
        wallpapersMenu.DropDownItems.Clear();
        var cats = Library.Categories(cfg.Library);
        if (cats.Count == 0)
            wallpapersMenu.DropDownItems.Add(new ToolStripMenuItem("(folder is empty)") { Enabled = false });
        foreach (var c in cats)
        {
            var sub = new ToolStripMenuItem(c.Name);
            foreach (var w in c.Items)
            {
                var item = new ToolStripMenuItem(w.Title) { Checked = Library.Matches(w, cfg.Selected) };
                item.Click += (_, _) => Select(w.Id);
                sub.DropDownItems.Add(item);
            }
            sub.Checked = c.Items.Any(w => Library.Matches(w, cfg.Selected));
            wallpapersMenu.DropDownItems.Add(sub);
        }
    }

    void Select(string id) { cfg.Selected = id; cfg.Save(); Rebuild(); }

    // Double-click the tray icon to cycle through the current category.
    void Next()
    {
        var cats = Library.Categories(cfg.Library);
        var cat = cats.FirstOrDefault(c => c.Items.Any(w => Library.Matches(w, cfg.Selected))) ?? cats.FirstOrDefault();
        if (cat == null) return;
        int i = cat.Items.FindIndex(w => Library.Matches(w, cfg.Selected));
        Select(cat.Items[(i + 1) % cat.Items.Count].Id);
    }

    void Rebuild()
    {
        foreach (var w in windows) w.Close();
        windows.Clear();

        var all = Library.Scan(cfg.Library);
        var wp = all.FirstOrDefault(w => Library.Matches(w, cfg.Selected)) ?? all.FirstOrDefault();
        if (wp == null)
        {
            if (!busy) Balloon("No wallpapers yet: right-click the crescent and choose Get new wallpapers.", ToolTipIcon.Warning);
            return;
        }
        var tip = "Mocha Wallpaper – " + wp.Title;
        tray.Text = tip.Length > 63 ? tip[..63] : tip;

        host = Desktop.GetWallpaperHost();
        if (host == IntPtr.Zero)
        {
            tray.ShowBalloonTip(4000, "Mocha Wallpaper", "Could not find the desktop layer.", ToolTipIcon.Error);
            return;
        }
        var origin = SystemInformation.VirtualScreen.Location;
        foreach (var screen in Screen.AllScreens)
        {
            var w = new WallpaperWindow(wp.Entry, host,
                new Rectangle(screen.Bounds.X - origin.X, screen.Bounds.Y - origin.Y, screen.Bounds.Width, screen.Bounds.Height));
            w.Start();
            windows.Add(w);
        }
        ApplyPause();
    }

    // Explorer restarts drop our windows; fullscreen apps should pause rendering.
    void Watch()
    {
        if (host != IntPtr.Zero && !Desktop.IsWindow(host)) { Rebuild(); return; }
        bool fs = cfg.PauseWhenFullscreen && Desktop.ForegroundIsFullscreen();
        if (fs != fsPaused) { fsPaused = fs; ApplyPause(); }
    }

    void ApplyPause()
    {
        bool paused = userPaused || fsPaused;
        pauseItem.Text = userPaused ? "Resume" : "Pause";
        foreach (var w in windows) w.SetPaused(paused);
    }

    void AddFile()
    {
        using var dlg = new OpenFileDialog
        {
            Title = "Add a wallpaper: image, video, index.html or a Wallpaper Engine project.json",
            Filter = "Wallpapers|*.jpg;*.jpeg;*.png;*.gif;*.webp;*.bmp;*.mp4;*.webm;*.html;*.htm;project.json|All files|*.*"
        };
        if (dlg.ShowDialog() == DialogResult.OK) Import(dlg.FileName);
    }

    void AddFolder()
    {
        using var dlg = new FolderBrowserDialog { Description = "Choose a wallpaper folder (web wallpaper with index.html, or a folder with an image/video)" };
        if (dlg.ShowDialog() == DialogResult.OK) Import(dlg.SelectedPath);
    }

    void Import(string source)
    {
        try
        {
            if (Directory.Exists(source) && Library.ResolveEntry(source, out _) == null)
            {
                MessageBox.Show("That folder has no index.html, image or video in it.", "Mocha Wallpaper");
                return;
            }
            var id = Library.Imported + "/" + Library.Import(source, Path.Combine(cfg.Library, Library.Imported));
            Select(id);
            tray.ShowBalloonTip(3000, "Mocha Wallpaper", "Added and applied: " + id, ToolTipIcon.Info);
        }
        catch (Exception ex) { MessageBox.Show("Could not add wallpaper:\n" + ex.Message, "Mocha Wallpaper"); }
    }

    // Autostart is a shortcut in the user's Startup folder. A Run-key entry was skipped silently at logon on
    // Windows 11 build 26300, even when marked enabled in StartupApproved, while Startup-folder items ran.
    static string ShortcutPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Mocha Wallpaper.lnk");
    const string ApprovedKey = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

    static bool IsAutostart() => File.Exists(ShortcutPath);

    static void CreateShortcut()
    {
        var shell = Type.GetTypeFromProgID("WScript.Shell");
        dynamic sh = Activator.CreateInstance(shell);
        dynamic lnk = sh.CreateShortcut(ShortcutPath);
        lnk.TargetPath = Environment.ProcessPath;
        lnk.WorkingDirectory = AppContext.BaseDirectory;
        lnk.Description = "Mocha Wallpaper";
        lnk.Save();
    }

    // Older builds of the app autostarted through the Run key: replace that entry with the shortcut.
    static void MigrateRunKey()
    {
        using var k = Registry.CurrentUser.OpenSubKey(RunKey, true);
        if (k?.GetValue("MochaWallpaper") is not string) return;
        k.DeleteValue("MochaWallpaper", false);
        using (var a = Registry.CurrentUser.OpenSubKey(ApprovedKey, true)) a?.DeleteValue("MochaWallpaper", false);
        try { if (!IsAutostart()) CreateShortcut(); } catch { }
    }

    void ToggleAutostart()
    {
        try
        {
            if (IsAutostart()) File.Delete(ShortcutPath);
            else CreateShortcut();
        }
        catch (Exception ex) { MessageBox.Show("Could not change autostart:\n" + ex.Message, "Mocha Wallpaper"); }
        autostartItem.Checked = IsAutostart();
    }

    void ExitApp()
    {
        watchdog.Stop();
        foreach (var w in windows) w.Close();
        tray.Visible = false;
        Desktop.RepaintStaticWallpaper();
        ExitThread();
    }
}
