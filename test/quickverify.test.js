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
