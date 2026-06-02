'use strict';

const http = require('http');
const WebSocket = require('ws');
const { DesktopDuplicator } = require('./index');

const PORT = Number(process.env.PORT || 8787);

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>DXGI BGRA Preview</title>
  <style>html,body{margin:0;background:#111;color:#fff;font-family:sans-serif}canvas{width:100vw;height:100vh;object-fit:contain}</style>
</head>
<body>
  <canvas id="preview"></canvas>
  <script>
    const canvas = document.querySelector('#preview');
    const ctx = canvas.getContext('2d');
    let meta = null;
    const ws = new WebSocket('ws://' + location.host);
    ws.binaryType = 'arraybuffer';
    ws.onmessage = event => {
      if (typeof event.data === 'string') {
        meta = JSON.parse(event.data);
        canvas.width = meta.width;
        canvas.height = meta.height;
        return;
      }
      const bgra = new Uint8Array(event.data);
      const rgba = new Uint8ClampedArray(meta.width * meta.height * 4);
      for (let i = 0; i < meta.width * meta.height; i++) {
        const p = i * 4;
        rgba[p] = bgra[p + 2];
        rgba[p + 1] = bgra[p + 1];
        rgba[p + 2] = bgra[p];
        rgba[p + 3] = 255;
      }
      ctx.putImageData(new ImageData(rgba, meta.width, meta.height), 0, 0);
    };
  </script>
</body>
</html>`;

async function main() {
  const capture = new DesktopDuplicator({ fps: 60, maxQueueSize: 2 });
  await capture.start();

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  const wss = new WebSocket.Server({ server });
  wss.on('connection', socket => {
    let closed = false;
    socket.on('close', () => { closed = true; });

    (async () => {
      while (!closed && socket.readyState === WebSocket.OPEN) {
        const frame = await capture.nextFrame(16);
        if (!frame) continue;
        socket.send(JSON.stringify({
          width: frame.width,
          height: frame.height,
          stride: frame.stride,
          timestampNs: String(frame.timestampNs || 0)
        }));
        socket.send(frame.data);
        frame.release?.();
      }
    })().catch(error => {
      if (!closed) socket.close(1011, error.message);
    });
  });

  server.listen(PORT, () => console.log(`Preview: http://127.0.0.1:${PORT}`));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
