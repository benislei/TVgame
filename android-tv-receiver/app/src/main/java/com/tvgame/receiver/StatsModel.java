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
    public volatile long audioPackets;
    public volatile long audioBytes;
    public volatile long droppedFrames;
    public volatile long lastVideoAtMs;
    public volatile long lastAudioAtMs;

    private long lastRealtimeAtMs = -1;
    private long lastRealtimeVideoFrames;
    private long lastRealtimeDroppedFrames;
    private long lastRealtimeQueueDrops;
    private long lastRealtimeDecoderDrops;

    public String render() {
        return render(System.currentTimeMillis());
    }

    String render(long nowMs) {
        RealtimeStats realtime = takeRealtimeSnapshot(nowMs);
        return "视频包: " + videoPackets
            + "\n视频帧: " + videoFrames
            + "\n实时FPS: " + realtime.fps
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
            + "\n音频包: " + audioPackets
            + "\n音频字节: " + audioBytes
            + "\n丢帧: " + droppedFrames
            + "\n视频状态: " + statusText(lastVideoAtMs, nowMs)
            + "\n音频状态: " + statusText(lastAudioAtMs, nowMs);
    }

    private synchronized RealtimeStats takeRealtimeSnapshot(long nowMs) {
        if (lastRealtimeAtMs < 0 || nowMs <= lastRealtimeAtMs) {
            lastRealtimeAtMs = nowMs;
            lastRealtimeVideoFrames = videoFrames;
            lastRealtimeDroppedFrames = droppedFrames;
            lastRealtimeQueueDrops = videoQueueDrops;
            lastRealtimeDecoderDrops = videoDecoderDrops;
            return new RealtimeStats(0, 0, 0, 0, 0);
        }

        long elapsedMs = nowMs - lastRealtimeAtMs;
        long frameDelta = Math.max(0, videoFrames - lastRealtimeVideoFrames);
        long droppedDelta = Math.max(0, droppedFrames - lastRealtimeDroppedFrames);
        long queueDelta = Math.max(0, videoQueueDrops - lastRealtimeQueueDrops);
        long decoderDelta = Math.max(0, videoDecoderDrops - lastRealtimeDecoderDrops);

        lastRealtimeAtMs = nowMs;
        lastRealtimeVideoFrames = videoFrames;
        lastRealtimeDroppedFrames = droppedFrames;
        lastRealtimeQueueDrops = videoQueueDrops;
        lastRealtimeDecoderDrops = videoDecoderDrops;

        long fps = Math.round((frameDelta * 1000.0) / elapsedMs);
        return new RealtimeStats(frameDelta, fps, droppedDelta, queueDelta, decoderDelta);
    }

    private static String formatDropRate(long droppedFrames, long videoFrames) {
        long totalFrames = droppedFrames + videoFrames;
        if (totalFrames <= 0) {
            return "0.0%";
        }
        return String.format(Locale.US, "%.1f%%", (droppedFrames * 100.0) / totalFrames);
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

        private RealtimeStats(long videoFrames, long fps, long droppedFrames, long queueDrops, long decoderDrops) {
            this.videoFrames = videoFrames;
            this.fps = fps;
            this.droppedFrames = droppedFrames;
            this.queueDrops = queueDrops;
            this.decoderDrops = decoderDrops;
        }
    }
}
