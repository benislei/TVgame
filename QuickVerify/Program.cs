using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

static string FindProjectRoot()
{
    var dir = AppContext.BaseDirectory;
    while (!string.IsNullOrWhiteSpace(dir))
    {
        if (File.Exists(Path.Combine(dir, "package.json")) &&
            Directory.Exists(Path.Combine(dir, "src")) &&
            Directory.Exists(Path.Combine(dir, "public")))
        {
            return dir;
        }

        var parent = Directory.GetParent(dir);
        if (parent == null) break;
        dir = parent.FullName;
    }

    return Directory.GetCurrentDirectory();
}

static string? FindLanIp()
{
    var candidates = new List<string>();

    foreach (var iface in NetworkInterface.GetAllNetworkInterfaces())
    {
        if (iface.OperationalStatus != OperationalStatus.Up) continue;
        if (iface.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;

        foreach (var address in iface.GetIPProperties().UnicastAddresses)
        {
            if (address.Address.AddressFamily != AddressFamily.InterNetwork) continue;
            var ip = address.Address;
            if (IPAddress.IsLoopback(ip)) continue;
            var text = ip.ToString();
            if (text.StartsWith("169.254.")) continue;
            candidates.Add(text);
        }
    }

    static int Score(string ip)
    {
        if (ip.StartsWith("192.168.")) return 0;
        if (ip.StartsWith("10.")) return 1;

        var parts = ip.Split('.');
        if (parts.Length == 4 && parts[0] == "172" && int.TryParse(parts[1], out var second) && second is >= 16 and <= 31)
        {
            return 2;
        }

        return 10;
    }

    return candidates.OrderBy(Score).FirstOrDefault();
}

static string? FindOnPath(string executable)
{
    var path = Environment.GetEnvironmentVariable("PATH") ?? "";
    foreach (var dir in path.Split(Path.PathSeparator))
    {
        if (string.IsNullOrWhiteSpace(dir)) continue;
        var candidate = Path.Combine(dir.Trim(), executable);
        if (File.Exists(candidate)) return candidate;
    }

    return null;
}

static string Quote(string value) => "\"" + value.Replace("\"", "\\\"") + "\"";

static string NpmCmd()
{
    return FindOnPath("npm.cmd") ?? @"C:\Program Files\nodejs\npm.cmd";
}

static int RunAndWaitNpm(string arguments, string workingDirectory)
{
    var npm = NpmCmd();
    if (!File.Exists(npm))
    {
        Console.WriteLine("找不到 npm.cmd。请先安装 Node.js LTS，并确认 npm 在 PATH 中。");
        return 1;
    }

    var process = Process.Start(new ProcessStartInfo
    {
        FileName = "cmd.exe",
        Arguments = $"/d /s /c \"{Quote(npm)} {arguments}\"",
        WorkingDirectory = workingDirectory,
        UseShellExecute = false
    });

    if (process == null) return 1;
    process.WaitForExit();
    return process.ExitCode;
}

static void StartCommandWindow(string title, string command, string workingDirectory)
{
    var escapedTitle = title.Replace("\"", "'");
    var escapedDirectory = workingDirectory.Replace("\"", "\\\"");
    var fullCommand = $"title {escapedTitle} && cd /d \"{escapedDirectory}\" && {command}";

    Process.Start(new ProcessStartInfo
    {
        FileName = "cmd.exe",
        Arguments = $"/k \"{fullCommand}\"",
        WorkingDirectory = workingDirectory,
        UseShellExecute = true
    });
}

static bool HasNodeModules(string root) => Directory.Exists(Path.Combine(root, "node_modules"));

static void PrintHeader(string root, string? lanIp)
{
    if (!Console.IsOutputRedirected)
    {
        Console.Clear();
    }

    Console.WriteLine("LAN Game Streaming Quick Verify");
    Console.WriteLine("================================");
    Console.WriteLine($"Project: {root}");
    Console.WriteLine($"LAN IP : {lanIp ?? "未找到，请手动用 ipconfig 查看"}");
    Console.WriteLine();
    Console.WriteLine("电视浏览器访问：");
    Console.WriteLine(lanIp == null
        ? "  http://<电脑局域网IP>:8080/receiver.html?room=game"
        : $"  http://{lanIp}:8080/receiver.html?room=game");
    Console.WriteLine();
}

var root = FindProjectRoot();
var lanIp = FindLanIp();

while (true)
{
    PrintHeader(root, lanIp);
    Console.WriteLine("请选择：");
    Console.WriteLine("  1. 安装/更新 npm 依赖");
    Console.WriteLine("  2. 启动信令服务器");
    Console.WriteLine("  3. 启动发送端测试画面");
    Console.WriteLine("  4. 一键启动：安装依赖 + 信令 + 发送端");
    Console.WriteLine("  5. 打开本机接收页用于测试");
    Console.WriteLine("  0. 退出");
    Console.WriteLine();
    Console.Write("> ");

    var choice = Console.ReadLine()?.Trim();
    Console.WriteLine();

    if (choice == "0") break;

    if (choice is "1" or "4")
    {
        Console.WriteLine("正在运行 npm.cmd install ...");
        var exit = RunAndWaitNpm("install", root);
        Console.WriteLine(exit == 0 ? "依赖安装完成。" : $"依赖安装失败，退出码：{exit}");
        if (choice == "1")
        {
            Console.WriteLine("按回车继续。");
            Console.ReadLine();
            continue;
        }
        if (exit != 0)
        {
            Console.WriteLine("安装失败，先不要启动。按回车继续。");
            Console.ReadLine();
            continue;
        }
    }

    if (choice is "2" or "4")
    {
        StartCommandWindow("LAN Stream Signaling", $"{Quote(NpmCmd())} run signal", root);
        Console.WriteLine("已打开信令服务器窗口。");
    }

    if (choice is "3" or "4")
    {
        if (!HasNodeModules(root))
        {
            Console.WriteLine("还没有 node_modules，请先选择 1 安装依赖。");
        }
        else
        {
            StartCommandWindow(
                "LAN Stream Sender",
                $"set SIGNAL=ws://127.0.0.1:8080&& set ROOM=game&& {Quote(NpmCmd())} run sender",
                root);
            Console.WriteLine("已打开发送端窗口。");
        }
    }

    if (choice == "5")
    {
        var url = "http://127.0.0.1:8080/receiver.html?room=game";
        Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        Console.WriteLine($"已打开：{url}");
    }

    if (choice is not ("1" or "2" or "3" or "4" or "5"))
    {
        Console.WriteLine("无效选择。");
    }

    Console.WriteLine();
    Console.WriteLine("按回车继续。");
    Console.ReadLine();
}
