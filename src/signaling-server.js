'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const rooms = new Map();

function sendJson(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function peersInRoom(room) {
  return rooms.get(room) || new Set();
}

function joinRoom(socket, room, role) {
  socket.room = String(room || 'default');
  socket.role = role || 'peer';

  if (!rooms.has(socket.room)) rooms.set(socket.room, new Set());
  const peers = rooms.get(socket.room);
  peers.add(socket);

  sendJson(socket, {
    type: 'joined',
    room: socket.room,
    role: socket.role,
    peers: peers.size
  });

  for (const peer of peers) {
    if (peer !== socket) {
      sendJson(peer, { type: 'peer-joined', room: socket.room, role: socket.role, peers: peers.size });
    }
  }
}

function leaveRoom(socket) {
  if (!socket.room) return;

  const peers = rooms.get(socket.room);
  if (!peers) return;

  peers.delete(socket);
  for (const peer of peers) {
    sendJson(peer, { type: 'peer-left', room: socket.room, peers: peers.size });
  }
  if (peers.size === 0) rooms.delete(socket.room);
}

function relay(socket, message) {
  const peers = peersInRoom(socket.room);
  for (const peer of peers) {
    if (peer !== socket) {
      sendJson(peer, {
        ...message,
        room: socket.room,
        from: socket.role || 'peer'
      });
    }
  }
}

function handleSignal(socket, raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    sendJson(socket, { type: 'error', message: 'Invalid JSON' });
    return;
  }

  if (message.type === 'join') {
    joinRoom(socket, message.room, message.role);
    return;
  }

  if (!socket.room) {
    sendJson(socket, { type: 'error', message: 'Join a room before sending signaling messages' });
    return;
  }

  if (['offer', 'answer', 'candidate', 'control', 'bye'].includes(message.type)) {
    relay(socket, message);
    return;
  }

  sendJson(socket, { type: 'error', message: `Unsupported type: ${message.type}` });
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname === '/' ? '/receiver.html' : url.pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, route));

  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(file) });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
wss.on('connection', (socket, req) => {
  socket.remoteAddress = req.socket.remoteAddress;
  socket.on('message', raw => handleSignal(socket, raw));
  socket.on('close', () => leaveRoom(socket));
  socket.on('error', () => leaveRoom(socket));
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Signaling server listening on http://0.0.0.0:${PORT}`);
    console.log(`Receiver page: http://<this-pc-lan-ip>:${PORT}/receiver.html?room=game`);
  });
}

module.exports = { server, wss, handleSignal, rooms };
