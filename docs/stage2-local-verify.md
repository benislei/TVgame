# 阶段 2 本地验证指南

## 目标

验证 PC 端原生 GStreamer RTP 发送链路与 Android TV 原生接收端可以配合使用。当前链路监听视频 UDP 5004 和音频 UDP 5006：视频 H.264 RTP 送入 MediaCodec，音频 L16 PCM RTP 转换为 Android 需要的小端 PCM 并交给 AudioTrack 播放。

## Android 版本基线

当前接收端以 Android 11+（API 30+）作为最低运行版本，目标是优先把画质、帧率、声音和输入延迟做到适合游戏。Android 9/10 暂不作为当前优化目标，Android 6/7/8 不再作为阶段 2 的兼容目标。

低版本电视后续可以通过独立电视盒子或硬件接收端路线解决，不拖慢当前 Android 11+ 极致体验路线。

## PC 端准备

在项目根目录运行依赖检查：

```powershell
npm.cmd run stage2:check
```

确认 GStreamer、RTP 视频插件、RTP 音频插件和 dotnet 状态通过后，启动 InputBridge：

```powershell
dotnet run --project InputBridge\InputBridge.csproj
```

保持这个窗口打开。若游戏以管理员权限运行，InputBridge 也建议用管理员 PowerShell 启动。

## Android TV 端准备

构建并安装 `android-tv-receiver` 生成的 APK，启动应用“电视游戏接收端”。首屏应显示全屏画面层和左上角半透明中文状态面板，并包含“接收端档位：Android 11+ 极致模式”。接收端 App 打开期间会保持屏幕常亮，避免电视或盒子自动休眠后黑屏。

默认端口规划：

- 视频 RTP：UDP 5004
- 音频 RTP：UDP 5006
- 输入回传：TCP 8789

## 启动发送端

默认发送档位已经按当前实测最佳体验调整为 `resilient1080`：1080p、22Mbps、60fps、GOP5、低延迟 CBR HQ、每个 IDR 携带参数集，并增大发送端 UDP 缓冲。优先用默认游戏档验证 1080p 底线画质、抗花屏和手感：

```powershell
npm.cmd run native:rtp -- --host <Android TV IP>
```

如果快速运动仍然偶发花屏，先切到 720p 回退档确认是否由码流压力触发：

```powershell
npm.cmd run native:rtp -- --host <Android TV IP> --profile game720
```

如果默认档稳定，可以再测 `quality1080`：1080p、30Mbps、60fps、GOP10。这个档位保留短关键帧恢复，同时给画质更多码率：

```powershell
npm.cmd run native:rtp -- --host <Android TV IP> --profile quality1080
```

`resilient1080` 仍然可以显式指定，方便确认当前使用的是抗花屏档：

```powershell
npm.cmd run native:rtp -- --host <Android TV IP> --profile resilient1080
```

如果想和旧默认低延迟参数做 A/B 对比，可以测试 `game1080` 实验档：1080p、24Mbps、60fps、GOP10。这个档位可能更激进，但在你和朋友的当前测试里，综合体验不如默认抗花屏档：

```powershell
npm.cmd run native:rtp -- --host <Android TV IP> --profile game1080
```

`game4k` 是后续 4K60/HEVC 路线的能力档位，当前 H.264 接收端不会直接启用它；如果运行 `--profile game4k`，发送端会提示需要 HEVC 接收端支持。

发送端默认使用 `--encoder-preset auto`，会按游戏体验优先顺序自动尝试 `low-latency-hq`、`low-latency-hp`、`low-latency`、`hp`、`default`、`hq`。如果前面的低延迟 preset 不被当前显卡、驱动或 GStreamer 支持，会自动回退到后面的兼容档。

如果发送端提示 `Selected preset not supported` 或 `Could not configure supporting library`，通常是当前显卡/驱动不支持某个 NVENC preset。新版启动脚本会自动回退；如果需要手动排查，可以直接指定兼容 preset：

```powershell
npm.cmd run native:rtp -- --host <Android TV IP> --encoder-preset default
```

朋友试用包里的 `.bat` 已默认使用 `--encoder-preset auto`，稳定后也可以手动尝试固定 `--encoder-preset low-latency-hq` 或 `--encoder-preset default` 对比体感。

启动后，电视左上角会显示紧凑状态面板，音视频状态应变为“正常”。面板保留“FPS”“实时丢包”“实时丢帧”“等待关键”“恢复”“队列”“解码”和音视频状态：如果花屏时实时丢包、恢复和等待关键同步增长，说明短暂 RTP 丢包后的关键帧恢复仍在影响体感；如果主要是队列或解码丢帧增长，说明瓶颈更偏接收端解码或渲染。当前低延迟版本只保留最新 1 帧待解码画面，优先压低操作到画面变化的体感延迟。菜单键或 F1 可以隐藏或显示状态面板。

## 输入回传

Android TV App 会把遥控器、键盘和 USB 手柄事件发送到 PC 端 TCP 8789。发送内容是一行 UTF-8 JSON，字段包含 `type=input`、`kind=keyboard`、`action=down/up`，以及 Android `keyCode` 或浏览器风格 `code`。

PC 端需要启动 InputBridge/SendInput，才能把这些 JSON 输入事件转换为 Windows 输入。当前 APK 的 PC 输入 relay 地址来自构建时的 `inputRelayHost` 配置；回家测试前请确认它等于 PC 当前局域网 IP。

Android TV 输入客户端会复用一个持久 TCP 连接，并开启 `TCP_NODELAY`，避免每次按键都重新建连或被 Nagle 算法合并等待。若 InputBridge 重启，下一次输入事件会自动重连。

USB 手柄会被接收端 App 消费，不再继续交给电视系统处理，避免手柄操作电视 UI。当前映射：左摇杆和 D-pad 映射 WASD；右摇杆映射鼠标移动；R1/右扳机映射鼠标左键；L1/左扳机映射鼠标右键；A/确认映射 Space，B 映射 Escape，X 映射 E，Y 映射 Q，START 映射 Enter，SELECT 映射 Tab。

键盘和遥控器按键仍会保留 Android 系统默认处理结果，因此不会吞掉系统 BACK/HOME 行为。BACK 也可能被发给 PC relay，后续 relay 可以按需要过滤。

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

试用包内包含 `TVGameReceiver.apk`、`README-朋友试用.md`、`安装npm依赖.bat`、`安装GStreamer依赖.bat`、`检查环境.bat`、`启动输入桥.bat`、`启动默认发送.bat`、`启动高画质发送.bat`、`启动抗花屏发送.bat`、`启动低延迟实验发送.bat` 和 `启动720回退发送.bat`。朋友优先使用 `启动默认发送.bat` 验证 1080p60 基础手感；默认档已经等同抗花屏推荐档。想对比旧低延迟参数时再用 `启动低延迟实验发送.bat`；如果出现花屏或明显卡顿，用 720 回退档判断是否是接收端或网络压力。

## 验收记录

- [ ] App 启动中文状态面板。
- [ ] 状态面板显示 Android 11+ 极致模式。
- [ ] `stage2:check` 通过。
- [ ] InputBridge 启动并监听 TCP 8789。
- [ ] `native:rtp` 启动视频音频发送。
- [ ] 电视视频包计数增长。
- [ ] 视频丢包计数保持较低。
- [ ] 花屏后“等待关键帧”短暂增长，随后画面恢复。
- [ ] 卡顿时记录“视频丢包 / 恢复丢帧 / 队列丢帧 / 解码丢帧”哪一个增长最明显。
- [ ] 音频包计数增长。
- [ ] 播放 PC 系统声音。
- [ ] USB 手柄输入回传到达 PC relay。

## 验收清单

- [ ] Android TV 应用可以从 Leanback 启动器打开。
- [ ] 应用 label 显示为“电视游戏接收端”。
- [ ] 首屏显示“等待视频和音频”。
- [ ] 紧凑状态面板包含 FPS、实时丢包、实时丢帧、等待关键、恢复、队列、解码、视频状态和音频状态，并且不会遮挡大面积游戏画面。
- [ ] 菜单键或 F1 可以隐藏或显示状态面板。
- [ ] 未收到数据时，视频状态和音频状态显示“未收到”。
- [ ] 运行 `npm.cmd run stage2:check` 可以看到 PC 端阶段 2 依赖检查结果。
- [ ] 运行 `npm.cmd run native:rtp -- --host <Android TV IP>` 后，PC 端启动视频和音频 RTP 发送进程。
- [ ] Android TV 接收端视频 UDP 5004 和音频 UDP 5006 指标会随数据包增长。
- [ ] 在真实 Android 11+ TV 上确认 MediaCodec 显示 H.264 画面，AudioTrack 播放 L16 音频。
- [ ] Android TV 按键和 USB 手柄事件通过 TCP 8789 回传到 PC 端 relay。
