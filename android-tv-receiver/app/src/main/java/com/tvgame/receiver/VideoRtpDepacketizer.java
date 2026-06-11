package com.tvgame.receiver;

import java.util.List;

interface VideoRtpDepacketizer {
    List<byte[]> depacketize(RtpPacket packet);
}
