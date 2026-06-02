package com.tvgame.receiver;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class H264RtpDepacketizer {
    private static final byte[] START_CODE = new byte[] { 0, 0, 0, 1 };

    private final ByteArrayOutputStream fragmentBuffer = new ByteArrayOutputStream(128 * 1024);
    private boolean fragmentStarted;

    public List<byte[]> depacketize(RtpPacket packet) {
        if (packet == null || packet.payloadLength <= 0) {
            return Collections.emptyList();
        }

        byte[] payload = packet.payload;
        int nalType = payload[0] & 0x1F;
        if (nalType >= 1 && nalType <= 23) {
            fragmentBuffer.reset();
            fragmentStarted = false;
            return Collections.singletonList(withStartCode(payload, 0, packet.payloadLength));
        }

        if (nalType == 24) {
            fragmentBuffer.reset();
            fragmentStarted = false;
            return unpackStapA(payload, packet.payloadLength);
        }

        if (nalType == 28) {
            return unpackFuA(payload, packet.payloadLength);
        }

        fragmentBuffer.reset();
        fragmentStarted = false;
        return Collections.emptyList();
    }

    private List<byte[]> unpackStapA(byte[] payload, int payloadLength) {
        List<byte[]> out = new ArrayList<>();
        int offset = 1;
        while (offset + 2 <= payloadLength) {
            int nalLength = ((payload[offset] & 0xFF) << 8) | (payload[offset + 1] & 0xFF);
            offset += 2;
            if (nalLength <= 0 || offset + nalLength > payloadLength) {
                fragmentBuffer.reset();
                fragmentStarted = false;
                break;
            }
            out.add(withStartCode(payload, offset, nalLength));
            offset += nalLength;
        }
        return out;
    }

    private List<byte[]> unpackFuA(byte[] payload, int payloadLength) {
        if (payloadLength < 2) {
            fragmentBuffer.reset();
            fragmentStarted = false;
            return Collections.emptyList();
        }

        int fuIndicator = payload[0] & 0xFF;
        int fuHeader = payload[1] & 0xFF;
        boolean startBit = (fuHeader & 0x80) != 0;
        boolean endBit = (fuHeader & 0x40) != 0;
        int reconstructedHeader = (fuIndicator & 0xE0) | (fuHeader & 0x1F);

        if (startBit) {
            fragmentBuffer.reset();
            fragmentStarted = true;
            fragmentBuffer.write(START_CODE, 0, START_CODE.length);
            fragmentBuffer.write(reconstructedHeader);
        } else if (!fragmentStarted) {
            return Collections.emptyList();
        }

        fragmentBuffer.write(payload, 2, payloadLength - 2);

        if (endBit) {
            byte[] nal = fragmentBuffer.toByteArray();
            fragmentBuffer.reset();
            fragmentStarted = false;
            return Collections.singletonList(nal);
        }

        return Collections.emptyList();
    }

    private static byte[] withStartCode(byte[] source, int offset, int length) {
        byte[] out = new byte[START_CODE.length + length];
        System.arraycopy(START_CODE, 0, out, 0, START_CODE.length);
        System.arraycopy(source, offset, out, START_CODE.length, length);
        return out;
    }
}
