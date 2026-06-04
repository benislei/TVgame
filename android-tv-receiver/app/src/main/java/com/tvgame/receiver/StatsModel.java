package com.tvgame.receiver;

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

    public String render() {
        return "视频包: " + videoPackets
            + "\n视频帧: " + videoFrames
            + "\n视频丢包: " + videoRtpLossPackets
            + "\n等待关键帧: " + videoRecoveryWaits
            + "\n恢复丢帧: " + videoRecoveryDrops
            + "\n接收缓冲: " + videoReceiveBufferBytes
            + "\n队列丢帧: " + videoQueueDrops
            + "\n解码丢帧: " + videoDecoderDrops
            + "\n音频包: " + audioPackets
            + "\n音频字节: " + audioBytes
            + "\n丢帧: " + droppedFrames
            + "\n视频状态: " + statusText(lastVideoAtMs)
            + "\n音频状态: " + statusText(lastAudioAtMs);
    }

    private static String statusText(long timestampMs) {
        if (timestampMs <= 0) {
            return "未收到";
        }

        long ageMs = System.currentTimeMillis() - timestampMs;
        if (ageMs <= 1000) {
            return "正常";
        }

        return "超过 " + ageMs + "ms 未更新";
    }
}
