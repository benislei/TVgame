# 局域网低延迟游戏串流原型

这是一个按“PC 发送端 -> WebRTC -> 电视浏览器接收端”的骨架工程。它把信令、接收页、发送端、DXGI 捕获接口、低延迟 SDP/RTP 补丁分开，方便逐步替换成真正的高性能实现。

## 现实边界

`wrtc` 的 `RTCVideoSource` 适合喂原始帧，再由 libwebrtc 内部编码。它不能用一个参数强制 NVIDIA NVENC、关闭 B 帧、设置 GOP 或把编码缓冲精确设为 0 帧。要严格控制 NVENC，需要 GStreamer、FFmpeg、WHIP/RTP 管线，或自编 libwebrtc encoder factory。

DXGI Desktop Duplication 也无法完全零拷贝到 Node Buffer。稳妥路线是 GPU texture -> staging texture -> 固定 native frame pool -> external Buffer，避免每帧分配，但仍会有一次 CPU 拷贝。

## 目录

```text
src/signaling-server.js        WebSocket 信令服务器，兼静态托管 public/
src/sender.js                  Node/wrtc 发送端骨架，默认推合成测试画面
src/low-latency-patches.js     H264/Opus SDP munging 与 sender 参数补丁
src/capture/index.js           DXGI 捕获模块 JS 包装
src/capture/preview-server.js  BGRA Buffer 到 HTML Canvas 的预览测试
public/receiver.html           电视浏览器打开的 WebRTC 接收端
native/dxgi-capture/           napi-rs DXGI 捕获模块骨架
test/                          Node 单元测试
```

## 安装

```bash
npm install
```

`wrtc` 是 optional dependency。信令服务器和测试不需要它；发送端需要它。

## 快速验证 exe

Windows 下可以直接双击工程根目录的 `QuickVerify.exe`。它会显示菜单：

```text
1. 安装/更新 npm 依赖
2. 启动信令服务器
3. 启动输入桥（让电视端键鼠控制电脑）
4. 打开电脑发送端页面（真实屏幕共享）
5. 打开本机接收端页面
6. 启动 Node 测试画面发送端
7. 一键启动：安装依赖 + 信令 + 输入桥 + 发送端页面
```

建议第一次选择 `7`。启动后它会打开信令服务器窗口、输入桥窗口，并打开电脑发送端页面。电视浏览器访问菜单中显示的地址：

```text
http://<电脑局域网IP>:8080/receiver.html?room=game
```

这个 exe 是验证启动器，不是把 WebRTC 和 native 模块完整封装进单文件。它仍然依赖本机安装的 Node.js 和 .NET 8。

## 输入桥

浏览器不能直接控制 Windows 键鼠，所以真实操作需要运行本机输入桥：

```bash
dotnet run --project InputBridge/InputBridge.csproj
```

它只监听本机地址：

```text
ws://127.0.0.1:8788/input
```

发送端页面收到电视接收端传回来的键盘、鼠标事件后，会转发给输入桥，再由输入桥调用 Windows `SendInput`。如果发送端页面显示“输入桥：已连接”，说明键鼠注入链路已接通。

注意：如果游戏或目标程序以管理员权限运行，输入桥也需要以管理员权限运行，否则 Windows 可能阻止低权限进程控制高权限窗口。

## 运行信令服务器

```bash
npm run signal
```

在电视浏览器打开：

```text
http://<电脑局域网IP>:8080/receiver.html?room=game
```

页面会自动使用同源 WebSocket，也可以手动填 `ws://<电脑局域网IP>:8080`。

## 运行发送端测试画面

```bash
set SIGNAL=ws://127.0.0.1:8080
set ROOM=game
npm run sender
```

当前发送端默认使用合成 I420 测试帧，目的是先跑通信令、WebRTC、电视播放、输入事件回传。接收端发回的键盘、鼠标、手柄 JSON 会打印到发送端控制台。生产版要把这些事件接到 Windows `SendInput`、ViGEm 或 HID 注入层。

## 先跑通真实桌面画面

最快的真实画面验证方式是使用浏览器发送端，它通过 Chrome/Edge 的 `getDisplayMedia()` 捕获桌面：

```text
http://<电脑局域网IP>:8080/sender-browser.html?room=game
```

操作顺序：

1. 电视或另一个浏览器标签打开 `receiver.html?room=game`，点击连接。
2. 电脑浏览器打开 `sender-browser.html?room=game`。
3. 点击 `开始共享真实画面`，在浏览器弹窗里选择要共享的屏幕或窗口。

这条路径已经是真实桌面画面，但捕获和编码由浏览器/libwebrtc 完成。后续 DXGI 原生模块完成后，可以把浏览器发送端替换回 Node 发送端。

接收端左上角会显示实时指标：

```text
RTT     DataChannel ping/pong 往返延迟
FPS     接收端解码帧率
BUFFER  WebRTC jitter buffer 平均驻留时间
JITTER  RTP jitter
DECODE  单帧平均解码耗时
LOST    已报告丢包数
```

这里的 RTT 不是严格的端到端画面延迟，但能很好地反映控制链路延迟。端到端画面延迟后续需要在采集帧里叠加发送时间戳或测试闪屏/高速摄像头。

手柄事件会按标准 Gamepad API 映射为：

```text
axes: lx, ly, rx, ry
buttons: a, b, x, y, lb, rb, lt, rt, back, start, ls, rs, dpadUp, dpadDown, dpadLeft, dpadRight, home
```

接收端会做摇杆死区处理，并且只在手柄状态变化时发送，避免每帧刷大量重复事件。

## 阶段 1：原生低延迟发送端

浏览器发送端已经可以跑通真实画面，但画质、帧率和控制延迟会受到浏览器捕获与 libwebrtc 默认编码策略限制。阶段 1 增加一条真正游戏串流方向的发送路径：

```text
D3D11 屏幕捕获 -> NVENC H.264 低延迟编码 -> RTP -> GStreamer webrtcbin -> 电视接收端
```

先检测环境：

```bash
npm run native:check
```

如果提示缺少依赖，运行自动安装：

```bash
npm run native:install
```

它会下载并安装官方 64 位 MSVC 版 GStreamer runtime/devel，并安装 Python `websockets` 信令依赖。安装完成后请重新打开终端或 QuickVerify，再次运行：

```bash
npm run native:check
```

查看 1080p60 管线：

```bash
npm run native:pipeline -- --profile 1080p60
```

启动原生发送端：

```bash
npm run native:run -- --profile 1080p60 --room game --signal ws://127.0.0.1:8080
```

QuickVerify.exe 也增加了：

```text
8. 检测原生串流环境（GStreamer / NVENC）
9. 安装 GStreamer 原生串流依赖
10. 启动原生 NVENC 发送端（1080p60）
```

当前这条原生路径是阶段 1 骨架，目标是验证依赖、管线和信令联通。实际机器上安装 GStreamer 后，可能还需要根据本机插件版本微调 `d3d11screencapturesrc` 或 `nvh264enc` 的属性名。

## DXGI 捕获模块

目标 API：

```js
const { DesktopDuplicator } = require('./src/capture');

const capture = new DesktopDuplicator({ fps: 60, maxQueueSize: 2 });
await capture.start();
const frame = await capture.nextFrame(16);
console.log(frame.width, frame.height, frame.stride, frame.data);
frame.release();
```

预览测试：

```bash
npm run capture:preview
```

然后打开：

```text
http://127.0.0.1:8787
```

注意：`native/dxgi-capture` 当前是 napi-rs 工程骨架，已列出 Windows API 接入点。完整生产实现需要补齐 `CreateDXGIFactory1`、D3D11 device、`IDXGIOutputDuplication::AcquireNextFrame`、staging texture、frame pool 和 duplication reset。

## 低延迟补丁

`src/low-latency-patches.js` 提供：

- H.264 优先与 baseline `profile-level-id=42e01f`
- Opus `128kbps`、`ptime=10`
- 去掉 RTX 和普通 NACK，默认保留 PLI
- `RTCRtpSender.setParameters()` 设置码率、帧率和保持帧率优先

示例：

```js
const { mungeLowLatencySdp, tuneVideoSender } = require('./src/low-latency-patches');

const offer = await pc.createOffer();
offer.sdp = mungeLowLatencySdp(offer.sdp);
await pc.setLocalDescription(offer);
await tuneVideoSender(videoSender, { bitrate: 12_000_000, fps: 60 });
```

这些是协商偏好和 RTP sender 限制，不等于真实编码器的 NVENC 参数。真正的编码器低延迟参数应该在 FFmpeg/GStreamer/NVENC 中设置：

```bash
ffmpeg -f rawvideo -pix_fmt yuv420p -s 1920x1080 -r 60 -i pipe:0 ^
  -c:v h264_nvenc -profile:v baseline -tune ll -preset p1 ^
  -bf 0 -g 30 -rc cbr -zerolatency 1 -b:v 20M -bufsize 1M ^
  -f h264 pipe:1
```

## 验证

```bash
npm test
```

## 推荐开发顺序

1. 跑通信令服务器、电视接收页、发送端合成画面。
2. 完成 DXGI 捕获和 BGRA Buffer frame pool。
3. 用 native libyuv 做 BGRA -> I420，接入 `createBgraFrameSource()`。
4. 做输入注入：键鼠用 `SendInput`，手柄用 ViGEm。
5. 如果 `wrtc` 内部编码延迟/画质不够，再切到 GStreamer/FFmpeg NVENC 或自定义 libwebrtc。
