'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

function permissionsFor(mode) {
  const allow = ['read', 'glob', 'grep', 'list'];
  if (mode === 'task') allow.push('edit', 'bash');
  return [{ permission: '*', pattern: '*', action: 'deny' }, ...allow.map(permission => ({ permission, pattern: '*', action: 'allow' })), { permission: 'external_directory', pattern: '*', action: 'deny' }];
}
class SSEParser {
  constructor(callback) { this.buffer = ''; this.callback = callback; }
  feed(text) {
    this.buffer += text;
    if (this.buffer.length > 8 * 1024 * 1024) throw new Error('OpenCode 事件超过大小限制');
    let match;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const block = this.buffer.slice(0, match.index); this.buffer = this.buffer.slice(match.index + match[0].length);
      const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data) this.callback(JSON.parse(data));
    }
  }
}
function launch({ binary, cwd }) {
  const password = randomBytes(24).toString('hex');
  // Only this child gets the override; never edit the user's global configuration.
  const env = { ...process.env, PATH: [path.dirname(binary), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH || ''].join(path.delimiter), OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: 'opencode', OPENCODE_CONFIG_CONTENT: JSON.stringify({ share: 'disabled', permission: 'deny' }) };
  const child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd, env, shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stopped = false, endpoint, buffer = '', stderr = '', resolveReady, rejectReady;
  const sockets = new Set();
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timer = setTimeout(() => rejectReady(new Error('OpenCode 启动超时')), 20000);
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', data => {
    buffer = (buffer + data).slice(-10000);
    const url = buffer.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (url && !endpoint) { endpoint = url; clearTimeout(timer); resolveReady(); }
  });
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-1500); });
  child.on('error', error => { clearTimeout(timer); rejectReady(new Error(error.code === 'ENOENT' ? '找不到 OpenCode，请检查插件设置中的路径' : error.message)); });
  child.on('close', () => { clearTimeout(timer); rejectReady(new Error('OpenCode 已退出：' + stderr)); });
  const headers = { Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64'), 'Content-Type': 'application/json', 'x-opencode-directory': encodeURIComponent(cwd) };
  const request = (route, method = 'GET', body, stream) => new Promise((resolve, reject) => {
    if (stopped) return reject(new Error('OpenCode 已停止'));
    const req = http.request(endpoint + route, { method, headers }, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error(`OpenCode ${route} 返回 HTTP ${res.statusCode}`)); return; }
      res.setEncoding('utf8');
      if (stream) { resolve(res); return; }
      let content = '';
      res.on('data', part => { content += part; if (content.length > 32 * 1024 * 1024) req.destroy(new Error('OpenCode 响应过大')); });
      res.on('error', reject); res.on('end', () => { try { resolve(content ? JSON.parse(content) : null); } catch (e) { reject(e); } });
    });
    sockets.add(req); req.on('close', () => sockets.delete(req)); req.on('error', reject);
    req.setTimeout(stream ? 0 : 20000, () => req.destroy(new Error('OpenCode 请求超时')));
    if (body !== undefined) req.write(JSON.stringify(body)); req.end();
  });
  const close = () => {
    if (stopped) return; stopped = true; clearTimeout(timer); rejectReady(new Error('OpenCode 已停止'));
    for (const req of sockets) req.destroy();
    const kill = signal => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch {} };
    kill('SIGTERM'); const force = setTimeout(() => kill('SIGKILL'), 2000); force.unref?.(); child.once('close', () => clearTimeout(force));
  };
  return { ready, request, close, child };
}
function modelsFrom(providers) {
  return (providers.all || []).filter(p => (providers.connected || []).includes(p.id)).flatMap(p => Object.values(p.models || {}).map(m => ({ value: `${p.id}/${m.id}`, label: `${p.id} / ${m.name || m.id}`, efforts: Object.keys(m.variants || {}).filter(v => !m.variants[v]?.disabled), image: m.capabilities?.input?.image === true })));
}
async function discoverOpenCode(options) {
  const server = launch(options);
  try { await server.ready; return modelsFrom(await server.request('/provider')); } finally { server.close(); }
}
function startOpenCodeRun({ binary, cwd, mode, model, effort = '', images = [], prompt, timeoutMs = 900000, onText = () => {}, onEvent = () => {} }) {
  if (!['ask', 'explain', 'idea', 'task'].includes(mode)) throw new Error('未知操作类型');
  const server = launch({ binary, cwd });
  let done = false, submitted = false, collecting = false, sessionID, text = '', stream, resolveRun, rejectRun;
  const parts = new Map(), assistants = new Set();
  const promise = new Promise((resolve, reject) => { resolveRun = resolve; rejectRun = reject; });
  const timer = setTimeout(() => finish(new Error('OpenCode 任务超时，已停止')), timeoutMs);
  function finish(error, result) {
    if (done) return; done = true; clearTimeout(timer);
    stream?.destroy(); server.close();
    if (error) { error.partialText = text; rejectRun(error); } else resolveRun(result);
  }
  const publish = () => {
    const next = [...parts.values()].filter(p => p.type === 'text' && assistants.has(p.messageID)).map(p => p.text || '').join('\n\n');
    if (next !== text) { text = next; onText(text); }
  };
  const collect = async () => {
    if (done || collecting || !submitted) return; collecting = true;
    try {
      const messages = await server.request(`/session/${sessionID}/message`);
      if (done) return;
      const replies = messages.filter(m => m.info.role === 'assistant');
      const last = replies.at(-1);
      if (last?.info.error) throw new Error(last.info.error.data?.message || last.info.error.name || 'OpenCode 回答失败');
      if (!last?.info.time?.completed) { collecting = false; return; }
      const answer = last.parts.filter(p => p.type === 'text').map(p => p.text).join('\n\n');
      if (!answer.trim()) throw new Error('OpenCode 未返回回答');
      const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
      for (const { info } of replies) { const t = info.tokens || {}; usage.input_tokens += (t.input || 0) + (t.cache?.read || 0) + (t.cache?.write || 0); usage.cached_input_tokens += t.cache?.read || 0; usage.output_tokens += (t.output || 0) + (t.reasoning || 0); }
      text = answer; onText(text); finish(null, { text, usage, model: `${last.info.providerID}/${last.info.modelID}`, stderr: '' });
    } catch (e) { finish(e); }
  };
  server.child.on('close', () => { if (!done) finish(new Error('OpenCode 流连接提前关闭')); });
  (async () => {
    await server.ready;
    const providers = await server.request('/provider');
    const config = await server.request('/config');
    const selected = model || config.model;
    if (!selected) throw new Error('请先在侧栏选择 OpenCode 模型，或在 OpenCode 中配置默认模型');
    const split = selected.indexOf('/');
    if (split <= 0 || split === selected.length - 1) throw new Error('OpenCode 模型格式应为 provider/model');
    const known = modelsFrom(providers).find(m => m.value === selected);
    if (images.length && !known?.image) throw new Error('该 OpenCode 模型未声明支持图片，请选择支持图片的模型或移除附件');
    if (effort && known && !known.efforts.includes(effort)) throw new Error('该 OpenCode 模型不支持所选思考强度，请重新选择');
    const session = await server.request('/session', 'POST', { title: 'Obsidian 阅读助手', permission: permissionsFor(mode) });
    sessionID = session.id;
    stream = await server.request('/event', 'GET', undefined, true);
    const parser = new SSEParser(event => {
      if (done) return;
      const p = event.properties || {}, part = p.part, info = p.info;
      if ((p.sessionID || part?.sessionID || info?.sessionID) !== sessionID) return;
      if (event.type === 'message.updated' && info.role === 'assistant') { assistants.add(info.id); if (info.error) return finish(new Error(info.error.data?.message || info.error.name)); publish(); }
      if (event.type === 'message.part.updated') { parts.set(part.id, part); publish(); }
      if (event.type === 'message.part.delta' && p.field === 'text') { const old = parts.get(p.partID); if (old) { old.text = (old.text || '') + p.delta; publish(); } }
      if (event.type === 'session.error') return finish(new Error(p.error?.data?.message || p.error?.name || 'OpenCode 会话失败'));
      if (event.type === 'permission.asked' || event.type === 'question.asked') return finish(new Error('OpenCode 请求交互确认，当前侧栏不支持；请调整任务范围'));
      onEvent({ method: event.type, params: p });
      if (event.type === 'session.idle' || (event.type === 'session.status' && p.status?.type === 'idle')) collect();
    });
    stream.on('data', chunk => { try { parser.feed(chunk); } catch (e) { finish(e); } });
    stream.on('error', e => { if (!done) finish(e); }); stream.on('end', () => { if (!done) finish(new Error('OpenCode 事件流中断')); });
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
    const input = [{ type: 'text', text: prompt }, ...images.map(file => { const type = mime[path.extname(file).toLowerCase()]; if (!type) throw new Error('不支持的图片格式'); const bytes = readFileSync(file); if (bytes.length > 20 * 1024 * 1024) throw new Error('图片超过 20 MB'); return { type: 'file', mime: type, filename: path.basename(file), url: `data:${type};base64,${bytes.toString('base64')}` }; })];
    submitted = true;
    await server.request(`/session/${sessionID}/prompt_async`, 'POST', { agent: 'build', model: { providerID: selected.slice(0, split), modelID: selected.slice(split + 1) }, ...(effort ? { variant: effort } : {}), parts: input });
    onEvent({ method: 'thread/started' });
  })().catch(finish);
  return { promise, cancel: () => finish(new Error('任务已停止')) };
}
module.exports = { discoverOpenCode, startOpenCodeRun, SSEParser, permissionsFor, modelsFrom };
