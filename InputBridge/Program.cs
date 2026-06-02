using System.Net;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

const string Prefix = "http://127.0.0.1:8788/";

var listener = new HttpListener();
listener.Prefixes.Add(Prefix);
listener.Start();

Console.WriteLine("电视游戏输入桥已启动");
Console.WriteLine($"监听地址：ws://127.0.0.1:8788/input");
Console.WriteLine("请保持此窗口打开。按 Ctrl+C 退出。");

while (true)
{
    var context = await listener.GetContextAsync();
    if (!context.Request.IsWebSocketRequest || context.Request.Url?.AbsolutePath != "/input")
    {
        context.Response.StatusCode = 404;
        context.Response.Close();
        continue;
    }

    _ = Task.Run(async () =>
    {
        using var ws = (await context.AcceptWebSocketAsync(null)).WebSocket;
        Console.WriteLine("输入通道已连接");
        await HandleClient(ws);
        Console.WriteLine("输入通道已断开");
    });
}

static async Task HandleClient(WebSocket ws)
{
    var buffer = new byte[8192];

    while (ws.State == WebSocketState.Open)
    {
        var result = await ws.ReceiveAsync(buffer, CancellationToken.None);
        if (result.MessageType == WebSocketMessageType.Close) break;

        var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
        try
        {
            using var doc = JsonDocument.Parse(text);
            InputInjector.Dispatch(doc.RootElement);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"输入事件处理失败：{ex.Message}");
        }
    }
}

static class InputInjector
{
    private const uint INPUT_MOUSE = 0;
    private const uint INPUT_KEYBOARD = 1;

    private const uint KEYEVENTF_KEYUP = 0x0002;

    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;

    public static void Dispatch(JsonElement input)
    {
        if (!TryGetString(input, "kind", out var kind)) return;

        switch (kind)
        {
            case "keyboard":
                HandleKeyboard(input);
                break;
            case "mouse":
                HandleMouse(input);
                break;
            case "gamepad":
                Console.WriteLine("收到手柄状态。虚拟手柄注入将在下一步接入 ViGEm。");
                break;
        }
    }

    private static void HandleKeyboard(JsonElement input)
    {
        if (!TryGetString(input, "action", out var action)) return;
        if (!TryGetString(input, "code", out var code)) return;
        if (!KeyMap.TryGetValue(code, out var vk)) return;

        var flags = action == "up" ? KEYEVENTF_KEYUP : 0;
        SendKeyboard(vk, flags);
    }

    private static void HandleMouse(JsonElement input)
    {
        if (!TryGetString(input, "action", out var action)) return;

        if (action == "move")
        {
            var dx = GetInt(input, "dx");
            var dy = GetInt(input, "dy");
            if (dx != 0 || dy != 0) SendMouse(dx, dy, 0, MOUSEEVENTF_MOVE);
            return;
        }

        if (action is "down" or "up")
        {
            var button = GetInt(input, "button");
            var flag = button switch
            {
                0 => action == "down" ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP,
                1 => action == "down" ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP,
                2 => action == "down" ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP,
                _ => 0u
            };
            if (flag != 0) SendMouse(0, 0, 0, flag);
            return;
        }

        if (action == "wheel")
        {
            var deltaY = GetInt(input, "deltaY");
            if (deltaY != 0) SendMouse(0, 0, -deltaY, MOUSEEVENTF_WHEEL);
        }
    }

    private static void SendKeyboard(ushort vk, uint flags)
    {
        var input = new INPUT
        {
            type = INPUT_KEYBOARD,
            U = new InputUnion
            {
                ki = new KEYBDINPUT
                {
                    wVk = vk,
                    wScan = 0,
                    dwFlags = flags,
                    time = 0,
                    dwExtraInfo = IntPtr.Zero
                }
            }
        };
        SendInput(1, [input], Marshal.SizeOf<INPUT>());
    }

    private static void SendMouse(int dx, int dy, int data, uint flags)
    {
        var input = new INPUT
        {
            type = INPUT_MOUSE,
            U = new InputUnion
            {
                mi = new MOUSEINPUT
                {
                    dx = dx,
                    dy = dy,
                    mouseData = data,
                    dwFlags = flags,
                    time = 0,
                    dwExtraInfo = IntPtr.Zero
                }
            }
        };
        SendInput(1, [input], Marshal.SizeOf<INPUT>());
    }

    private static bool TryGetString(JsonElement element, string name, out string value)
    {
        value = "";
        if (!element.TryGetProperty(name, out var property)) return false;
        value = property.GetString() ?? "";
        return value.Length > 0;
    }

    private static int GetInt(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var property)) return 0;
        return property.ValueKind switch
        {
            JsonValueKind.Number when property.TryGetInt32(out var value) => value,
            JsonValueKind.Number => (int)Math.Round(property.GetDouble()),
            _ => 0
        };
    }

    private static readonly Dictionary<string, ushort> KeyMap = BuildKeyMap();

    private static Dictionary<string, ushort> BuildKeyMap()
    {
        var map = new Dictionary<string, ushort>
        {
            ["Backspace"] = 0x08,
            ["Tab"] = 0x09,
            ["Enter"] = 0x0D,
            ["ShiftLeft"] = 0x10,
            ["ShiftRight"] = 0x10,
            ["ControlLeft"] = 0x11,
            ["ControlRight"] = 0x11,
            ["AltLeft"] = 0x12,
            ["AltRight"] = 0x12,
            ["Pause"] = 0x13,
            ["CapsLock"] = 0x14,
            ["Escape"] = 0x1B,
            ["Space"] = 0x20,
            ["PageUp"] = 0x21,
            ["PageDown"] = 0x22,
            ["End"] = 0x23,
            ["Home"] = 0x24,
            ["ArrowLeft"] = 0x25,
            ["ArrowUp"] = 0x26,
            ["ArrowRight"] = 0x27,
            ["ArrowDown"] = 0x28,
            ["PrintScreen"] = 0x2C,
            ["Insert"] = 0x2D,
            ["Delete"] = 0x2E,
            ["MetaLeft"] = 0x5B,
            ["MetaRight"] = 0x5C,
            ["NumpadMultiply"] = 0x6A,
            ["NumpadAdd"] = 0x6B,
            ["NumpadSubtract"] = 0x6D,
            ["NumpadDecimal"] = 0x6E,
            ["NumpadDivide"] = 0x6F,
            ["NumLock"] = 0x90,
            ["ScrollLock"] = 0x91,
            ["Semicolon"] = 0xBA,
            ["Equal"] = 0xBB,
            ["Comma"] = 0xBC,
            ["Minus"] = 0xBD,
            ["Period"] = 0xBE,
            ["Slash"] = 0xBF,
            ["Backquote"] = 0xC0,
            ["BracketLeft"] = 0xDB,
            ["Backslash"] = 0xDC,
            ["BracketRight"] = 0xDD,
            ["Quote"] = 0xDE
        };

        for (var c = 'A'; c <= 'Z'; c++) map[$"Key{c}"] = c;
        for (var i = 0; i <= 9; i++)
        {
            map[$"Digit{i}"] = (ushort)('0' + i);
            map[$"Numpad{i}"] = (ushort)(0x60 + i);
        }
        for (var i = 1; i <= 24; i++) map[$"F{i}"] = (ushort)(0x70 + i - 1);

        return map;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public int mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }
}
