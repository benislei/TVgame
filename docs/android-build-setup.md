# Android TV APK 构建说明

本文说明如何在 Windows 上准备 Android TV 接收端 APK 的构建环境，并生成 Debug APK。

## 一键安装构建依赖

在项目根目录运行：

```powershell
npm.cmd run android:install
```

该命令会启动 PowerShell 安装脚本，准备 JDK 17、Android SDK 命令行工具、platform-tools、Android 35 平台包、build-tools 35.0.0，以及项目中的 Gradle Wrapper。

## 检查构建环境

安装完成后运行：

```powershell
npm.cmd run android:check
```

如果仍有缺失项，命令会用中文列出需要补齐的依赖。确认全部通过后再继续构建。

## 构建 Debug APK

运行：

```powershell
npm.cmd run android:build
```

该命令会先执行 Android 构建环境检查。依赖缺失时不会启动 Gradle；依赖齐全时会在 `android-tv-receiver` 目录调用：

```powershell
.\gradlew.bat :app:assembleDebug --no-daemon
```

构建成功后会输出 APK 路径。

## APK 路径

Debug APK 的预期路径为：

```text
android-tv-receiver\app\build\outputs\apk\debug\app-debug.apk
```

也可以运行下面的命令查看预期路径和当前文件是否存在：

```powershell
npm.cmd run android:apk
```

## 电视安装提示

可以把 `app-debug.apk` 复制到 Android TV，通过电视上的文件管理器安装。安装前请确认设备允许安装未知来源应用。

后续可以把电视连接到同一局域网，并通过 `adb install` 自动安装 APK，例如：

```powershell
adb install android-tv-receiver\app\build\outputs\apk\debug\app-debug.apk
```
