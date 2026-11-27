using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MochaWallpaper;

// Everything the app fetches lives in the public GitHub repository: wallpapers straight from the main branch,
// new versions of the app as the setup file attached to the latest GitHub release.
static class GitHub
{
    public const string Repo = "tianvay/wallpaperz";
    public const string Branch = "main";

    static readonly HttpClient http = Make();

    static HttpClient Make()
    {
        var h = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
        h.DefaultRequestHeaders.UserAgent.ParseAdd("MochaWallpaper");
        return h;
    }

    // null when GitHub answers 404 (e.g. no release published yet).
    public static async Task<JsonDocument> Api(string path)
    {
        using var r = await http.GetAsync($"https://api.github.com/repos/{Repo}/{path}");
        if (r.StatusCode == HttpStatusCode.NotFound) return null;
        if (r.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.TooManyRequests)
            throw new Exception("GitHub is limiting requests from this network right now. Try again in an hour.");
        r.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync());
    }

    public static async Task<byte[]> Raw(string commit, string path)
    {
        var escaped = string.Join("/", path.Split('/').Select(Uri.EscapeDataString));
        return await http.GetByteArrayAsync($"https://raw.githubusercontent.com/{Repo}/{commit}/{escaped}");
    }

    public static async Task DownloadFile(string url, string dest)
    {
        using var r = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
        r.EnsureSuccessStatusCode();
        await using (var f = File.Create(dest + ".part")) await r.Content.CopyToAsync(f);
        File.Move(dest + ".part", dest, true);
    }

    // A git checkout of the repository manages its wallpapers with git, not with the app.
    public static bool IsDevCheckout(string library) =>
        Directory.Exists(Path.Combine(Path.GetFullPath(Path.Combine(library, "..")), ".git"));
}

record SyncResult(List<string> Added, List<string> Updated, List<string> Removed)
{
    public bool Any => Added.Count + Updated.Count + Removed.Count > 0;
}

// Mirrors wallpapers/<category>/<wallpaper>/ from the repository into the local library. Only folders the
// sync itself put there (listed in .sync.json) are ever deleted; imported\ and the user's own folders stay.
static class WallpaperSync
{
    const string StateFile = ".sync.json";

    public static async Task<SyncResult> Run(string library)
    {
        using var commit = await GitHub.Api($"commits/{GitHub.Branch}") ?? throw new Exception("Repository not found.");
        var sha = commit.RootElement.GetProperty("sha").GetString();
        var treeSha = commit.RootElement.GetProperty("commit").GetProperty("tree").GetProperty("sha").GetString();
        using var tree = await GitHub.Api($"git/trees/{treeSha}?recursive=1") ?? throw new Exception("Repository tree not found.");
        if (tree.RootElement.GetProperty("truncated").GetBoolean()) throw new Exception("Repository listing is too large.");

        // id ("animated/mocha-forest") -> files inside it (relative path, git blob sha)
        var remote = new Dictionary<string, List<(string Rel, string Sha, string Path)>>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in tree.RootElement.GetProperty("tree").EnumerateArray())
        {
            if (item.GetProperty("type").GetString() != "blob") continue;
            var path = item.GetProperty("path").GetString();
            var parts = path.Split('/');
            if (parts.Length < 4 || parts[0] != "wallpapers") continue;
            if (parts[1].StartsWith('_') || parts[2].StartsWith('_') || parts[1].Equals(Library.Imported, StringComparison.OrdinalIgnoreCase)) continue;
            var id = parts[1] + "/" + parts[2];
            if (!remote.TryGetValue(id, out var files)) remote[id] = files = new();
            files.Add((string.Join("/", parts[3..]), item.GetProperty("sha").GetString(), path));
        }

        var state = LoadState(library);
        var result = new SyncResult(new(), new(), new());
        var jobs = new List<(string Dest, string Sha, string Path)>();

        foreach (var (id, files) in remote)
        {
            var dir = Path.Combine(library, id.Replace('/', Path.DirectorySeparatorChar));
            bool existed = Directory.Exists(dir), changed = false;
            foreach (var f in files)
            {
                var local = Path.Combine(dir, f.Rel.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(local) && BlobSha(local) == f.Sha) continue;
                jobs.Add((local, f.Sha, f.Path));
                changed = true;
            }
            if (existed && state.Contains(id))   // files that were removed or renamed upstream
            {
                var wanted = files.Select(f => Path.GetFullPath(Path.Combine(dir, f.Rel))).ToHashSet(StringComparer.OrdinalIgnoreCase);
                foreach (var local in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                    if (!wanted.Contains(Path.GetFullPath(local))) { TryDelete(local); changed = true; }
            }
            if (!existed) result.Added.Add(id);
            else if (changed) result.Updated.Add(id);
            state.Add(id);
        }

        // Identical files (the 3D scenes share three.js) are downloaded once and written everywhere.
        await Parallel.ForEachAsync(jobs.GroupBy(j => j.Sha), new ParallelOptions { MaxDegreeOfParallelism = 8 }, async (g, _) =>
        {
            var data = await GitHub.Raw(sha, g.First().Path);
            foreach (var j in g)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(j.Dest)!);
                await File.WriteAllBytesAsync(j.Dest + ".part", data);
                File.Move(j.Dest + ".part", j.Dest, true);
            }
        });

        foreach (var id in state.Where(id => !remote.ContainsKey(id)).ToList())
        {
            var dir = Path.Combine(library, id.Replace('/', Path.DirectorySeparatorChar));
            try { if (Directory.Exists(dir)) Directory.Delete(dir, true); result.Removed.Add(id); state.Remove(id); }
            catch { }   // in use right now: retried on the next sync
        }
        foreach (var cat in Directory.GetDirectories(library))   // drop categories that became empty
            if (!Path.GetFileName(cat).StartsWith('_') && !Directory.EnumerateFileSystemEntries(cat).Any()) TryDeleteDir(cat);

        SaveState(library, state);
        return result;
    }

    // The id git and GitHub use for a file: sha1("blob <size>\0" + content).
    static string BlobSha(string file)
    {
        var data = File.ReadAllBytes(file);
        using var sha1 = IncrementalHash.CreateHash(HashAlgorithmName.SHA1);
        sha1.AppendData(Encoding.ASCII.GetBytes($"blob {data.Length}\0"));
        sha1.AppendData(data);
        return Convert.ToHexString(sha1.GetHashAndReset()).ToLowerInvariant();
    }

    static HashSet<string> LoadState(string library)
    {
        try { return JsonSerializer.Deserialize<HashSet<string>>(File.ReadAllText(Path.Combine(library, StateFile))) is { } s
                ? new HashSet<string>(s, StringComparer.OrdinalIgnoreCase) : new(StringComparer.OrdinalIgnoreCase); }
        catch { return new HashSet<string>(StringComparer.OrdinalIgnoreCase); }
    }

    static void SaveState(string library, HashSet<string> state)
    {
        Directory.CreateDirectory(library);
        File.WriteAllText(Path.Combine(library, StateFile), JsonSerializer.Serialize(state.OrderBy(s => s, StringComparer.OrdinalIgnoreCase)));
    }

    static void TryDelete(string f) { try { File.Delete(f); } catch { } }
    static void TryDeleteDir(string d) { try { Directory.Delete(d); } catch { } }
}

// New app versions are published as MochaWallpaperSetup.exe on a GitHub release tagged v<version>.
static class AppUpdate
{
    public const string SetupAsset = "MochaWallpaperSetup.exe";

    public static Version Current => Normalize(typeof(AppUpdate).Assembly.GetName().Version);

    static Version Normalize(Version v) => new(v.Major, v.Minor, Math.Max(v.Build, 0));

    // The newer release, or null when this is the newest version (or nothing is published yet).
    public static async Task<(Version Version, string Url)?> Check(Version current = null)
    {
        using var rel = await GitHub.Api("releases/latest");
        if (rel == null) return null;
        if (!Version.TryParse(rel.RootElement.GetProperty("tag_name").GetString()?.TrimStart('v', 'V'), out var v)) return null;
        var url = rel.RootElement.GetProperty("assets").EnumerateArray()
            .Where(a => a.GetProperty("name").GetString() == SetupAsset)
            .Select(a => a.GetProperty("browser_download_url").GetString()).FirstOrDefault();
        return url != null && Normalize(v) > (current ?? Current) ? (Normalize(v), url) : null;
    }

    // Runs the new setup unattended: it closes this app, updates it in place and starts it again.
    public static async Task Install(string url)
    {
        var dest = Path.Combine(Path.GetTempPath(), SetupAsset);
        await GitHub.DownloadFile(url, dest);
        Process.Start(new ProcessStartInfo(dest, "/SILENT /SUPPRESSMSGBOXES /NORESTART") { UseShellExecute = true });
    }
}
