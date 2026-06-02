# 阶段 2 本地验证指南

## 目标

验证 PC 端原生 GStreamer RTP 发送链路与 Android TV 原生接收端骨架可以配合使用，为后续视频解码、音频播放和输入回传接入打基础。当前接收端先提供全屏画面层和中文指标面板，用于确认应用启动、端口规划和运行状态展示。

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

构建并安装 `android-tv-receiver` 生成的 APK，启动应用“电视游戏接收端”。首屏应显示全屏黑色画面层和左上角半透明中文状态面板。

默认端口规划：

- 视频 RTP：UDP 5004
- 音频 RTP：UDP 5006
- 输入回传：TCP 8789

## 验收清单

- [ ] Android TV 应用可以从 Leanback 启动器打开。
- [ ] 应用 label 显示为“电视游戏接收端”。
- [ ] 首屏显示“等待视频和音频”。
- [ ] 状态面板包含视频包、视频帧、音频包、音频字节、丢帧、视频状态、音频状态。
- [ ] 未收到数据时，视频状态和音频状态显示“未收到”。
- [ ] 运行 `npm.cmd run stage2:check` 可以看到 PC 端 Stage 2 依赖检查结果。
- [ ] 运行 `npm.cmd run native:rtp -- --host <Android TV IP>` 后，PC 端启动视频和音频 RTP 发送进程。
- [ ] 后续接收逻辑接入后，视频 UDP 5004 和音频 UDP 5006 的指标会随数据包增长。
- [ ] 后续输入回传接入后，Android TV 按键事件会通过 TCP 8789 回传到 PC。
