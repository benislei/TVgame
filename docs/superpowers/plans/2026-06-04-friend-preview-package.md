# Friend Preview Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a friend-ready preview package with clearer Android TV realtime metrics, overlay hide/show controls, and Windows launch helpers.

**Architecture:** Keep the current low-latency RTP path unchanged. Add per-second metric snapshots inside `StatsModel`, toggle the overlay from `MainActivity`, and create a Node release-packaging CLI that copies the APK plus source/runtime scripts into a zip-friendly preview folder.

**Tech Stack:** Java Android app, Node.js test/CLI tooling, PowerShell `Compress-Archive`, Windows batch launchers, Git.

---

### Task 1: Android Overlay Metrics And Hide Control

**Files:**
- Modify: `test/android-tv-receiver.test.js`
- Modify: `android-tv-receiver/app/src/main/java/com/tvgame/receiver/StatsModel.java`
- Modify: `android-tv-receiver/app/src/main/java/com/tvgame/receiver/MainActivity.java`

- [ ] Write tests requiring `实时FPS`, `实时丢帧`, `实时丢帧率`, `实时队列丢帧`, `实时解码丢帧`, plus `KEYCODE_MENU` and `KEYCODE_F1` overlay toggling.
- [ ] Run `npm.cmd test -- test\android-tv-receiver.test.js` and confirm the new checks fail.
- [ ] Implement `StatsModel` rolling snapshot rendering and `MainActivity` overlay visibility toggle.
- [ ] Re-run `npm.cmd test -- test\android-tv-receiver.test.js` and confirm it passes.

### Task 2: Friend Preview Packaging CLI

**Files:**
- Create: `src/release-package/tooling.js`
- Create: `src/release-package/cli.js`
- Create: `test/release-package.test.js`
- Modify: `package.json`
- Modify: `docs/stage2-local-verify.md`

- [ ] Write tests requiring a Chinese package report, APK copy path, launcher batch files, and `npm.cmd run package:friend`.
- [ ] Run `npm.cmd test -- test\release-package.test.js` and confirm the new checks fail.
- [ ] Implement package helpers and CLI. The package must contain `TVGameReceiver.apk`, `README-朋友试用.md`, `启动输入桥.bat`, `启动默认发送.bat`, `启动高画质发送.bat`, `检查环境.bat`, and an `app` folder with the project files needed by the launchers.
- [ ] Re-run `npm.cmd test -- test\release-package.test.js` and confirm it passes.

### Task 3: Verify, Build, Package, Commit

**Files:**
- All changed files from Task 1 and Task 2

- [ ] Run `npm.cmd test`.
- [ ] Run `npm.cmd run android:build`.
- [ ] Run `npm.cmd run package:friend`.
- [ ] Run `git diff --check`.
- [ ] Commit with message `Add friend preview package`.
- [ ] Push `main` to GitHub.
