'use strict';

const WebSocket = require('ws');

let wrtc;
try {
  wrtc = require('wrtc');
} catch {
  try {
    wrtc = require('@roamhq/wrtc');
  } catch {
    wrtc = null;
  }
}

const config = {
  signal: process.env.SIGNAL || 'ws://127.0.0.1:8080',
  room: process.env.ROOM || 'game',
  width: Number(process.env.WIDTH || 1280),
  height: Number(process.env.HEIGHT || 720),
  fps: Number(process.env.FPS || 60),
  videoBitrate: Number(process.env.VIDEO_BITRATE || 12_000_000),
  audioBitrate: Number(process.env.AUDIO_BITRATE || 128_000)
};

function requireWrtc() {
  if (!wrtc) {
    throw new Error('No WebRTC binding is installed. Run: npm install @roamhq/wrtc');
  }
  return wrtc;
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function createPeer(ws) {
  const api = requireWrtc();
  const pc = new api.RTCPeerConnection({
    iceServers: [],
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  });

  pc.onicecandidate = event => {
    if (event.candidate) sendJson(ws, { type: 'candidate', candidate: event.candidate });
  };
  pc.onconnectionstatechange = () => console.log('connectionState:', pc.connectionState);
  pc.oniceconnectionstatechange = () => console.log('iceConnectionState:', pc.iceConnectionState);

  const control = pc.createDataChannel('input', {
    ordered: false,
    maxRetransmits: 0
  });
  control.onopen = () => console.log('input data channel open');
  control.onmessage = event => {
    const input = JSON.parse(event.data);
    if (input.type === 'latency-ping') {
      control.send(JSON.stringify({
        type: 'latency-pong',
        id: input.id,
        sentAt: input.sentAt,
        senderAt: Date.now()
      }));
      return;
    }
    console.log('input event:', input);
    // Production: inject this into Windows with SendInput / ViGEm / HID APIs.
  };

  return { pc, control };
}

function createSyntheticFrameSource({ width, height, fps }) {
  const api = requireWrtc();
  const source = new api.nonstandard.RTCVideoSource();
  const track = source.createTrack();
  let frame = 0;
  const ySize = width * height;
  const uvSize = (width >> 1) * (height >> 1);
  const data = Buffer.alloc(ySize + uvSize * 2);

  const timer = setInterval(() => {
    frame += 1;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const band = Math.floor((x + frame * 8) / 80) % 4;
        data[row + x] = band === 0 ? 40 : band === 1 ? 110 : band === 2 ? 190 : 245;
      }
    }
    data.fill(80 + (frame % 40), ySize, ySize + uvSize);
    data.fill(180 - (frame % 40), ySize + uvSize);
    source.onFrame({ width, height, data });
  }, Math.max(1, Math.round(1000 / fps)));

  return {
    track,
    stop() {
      clearInterval(timer);
      track.stop();
    }
  };
}

function createBgraFrameSource({ capture, width, height, fps }) {
  const api = requireWrtc();
  const source = new api.nonstandard.RTCVideoSource();
  const track = source.createTrack();

  let stopped = false;
  let lastFrameAt = 0;
  const minInterval = 1000 / fps;

  async function loop() {
    while (!stopped) {
      const frame = await capture.nextFrame(16);
      if (!frame) continue;

      const now = Date.now();
      if (now - lastFrameAt < minInterval) {
        frame.release?.();
        continue;
      }
      lastFrameAt = now;

      const i420 = bgraToI420(frame.data, width || frame.width, height || frame.height, frame.stride);
      source.onFrame({ width: width || frame.width, height: height || frame.height, data: i420 });
      frame.release?.();
    }
  }

  loop().catch(error => {
    stopped = true;
    console.error('capture loop failed:', error);
  });

  return {
    track,
    stop() {
      stopped = true;
      track.stop();
    }
  };
}

function bgraToI420() {
  throw new Error(
    'BGRA to I420 conversion must be implemented with native libyuv for 1080p60. ' +
    'Use the synthetic source until native conversion is wired.'
  );
}

async function tuneSender(sender, { bitrate, fps }) {
  const params = sender.getParameters();
  params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}];
  params.encodings[0].maxBitrate = bitrate;
  params.encodings[0].maxFramerate = fps;
  params.encodings[0].priority = 'high';
  params.degradationPreference = 'maintain-framerate';
  await sender.setParameters(params).catch(error => {
    console.warn('setParameters failed:', error.message);
  });
}

function preferH264Baseline(sdp) {
  const lines = sdp.split('\r\n');
  const h264Payloads = [];

  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+) H264\/90000/i);
    if (match) h264Payloads.push(match[1]);
  }

  return lines
    .map(line => {
      const fmtp = line.match(/^a=fmtp:(\d+) (.*)$/);
      if (!fmtp || !h264Payloads.includes(fmtp[1])) return line;
      const attrs = fmtp[2]
        .split(';')
        .map(part => part.trim())
        .filter(part => part && !part.startsWith('profile-level-id=') && !part.startsWith('packetization-mode='));
      attrs.push('profile-level-id=42e01f');
      attrs.push('packetization-mode=1');
      return `a=fmtp:${fmtp[1]} ${attrs.join(';')}`;
    })
    .filter(line => !/^a=rtcp-fb:\d+ (nack|nack pli)/i.test(line))
    .join('\r\n');
}

async function main() {
  const ws = new WebSocket(config.signal);
  let pc;
  let videoSource;

  ws.on('open', async () => {
    sendJson(ws, { type: 'join', room: config.room, role: 'sender' });
    const peer = createPeer(ws);
    pc = peer.pc;

    videoSource = createSyntheticFrameSource(config);
    const mediaStream = typeof wrtc.MediaStream === 'function'
      ? new wrtc.MediaStream([videoSource.track])
      : undefined;
    const videoSender = mediaStream
      ? pc.addTrack(videoSource.track, mediaStream)
      : pc.addTrack(videoSource.track);
    await tuneSender(videoSender, { bitrate: config.videoBitrate, fps: config.fps });

    const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
    offer.sdp = preferH264Baseline(offer.sdp);
    await pc.setLocalDescription(offer);
    sendJson(ws, { type: 'offer', description: pc.localDescription });
    console.log(`offer sent to room "${config.room}" via ${config.signal}`);
  });

  ws.on('message', async raw => {
    const message = JSON.parse(raw.toString());
    if (!pc) return;

    if (message.type === 'answer') {
      if (pc.signalingState !== 'have-local-offer') {
        console.log(`duplicate or late answer ignored; signalingState=${pc.signalingState}`);
        return;
      }

      try {
        await pc.setRemoteDescription(message.description || message.sdp);
        console.log('answer applied');
      } catch (error) {
        console.warn(`answer ignored: ${error.message}`);
      }
    } else if (message.type === 'candidate' && message.candidate) {
      await pc.addIceCandidate(message.candidate).catch(console.warn);
    }
  });

  ws.on('close', () => {
    videoSource?.stop();
    pc?.close();
  });
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  bgraToI420,
  createSyntheticFrameSource,
  createBgraFrameSource,
  preferH264Baseline,
  tuneSender
};
