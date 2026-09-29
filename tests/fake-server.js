#!/usr/bin/env node
'use strict';
const readline = require('node:readline');
const emit = data => process.stdout.write(JSON.stringify(data) + '\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  const reply = result => emit({ id: request.id, result });
  if (request.method === 'initialize') return reply({});
  if (request.method === 'thread/start') {
    if (request.params.approvalPolicy !== 'never' || !request.params.ephemeral) process.exit(4);
    return reply({ thread: { id: 't1' } });
  }
  if (request.method !== 'turn/start') return;
  reply({ turn: { id: 'turn1' } });
  const prompt = request.params.input[0].text;
  if (prompt === 'wait') return;
  emit({ method: 'item/agentMessage/delta', params: { threadId: 't1', itemId: 'a', delta: '中文' } });
  setTimeout(() => {
    emit({ method: 'item/agentMessage/delta', params: { threadId: 't1', itemId: 'a', delta: '回答' } });
    if (prompt === 'disconnect') return process.exit(3);
    if (prompt === 'fail') return emit({ method: 'turn/completed', params: { threadId: 't1', turn: { status: 'failed', error: { message: 'fixture failure' } } } });
    const text = prompt === 'params' ? JSON.stringify(request.params) : '中文回答';
    emit({ method: 'item/completed', params: { threadId: 't1', item: { type: 'agentMessage', id: 'a', text } } });
    emit({ method: 'thread/tokenUsage/updated', params: { threadId: 't1', tokenUsage: { total: { inputTokens: 30, cachedInputTokens: 10, outputTokens: 5 } } } });
    emit({ method: 'turn/completed', params: { threadId: 't1', turn: { status: 'completed' } } });
  }, 50);
});
