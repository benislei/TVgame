package com.tvgame.receiver;

import android.media.MediaCodec;
import android.media.MediaFormat;
import android.os.Bundle;
import android.view.Surface;

import java.io.ByteArrayOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

public final class H264VideoReceiver implements Runnable {
    public interface SenderAddressListener {
        void onSenderAddress(String host);
    }

    private static final int VIDEO_PORT = 5004;
    private static final int SOCKET_TIMEOUT_MS = 250;
    private static final int VIDEO_RECEIVE_BUFFER_BYTES = 4 * 1024 * 1024;
    private static final int MAX_RTP_PACKET_SIZE = 1500;
    private static final int MAX_ACCESS_UNIT_SIZE = 4 * 1024 * 1024;
    private static final int MAX_PENDING_ACCESS_UNITS = 1;
    private static final long DECODER_POLL_TIMEOUT_MS = 2;
    private static final long DECODER_INPUT_TIMEOUT_US = 2000;
    private static final long DECODER_JOIN_MS = 400;

    private final Surface surface;
    private final StatsModel stats;
    private final SenderAddressListener senderAddressListener;
    private final H264RtpDepacketizer depacketizer = new H264RtpDepacketizer();
    private final ByteArrayOutputStream accessUnitBuffer = new ByteArrayOutputStream(512 * 1024);
    private final ArrayBlockingQueue<EncodedFrame> pendingAccessUnits =
        new ArrayBlockingQueue<>(MAX_PENDING_ACCESS_UNITS);
    private volatile boolean running = true;
    private DatagramSocket socket;
    private MediaCodec decoder;
    private Thread decoderThread;
    private long accessUnitTimestamp = -1;
    private long firstVideoTimestamp = -1;
    private int expectedVideoSequenceNumber = -1;
    private boolean accessUnitDamaged;
    private boolean waitingForKeyframe;
    private String lastSenderHost;

    public H264VideoReceiver(Surface surface, StatsModel stats) {
        this(surface, stats, null);
    }

    public H264VideoReceiver(Surface surface, StatsModel stats, SenderAddressListener senderAddressListener) {
        this.surface = surface;
        this.stats = stats;
        this.senderAddressListener = senderAddressListener;
    }

    @Override
    public void run() {
        startDecoderThread();
        try {
            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.setReceiveBufferSize(VIDEO_RECEIVE_BUFFER_BYTES);
            socket.bind(new InetSocketAddress(VIDEO_PORT));
            stats.videoReceiveBufferBytes = socket.getReceiveBufferSize();
            socket.setSoTimeout(SOCKET_TIMEOUT_MS);

            byte[] buffer = new byte[MAX_RTP_PACKET_SIZE];
            DatagramPacket datagram = new DatagramPacket(buffer, buffer.length);
            while (running) {
                try {
                    datagram.setLength(buffer.length);
                    socket.receive(datagram);
                    recordSenderAddress(datagram);
                    RtpPacket packet = RtpPacket.parse(datagram.getData(), datagram.getLength());
                    stats.videoPackets++;
                    recordVideoSequence(packet.sequenceNumber);
                    stats.lastVideoAtMs = System.currentTimeMillis();
                    List<byte[]> nalUnits = depacketizer.depacketize(packet);
                    if (!nalUnits.isEmpty()) {
                        appendNalUnits(packet.timestamp, nalUnits);
                    }
                    if (packet.marker) {
                        queueCurrentAccessUnit(packet.timestamp);
                    }
                } catch (SocketTimeoutException ignored) {
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
            running = false;
            releaseResources();
        }
    }

    public void stop() {
        running = false;
        closeSocket();
        Thread currentDecoderThread = decoderThread;
        if (currentDecoderThread != null) {
            currentDecoderThread.interrupt();
        }
    }

    private void recordSenderAddress(DatagramPacket datagram) {
        if (senderAddressListener == null || datagram.getAddress() == null) {
            return;
        }

        String host = datagram.getAddress().getHostAddress();
        if (host == null || host.length() == 0 || host.equals(lastSenderHost)) {
            return;
        }

        lastSenderHost = host;
        senderAddressListener.onSenderAddress(host);
    }

    private void startDecoderThread() {
        decoderThread = new Thread(new Runnable() {
            @Override
            public void run() {
                runDecoderLoop();
            }
        }, "H264 解码");
        decoderThread.start();
    }

    private void runDecoderLoop() {
        try {
            decoder = MediaCodec.createDecoderByType("video/avc");
            MediaFormat format = MediaFormat.createVideoFormat("video/avc", 1920, 1080);
            format.setInteger(MediaFormat.KEY_LOW_LATENCY, 1);
            format.setInteger(MediaFormat.KEY_PRIORITY, 0);
            format.setInteger(MediaFormat.KEY_OPERATING_RATE, 60);
            decoder.configure(format, surface, null, 0);
            decoder.start();
            Bundle decoderParameters = new Bundle();
            decoderParameters.putInt(MediaCodec.PARAMETER_KEY_LOW_LATENCY, 1);
            decoder.setParameters(decoderParameters);

            while (running || !pendingAccessUnits.isEmpty()) {
                EncodedFrame frame = pendingAccessUnits.poll(DECODER_POLL_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                if (frame != null) {
                    queueEncodedFrame(frame);
                }
                drainOutput();
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        } catch (Exception ex) {
            stats.videoDecoderDrops++;
            stats.droppedFrames++;
        } finally {
            releaseDecoder();
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
        if (accessUnitDamaged) {
            accessUnitBuffer.reset();
            accessUnitTimestamp = -1;
            accessUnitDamaged = false;
            stats.droppedFrames++;
            return;
        }
        if (accessUnitBuffer.size() == 0) {
            accessUnitTimestamp = -1;
            return;
        }

        byte[] accessUnit = accessUnitBuffer.toByteArray();
        accessUnitBuffer.reset();
        accessUnitTimestamp = -1;
        if (waitingForKeyframe) {
            if (!accessUnitContainsIdr(accessUnit)) {
                stats.videoRecoveryWaits++;
                stats.videoRecoveryDrops++;
                stats.droppedFrames++;
                return;
            }
            waitingForKeyframe = false;
        }
        enqueueEncodedFrame(accessUnit, timestamp);
    }

    private void enqueueEncodedFrame(byte[] accessUnit, long timestamp) {
        EncodedFrame frame = new EncodedFrame(accessUnit, timestamp);
        boolean droppedQueuedFrame = false;
        while (pendingAccessUnits.remainingCapacity() == 0) {
            EncodedFrame dropped = pendingAccessUnits.poll();
            if (dropped == null) {
                break;
            }
            stats.videoQueueDrops++;
            stats.droppedFrames++;
            waitingForKeyframe = true;
            droppedQueuedFrame = true;
        }
        if (droppedQueuedFrame && waitingForKeyframe && !accessUnitContainsIdr(accessUnit)) {
            stats.videoRecoveryWaits++;
            stats.videoRecoveryDrops++;
            stats.droppedFrames++;
            return;
        }
        if (droppedQueuedFrame && waitingForKeyframe && accessUnitContainsIdr(accessUnit)) {
            waitingForKeyframe = false;
        }
        if (!pendingAccessUnits.offer(frame)) {
            stats.videoQueueDrops++;
            stats.droppedFrames++;
            waitingForKeyframe = true;
        }
    }

    private void recordVideoSequence(int sequenceNumber) {
        if (expectedVideoSequenceNumber < 0) {
            expectedVideoSequenceNumber = nextSequenceNumber(sequenceNumber);
            return;
        }

        if (sequenceNumber != expectedVideoSequenceNumber) {
            int lostPackets = (sequenceNumber - expectedVideoSequenceNumber) & 0xFFFF;
            if (lostPackets > 0 && lostPackets < 32768) {
                stats.videoRtpLossPackets += lostPackets;
                accessUnitDamaged = true;
                waitingForKeyframe = true;
            }
        }
        expectedVideoSequenceNumber = nextSequenceNumber(sequenceNumber);
    }

    private static int nextSequenceNumber(int sequenceNumber) {
        return (sequenceNumber + 1) & 0xFFFF;
    }

    private static boolean accessUnitContainsIdr(byte[] accessUnit) {
        if (accessUnit == null || accessUnit.length < 5) {
            return false;
        }

        for (int i = 0; i < accessUnit.length - 4; i++) {
            int nalOffset = -1;
            if (accessUnit[i] == 0 && accessUnit[i + 1] == 0 && accessUnit[i + 2] == 1) {
                nalOffset = i + 3;
            } else if (i < accessUnit.length - 5
                && accessUnit[i] == 0
                && accessUnit[i + 1] == 0
                && accessUnit[i + 2] == 0
                && accessUnit[i + 3] == 1) {
                nalOffset = i + 4;
            }

            if (nalOffset >= 0 && nalOffset < accessUnit.length) {
                int nalType = accessUnit[nalOffset] & 0x1F;
                if (nalType == 5) {
                    return true;
                }
            }
        }
        return false;
    }

    private void queueEncodedFrame(EncodedFrame frame) {
        byte[] accessUnit = frame.accessUnit;
        long timestamp = frame.timestamp;
        if (decoder == null || accessUnit.length == 0) {
            return;
        }

        int inputIndex = decoder.dequeueInputBuffer(DECODER_INPUT_TIMEOUT_US);
        if (inputIndex < 0) {
            stats.videoDecoderDrops++;
            stats.droppedFrames++;
            return;
        }

        ByteBuffer inputBuffer = decoder.getInputBuffer(inputIndex);
        if (inputBuffer == null || inputBuffer.capacity() < accessUnit.length) {
            stats.videoDecoderDrops++;
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
        closeSocket();
        stopDecoderThread();
        pendingAccessUnits.clear();
    }

    private void closeSocket() {
        DatagramSocket currentSocket = socket;
        socket = null;
        if (currentSocket != null) {
            currentSocket.close();
        }
    }

    private void stopDecoderThread() {
        Thread currentDecoderThread = decoderThread;
        decoderThread = null;
        if (currentDecoderThread == null || currentDecoderThread == Thread.currentThread()) {
            return;
        }
        currentDecoderThread.interrupt();
        try {
            currentDecoderThread.join(DECODER_JOIN_MS);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }
    }

    private void releaseDecoder() {
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

    private static final class EncodedFrame {
        private final byte[] accessUnit;
        private final long timestamp;

        private EncodedFrame(byte[] accessUnit, long timestamp) {
            this.accessUnit = accessUnit;
            this.timestamp = timestamp;
        }
    }
}
