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
        if (length < 0 || length > buffer.length) {
            throw new IllegalArgumentException("RTP 包长度越界");
        }
        if (length < 12) {
            throw new IllegalArgumentException("RTP 包长度不足");
        }

        boolean hasPadding = (buffer[0] & 0x20) != 0;
        boolean hasExtension = (buffer[0] & 0x10) != 0;
        int version = (buffer[0] >> 6) & 0x03;
        if (version != 2) {
            throw new IllegalArgumentException("RTP 版本不正确");
        }

        int csrcCount = buffer[0] & 0x0F;
        int payloadOffset = 12 + csrcCount * 4;
        if (length < payloadOffset) {
            throw new IllegalArgumentException("RTP CSRC 头长度不足");
        }
        if (hasExtension) {
            if (length < payloadOffset + 4) {
                throw new IllegalArgumentException("RTP 扩展头长度不足");
            }
            int extensionHeaderOffset = payloadOffset;
            int extensionWords = ((buffer[extensionHeaderOffset + 2] & 0xFF) << 8)
                | (buffer[extensionHeaderOffset + 3] & 0xFF);
            int extensionBytes = extensionWords * 4;
            payloadOffset += 4;
            if (length < payloadOffset + extensionBytes) {
                throw new IllegalArgumentException("RTP 扩展数据长度不足");
            }
            payloadOffset += extensionBytes;
        }

        int payloadEnd = length;
        if (hasPadding) {
            if (payloadEnd <= payloadOffset) {
                throw new IllegalArgumentException("RTP 填充长度不足");
            }
            int paddingLength = buffer[payloadEnd - 1] & 0xFF;
            if (paddingLength <= 0 || paddingLength > payloadEnd - payloadOffset) {
                throw new IllegalArgumentException("RTP 填充长度不合法");
            }
            payloadEnd -= paddingLength;
        }
        if (payloadEnd < payloadOffset) {
            throw new IllegalArgumentException("RTP 负载长度不合法");
        }

        boolean marker = (buffer[1] & 0x80) != 0;
        int payloadType = buffer[1] & 0x7F;
        int sequenceNumber = ((buffer[2] & 0xFF) << 8) | (buffer[3] & 0xFF);
        long timestamp = ((long) (buffer[4] & 0xFF) << 24)
            | ((long) (buffer[5] & 0xFF) << 16)
            | ((long) (buffer[6] & 0xFF) << 8)
            | (long) (buffer[7] & 0xFF);
        byte[] payload = Arrays.copyOfRange(buffer, payloadOffset, payloadEnd);

        return new RtpPacket(payloadType, sequenceNumber, timestamp, marker, payload);
    }
}
