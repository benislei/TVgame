package com.tvgame.receiver;

import android.media.MediaCodec;
import android.media.MediaFormat;
import android.view.Surface;

import java.io.ByteArrayOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.util.List;

public final class H264VideoReceiver implements Runnable {
    private static final int VIDEO_PORT = 5004;
    private static final int SOCKET_TIMEOUT_MS = 250;
    private static final int MAX_RTP_PACKET_SIZE = 1500;
    private static final int MAX_ACCESS_UNIT_SIZE = 4 * 1024 * 1024;

    private final Surface surface;
    private final StatsModel stats;
    private final H264RtpDepacketizer depacketizer = new H264RtpDepacketizer();
    private final ByteArrayOutputStream accessUnitBuffer = new ByteArrayOutputStream(512 * 1024);
    private volatile boolean running = true;
    private DatagramSocket socket;
    private MediaCodec decoder;
    private long accessUnitTimestamp = -1;
    private long firstVideoTimestamp = -1;

    public H264VideoReceiver(Surface surface, StatsModel stats) {
        this.surface = surface;
        this.stats = stats;
    }

    @Override
    public void run() {
        try {
            decoder = MediaCodec.createDecoderByType("video/avc");
            MediaFormat format = MediaFormat.createVideoFormat("video/avc", 1920, 1080);
            decoder.configure(format, surface, null, 0);
            decoder.start();

            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(VIDEO_PORT));
            socket.setSoTimeout(SOCKET_TIMEOUT_MS);

            byte[] buffer = new byte[MAX_RTP_PACKET_SIZE];
            DatagramPacket datagram = new DatagramPacket(buffer, buffer.length);
            while (running) {
                try {
                    datagram.setLength(buffer.length);
                    socket.receive(datagram);
                    RtpPacket packet = RtpPacket.parse(datagram.getData(), datagram.getLength());
                    stats.videoPackets++;
                    stats.lastVideoAtMs = System.currentTimeMillis();
                    List<byte[]> nalUnits = depacketizer.depacketize(packet);
                    if (!nalUnits.isEmpty()) {
                        appendNalUnits(packet.timestamp, nalUnits);
                    }
                    if (packet.marker) {
                        queueCurrentAccessUnit(packet.timestamp);
                    }
                    drainOutput();
                } catch (SocketTimeoutException ignored) {
                    drainOutput();
                } catch (SocketException ex) {
                    if (running) {
                        stats.droppedFrames++;
                    }
                    break;
                } catch (Exception ex) {
                    stats.droppedFrames++;
                }
            }
        } catch (Exception ex) {
            stats.droppedFrames++;
        } finally {
            releaseResources();
        }
    }

    public void stop() {
        running = false;
        if (socket != null) {
            socket.close();
        }
    }

    private void appendNalUnits(long timestamp, List<byte[]> nalUnits) {
        if (accessUnitTimestamp >= 0 && accessUnitTimestamp != timestamp && accessUnitBuffer.size() > 0) {
            queueCurrentAccessUnit(accessUnitTimestamp);
        }
        if (accessUnitTimestamp < 0) {
            accessUnitTimestamp = timestamp;
        }

        for (byte[] nalUnit : nalUnits) {
            if (nalUnit == null || nalUnit.length == 0) {
                continue;
            }
            if (accessUnitBuffer.size() + nalUnit.length > MAX_ACCESS_UNIT_SIZE) {
                accessUnitBuffer.reset();
                accessUnitTimestamp = -1;
                stats.droppedFrames++;
                return;
            }
            accessUnitBuffer.write(nalUnit, 0, nalUnit.length);
        }
    }

    private void queueCurrentAccessUnit(long timestamp) {
        if (accessUnitBuffer.size() == 0) {
            accessUnitTimestamp = -1;
            return;
        }

        byte[] accessUnit = accessUnitBuffer.toByteArray();
        accessUnitBuffer.reset();
        accessUnitTimestamp = -1;
        queueEncodedFrame(accessUnit, timestamp);
    }

    private void queueEncodedFrame(byte[] accessUnit, long timestamp) {
        if (decoder == null || accessUnit.length == 0) {
            return;
        }

        int inputIndex = decoder.dequeueInputBuffer(0);
        if (inputIndex < 0) {
            stats.droppedFrames++;
            return;
        }

        ByteBuffer inputBuffer = decoder.getInputBuffer(inputIndex);
        if (inputBuffer == null || inputBuffer.capacity() < accessUnit.length) {
            stats.droppedFrames++;
            decoder.queueInputBuffer(inputIndex, 0, 0, presentationTimeUs(timestamp), 0);
            return;
        }

        inputBuffer.clear();
        inputBuffer.put(accessUnit);
        decoder.queueInputBuffer(inputIndex, 0, accessUnit.length, presentationTimeUs(timestamp), 0);
    }

    private void drainOutput() {
        if (decoder == null) {
            return;
        }

        MediaCodec.BufferInfo bufferInfo = new MediaCodec.BufferInfo();
        while (true) {
            int outputIndex = decoder.dequeueOutputBuffer(bufferInfo, 0);
            if (outputIndex >= 0) {
                decoder.releaseOutputBuffer(outputIndex, true);
                stats.videoFrames++;
            } else if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED
                || outputIndex == MediaCodec.INFO_OUTPUT_BUFFERS_CHANGED) {
                continue;
            } else {
                break;
            }
        }
    }

    private long presentationTimeUs(long rtpTimestamp) {
        if (firstVideoTimestamp < 0) {
            firstVideoTimestamp = rtpTimestamp;
        }
        long delta = (rtpTimestamp - firstVideoTimestamp) & 0xFFFFFFFFL;
        return (delta * 1000000L) / 90000L;
    }

    private void releaseResources() {
        DatagramSocket currentSocket = socket;
        socket = null;
        if (currentSocket != null) {
            currentSocket.close();
        }

        MediaCodec currentDecoder = decoder;
        decoder = null;
        if (currentDecoder != null) {
            try {
                currentDecoder.stop();
            } catch (IllegalStateException ignored) {
            }
            currentDecoder.release();
        }
    }
}
