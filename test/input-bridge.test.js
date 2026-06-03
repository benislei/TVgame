'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('InputBridge listens for Android TV TCP JSON input on port 8789', () => {
  const source = readProjectFile('InputBridge/Program.cs');

  assert.match(source, /AndroidTcpInputPort\s*=\s*8789/);
  assert.match(source, /new\s+TcpListener\(IPAddress\.Any,\s*AndroidTcpInputPort\)/);
  assert.match(source, /RunTcpInputServerAsync/);
  assert.match(source, /AcceptTcpClientAsync/);
  assert.match(source, /ReadLineAsync/);
  assert.match(source, /InputInjector\.Dispatch\(doc\.RootElement\)/);
});

test('InputBridge maps Android TV keyCode values to Windows virtual keys', () => {
  const source = readProjectFile('InputBridge/Program.cs');

  assert.match(source, /TryGetInt\(input,\s*"keyCode"/);
  assert.match(source, /AndroidKeyCodeMap/);
  assert.match(source, /\[19\]\s*=\s*0x26/);
  assert.match(source, /\[20\]\s*=\s*0x28/);
  assert.match(source, /\[21\]\s*=\s*0x25/);
  assert.match(source, /\[22\]\s*=\s*0x27/);
  assert.match(source, /\[96\]\s*=\s*0x20/);
  assert.match(source, /\[97\]\s*=\s*0x1B/);
});
