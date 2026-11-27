using System.Text.Json;

namespace MochaWallpaper;

// The library is split into category folders (animated\, 3d\ …); every subfolder of a category is one wallpaper.
// A top-level folder that is itself a wallpaper, and loose files in the root, land in the "Other" category.
// Id is the path relative to the library, e.g. "animated/mocha-forest".
record Wallpaper(string Id, string Title, string Entry);
record Category(string Name, List<Wallpaper> Items);

static class Library
{
    public const string Imported = "imported";   // where "Add wallpaper…" puts new items

    public static List<Category> Categories(string dir)
    {
        var cats = new List<Category>();
        if (!Directory.Exists(dir)) return cats;
        var other = new List<Wallpaper>();
        foreach (var sub in Folders(dir))
        {
            var name = Path.GetFileName(sub);
            if (ResolveEntry(sub, out _) != null) { other.AddRange(ScanFolder(dir, "", only: sub)); continue; }
            var items = ScanFolder(sub, name + "/");
            if (items.Count > 0) cats.Add(new Category(CategoryTitle(name), items));
        }
        other.AddRange(LooseFiles(dir, ""));
        if (other.Count > 0) cats.Add(new Category("Other", other));
        return cats;
    }

    public static List<Wallpaper> Scan(string dir) => Categories(dir).SelectMany(c => c.Items).ToList();

    // Ids used to be bare folder names before categories existed: match those by their last segment.
    public static bool Matches(Wallpaper w, string id) =>
        id != null && (w.Id.Equals(id, StringComparison.OrdinalIgnoreCase) ||
                       (!id.Contains('/') && w.Id.EndsWith("/" + id, StringComparison.OrdinalIgnoreCase)));

    static IEnumerable<string> Folders(string dir) => Directory.GetDirectories(dir)
        .Where(d => !Path.GetFileName(d).StartsWith('_'))   // _todos, _drafts … are work folders, not wallpapers
        .OrderBy(d => d, StringComparer.OrdinalIgnoreCase);

    static List<Wallpaper> ScanFolder(string dir, string prefix, string only = null)
    {
        var list = new List<Wallpaper>();
        foreach (var sub in only != null ? new[] { only } : Folders(dir))
        {
            var entry = ResolveEntry(sub, out var title);
            var name = Path.GetFileName(sub);
            if (entry != null) list.Add(new Wallpaper(prefix + name, title ?? Pretty(name), entry));
        }
        if (only == null) list.AddRange(LooseFiles(dir, prefix));
        return list;
    }

    static IEnumerable<Wallpaper> LooseFiles(string dir, string prefix) => Directory.GetFiles(dir).Where(IsMedia)
        .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
        .Select(f => new Wallpaper(prefix + Path.GetFileName(f), Pretty(Path.GetFileNameWithoutExtension(f)), f));

    static string CategoryTitle(string folder) => folder.Length <= 3 ? folder.ToUpperInvariant() : Pretty(folder);

    static readonly string[] Images = { ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp" };
    static readonly string[] Videos = { ".mp4", ".webm" };
    static readonly string[] Pages = { ".html", ".htm" };

    public static bool IsMedia(string p)
    {
        var e = Path.GetExtension(p).ToLowerInvariant();
        return Images.Contains(e) || Videos.Contains(e) || Pages.Contains(e);
    }

    // project.json "file"  >  index.html / any .html  >  video  >  image (preview.* ignored)
    public static string ResolveEntry(string folder, out string title)
    {
        title = null;
        var pj = Path.Combine(folder, "project.json");
        if (File.Exists(pj))
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(pj));
                if (doc.RootElement.TryGetProperty("title", out var t)) title = t.GetString();
                if (doc.RootElement.TryGetProperty("file", out var f))
                {
                    var p = Path.Combine(folder, f.GetString() ?? "");
                    if (File.Exists(p) && IsMedia(p)) return p;
                }
            }
            catch { }
        }
        var files = Directory.GetFiles(folder);
        string Pick(string[] exts, bool skipPreview = false) => files
            .Where(f => exts.Contains(Path.GetExtension(f).ToLowerInvariant()))
            .Where(f => !skipPreview || !Path.GetFileNameWithoutExtension(f).Equals("preview", StringComparison.OrdinalIgnoreCase))
            .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();
        var index = Path.Combine(folder, "index.html");
        return File.Exists(index) ? index : Pick(Pages) ?? Pick(Videos) ?? Pick(Images, true);
    }

    static string Pretty(string s)
    {
        s = s.Replace('-', ' ').Replace('_', ' ').Trim();
        return s.Length == 0 ? s : char.ToUpper(s[0]) + s[1..];
    }

    // Copy a file, or the folder holding a web wallpaper, into the library. Returns the new wallpaper id.
    public static string Import(string source, string library)
    {
        Directory.CreateDirectory(library);
        bool isFolder = Directory.Exists(source);
        var ext = isFolder ? "" : Path.GetExtension(source).ToLowerInvariant();
        bool webProject = !isFolder && (Pages.Contains(ext) ||
            Path.GetFileName(source).Equals("project.json", StringComparison.OrdinalIgnoreCase));
        string srcFolder = isFolder ? source : webProject ? Path.GetDirectoryName(source) : null;

        var baseName = Slug(srcFolder != null ? Path.GetFileName(srcFolder) : Path.GetFileNameWithoutExtension(source));
        var id = baseName;
        int n = 2;
        while (Directory.Exists(Path.Combine(library, id)) || File.Exists(Path.Combine(library, id))) id = $"{baseName}-{n++}";
        var dest = Path.Combine(library, id);

        if (srcFolder != null) CopyDir(srcFolder, dest);
        else { Directory.CreateDirectory(dest); File.Copy(source, Path.Combine(dest, "wallpaper" + ext)); }
        return id;
    }

    static string Slug(string s)
    {
        var chars = s.ToLowerInvariant().Select(c => char.IsLetterOrDigit(c) ? c : '-').ToArray();
        var r = string.Join("-", new string(chars).Split('-', StringSplitOptions.RemoveEmptyEntries));
        return r.Length == 0 ? "wallpaper" : r;
    }

    static void CopyDir(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var f in Directory.GetFiles(from)) File.Copy(f, Path.Combine(to, Path.GetFileName(f)));
        foreach (var d in Directory.GetDirectories(from)) CopyDir(d, Path.Combine(to, Path.GetFileName(d)));
    }
}
