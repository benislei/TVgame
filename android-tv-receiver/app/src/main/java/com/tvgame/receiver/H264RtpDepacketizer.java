package com.tvgame.receiver;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class H264RtpDepacketizer {
    private static final byte[] START_CODE = new byte[] { 0, 0, 0, 1 };
    private static final int MAX_REASSEMBLED_NAL_SIZE = 2 * 1024 * 1024;

    private final ByteArrayOutputStream fragmentBuffer = new ByteArrayOutputStream(128 * 1024);
    private boolean fragmentStarted;
    private int expectedSequenceNumber = -1;
    private long fragmentTimestamp = -1;

    public List<byte[]> depacketize(RtpPacket packet) {
        if (packet == null || packet.payloadLength <= 0) {
            return Collections.emptyList();
        }

        byte[] payload = packet.payload;
        int nalType = payload[0] & 0x1F;
        if (nalType >= 1 && nalType <= 23) {
            resetFragment();
            if (packet.payloadLength > MAX_REASSEMBLED_NAL_SIZE) {
                return Collections.emptyList();
            }
            return Collections.singletonList(withStartCode(payload, 0, packet.payloadLength));
        }

        if (nalType == 24) {
            resetFragment();
            return unpackStapA(payload, packet.payloadLength);
        }

        if (nalType == 28) {
            return unpackFuA(packet, payload, packet.payloadLength);
        }

        resetFragment();
        return Collections.emptyList();
    }

    private List<byte[]> unpackStapA(byte[] payload, int payloadLength) {
        List<byte[]> out = new ArrayList<>();
        int offset = 1;
        while (offset + 2 <= payloadLength) {
            int nalLength = ((payload[offset] & 0xFF) << 8) | (payload[offset + 1] & 0xFF);
            offset += 2;
            if (nalLength <= 0
                || nalLength > MAX_REASSEMBLED_NAL_SIZE
                || offset + nalLength > payloadLength) {
                out.clear();
                resetFragment();
                break;
            }
            out.add(withStartCode(payload, offset, nalLength));
            offset += nalLength;
        }
        if (offset != payloadLength) {
            out.clear();
            resetFragment();
        }
        return out;
    }

    private List<byte[]> unpackFuA(RtpPacket packet, byte[] payload, int payloadLength) {
        if (payloadLength < 2) {
            resetFragment();
            return Collections.emptyList();
        }

        int fuIndicator = payload[0] & 0xFF;
        int fuHeader = payload[1] & 0xFF;
        boolean startBit = (fuHeader & 0x80) != 0;
        boolean endBit = (fuHeader & 0x40) != 0;
        int reconstructedHeader = (fuIndicator & 0xE0) | (fuHeader & 0x1F);

        if (startBit) {
            resetFragment();
            fragmentStarted = true;
            fragmentTimestamp = packet.timestamp;
            expectedSequenceNumber = nextSequenceNumber(packet.sequenceNumber);
            fragmentBuffer.write(START_CODE, 0, START_CODE.length);
            fragmentBuffer.write(reconstructedHeader);
        } else {
            if (!fragmentStarted) {
                return Collections.emptyList();
            }
            if (packet.timestamp != fragmentTimestamp
                || packet.sequenceNumber != expectedSequenceNumber) {
                resetFragment();
                return Collections.emptyList();
            }
            expectedSequenceNumber = nextSequenceNumber(packet.sequenceNumber);
        }

        if (fragmentBuffer.size() + payloadLength - 2 > MAX_REASSEMBLED_NAL_SIZE) {
            resetFragment();
            return Collections.emptyList();
        }

        fragmentBuffer.write(payload, 2, payloadLength - 2);

        if (endBit) {
            byte[] nal = fragmentBuffer.toByteArray();
            resetFragment();
            return Collections.singletonList(nal);
        }

        return Collections.emptyList();
    }

    private static int nextSequenceNumber(int sequenceNumber) {
        return (sequenceNumber + 1) & 0xFFFF;
    }

    private void resetFragment() {
        fragmentBuffer.reset();
        fragmentStarted = false;
        expectedSequenceNumber = -1;
        fragmentTimestamp = -1;
    }

    private static byte[] withStartCode(byte[] source, int offset, int length) {
        byte[] out = new byte[START_CODE.length + length];
        System.arraycopy(START_CODE, 0, out, 0, START_CODE.length);
        System.arraycopy(source, offset, out, START_CODE.length, length);
        return out;
    }
}
