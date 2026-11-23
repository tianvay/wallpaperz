using System.Diagnostics;
using System.Text.Json;
using Microsoft.Win32;

namespace MochaWallpaper;

// Lives one level above the app folder: C:\_wallpaperz\config.json
class Config
{
    public string Selected { get; set; } = "mocha-forest";
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
    bool userPaused, fsPaused;
    IntPtr host;

    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    public TrayApp()
    {
        wallpapersMenu = new ToolStripMenuItem("Wallpapers");
        pauseItem = new ToolStripMenuItem("Pause", null, (_, _) => { userPaused = !userPaused; ApplyPause(); });
        fsItem = new ToolStripMenuItem("Pause when a fullscreen app runs", null, (_, _) =>
        {
            cfg.PauseWhenFullscreen = !cfg.PauseWhenFullscreen; cfg.Save(); fsItem.Checked = cfg.PauseWhenFullscreen;
        }) { Checked = cfg.PauseWhenFullscreen };
        autostartItem = new ToolStripMenuItem("Start with Windows", null, (_, _) => ToggleAutostart()) { Checked = IsAutostart() };

        var menu = new ContextMenuStrip();
        menu.Items.Add(wallpapersMenu);
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
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitApp());
        menu.Opening += (_, _) => FillWallpaperMenu();   // rescans the folder each time the menu opens

        tray = new NotifyIcon { Icon = MakeIcon(), Text = "Mocha Wallpaper", Visible = true, ContextMenuStrip = menu };
        tray.DoubleClick += (_, _) => Next();

        SystemEvents.DisplaySettingsChanged += (_, _) => Rebuild();
        watchdog.Tick += (_, _) => Watch();
        watchdog.Start();
        FillWallpaperMenu();
        Rebuild();
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

    void FillWallpaperMenu()
    {
        wallpapersMenu.DropDownItems.Clear();
        var all = Library.Scan(cfg.Library);
        if (all.Count == 0)
            wallpapersMenu.DropDownItems.Add(new ToolStripMenuItem("(folder is empty)") { Enabled = false });
        foreach (var w in all)
        {
            var item = new ToolStripMenuItem(w.Title) { Checked = w.Id.Equals(cfg.Selected, StringComparison.OrdinalIgnoreCase) };
            item.Click += (_, _) => Select(w.Id);
            wallpapersMenu.DropDownItems.Add(item);
        }
    }

    void Select(string id) { cfg.Selected = id; cfg.Save(); Rebuild(); }

    // Double-click the tray icon to cycle through the library.
    void Next()
    {
        var all = Library.Scan(cfg.Library);
        if (all.Count == 0) return;
        int i = all.FindIndex(w => w.Id.Equals(cfg.Selected, StringComparison.OrdinalIgnoreCase));
        Select(all[(i + 1) % all.Count].Id);
    }

    void Rebuild()
    {
        foreach (var w in windows) w.Close();
        windows.Clear();

        var all = Library.Scan(cfg.Library);
        var wp = all.FirstOrDefault(w => w.Id.Equals(cfg.Selected, StringComparison.OrdinalIgnoreCase)) ?? all.FirstOrDefault();
        if (wp == null)
        {
            tray.ShowBalloonTip(4000, "Mocha Wallpaper", $"No wallpapers found in {cfg.Library}", ToolTipIcon.Warning);
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
            var id = Library.Import(source, cfg.Library);
            Select(id);
            tray.ShowBalloonTip(3000, "Mocha Wallpaper", "Added and applied: " + id, ToolTipIcon.Info);
        }
        catch (Exception ex) { MessageBox.Show("Could not add wallpaper:\n" + ex.Message, "Mocha Wallpaper"); }
    }

    static bool IsAutostart()
    {
        using var k = Registry.CurrentUser.OpenSubKey(RunKey);
        return k?.GetValue("MochaWallpaper") is string;
    }

    void ToggleAutostart()
    {
        using var k = Registry.CurrentUser.CreateSubKey(RunKey);
        if (IsAutostart()) k.DeleteValue("MochaWallpaper", false);
        else k.SetValue("MochaWallpaper", $"\"{Environment.ProcessPath}\"");
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
