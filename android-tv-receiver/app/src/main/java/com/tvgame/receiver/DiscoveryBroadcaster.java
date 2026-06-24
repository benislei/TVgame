package com.tvgame.receiver;

import android.os.Build;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public final class DiscoveryBroadcaster {
    private static final int DISCOVERY_PORT = 8790;
    private static final int BROADCAST_INTERVAL_MS = 2000;
    private static final String BROADCAST_ADDRESS = "255.255.255.255";

    private final StatsModel stats;
    private volatile boolean running;
    private volatile Thread thread;

    public DiscoveryBroadcaster(StatsModel stats) {
        this.stats = stats;
    }

    public synchronized void start() {
        if (running) {
            return;
        }

        running = true;
        thread = new Thread(new Runnable() {
            @Override
            public void run() {
                runLoop();
            }
        }, "TVGame discovery broadcast");
        thread.setDaemon(true);
        thread.start();
    }

    public synchronized void stop() {
        running = false;
        if (thread != null) {
            thread.interrupt();
            thread = null;
        }
    }

    private void runLoop() {
        Thread currentThread = Thread.currentThread();
        while (running && currentThread == thread) {
            broadcastOnce();
            try {
                Thread.sleep(BROADCAST_INTERVAL_MS);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private void broadcastOnce() {
        try {
            byte[] payload = buildPayload().getBytes(StandardCharsets.UTF_8);
            InetAddress address = InetAddress.getByName(BROADCAST_ADDRESS);
            DatagramPacket packet = new DatagramPacket(payload, payload.length, address, DISCOVERY_PORT);
            DatagramSocket socket = new DatagramSocket();
            try {
                socket.setBroadcast(true);
                socket.send(packet);
            } finally {
                socket.close();
            }
        } catch (Exception ex) {
            // Discovery is best-effort; streaming must keep running even if broadcast is unavailable.
        }
    }

    String buildPayload() {
        String deviceName = (cleanBuildText(Build.MANUFACTURER) + " " + cleanBuildText(Build.MODEL)).trim();
        return "{\"app\":\"TVGameReceiver\""
            + ",\"version\":1"
            + ",\"deviceName\":\"" + escapeJson(deviceName) + "\""
            + ",\"androidApi\":" + Build.VERSION.SDK_INT
            + ",\"decoder\":\"" + escapeJson(stats.videoDecoderName) + "\""
            + ",\"recommendedProfile\":\"" + escapeJson(profileFromAdvice(stats.receiverAdvice)) + "\""
            + "}";
    }

    static String profileFromAdvice(String advice) {
        if (advice == null || advice.trim().length() == 0) {
            return "h2641080p30";
        }

        String lower = advice.toLowerCase(Locale.US);
        if (lower.contains("hevc") && lower.contains("60")) {
            return "hevc1080p60";
        }
        if (lower.contains("hevc")) {
            return "hevc1080p30";
        }
        if (lower.contains("720") && lower.contains("60")) {
            return "h264720p60";
        }
        if (lower.contains("720")) {
            return "h264720p30";
        }
        if (lower.contains("60")) {
            return "h2641080p60";
        }
        return "h2641080p30";
    }

    private static String escapeJson(String text) {
        if (text == null) {
            return "";
        }

        StringBuilder escaped = new StringBuilder(text.length());
        for (int i = 0; i < text.length(); i++) {
            char value = text.charAt(i);
            switch (value) {
                case '"':
                    escaped.append("\\\"");
                    break;
                case '\\':
                    escaped.append("\\\\");
                    break;
                case '\b':
                    escaped.append("\\b");
                    break;
                case '\f':
                    escaped.append("\\f");
                    break;
                case '\n':
                    escaped.append("\\n");
                    break;
                case '\r':
                    escaped.append("\\r");
                    break;
                case '\t':
                    escaped.append("\\t");
                    break;
                default:
                    if (value < 0x20) {
                        escaped.append(String.format(Locale.US, "\\u%04x", (int) value));
                    } else {
                        escaped.append(value);
                    }
                    break;
            }
        }
        return escaped.toString();
    }

    private static String cleanBuildText(String text) {
        if (text == null) {
            return "";
        }
        text = text.trim();
        if (text.length() == 0 || "unknown".equalsIgnoreCase(text)) {
            return "";
        }
        return text;
    }
}
