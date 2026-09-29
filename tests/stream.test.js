'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startStreamRun } = require('../src/core');
const defaults = { binary: path.join(__dirname, 'fake-server.js'), cwd: __dirname, mode: 'ask', prompt: 'hello', timeoutMs: 2000 };
test('stream exposes deltas before completion, final snapshot does not duplicate, usage preserved', async () => {
  const chunks = []; let complete = false;
  const run = startStreamRun({ ...defaults, onText: text => { assert(!complete); chunks.push(text); } });
  const result = await run.promise; complete = true;
  assert.deepEqual(chunks, ['中文', '中文回答', '中文回答']);
  assert.equal(result.text, '中文回答'); assert.equal(result.usage.cached_input_tokens, 10);
});
test('stream forwards reasoning effort and images in structured request', async () => {
  const result = await startStreamRun({ ...defaults, prompt: 'params', effort: 'high', images: ['/vault/图 1.png'] }).promise;
  const params = JSON.parse(result.text);
  assert.equal(params.effort, 'high'); assert.deepEqual(params.input[1], { type: 'localImage', path: '/vault/图 1.png' });
});
test('stream failure and disconnect preserve partial text', async () => {
  for (const prompt of ['fail', 'disconnect']) await assert.rejects(startStreamRun({ ...defaults, prompt }).promise, error => error.partialText === '中文回答');
});
test('stream cancellation and timeout settle promptly', async () => {
  const run = startStreamRun({ ...defaults, prompt: 'wait' });
  run.cancel(); await assert.rejects(run.promise, /停止/);
  await assert.rejects(startStreamRun({ ...defaults, prompt: 'wait', timeoutMs: 100 }).promise, /超时/);
});
