using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace MochaWallpaper;

static class Program
{
    // Signalled by "MochaWallpaper.exe --exit" (the installer/uninstaller): the running instance quits cleanly
    // and restores the static wallpaper, which a plain process kill would leave black.
    public const string ExitEventName = "MochaWallpaper.Exit";

    [STAThread]
    static void Main(string[] args)
    {
        if (args.Any(a => a.Equals("--exit", StringComparison.OrdinalIgnoreCase)))
        {
            if (EventWaitHandle.TryOpenExisting(ExitEventName, out var ev)) using (ev) ev.Set();
            return;
        }
        using var mutex = new Mutex(true, "MochaWallpaper.SingleInstance", out bool first);
        if (!first) return;
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayApp());
    }
}

// ---------------------------------------------------------------- one window per monitor
// A raw native child of the desktop WorkerW (no WinForms parenting logic), with WebView2 attached directly.
class WallpaperWindow : NativeWindow
{
    readonly string path;
    readonly Rectangle area;
    CoreWebView2Controller ctl;
    bool closed;

    public WallpaperWindow(string path, IntPtr host, Rectangle bounds)
    {
        this.path = path; area = bounds;
        CreateHandle(new CreateParams
        {
            ClassName = null, Caption = "MochaWallpaper", Parent = host,
            Style = 0x40000000 /*CHILD*/ | 0x10000000 /*VISIBLE*/ | 0x02000000 /*CLIPCHILDREN*/ | 0x04000000 /*CLIPSIBLINGS*/,
            ExStyle = 0x08000000 /*NOACTIVATE*/,
            X = bounds.X, Y = bounds.Y, Width = bounds.Width, Height = bounds.Height
        });
    }

    protected override void WndProc(ref Message m)
    {
        const int WM_ERASEBKGND = 0x0014, WM_SIZE = 0x0005;
        if (m.Msg == WM_ERASEBKGND)
        {
            using var g = Graphics.FromHdc(m.WParam);
            g.Clear(Color.FromArgb(0x11, 0x11, 0x1b));
            m.Result = (IntPtr)1; return;
        }
        if (m.Msg == WM_SIZE && ctl != null)
        {
            int w = (int)((long)m.LParam & 0xFFFF), h = (int)(((long)m.LParam >> 16) & 0xFFFF);
            ctl.Bounds = new Rectangle(0, 0, w, h);
        }
        base.WndProc(ref m);
    }

    public async void Start()
    {
        var dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MochaWallpaper", "WebView2");
        var env = await CoreWebView2Environment.CreateAsync(null, dataDir,
            new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required"));
        var c = await env.CreateCoreWebView2ControllerAsync(Handle);
        if (closed) { c.Close(); return; }
        ctl = c;
        ctl.DefaultBackgroundColor = Color.FromArgb(0x11, 0x11, 0x1b);
        ctl.Bounds = new Rectangle(0, 0, area.Width, area.Height);
        ctl.IsVisible = true;

        var cw = ctl.CoreWebView2;
        cw.Settings.AreDefaultContextMenusEnabled = false;
        cw.Settings.AreDevToolsEnabled = false;
        cw.Settings.IsStatusBarEnabled = false;
        cw.Settings.IsZoomControlEnabled = false;
        cw.IsMuted = true;

        var dir = Path.GetDirectoryName(path)!;
        cw.SetVirtualHostNameToFolderMapping("wallpaper.local", dir, CoreWebView2HostResourceAccessKind.Allow);
        var name = Uri.EscapeDataString(Path.GetFileName(path));
        var ext = Path.GetExtension(path).ToLowerInvariant();
        if (ext is ".html" or ".htm")
            cw.Navigate($"https://wallpaper.local/{name}");
        else
        {
            string media = ext is ".mp4" or ".webm"
                ? $"<video src='https://wallpaper.local/{name}' autoplay loop muted playsinline></video>"
                : $"<img src='https://wallpaper.local/{name}'>";
            cw.NavigateToString("<html><body style='margin:0;background:#11111b;overflow:hidden'>" +
                "<style>img,video{width:100vw;height:100vh;object-fit:cover;display:block}</style>" + media + "</body></html>");
        }
    }

    public async void SetPaused(bool paused)
    {
        if (ctl == null) return;
        try
        {
            // Suspending the renderer stops rAF/timers entirely: ~0% CPU/GPU while paused.
            if (paused) { ctl.IsVisible = false; await ctl.CoreWebView2.TrySuspendAsync(); }
            else { ctl.CoreWebView2.Resume(); ctl.IsVisible = true; }
        }
        catch { }
    }

    public void Close()
    {
        closed = true;
        try { ctl?.Close(); } catch { }
        ctl = null;
        DestroyHandle();
    }
}

// ---------------------------------------------------------------- Win32 desktop plumbing
static class Desktop
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int idx, int v);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder sb, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SystemParametersInfo(uint a, uint b, string c, uint d);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }

    // Ask Explorer to create the WorkerW layer between the wallpaper and the icons, then return it.
    public static IntPtr GetWallpaperHost()
    {
        var progman = FindWindow("Progman", null);
        SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out _);
        SendMessageTimeout(progman, 0x052C, (IntPtr)0xD, (IntPtr)1, 0, 1000, out _);

        // Windows 11 24H2+: WorkerW lives inside Progman, below the icon view.
        var inner = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        if (inner != IntPtr.Zero) return inner;

        // Older layout: the WorkerW that follows the one holding SHELLDLL_DefView.
        IntPtr worker = IntPtr.Zero;
        EnumWindows((h, _) =>
        {
            if (FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
                worker = FindWindowEx(IntPtr.Zero, h, "WorkerW", null);
            return true;
        }, IntPtr.Zero);
        return worker != IntPtr.Zero ? worker : progman;
    }

    public static void Place(IntPtr child, Rectangle r) =>
        SetWindowPos(child, IntPtr.Zero, r.X, r.Y, r.Width, r.Height, 0x0040 /*SHOWWINDOW*/ | 0x0010 /*NOACTIVATE*/);

    public static bool ForegroundIsFullscreen()
    {
        var fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) return false;
        var sb = new System.Text.StringBuilder(64);
        GetClassName(fg, sb, 64);
        var cls = sb.ToString();
        if (cls is "Progman" or "WorkerW" or "Shell_TrayWnd") return false;
        if (!GetWindowRect(fg, out var r)) return false;
        var s = Screen.FromHandle(fg).Bounds;
        return r.L <= s.Left && r.T <= s.Top && r.R >= s.Right && r.B >= s.Bottom;
    }

    // Make Explorer redraw the normal static wallpaper after we leave.
    public static void RepaintStaticWallpaper()
    {
        var current = (string)Registry.CurrentUser.OpenSubKey(@"Control Panel\Desktop")?.GetValue("WallPaper") ?? "";
        SystemParametersInfo(0x0014, 0, current, 0x01 | 0x02);
    }
}
