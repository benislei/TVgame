# 阶段 2 设计：Android TV 原生游戏串流 MVP

## 目标

阶段 2 的目标是从“浏览器可用验证”升级到“能快速验证游戏手感”的原生串流 MVP。验收优先级是低延迟、稳定 60 帧、键鼠/手柄跟手、声音可用且尽量同步，而不是一开始追求 4K 或最高画质。

目标规格：

- 分辨率：1920x1080
- 帧率：60 FPS
- 视频编码：H.264 NVENC，低延迟参数
- 默认视频码率：25 Mbps，可切换 12 / 18 / 25 / 35 Mbps
- 音频：系统声音必须随画面传输到电视
- 接收端：小米/海信/TCL 等 Android TV 原生 App
- 输入：先支持键盘和鼠标，随后接入标准手柄映射
- 指标：接收端实时显示 FPS、码率、RTT、解码耗时、丢帧、音频状态
- 安装：发送端依赖必须开始收敛到一键检测/安装，避免用户手动配置复杂运行环境

## 非目标

- 第一版不追求 1440p60、4K60、HDR、HEVC 或 AV1。
- 第一版不做跨公网串流，只服务同一局域网。
- 第一版不做复杂账号、鉴权、云中继或多用户房间。
- 第一版不把电视浏览器作为最终接收端。
- 第一版不要求把所有底层依赖完全消灭，但用户侧不能依赖手动阅读文档逐项安装。

## 推荐架构

```text
PC 原生发送端
  D3D11 桌面捕获
  WASAPI loopback 系统声音采集
  NVENC H.264 低延迟视频编码
  Opus 或 AAC-LC 低延迟音频编码
  RTP/UDP 或轻量会话协议发送
  接收输入事件并交给 InputBridge

Android TV 原生接收端
  发现/连接 PC
  接收视频和音频包
  MediaCodec 硬解视频
  AudioTrack 低延迟播放音频
  Surface 渲染画面
  采集键鼠/手柄/遥控器输入
  通过低延迟通道回传 PC
  显示实时性能指标
```

## 视频设计

PC 端使用 D3D11 桌面捕获，尽量保持 GPU 内存路径，避免 BGRA 帧反复拷贝到 JavaScript/Node。编码使用 NVIDIA NVENC H.264：

- 低延迟 preset
- CBR 或接近 CBR 的稳定码率
- 关闭 B 帧
- GOP 默认 60，可切换 30
- 编码缓冲尽量控制到 0-1 帧
- 初始档位 1080p60 / 25 Mbps

Android TV 端使用 MediaCodec 解码 H.264，并渲染到 Surface。接收端队列目标是只保留极少量帧，过期帧直接丢弃，优先保证最新画面。

## 音频设计

声音是阶段 2 MVP 的必要验收项。PC 端采集系统声音，而不是麦克风：

- 采集方式：WASAPI loopback
- 采样率：48 kHz
- 声道：立体声
- 第一版码率：128-192 kbps
- 传输：跟视频同会话，但独立音频流

音频编码有两个候选：

- Opus：低延迟更好，适合游戏；Android 端可能需要额外解码库或更细的 MediaCodec 适配。
- AAC-LC：Android MediaCodec 支持更稳，工程风险低；延迟略高。

MVP 推荐先实现 AAC-LC 或可稳定落地的 Opus 路径，以“声音稳定出来、延迟可测”为第一目标。若 AAC-LC 体感延迟偏高，再切换到 Opus 低延迟实现。

Android TV 端用 AudioTrack 播放，使用低延迟模式和较小缓冲。音画同步第一版不追求电影级精确同步，而是以游戏手感为准：画面优先低延迟，音频延迟尽量贴近画面。接收端需要显示音频是否收到、音频缓冲长度和音频丢包/欠载次数。

## 输入设计

输入路径沿用当前已经验证过的 InputBridge 思路，但发送端从浏览器页面转移到 PC 原生发送端：

```text
Android TV App 输入事件
-> UDP/WebSocket 低延迟控制通道
-> PC 原生发送端
-> InputBridge / SendInput
-> Windows 游戏窗口
```

第一版继续支持键盘和鼠标。手柄输入按标准布局映射：

```text
axes: lx, ly, rx, ry
buttons: a, b, x, y, lb, rb, lt, rt, back, start, ls, rs, dpadUp, dpadDown, dpadLeft, dpadRight, home
```

手柄最终注入建议使用 ViGEm 或同类虚拟手柄驱动。阶段 2 可以先采集并回传手柄事件，若 ViGEm 集成风险较高，则把手柄注入列为阶段 2 后半段。

## 连接与发现

MVP 不做复杂发现协议。保留当前房间号和信令思路，Android TV App 支持：

- 手动输入 PC IP
- 默认房间 `game`
- 显示连接状态
- 显示发送端能力：分辨率、帧率、视频码率、音频状态

后续可以增加局域网 UDP 广播发现 PC。

## 性能指标

Android TV 接收端需要持续显示：

- 视频 FPS
- 当前视频码率估算
- 网络 RTT
- 视频解码耗时
- 视频丢帧数
- 音频是否收到
- 音频缓冲长度
- 音频欠载次数
- 输入回传 RTT

这些指标用于判断每一轮优化是否真的改善游戏手感。

## 发送端安装器与依赖收敛

阶段 2 必须开始解决“发送端依赖复杂、普通用户装不起来”的问题。原型期可以继续使用 Node、.NET、GStreamer 等工具链，但用户侧应逐步收敛成一个 Host 安装器。

推荐交付形态：

```text
TVGame-Host-Setup.exe
```

安装器需要检测并自动安装或提示：

- Node.js
- .NET 8 Runtime/SDK
- GStreamer 1.24.13 MSVC x86_64 runtime/devel，优先支持安装到 C 或 D 盘
- NVIDIA 驱动和 NVENC 可用性
- VC++ Runtime
- Android 调试环境：ADB，可选
- Windows 防火墙放行规则
- 输入桥运行权限

阶段 2 的依赖收敛分两步：

1. MVP 阶段：保留现有原型组件，但提供统一检测、下载、安装、环境变量配置和诊断日志。用户只运行一个安装入口。
2. 后续产品化：把 PC 发送端收敛成 `TVGame Host.exe`，减少 Node、Python、GStreamer 等外部依赖在用户环境中的存在感。

长期推荐架构：

```text
TVGame Host.exe
  C# 管理外壳 / 托盘 / 设置 UI
  Rust 或 C++ native core 负责捕获、编码、音频、网络
  InputBridge 能力内置或作为随 Host 安装的本地服务
```

GStreamer 仍可用于阶段 2 验证和过渡，但不应成为最终用户必须手动安装的长期依赖。

Android TV 端第一版可以提供 APK，让用户通过 U 盘或 ADB 安装。后续再做更友好的安装器。

## 阶段 2 验收

最小验收场景：

1. PC 启动发送端。
2. Android TV App 连接 PC。
3. 电视显示 1080p60 游戏画面。
4. 电视播放 PC 系统声音。
5. 电视端键鼠输入能控制 PC。
6. 接收端显示实时 FPS、RTT、解码耗时、丢帧和音频状态。
7. 体感明显优于当前浏览器方案。
8. 发送端提供统一依赖检测/安装入口，能明确报告缺失项和修复方式。

## 风险

- Android TV 厂商系统差异较大，MediaCodec 能力和低延迟表现不完全一致。
- Opus 在 Android 端的低延迟接入可能比 AAC-LC 更复杂。
- GStreamer Python 绑定在 Windows 上安装链路复杂，PC 发送端不应继续强依赖 Python GI。
- 完整手柄注入需要虚拟手柄驱动，安装和权限处理要单独设计。
- 如果发送端继续暴露过多开发期依赖，项目会难以被普通用户安装和复现。

## 推荐实施顺序

1. 建立 Android TV App 工程骨架，中文界面，能显示连接状态和性能面板。
2. 建立发送端统一依赖检测/安装入口，覆盖 GStreamer、.NET、NVENC、VC++ Runtime、PATH 和防火墙。
3. PC 原生发送端改为不依赖 Python GI 的实现路线。
4. 跑通 1080p60 H.264 视频到 Android MediaCodec。
5. 加入 WASAPI 系统声音采集和 Android AudioTrack 播放。
6. 接入键鼠输入回传和 InputBridge。
7. 加入码率档位、GOP 档位、音视频缓冲配置。
8. 做手柄映射和 ViGEm 注入。
9. 把发送端入口收敛为 `TVGame Host.exe` 或 `TVGame-Host-Setup.exe` 的第一版可验证形态。
