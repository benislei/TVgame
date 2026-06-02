package com.tvgame.receiver;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.SocketException;
import java.net.SocketTimeoutException;

public final class L16AudioReceiver implements Runnable {
    private static final int AUDIO_PORT = 5006;
    private static final int SOCKET_TIMEOUT_MS = 250;
    private static final int MAX_RTP_PACKET_SIZE = 1500;
    private static final int SAMPLE_RATE = 48000;

    private final StatsModel stats;
    private volatile boolean running = true;
    private DatagramSocket socket;
    private AudioTrack audioTrack;

    public L16AudioReceiver(StatsModel stats) {
        this.stats = stats;
    }

    @Override
    public void run() {
        try {
            audioTrack = createAudioTrack();
            audioTrack.play();

            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(AUDIO_PORT));
            socket.setSoTimeout(SOCKET_TIMEOUT_MS);

            byte[] buffer = new byte[MAX_RTP_PACKET_SIZE];
            DatagramPacket datagram = new DatagramPacket(buffer, buffer.length);
            while (running) {
                try {
                    datagram.setLength(buffer.length);
                    socket.receive(datagram);
                    RtpPacket packet = RtpPacket.parse(datagram.getData(), datagram.getLength());
                    stats.audioPackets++;
                    stats.lastAudioAtMs = System.currentTimeMillis();
                    byte[] pcm = bigEndianToLittleEndian(packet.payload, packet.payloadLength);
                    int written = audioTrack.write(pcm, 0, pcm.length);
                    if (written > 0) {
                        stats.audioBytes += written;
                    }
                } catch (SocketTimeoutException ignored) {
                } catch (SocketException ex) {
                    break;
                } catch (Exception ignored) {
                }
            }
        } catch (Exception ignored) {
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

    private static AudioTrack createAudioTrack() {
        AudioFormat format = new AudioFormat.Builder()
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .build();
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_GAME)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build();
        int minBufferSize = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_STEREO,
            AudioFormat.ENCODING_PCM_16BIT
        );
        int bufferSize = Math.max(minBufferSize * 2, 4096);

        return new AudioTrack.Builder()
            .setAudioAttributes(attributes)
            .setAudioFormat(format)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(bufferSize)
            .build();
    }

    private static byte[] bigEndianToLittleEndian(byte[] payload, int payloadLength) {
        int evenLength = payloadLength & ~1;
        byte[] littleEndian = new byte[evenLength];
        for (int i = 0; i < evenLength; i += 2) {
            littleEndian[i] = payload[i + 1];
            littleEndian[i + 1] = payload[i];
        }
        return littleEndian;
    }

    private void releaseResources() {
        DatagramSocket currentSocket = socket;
        socket = null;
        if (currentSocket != null) {
            currentSocket.close();
        }

        AudioTrack currentTrack = audioTrack;
        audioTrack = null;
        if (currentTrack != null) {
            try {
                currentTrack.stop();
            } catch (IllegalStateException ignored) {
            }
            currentTrack.release();
        }
    }
}
