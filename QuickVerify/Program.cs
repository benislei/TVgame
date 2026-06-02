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

static string NpmCmd() => FindOnPath("npm.cmd") ?? @"C:\Program Files\nodejs\npm.cmd";

static string DotnetCmd() => FindOnPath("dotnet.exe") ?? "dotnet";

static int RunAndWait(string fileName, string arguments, string workingDirectory)
{
    var process = Process.Start(new ProcessStartInfo
    {
        FileName = fileName,
        Arguments = arguments,
        WorkingDirectory = workingDirectory,
        UseShellExecute = false
    });

    if (process == null) return 1;
    process.WaitForExit();
    return process.ExitCode;
}

static int RunAndWaitNpm(string arguments, string workingDirectory)
{
    var npm = NpmCmd();
    if (!File.Exists(npm))
    {
        Console.WriteLine("找不到 npm.cmd。请先安装 Node.js LTS，并确认 npm 在 PATH 中。");
        return 1;
    }

    return RunAndWait("cmd.exe", $"/d /s /c \"{Quote(npm)} {arguments}\"", workingDirectory);
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

static void OpenUrl(string url)
{
    Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
}

static void PrintHeader(string root, string? lanIp)
{
    if (!Console.IsOutputRedirected) Console.Clear();

    Console.WriteLine("电视游戏串流快速验证");
    Console.WriteLine("====================");
    Console.WriteLine($"项目目录：{root}");
    Console.WriteLine($"局域网 IP：{lanIp ?? "未找到，请手动用 ipconfig 查看"}");
    Console.WriteLine();
    Console.WriteLine("电视接收端地址：");
    Console.WriteLine(lanIp == null
        ? "  http://<电脑局域网IP>:8080/receiver.html?room=game"
        : $"  http://{lanIp}:8080/receiver.html?room=game");
    Console.WriteLine();
    Console.WriteLine("电脑发送端地址：");
    Console.WriteLine("  http://127.0.0.1:8080/sender-browser.html?room=game");
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
    Console.WriteLine("  3. 启动输入桥（让电视端键鼠控制电脑）");
    Console.WriteLine("  4. 打开电脑发送端页面（真实屏幕共享）");
    Console.WriteLine("  5. 打开本机接收端页面");
    Console.WriteLine("  6. 启动 Node 测试画面发送端");
    Console.WriteLine("  7. 一键启动：安装依赖 + 信令 + 输入桥 + 发送端页面");
    Console.WriteLine("  8. 检测原生串流环境（GStreamer / NVENC）");
    Console.WriteLine("  9. 安装 GStreamer 原生串流依赖");
    Console.WriteLine(" 10. 启动原生 NVENC 发送端（1080p60）");
    Console.WriteLine("  0. 退出");
    Console.WriteLine();
    Console.Write("> ");

    var choice = Console.ReadLine()?.Trim();
    Console.WriteLine();

    if (choice == "0") break;

    if (choice is "1" or "7")
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

    if (choice is "2" or "7")
    {
        StartCommandWindow("电视游戏信令服务器", $"{Quote(NpmCmd())} run signal", root);
        Console.WriteLine("已打开信令服务器窗口。");
    }

    if (choice is "3" or "7")
    {
        StartCommandWindow("电视游戏输入桥", $"{Quote(DotnetCmd())} run --project InputBridge/InputBridge.csproj", root);
        Console.WriteLine("已打开输入桥窗口。");
    }

    if (choice is "4" or "7")
    {
        OpenUrl("http://127.0.0.1:8080/sender-browser.html?room=game");
        Console.WriteLine("已打开电脑发送端页面。");
    }

    if (choice == "5")
    {
        OpenUrl("http://127.0.0.1:8080/receiver.html?room=game");
        Console.WriteLine("已打开本机接收端页面。");
    }

    if (choice == "6")
    {
        if (!HasNodeModules(root))
        {
            Console.WriteLine("还没有 node_modules，请先选择 1 安装依赖。");
        }
        else
        {
            StartCommandWindow(
                "电视游戏测试画面发送端",
                $"set SIGNAL=ws://127.0.0.1:8080&& set ROOM=game&& {Quote(NpmCmd())} run sender",
                root);
            Console.WriteLine("已打开 Node 测试画面发送端窗口。");
        }
    }

    if (choice == "8")
    {
        StartCommandWindow("原生串流环境检测", $"{Quote(NpmCmd())} run native:check", root);
        Console.WriteLine("已打开原生串流环境检测窗口。");
    }

    if (choice == "9")
    {
        StartCommandWindow("安装 GStreamer 原生依赖", $"{Quote(NpmCmd())} run native:install", root);
        Console.WriteLine("已打开 GStreamer 安装窗口。安装后请重新打开此快速验证程序。");
    }

    if (choice == "10")
    {
        if (!HasNodeModules(root))
        {
            Console.WriteLine("还没有 node_modules，请先选择 1 安装依赖。");
        }
        else
        {
            StartCommandWindow(
                "原生 NVENC 发送端",
                $"{Quote(NpmCmd())} run native:run -- --profile 1080p60",
                root);
            Console.WriteLine("已打开原生 NVENC 发送端窗口。");
        }
    }

    if (choice is not ("1" or "2" or "3" or "4" or "5" or "6" or "7" or "8" or "9" or "10"))
    {
        Console.WriteLine("无效选择。");
    }

    Console.WriteLine();
    Console.WriteLine("按回车继续。");
    Console.ReadLine();
}
