'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mungeLowLatencySdp } = require('../src/low-latency-patches');

test('low latency SDP patch prefers H264 and Opus and removes RTX payload', () => {
  const sdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 0',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98',
    'a=rtpmap:96 VP8/90000',
    'a=rtpmap:97 H264/90000',
    'a=fmtp:97 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=64001f',
    'a=rtpmap:98 rtx/90000',
    'a=fmtp:98 apt=97',
    'a=rtcp-fb:97 nack',
    'a=rtcp-fb:97 nack pli',
    'a=rtcp-fb:97 goog-remb'
  ].join('\r\n');

  const patched = mungeLowLatencySdp(sdp);

  assert.match(patched, /m=video 9 UDP\/TLS\/RTP\/SAVPF 97 96/);
  assert.match(patched, /profile-level-id=42e01f/);
  assert.match(patched, /maxaveragebitrate=128000/);
  assert.doesNotMatch(patched, /rtx\/90000/);
  assert.doesNotMatch(patched, /a=rtcp-fb:97 nack\r?\n/);
  assert.match(patched, /a=rtcp-fb:97 nack pli/);
});
