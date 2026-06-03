# Android 构建自动化设计

## 目标

让普通用户不必手动研究 Android Studio、JDK、Gradle 和 Android SDK，也能在 Windows 主机上完成 Android TV 接收端 APK 构建。阶段目标是把“检查、安装、构建、定位 APK”做成可重复的中文命令和 QuickVerify 菜单入口。

## 范围

本阶段只处理 Android 构建和打包链路，不修改 RTP 传输协议、音视频解码逻辑或 PC 输入 relay。成功标准是：

- `npm.cmd run android:check` 能用中文报告 JDK、Android SDK、sdkmanager、platform-tools、Android 35 platform、build-tools、Gradle Wrapper 和 APK 状态。
- `npm.cmd run android:install` 能自动安装或准备 JDK 17、Android command-line tools、Android SDK packages，并生成项目 Gradle Wrapper。
- `npm.cmd run android:build` 能调用 `android-tv-receiver\gradlew.bat :app:assembleDebug`，成功后输出 APK 路径。
- QuickVerify 提供中文菜单项，能检查 Android 构建环境、安装 Android 构建依赖、构建 Android TV APK。
- 文档给出本地验证步骤和常见失败原因。

## 方案选择

推荐方案是“Node CLI + PowerShell installer + Gradle Wrapper”。Node CLI 负责检测和构建，PowerShell 脚本负责下载和安装，Gradle Wrapper 固化 Gradle 版本，避免依赖用户 PATH 中的全局 Gradle。这个方案延续项目现有 `stage2:check`、`native:install`、QuickVerify 风格，用户只需要运行中文菜单或 npm 命令。

不采用“要求用户安装 Android Studio 后手动配置”的方案，因为它违背当前项目要服务更多普通用户的目标。不采用“把完整 Android SDK/JDK 打包进仓库”的方案，因为体积过大，也不利于版本更新。

## 组件

- `src/android-build/tooling.js`：检测 JDK、Android SDK、sdkmanager、adb、SDK packages、Gradle Wrapper、APK。
- `src/android-build/cli.js`：提供 `check`、`install`、`build`、`apk` 命令。
- `scripts/install-android-build-tools.ps1`：安装 JDK 17，下载 Android command-line tools，接受 SDK license，安装 `platform-tools`、`platforms;android-35`、`build-tools;35.0.0`，生成 Gradle Wrapper。
- `android-tv-receiver/gradle/wrapper/*` 与 `android-tv-receiver/gradlew.bat`：固定 Android 工程构建入口。
- `QuickVerify/Program.cs`：新增 Android 构建检查、安装、构建 APK 菜单项。
- `docs/android-build-setup.md`：中文说明安装和构建流程。

## 依赖版本

- JDK：17。Android Gradle Plugin 8.7.x 需要 JDK 17。
- Android command-line tools：从 Android Developers 官方下载页面使用 Windows command-line tools 包。
- Android SDK：compileSdk/targetSdk 35，对应 `platforms;android-35` 和 `build-tools;35.0.0`。
- Gradle Wrapper：8.10.2，兼容 Android Gradle Plugin 8.7.3。

## 错误处理

检查命令只报告，不修改系统。安装命令遇到缺失项时用中文说明正在安装什么；下载失败、权限不足、license 未接受、sdkmanager 失败时保留退出码。构建命令先运行检查，缺依赖时不盲目构建，并提示先运行 `npm.cmd run android:install`。

## 测试

Node 测试覆盖检测逻辑、命令输出、安装脚本关键步骤、Gradle Wrapper 文件存在、QuickVerify 菜单项和中文文案。真实 APK 构建在本机安装依赖后验证。

## 自检

本设计没有依赖占位项；范围限定为 Android 构建自动化；命令名称、文件路径和现有项目风格一致。
