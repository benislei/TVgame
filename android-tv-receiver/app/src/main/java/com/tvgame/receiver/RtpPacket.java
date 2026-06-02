package com.tvgame.receiver;

import java.util.Arrays;

public final class RtpPacket {
    public final int payloadType;
    public final int sequenceNumber;
    public final long timestamp;
    public final boolean marker;
    public final byte[] payload;
    public final int payloadLength;

    private RtpPacket(
        int payloadType,
        int sequenceNumber,
        long timestamp,
        boolean marker,
        byte[] payload
    ) {
        this.payloadType = payloadType;
        this.sequenceNumber = sequenceNumber;
        this.timestamp = timestamp;
        this.marker = marker;
        this.payload = payload;
        this.payloadLength = payload.length;
    }

    public static RtpPacket parse(byte[] buffer, int length) {
        if (buffer == null) {
            throw new IllegalArgumentException("RTP 数据为空");
        }
        if (length < 12) {
            throw new IllegalArgumentException("RTP 包长度不足");
        }

        int version = (buffer[0] >> 6) & 0x03;
        if (version != 2) {
            throw new IllegalArgumentException("RTP 版本不正确");
        }

        int csrcCount = buffer[0] & 0x0F;
        int headerLength = 12 + csrcCount * 4;
        if (length < headerLength) {
            throw new IllegalArgumentException("RTP CSRC 头长度不足");
        }

        boolean marker = (buffer[1] & 0x80) != 0;
        int payloadType = buffer[1] & 0x7F;
        int sequenceNumber = ((buffer[2] & 0xFF) << 8) | (buffer[3] & 0xFF);
        long timestamp = ((long) (buffer[4] & 0xFF) << 24)
            | ((long) (buffer[5] & 0xFF) << 16)
            | ((long) (buffer[6] & 0xFF) << 8)
            | (long) (buffer[7] & 0xFF);
        byte[] payload = Arrays.copyOfRange(buffer, headerLength, length);

        return new RtpPacket(payloadType, sequenceNumber, timestamp, marker, payload);
    }
}
