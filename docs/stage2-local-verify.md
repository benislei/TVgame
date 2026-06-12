# 阶段 2 本地验证指南

## 目标

验证 PC 端原生 GStreamer RTP 发送链路与 Android TV 原生接收端可以配合使用。当前链路监听视频 UDP 5004 和音频 UDP 5006：视频 H.264 RTP 送入 MediaCodec，音频 L16 PCM RTP 转换为 Android 需要的小端 PCM 并交给 AudioTrack 播放。

## Android 版本基线

当前接收端以 Android 11+（API 30+）作为最低运行版本，目标是优先把画质、帧率、声音和输入延迟做到适合游戏。Android 9/10 暂不作为当前优化目标，Android 6/7/8 不再作为阶段 2 的兼容目标。

低版本电视后续可以通过独立电视盒子或硬件接收端路线解决，不拖慢当前 Android 11+ 极致体验路线。

## PC 端准备

Node.js/npm 是发送端基础运行时依赖。朋友试用包用户优先运行 `检查环境.bat`：它会先检查 Node.js/npm、npm 依赖、GStreamer、编码器插件、音频捕获和输入桥运行时；如果发现缺失，会先说明原因和处理方案，再询问是否一键处理。用户确认后脚本会自动安装/更新对应依赖，不需要一个个手动运行安装脚本。

源码开发环境可在项目根目录运行同样的环境医生：

```powershell
npm.cmd run stage2:doctor
```

确认 GStreamer、RTP 视频插件、RTP 音频插件和编码能力通过后，启动 InputBridge。朋友试用包直接运行 `启动输入桥.bat`，它会使用包内 `InputBridgeRuntime\InputBridge.exe`，朋友电脑不需要安装 .NET SDK。源码开发环境可使用：

编码器兼容性：NVIDIA 显卡优先使用 `nvh264enc`，AMD 显卡优先使用 `amfh264enc`，通用 Windows 兜底使用 `mfh264enc`。如果 A 卡机器提示缺 `nvh264enc`，这本身不是问题；只要 H.264 编码能力显示通过，并标出 `amfh264enc` 或 `mfh264enc`，就可以继续验证。

```powershell
dotnet run --project InputBridge\InputBridge.csproj
```

保持这个窗口打开。若游戏以管理员权限运行，InputBridge 也建议用管理员 PowerShell 启动。

如果要测试电视端 USB 手柄控制 PC 游戏，请先安装 ViGEmBus 虚拟 Xbox 手柄驱动。朋友试用包里可以直接运行 `安装ViGEmBus手柄驱动.bat`；在项目目录也可以运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\install-vigembus.ps1
```

安装完成后重新启动 InputBridge，正常情况下会看到“虚拟 Xbox 手柄已连接”。游戏里请选择 Xbox 手柄或控制器输入。

## Android TV 端准备

构建并安装 `android-tv-receiver` 生成的 APK，启动应用“电视游戏接收端”。首屏应显示全屏画面层和左上角半透明中文状态面板，并包含“接收端档位：Android 11+ 极致模式”。接收端 App 打开期间会保持屏幕常亮，避免电视或盒子自动休眠后黑屏。

默认端口规划：

- 视频 RTP：UDP 5004
- 音频 RTP：UDP 5006
- 输入回传：TCP 8789

## 启动发送端

当前实测推荐优先使用 `hevc1080p30`：1080p、7Mbps、30fps、GOP5、低延迟 CBR HQ。它在小米盒子 5 Max 和手机接收端测试里清晰度、流畅度和延迟综合最好。命令行手动验证时请显式带上档位：

```powershell
npm.cmd run native:rtp -- --host <Android TV IP> --profile hevc1080p30
```

大型游戏优先使用性能保护参数，它会把发送端 GStreamer 进程提升到 High 优先级，避免游戏吃满 GPU、显存或内存时把捕获、编码和发送挤掉：

```powershell
npm.cmd run native:rtp -- --host <Android TV IP> --profile hevc1080p30 --process-priority high
```

如果接收端 FPS 明显低于电脑端游戏 FPS，先在游戏内设置 FPS 上限，建议从 60 FPS 开始；仍然卡顿时再试 45 或 30 FPS。串流场景里要给发送端留下 10% 到 20% 的 GPU/显存余量，稳定帧时间通常比电脑端单机 FPS 更重要。朋友包里的 `启动发送端-选择画质.bat` 会给每个画质档位显示建议的游戏 FPS 上限，并且所有档位都会带上发送进程 High 优先级；脚本只提示建议值，不会自动修改游戏设置。

如果接收端 H.265 硬解稳定，并且想继续尝试更高帧率，可以测试 `hevc1080p60`：

```powershell
npm.cmd run native:rtp -- --host <Android TV IP> --profile hevc1080p60
```

如果 HEVC 在某台电视或盒子上表现不稳定，按下面 H.264 梯度回退：

```powershell
npm.cmd run native:rtp -- --host <Android TV IP> --profile h2641080p60
npm.cmd run native:rtp -- --host <Android TV IP> --profile h2641080p30
npm.cmd run native:rtp -- --host <Android TV IP> --profile h264720p60
npm.cmd run native:rtp -- --host <Android TV IP> --profile h264720p30
```

`resilient1080` 仍然可以显式指定，方便和前一版抗花屏 H.264 推荐档做 A/B 对比：

```powershell
npm.cmd run native:rtp -- --host <Android TV IP> --profile resilient1080
```

如果想和旧默认低延迟参数做 A/B 对比，可以测试 `game1080` 实验档：1080p、24Mbps、60fps、GOP10。这个档位可能更激进，但在你和朋友的当前测试里，综合体验不如 HEVC 推荐档：

```powershell
npm.cmd run native:rtp -- --host <Android TV IP> --profile game1080
```

`game4k` 仍然是后续 4K60 路线的能力档位，当前先保留为能力检测和路线预留，不作为朋友包默认入口。

发送端默认使用 `--encoder auto --encoder-preset auto`。编码器会按 `nvh264enc`、`amfh264enc`、`mfh264enc` 自动选择；N 卡的 preset 会按游戏体验优先顺序自动尝试 `low-latency-hq`、`low-latency-hp`、`low-latency`、`hp`、`default`、`hq`。如果前面的低延迟 preset 不被当前显卡、驱动或 GStreamer 支持，会自动回退到后面的兼容档。

如果发送端提示 `Selected preset not supported` 或 `Could not configure supporting library`，通常是当前显卡/驱动不支持某个 NVENC preset。新版启动脚本会自动回退；如果需要手动排查，可以直接指定兼容 preset：

```powershell
npm.cmd run native:rtp -- --host <Android TV IP> --encoder-preset default
```

朋友试用包里的 `.bat` 已默认使用 `--encoder auto --encoder-preset auto`，稳定后也可以手动尝试固定 `--encoder-preset low-latency-hq`、`--encoder-preset default`，或用 `--encoder amf` / `--encoder mf` 对比兼容性和体感。

启动后，电视左上角会显示紧凑状态面板，音视频状态应变为“正常”。面板保留“FPS”“实时丢包”“实时丢帧”“等待关键”“恢复”“队列”“解码”、音视频状态和输入诊断：如果花屏时实时丢包、恢复和等待关键同步增长，说明短暂 RTP 丢包后的关键帧恢复仍在影响体感；如果主要是队列或解码丢帧增长，说明瓶颈更偏接收端解码或渲染。当前低延迟版本只保留最新 1 帧待解码画面，优先压低操作到画面变化的体感延迟。菜单键或 F1 可以隐藏或显示状态面板。

## 输入回传

Android TV App 会把遥控器、键盘和 USB 手柄事件发送到 PC 端 TCP 8789。发送内容是一行 UTF-8 JSON，键盘字段包含 `type=input`、`kind=keyboard`、`action=down/up`，以及 Android `keyCode` 或浏览器风格 `code`；手柄字段包含 `kind=gamepad`、摇杆、扳机和按钮位图。

PC 端需要启动 InputBridge，才能把这些 JSON 输入事件转换为 Windows 输入。键盘和鼠标仍使用 SendInput；USB 手柄会通过 ViGEmBus 虚拟 Xbox 手柄注入，让支持手柄的 PC 游戏直接识别为 Xbox 控制器。当前 APK 默认会从第一批视频 RTP 包自动识别 PC 输入 relay 地址；只有需要固定电脑 IP 时，才通过构建时的 `inputRelayHost` 配置覆盖。

Android TV 输入客户端会复用一个持久 TCP 连接，并开启 `TCP_NODELAY`，避免每次按键都重新建连或被 Nagle 算法合并等待。若 InputBridge 重启，下一次输入事件会自动重连。

USB 手柄会被接收端 App 消费，不再继续交给电视系统处理，避免手柄操作电视 UI。接收端会回传原始手柄状态，PC 端 InputBridge 通过 ViGEmBus 虚拟 Xbox 手柄注入，不再把手柄强行转换成 WASD 或鼠标。电视系统保留的 HOME 等系统键可能仍无法被 App 截获，这是 Android TV 的系统级限制。

键盘和遥控器按键仍会保留 Android 系统默认处理结果，因此不会吞掉系统 BACK/HOME 行为。BACK 也可能被发给 PC relay，后续 relay 可以按需要过滤。

手柄链路按三段判断：

1. 如果 Steam 提示连接 Xbox 控制器，说明 PC 端 ViGEm 虚拟手柄已经启动。
2. 如果电视面板里的“手柄 包”随手柄按键或摇杆增长，说明 Android 接收端已经截获手柄事件；如果不增长，通常是电视系统或当前焦点仍在吃掉手柄事件。
3. 如果“输入 发”增长且 InputBridge 窗口打印“收到手柄状态”，说明电视到 PC 的 TCP 回传已经到达；如果“输入失败”增长，优先检查接收端面板里的“输入目标”是否已经自动识别为电脑 IP、Windows 防火墙和 InputBridge 是否仍在运行。

如果以上三段都正常，但游戏仍不能操作，先在游戏或 Steam 中选择 Xbox 手柄/控制器输入，并尝试重启游戏；部分游戏只在启动时扫描控制器。

## Android 构建工具记录

Android TV 接收端 APK 构建通过项目脚本统一执行。首次准备环境时，在项目根目录运行：

```powershell
npm.cmd run android:install
```

安装完成后检查 JDK、Android SDK、SDK 包和 Gradle Wrapper：

```powershell
npm.cmd run android:check
```

确认检查通过后构建 Debug APK：

```powershell
npm.cmd run android:build
```

构建成功后 APK 位于：

```text
android-tv-receiver\app\build\outputs\apk\debug\app-debug.apk
```

也可以运行 `npm.cmd run android:apk` 查看预期 APK 路径和文件是否存在。更完整的说明见 `docs/android-build-setup.md`。

## 朋友试用包

当本机已经成功构建 Android TV APK 后，可以在项目根目录生成朋友试用包：

```powershell
npm.cmd run package:friend
```

生成结果位于：

```text
dist\TVGame-Friend-Preview\
dist\TVGame-Friend-Preview.zip
```

试用包内包含 `TVGameReceiver.apk`、`README-朋友试用.md`、`InputBridgeRuntime`、`安装npm依赖.bat`、`安装GStreamer依赖.bat`、`安装ViGEmBus手柄驱动.bat`、`检查环境.bat`、`启动输入桥.bat`、`启动推荐发送.bat`、`启动性能保护发送.bat` 和 `启动发送端-选择画质.bat`。朋友优先运行 `检查环境.bat`，按提示确认一键处理缺失依赖；确认环境通过后，再使用 `启动推荐发送.bat` 或 `启动性能保护发送.bat` 验证 HEVC 1080P30 基础手感。如果接收设备足够强，或需要排查设备性能，再用 `启动发送端-选择画质.bat` 在性能保护推荐、HEVC 1080P60、1080P60、1080P30、720P60 和 720P30 之间切换。选择器里的每个档位都会开启发送端 High 优先级，并在启动前提示对应的游戏 FPS 上限建议。

## 验收记录

- [ ] App 启动中文状态面板。
- [ ] 状态面板显示 Android 11+ 极致模式。
- [ ] `检查环境.bat` 或 `npm.cmd run stage2:doctor` 通过。
- [ ] InputBridge 启动并监听 TCP 8789。
- [ ] `native:rtp` 启动视频音频发送。
- [ ] 电视视频包计数增长。
- [ ] 视频丢包计数保持较低。
- [ ] 花屏后“等待关键帧”短暂增长，随后画面恢复。
- [ ] 卡顿时记录“视频丢包 / 恢复丢帧 / 队列丢帧 / 解码丢帧”哪一个增长最明显。
- [ ] 音频包计数增长。
- [ ] 播放 PC 系统声音。
- [ ] USB 手柄输入回传到达 PC relay，面板“手柄 包”和“输入 发”会增长。

## 验收清单

- [ ] Android TV 应用可以从 Leanback 启动器打开。
- [ ] 应用 label 显示为“电视游戏接收端”。
- [ ] 首屏显示“等待视频和音频”。
- [ ] 紧凑状态面板包含 FPS、实时丢包、实时丢帧、等待关键、恢复、队列、解码、视频状态和音频状态，并且不会遮挡大面积游戏画面。
- [ ] 菜单键或 F1 可以隐藏或显示状态面板。
- [ ] 未收到数据时，视频状态和音频状态显示“未收到”。
- [ ] 运行 `npm.cmd run stage2:doctor` 可以看到 PC 端阶段 2 依赖检查结果和确认式一键处理方案。
- [ ] 运行 `npm.cmd run native:rtp -- --host <Android TV IP>` 后，PC 端启动视频和音频 RTP 发送进程。
- [ ] Android TV 接收端视频 UDP 5004 和音频 UDP 5006 指标会随数据包增长。
- [ ] 在真实 Android 11+ TV 上确认 MediaCodec 显示 H.264 画面，AudioTrack 播放 L16 音频。
- [ ] Android TV 按键和 USB 手柄事件通过 TCP 8789 回传到 PC 端 relay。
