'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const programPath = path.join(__dirname, '..', 'QuickVerify', 'Program.cs');

function readProgram() {
  return fs.readFileSync(programPath, 'utf8');
}

test('QuickVerify offers a one-click stage 2 check and RTP sender entry', () => {
  const source = readProgram();

  assert.match(source, /一键阶段 2：检测环境 \+ 启动 RTP 发送端/);
  assert.match(source, /if \(choice == "13"\)/);
  assert.match(source, /run stage2:check && .*run native:rtp -- --host/);
});

test('QuickVerify uses localhost as the default Android TV IP', () => {
  const source = readProgram();

  assert.match(source, /请输入 Android TV IP（默认 127\.0\.0\.1）：/);
  assert.match(source, /string\.IsNullOrWhiteSpace\(tvIp\) \? "127\.0\.0\.1" : tvIp/);
  assert.doesNotMatch(source, /电视 IP 不能为空/);
});

test('QuickVerify validates Android TV IP as IPv4 before command launch', () => {
  const source = readProgram();

  assert.match(source, /static string\? ReadValidatedAndroidTvIpOrDefault\(\)/);
  assert.match(source, /IPAddress\.TryParse\(candidate, out var address\)/);
  assert.match(source, /address\.AddressFamily == AddressFamily\.InterNetwork/);
  assert.match(source, /Android TV IP 必须是合法的 IPv4 地址。/);
});

test('QuickVerify rejects dangerous Android TV IP input before building npm command', () => {
  const source = readProgram();

  assert.match(source, /var tvIp = ReadValidatedAndroidTvIpOrDefault\(\);\s+if \(tvIp == null\) continue;\s+StartCommandWindow\([\s\S]+?--host \{Quote\(tvIp\)\}/);
});
