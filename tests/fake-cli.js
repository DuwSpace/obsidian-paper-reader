#!/usr/bin/env node
'use strict';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const emit = event => process.stdout.write(JSON.stringify(event) + '\n');
  if (input === 'wait') { setInterval(() => {}, 1000); return; }
  if (input === 'exit-fail') { process.stderr.write('fixture failure'); process.exitCode = 7; return; }
  if (input === 'turn-fail') { emit({ type: 'turn.failed', error: { message: 'fixture turn failure' } }); return; }
  if (input === 'empty') { emit({ type: 'turn.completed' }); return; }
  emit({ type: 'thread.started', thread_id: 'fixture' });
  emit({ type: 'item.completed', item: { type: 'agent_message', text: 'intermediate' } });
  const bytes = Buffer.from(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '中文回答 ' + input } }));
  for (let i = 0; i < bytes.length; i += 2) process.stdout.write(bytes.subarray(i, i + 2));
});
