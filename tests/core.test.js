'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeMarkdown, extractReferences, excerptFor, compactHistory, JsonLines, argsFor, startRun, buildPrompt, noteContent, safeName, paperFolder, headingAt } = require('../src/core');
const fixture = path.join(__dirname, 'fake-cli.js');
const context = { path: 'omni/2024-SD3/paper.md', folder: 'omni/2024-SD3', paper: 'omni/2024-SD3/paper.md', paperId: 'SD3-2024', heading: '2. 理论', selection: '选区', text: '# Paper\n正文' };
const job = { context, mode: 'explain', question: '解释推导' };
const run = prompt => startRun({ binary: fixture, cwd: __dirname, mode: 'ask', prompt, timeoutMs: 4000 });
test('JSONL handles UTF-8 fragmentation, noise and final line without newline', () => {
  const events = []; const parser = new JsonLines(e => events.push(e));
  const bytes = Buffer.from('noise\n' + JSON.stringify({ text: '中文🧠' }) + '\n' + JSON.stringify({ end: true }));
  for (const byte of bytes) parser.feed(Buffer.from([byte])); parser.end();
  assert.deepEqual(events, [{ text: '中文🧠' }, { end: true }]);
});
test('mode permissions and model are separate argv tokens; no shell expansion', () => {
  assert.equal(argsFor('ask', '')[argsFor('ask', '').indexOf('--sandbox') + 1], 'read-only');
  assert.equal(argsFor('task', '')[argsFor('task', '').indexOf('--sandbox') + 1], 'workspace-write');
  assert(argsFor('ask', 'model $(touch /tmp/nope)').includes('model $(touch /tmp/nope)'));
  assert.throws(() => argsFor('bad'));
});
test('actual process receives stdin literally and selects last completed answer', async () => {
  const input = '`echo NOT_EXECUTED` $(echo test)\n中文';
  const answer = await run(input).promise;
  assert.equal(answer.text, '中文回答 ' + input);
});
test('nonzero exit, failed turn, missing answer and missing binary are errors', async () => {
  await assert.rejects(run('exit-fail').promise, /fixture failure/);
  await assert.rejects(run('turn-fail').promise, /fixture turn failure/);
  await assert.rejects(run('empty').promise, /未返回回答/);
  await assert.rejects(startRun({ binary: '/nonexistent/codex', cwd: __dirname, mode: 'ask', prompt: 'x' }).promise, /找不到 Codex/);
});
test('cancellation and timeout terminate process', async () => {
  const running = run('wait'); setTimeout(() => running.cancel(), 100);
  await assert.rejects(running.promise, /已停止/);
  await assert.rejects(startRun({ binary: fixture, cwd: __dirname, mode: 'ask', prompt: 'wait', timeoutMs: 100 }).promise, /超时/);
});
test('context includes selected text and recent conversation with bounded note excerpt', () => {
  const prompt = buildPrompt({ ...job, context: { ...context, text: 'x'.repeat(71000) } }, [{ role: 'assistant', text: '已有解释' }]);
  assert(prompt.includes('选区')); assert(prompt.includes('已有解释')); assert(prompt.includes('"excerptTruncated": true'));
  assert(prompt.includes('不要写入')); assert(prompt.endsWith('解释推导'));
});
test('archive content has provenance, back link, valid escaped metadata and strips model YAML', () => {
  const text = noteContent({ ...job, context: { ...context, heading: '测试 "标题"' } }, '---\n类型: 错误\n---\n# 解读\n正文');
  assert(text.includes('类型: "专题解读"')); assert(!text.includes('类型: 错误'));
  assert(text.includes('状态: "整理中"')); assert(text.includes('返回来源笔记'));
  assert(text.includes('原文位置: "测试 \\"标题\\""'.replaceAll('\\\\','\\')));
});
test('folder resolution, safe filenames and heading ignores fenced examples', () => {
  assert.equal(paperFolder('omni/2024-SD3/解读/note.md'), 'omni/2024-SD3');
  assert.equal(paperFolder('欢迎.md'), null);
  assert(!/[/:\[\]#]/.test(safeName('../a:#test[x]')));
  assert.equal(headingAt('# Main\n```\n## fake\n```\ntext', 4), 'Main');
});
test('Markdown normalization converts math delimiters but preserves code', () => {
  const value = '# 标题\n\n\\(x_0\\)\n\\[\nx^2+1\n\\]\n\n`\\(keep\\)`\n```js\n"\\[keep\\]"\n```';
  const actual = normalizeMarkdown(value);
  assert(actual.includes('$x_0$')); assert(actual.includes('$$\nx^2+1\n$$'));
  assert(actual.includes('`\\(keep\\)`')); assert(actual.includes('"\\[keep\\]"'));
  assert.equal(normalizeMarkdown('```markdown\n# H\n\ntext\n```'),'# H\n\ntext');
});
test('formula/image selector extracts exact source, numbering and local paths, excluding code', () => {
  const note = '# Method\n\n$$\nx_t=x_0\\tag{23}\n$$\n\nInline $x_0$.\n\n![图 2](attachments/a%20b.png)\n\n图注\n\n![[plot.png|400]]\n```\n$$fake$$\n![fake](x.png)\n```';
  const refs = extractReferences(note);
  assert.equal(refs.length,4); assert.equal(refs[0].label,'公式 (23)');
  assert(refs[0].text.includes('\\tag{23}'));assert.equal(refs[0].heading,'Method');
  assert.equal(refs[2].link,'attachments/a b.png');assert.equal(refs[2].caption,'图注');assert.equal(refs[3].link,'plot.png');
});
test('focused context uses selected position rather than beginning, with strict history budget', () => {
  const c = {text:'A'.repeat(15000)+'TARGET'+'Z'.repeat(15000),selection:'TARGET'};
  assert(excerptFor(c).text.includes('TARGET'));assert.equal(excerptFor(c).text.length,6000);
  assert.equal(excerptFor(c,'selection').text,''); assert.equal(excerptFor(c,'full').text,c.text);
  const history = compactHistory(Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',text:'x'.repeat(5000)})));
  assert(history.reduce((n,m)=>n+m.text.length,0)<=4000);assert(history.length<=4);
});
test('image argv stays separate and selected attachment is present in context', () => {
  const args = argsFor('ask','test-model',['/vault/图 2.png']);
  assert.equal(args[args.indexOf('--image')+1],'/vault/图 2.png');
  const prompt=buildPrompt({...job,context:{...context,attachments:[{kind:'image',path:'a.png',label:'图 2',text:'![图 2](a.png)'}]}});
  assert(prompt.includes('a.png'));
});

test('reasoning effort is an explicit per-request config override', () => {
  const args = argsFor('ask', 'test-model', [], 'high');
  assert(args.includes('model_reasoning_effort="high"'));
  assert(!argsFor('ask', '').some(a => a.startsWith('model_reasoning_effort')));
  assert.throws(() => argsFor('ask', '', [], 'invalid'), /思考强度/);
});

test('configurable paper roots support nested folders and reject traversal',()=>{
 const {archiveOptions}=require('../src/core');
 assert.equal(paperFolder('Research/Papers/Example/Notes/a.md','Research/Papers'),'Research/Papers/Example');
 assert.equal(paperFolder('Research/Papers-other/Example/a.md','Research/Papers'),null);
 for(const root of ['/tmp','../outside','Papers/../Other','Papers//Other','C:\\Notes'])assert.throws(()=>archiveOptions({paperRoot:root}));
 assert.equal(archiveOptions({paperRoot:'Research/Papers',metadataLanguage:'en'}).root,'Research/Papers');
});
