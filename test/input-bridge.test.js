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

test('InputBridge injects raw Android gamepad state as a virtual Xbox controller', () => {
  const project = readProjectFile('InputBridge/InputBridge.csproj');
  const source = readProjectFile('InputBridge/Program.cs');

  assert.match(project, /Nefarius\.ViGEm\.Client/);
  assert.match(source, /using\s+Nefarius\.ViGEm\.Client/);
  assert.match(source, /using\s+Nefarius\.ViGEm\.Client\.Targets\.Xbox360/);
  assert.match(source, /VirtualGamepadInjector/);
  assert.match(source, /ViGEmClient/);
  assert.match(source, /CreateXbox360Controller\(\)/);
  assert.match(source, /controller\.Connect\(\)/);
  assert.match(source, /HandleGamepad\(input\)/);
  assert.match(source, /Xbox360Button\.A/);
  assert.match(source, /Xbox360Button\.B/);
  assert.match(source, /Xbox360Button\.LeftShoulder/);
  assert.match(source, /Xbox360Axis\.LeftThumbX/);
  assert.match(source, /Xbox360Axis\.RightThumbY/);
  assert.match(source, /Xbox360Slider\.LeftTrigger/);
  assert.match(source, /Xbox360Slider\.RightTrigger/);
  assert.match(source, /SubmitReport\(\)/);
  assert.doesNotMatch(source, /虚拟手柄注入将在下一步/);
});

test('InputBridge uses bounded conversion from normalized gamepad values to Xbox report values', () => {
  const source = readProjectFile('InputBridge/Program.cs');

  assert.match(source, /StickToShort\(double\s+value,\s+bool\s+invert/);
  assert.match(source, /TriggerToByte\(double\s+value\)/);
  assert.match(source, /Clamp\(value,\s*-1,\s*1\)/);
  assert.match(source, /short\.MaxValue/);
  assert.match(source, /byte\.MaxValue/);
  assert.match(source, /GetDouble\(input,\s*"lx"/);
  assert.match(source, /GetInt\(input,\s*"buttons"/);
});

test('InputBridge logs throttled gamepad state diagnostics for Android input tracing', () => {
  const source = readProjectFile('InputBridge/Program.cs');

  assert.match(source, /gamepadPacketCount\+\+/);
  assert.match(source, /lastGamepadLogAt/);
  assert.match(source, /lastLoggedButtons/);
  assert.match(source, /LogGamepadState\(input,\s*buttons\)/);
  assert.match(source, /收到手柄状态/);
  assert.match(source, /buttons=/);
  assert.match(source, /lx=/);
  assert.match(source, /rt=/);
});
