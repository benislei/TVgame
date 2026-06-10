package com.tvgame.receiver;

import java.util.Locale;

public final class StatsModel {
    public volatile long videoPackets;
    public volatile long videoFrames;
    public volatile long videoRtpLossPackets;
    public volatile long videoRecoveryWaits;
    public volatile long videoRecoveryDrops;
    public volatile long videoReceiveBufferBytes;
    public volatile long videoQueueDrops;
    public volatile long videoDecoderDrops;
    public volatile long videoRestarts;
    public volatile String deviceLabel = "";
    public volatile String receiverAdvice = "";
    public volatile String videoDecoderName = "";
    public volatile long audioPackets;
    public volatile long audioBytes;
    public volatile long droppedFrames;
    public volatile long lastVideoAtMs;
    public volatile long lastAudioAtMs;
    public volatile String inputRelayHost = "";
    public volatile long inputPackets;
    public volatile long inputFailures;
    public volatile long lastInputAtMs;
    public volatile long gamepadEvents;
    public volatile long lastGamepadAtMs;
    public volatile int lastGamepadButtons;
    public volatile float lastGamepadLx;
    public volatile float lastGamepadLy;
    public volatile float lastGamepadLt;
    public volatile float lastGamepadRt;

    private long lastRealtimeAtMs = -1;
    private long lastRealtimeVideoFrames;
    private long lastRealtimeDroppedFrames;
    private long lastRealtimeQueueDrops;
    private long lastRealtimeDecoderDrops;
    private long lastRealtimeVideoRtpLossPackets;

    public String render() {
        return render(System.currentTimeMillis());
    }

    public String renderCompact() {
        return renderCompact(System.currentTimeMillis());
    }

    String render(long nowMs) {
        RealtimeStats realtime = takeRealtimeSnapshot(nowMs);
        return "视频包: " + videoPackets
            + "\n视频帧: " + videoFrames
            + "\n实时FPS: " + realtime.fps
            + "\n实时视频丢包: " + realtime.videoRtpLossPackets
            + "\n实时丢帧: " + realtime.droppedFrames
            + "\n实时丢帧率: " + formatDropRate(realtime.droppedFrames, realtime.videoFrames)
            + "\n实时队列丢帧: " + realtime.queueDrops
            + "\n实时解码丢帧: " + realtime.decoderDrops
            + "\n视频丢包: " + videoRtpLossPackets
            + "\n等待关键帧: " + videoRecoveryWaits
            + "\n恢复丢帧: " + videoRecoveryDrops
            + "\n接收缓冲: " + videoReceiveBufferBytes
            + "\n队列丢帧: " + videoQueueDrops
            + "\n解码丢帧: " + videoDecoderDrops
            + "\n视频重启: " + videoRestarts
            + "\n设备: " + safeText(deviceLabel)
            + "\n解码器: " + safeText(videoDecoderName)
            + "\n建议档: " + safeText(receiverAdvice)
            + "\n音频包: " + audioPackets
            + "\n音频字节: " + audioBytes
            + "\n输入目标: " + inputRelayHost
            + "\n输入发送: " + inputPackets
            + "\n输入失败: " + inputFailures
            + "\n手柄包: " + gamepadEvents
            + "\n手柄按钮: " + lastGamepadButtons
            + "\n丢帧: " + droppedFrames
            + "\n视频状态: " + statusText(lastVideoAtMs, nowMs)
            + "\n音频状态: " + statusText(lastAudioAtMs, nowMs)
            + "\n输入状态: " + statusText(lastInputAtMs, nowMs)
            + "\n手柄状态: " + statusText(lastGamepadAtMs, nowMs);
    }

    String renderCompact(long nowMs) {
        RealtimeStats realtime = takeRealtimeSnapshot(nowMs);
        return "FPS " + realtime.fps
            + " | 实时丢包 " + realtime.videoRtpLossPackets
            + " | 实时丢帧 " + realtime.droppedFrames
            + "（" + formatDropRate(realtime.droppedFrames, realtime.videoFrames) + "）"
            + "\n等待关键 " + videoRecoveryWaits
            + " | 恢复 " + videoRecoveryDrops
            + " | 队列 " + videoQueueDrops
            + " | 解码 " + videoDecoderDrops
            + " | 重启 " + videoRestarts
            + "\n视频 " + statusText(lastVideoAtMs, nowMs)
            + " | 包" + videoPackets
            + " / 帧 " + videoFrames
            + " | 丢包 " + videoRtpLossPackets
            + "\n音频 " + statusText(lastAudioAtMs, nowMs)
            + " | 包 " + audioPackets
            + " | " + formatBytes(audioBytes)
            + "\n设备 " + safeText(deviceLabel)
            + " | 解码器 " + safeText(videoDecoderName)
            + " | 建议 " + safeText(receiverAdvice)
            + "\n输入 " + inputRelayHost + " " + statusText(lastInputAtMs, nowMs)
            + " | 发" + inputPackets
            + " | 失败" + inputFailures
            + " | 手柄 " + statusText(lastGamepadAtMs, nowMs)
            + " | 包" + gamepadEvents
            + " | B" + lastGamepadButtons
            + " | L" + formatAxis(lastGamepadLx) + "," + formatAxis(lastGamepadLy)
            + " | T" + formatAxis(lastGamepadLt) + "," + formatAxis(lastGamepadRt);
    }

    public void recordGamepadState(float lx, float ly, float rx, float ry, float lt, float rt, int buttons, long nowMs) {
        gamepadEvents++;
        lastGamepadAtMs = nowMs;
        lastGamepadButtons = buttons;
        lastGamepadLx = lx;
        lastGamepadLy = ly;
        lastGamepadLt = lt;
        lastGamepadRt = rt;
    }

    private synchronized RealtimeStats takeRealtimeSnapshot(long nowMs) {
        if (lastRealtimeAtMs < 0 || nowMs <= lastRealtimeAtMs) {
            lastRealtimeAtMs = nowMs;
            lastRealtimeVideoFrames = videoFrames;
            lastRealtimeDroppedFrames = droppedFrames;
            lastRealtimeQueueDrops = videoQueueDrops;
            lastRealtimeDecoderDrops = videoDecoderDrops;
            lastRealtimeVideoRtpLossPackets = videoRtpLossPackets;
            return new RealtimeStats(0, 0, 0, 0, 0, 0);
        }

        long elapsedMs = nowMs - lastRealtimeAtMs;
        long frameDelta = Math.max(0, videoFrames - lastRealtimeVideoFrames);
        long droppedDelta = Math.max(0, droppedFrames - lastRealtimeDroppedFrames);
        long queueDelta = Math.max(0, videoQueueDrops - lastRealtimeQueueDrops);
        long decoderDelta = Math.max(0, videoDecoderDrops - lastRealtimeDecoderDrops);
        long videoRtpLossDelta = Math.max(0, videoRtpLossPackets - lastRealtimeVideoRtpLossPackets);

        lastRealtimeAtMs = nowMs;
        lastRealtimeVideoFrames = videoFrames;
        lastRealtimeDroppedFrames = droppedFrames;
        lastRealtimeQueueDrops = videoQueueDrops;
        lastRealtimeDecoderDrops = videoDecoderDrops;
        lastRealtimeVideoRtpLossPackets = videoRtpLossPackets;

        long fps = Math.round((frameDelta * 1000.0) / elapsedMs);
        return new RealtimeStats(frameDelta, fps, droppedDelta, queueDelta, decoderDelta, videoRtpLossDelta);
    }

    private static String formatDropRate(long droppedFrames, long videoFrames) {
        long totalFrames = droppedFrames + videoFrames;
        if (totalFrames <= 0) {
            return "0.0%";
        }
        return String.format(Locale.US, "%.1f%%", (droppedFrames * 100.0) / totalFrames);
    }

    private static String formatBytes(long bytes) {
        if (bytes < 1024 * 1024) {
            return bytes + "B";
        }
        return String.format(Locale.US, "%.1fMB", bytes / (1024.0 * 1024.0));
    }

    private static String formatAxis(float value) {
        return String.format(Locale.US, "%.2f", value);
    }

    private static String safeText(String text) {
        if (text == null || text.trim().length() == 0) {
            return "未知";
        }
        return text.trim();
    }

    private static String statusText(long timestampMs, long nowMs) {
        if (timestampMs <= 0) {
            return "未收到";
        }

        long ageMs = nowMs - timestampMs;
        if (ageMs <= 1000) {
            return "正常";
        }

        return "超过 " + ageMs + "ms 未更新";
    }

    private static final class RealtimeStats {
        private final long videoFrames;
        private final long fps;
        private final long droppedFrames;
        private final long queueDrops;
        private final long decoderDrops;
        private final long videoRtpLossPackets;

        private RealtimeStats(long videoFrames, long fps, long droppedFrames, long queueDrops, long decoderDrops, long videoRtpLossPackets) {
            this.videoFrames = videoFrames;
            this.fps = fps;
            this.droppedFrames = droppedFrames;
            this.queueDrops = queueDrops;
            this.decoderDrops = decoderDrops;
            this.videoRtpLossPackets = videoRtpLossPackets;
        }
    }
}
