'use strict';

function parseFmtp(value) {
  const out = {};
  for (const part of value.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) out[key] = rest.join('=') || '';
  }
  return out;
}

function stringifyFmtp(values) {
  return Object.entries(values)
    .map(([key, value]) => value === '' ? key : `${key}=${value}`)
    .join(';');
}

function preferCodec(sdp, kind, codec) {
  const lines = sdp.split(/\r?\n/);
  const mIndex = lines.findIndex(line => line.startsWith(`m=${kind} `));
  if (mIndex < 0) return sdp;

  const payloads = [];
  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+([^/]+)/i);
    if (match && match[2].toLowerCase() === codec.toLowerCase()) payloads.push(match[1]);
  }
  if (!payloads.length) return sdp;

  const parts = lines[mIndex].split(' ');
  const reordered = [...payloads, ...parts.slice(3).filter(payload => !payloads.includes(payload))];
  lines[mIndex] = [...parts.slice(0, 3), ...reordered].join(' ');
  return lines.join('\r\n');
}

function forceH264BaselineFmtp(sdp) {
  const lines = sdp.split(/\r?\n/);
  const h264Payloads = new Set();

  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+H264\/90000/i);
    if (match) h264Payloads.add(match[1]);
  }

  return lines.map(line => {
    const match = line.match(/^a=fmtp:(\d+)\s+(.*)$/i);
    if (!match || !h264Payloads.has(match[1])) return line;

    const values = parseFmtp(match[2]);
    values['profile-level-id'] = '42e01f';
    values['level-asymmetry-allowed'] = '1';
    values['packetization-mode'] = '1';
    values['x-google-start-bitrate'] = '12000';
    values['x-google-min-bitrate'] = '12000';
    values['x-google-max-bitrate'] = '12000';
    return `a=fmtp:${match[1]} ${stringifyFmtp(values)}`;
  }).join('\r\n');
}

function forceOpusLowLatencyFmtp(sdp) {
  const lines = sdp.split(/\r?\n/);
  const opusPayloads = new Set();
  let hasPtime = false;

  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+opus\/48000\/2/i);
    if (match) opusPayloads.add(match[1]);
  }

  const out = lines.map(line => {
    if (/^a=ptime:/i.test(line)) {
      hasPtime = true;
      return 'a=ptime:10';
    }

    const match = line.match(/^a=fmtp:(\d+)\s+(.*)$/i);
    if (!match || !opusPayloads.has(match[1])) return line;

    const values = parseFmtp(match[2]);
    values.maxaveragebitrate = '128000';
    values.stereo = '1';
    values['sprop-stereo'] = '1';
    values.cbr = '1';
    values.usedtx = '0';
    values.useinbandfec = '0';
    values.minptime = '10';
    return `a=fmtp:${match[1]} ${stringifyFmtp(values)}`;
  });

  if (!hasPtime) {
    const audioIndex = out.findIndex(line => line.startsWith('m=audio '));
    if (audioIndex >= 0) out.splice(audioIndex + 1, 0, 'a=ptime:10');
  }

  return out.join('\r\n');
}

function stripRtx(sdp) {
  const lines = sdp.split(/\r?\n/);
  const rtxPayloads = new Set();

  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+rtx\/90000/i);
    if (match) rtxPayloads.add(match[1]);
  }
  if (!rtxPayloads.size) return sdp;

  return lines
    .map(line => {
      if (!line.startsWith('m=video ')) return line;
      const parts = line.split(' ');
      return [...parts.slice(0, 3), ...parts.slice(3).filter(payload => !rtxPayloads.has(payload))].join(' ');
    })
    .filter(line => {
      for (const payload of rtxPayloads) {
        if (line.startsWith(`a=rtpmap:${payload} `)) return false;
        if (line.startsWith(`a=fmtp:${payload} `)) return false;
        if (line.startsWith(`a=rtcp-fb:${payload} `)) return false;
      }
      return true;
    })
    .join('\r\n');
}

function stripVideoFeedback(sdp, { nack = true, pli = false, googRemb = true, transportCc = false } = {}) {
  const lines = sdp.split(/\r?\n/);
  const videoPayloads = new Set();
  let inVideo = false;

  for (const line of lines) {
    if (line.startsWith('m=')) inVideo = line.startsWith('m=video ');
    if (inVideo) {
      const match = line.match(/^a=rtpmap:(\d+)\s+/);
      if (match) videoPayloads.add(match[1]);
    }
  }

  return lines.filter(line => {
    const match = line.match(/^a=rtcp-fb:(\d+)\s+(.+)$/i);
    if (!match || !videoPayloads.has(match[1])) return true;
    const feedback = match[2].toLowerCase();
    if (nack && feedback === 'nack') return false;
    if (pli && feedback === 'nack pli') return false;
    if (googRemb && feedback === 'goog-remb') return false;
    if (transportCc && feedback === 'transport-cc') return false;
    return true;
  }).join('\r\n');
}

function mungeLowLatencySdp(sdp) {
  let out = preferCodec(sdp, 'video', 'H264');
  out = preferCodec(out, 'audio', 'opus');
  out = forceH264BaselineFmtp(out);
  out = forceOpusLowLatencyFmtp(out);
  out = stripRtx(out);
  out = stripVideoFeedback(out, { nack: true, pli: false, googRemb: true, transportCc: false });
  return out;
}

async function tuneVideoSender(sender, { bitrate = 12_000_000, fps = 60 } = {}) {
  const params = sender.getParameters();
  params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}];
  Object.assign(params.encodings[0], {
    active: true,
    maxBitrate: bitrate,
    maxFramerate: fps,
    scaleResolutionDownBy: 1,
    priority: 'high',
    networkPriority: 'high'
  });
  params.degradationPreference = 'maintain-framerate';

  try {
    await sender.setParameters(params);
  } catch {
    delete params.degradationPreference;
    delete params.encodings[0].networkPriority;
    await sender.setParameters(params);
  }
}

async function tuneAudioSender(sender) {
  const params = sender.getParameters();
  params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}];
  Object.assign(params.encodings[0], {
    active: true,
    maxBitrate: 128_000,
    priority: 'high',
    networkPriority: 'high'
  });

  try {
    await sender.setParameters(params);
  } catch {
    delete params.encodings[0].networkPriority;
    await sender.setParameters(params);
  }
}

module.exports = {
  mungeLowLatencySdp,
  preferCodec,
  forceH264BaselineFmtp,
  forceOpusLowLatencyFmtp,
  stripRtx,
  stripVideoFeedback,
  tuneVideoSender,
  tuneAudioSender
};
