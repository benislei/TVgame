package com.tvgame.receiver;

import android.media.MediaCodec;
import android.media.MediaFormat;
import android.view.Surface;

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

    private final Surface surface;
    private final StatsModel stats;
    private final H264RtpDepacketizer depacketizer = new H264RtpDepacketizer();
    private volatile boolean running = true;
    private DatagramSocket socket;
    private MediaCodec decoder;

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
                    for (byte[] nalUnit : nalUnits) {
                        queueNalUnit(nalUnit, packet.timestamp);
                        drainOutput();
                    }
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

    private void queueNalUnit(byte[] nalUnit, long timestamp) {
        if (decoder == null || nalUnit.length == 0) {
            return;
        }

        int inputIndex = decoder.dequeueInputBuffer(0);
        if (inputIndex < 0) {
            stats.droppedFrames++;
            return;
        }

        ByteBuffer inputBuffer = decoder.getInputBuffer(inputIndex);
        if (inputBuffer == null || inputBuffer.capacity() < nalUnit.length) {
            stats.droppedFrames++;
            decoder.queueInputBuffer(inputIndex, 0, 0, presentationTimeUs(timestamp), 0);
            return;
        }

        inputBuffer.clear();
        inputBuffer.put(nalUnit);
        decoder.queueInputBuffer(inputIndex, 0, nalUnit.length, presentationTimeUs(timestamp), 0);
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

    private static long presentationTimeUs(long rtpTimestamp) {
        return (rtpTimestamp * 1000000L) / 90000L;
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
