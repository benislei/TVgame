# 阶段 2 本地验证指南

## 目标

验证 PC 端原生 GStreamer RTP 发送链路与 Android TV 原生接收端可以配合使用。Task 5 后，Android TV 接收端会监听视频 UDP 5004 和音频 UDP 5006：视频 H.264 RTP 会送入 MediaCodec，音频 L16 PCM RTP 会转换为 Android 需要的小端 PCM 并交给 AudioTrack 播放。

## PC 端准备

在项目根目录运行依赖检查：

```powershell
npm.cmd run stage2:check
```

确认 GStreamer、RTP 视频插件、RTP 音频插件和 dotnet 状态通过后，启动 RTP 发送端：

```powershell
npm.cmd run native:rtp -- --host <Android TV IP>
```

## Android TV 端准备

构建并安装 `android-tv-receiver` 生成的 APK，启动应用“电视游戏接收端”。首屏应显示全屏画面层和左上角半透明中文状态面板。

默认端口规划：

- 视频 RTP：UDP 5004
- 音频 RTP：UDP 5006
- 输入回传：TCP 8789

Task 5 后，启动 PC 端 RTP 发送时，左上角指标中的视频包、音频包、音频字节和最近接收状态预计会增长或变为正常。若 Android TV 设备、编码参数和网络环境匹配，有机会显示视频画面并播放声音；这一点仍需要在真实 Android TV 或等效设备上验证。

## 输入回传

Android TV 第一版会把遥控器和键盘按键事件发送到 PC 端 TCP 8789。发送内容是一行 UTF-8 JSON，字段包含 `type=input`、`kind=keyboard`、`action=down/up` 和 Android `keyCode`。

当前 Android TV App 的 PC 输入 relay 默认地址是 `192.168.1.178:8789`。如需调整 PC IP，可以修改 `AndroidManifest.xml` 中的 `com.tvgame.receiver.INPUT_RELAY_HOST` metadata；端口当前固定为 TCP 8789。

PC 端还需要 relay 接入 InputBridge/SendInput，才能把这些 JSON 按键事件转换为 Windows 输入。relay 未实现不影响视频和声音验证；它只影响“输入回传到达 PC relay”这一项验收。

## Android 构建工具记录

本地已尝试在 `android-tv-receiver` 目录运行：

```powershell
gradle :app:assembleDebug
```

当前环境失败原因：PowerShell 报告 `gradle` 不是可识别的 cmdlet、函数、脚本文件或可运行程序，说明本机 PATH 中没有可用的 Gradle 命令。项目目录中也没有 Gradle Wrapper，因此本轮无法继续验证 Android APK 构建。安装 Gradle 或补充 `gradlew` 后，应重新运行 `gradle :app:assembleDebug` 或等价 wrapper 命令。

## 验收记录

- [ ] App 启动中文状态面板。
- [ ] `stage2:check` 通过。
- [ ] `native:rtp` 启动视频音频发送。
- [ ] 电视视频包计数增长。
- [ ] 音频包计数增长。
- [ ] 播放 PC 系统声音。
- [ ] 输入回传到达 PC relay。

## 验收清单

- [ ] Android TV 应用可以从 Leanback 启动器打开。
- [ ] 应用 label 显示为“电视游戏接收端”。
- [ ] 首屏显示“等待视频和音频”。
- [ ] 状态面板包含视频包、视频帧、音频包、音频字节、丢帧、视频状态、音频状态。
- [ ] 未收到数据时，视频状态和音频状态显示“未收到”。
- [ ] 运行 `npm.cmd run stage2:check` 可以看到 PC 端阶段 2 依赖检查结果。
- [ ] 运行 `npm.cmd run native:rtp -- --host <Android TV IP>` 后，PC 端启动视频和音频 RTP 发送进程。
- [ ] Android TV 接收端视频 UDP 5004 和音频 UDP 5006 指标会随数据包增长。
- [ ] 在真实 Android TV 上确认 MediaCodec 有机会显示 H.264 画面，AudioTrack 有机会播放 L16 音频。
- [ ] Android TV 按键事件通过 TCP 8789 回传到 PC 端 relay。
