'use strict';
const { Plugin, ItemView, MarkdownView, MarkdownRenderer, Component, Notice, PluginSettingTab, Setting, TFile, normalizePath, Modal, finishRenderMath } = require('obsidian');
const { existsSync, readFileSync, realpathSync } = require('node:fs');
const nodePath = require('node:path');
const { homedir } = require('node:os');
const { archiveOptions, normalizeMarkdown, extractReferences, excerptFor, MODES, safeName, paperFolder, headingAt, buildPrompt, startStreamRun, noteContent } = require('./core');
const { discoverOpenCode, startOpenCodeRun } = require('./opencode');
const backendLabel = id => id === 'opencode' ? 'OpenCode' : 'Codex';
const VIEW = 'paper-reader-view';
const DEFAULTS = {
  binary: ['/opt/homebrew/bin/codex', '/usr/local/bin/codex'].find(existsSync) || 'codex',
  backend: 'codex', opencodeBinary: [nodePath.join(homedir(), '.opencode/bin/opencode'), '/opt/homebrew/bin/opencode'].find(existsSync) || 'opencode', opencodeModel: '', opencodeEffort: '',
  paperRoot: 'Papers', explainFolder: 'Explanations', ideaFolder: 'Ideas', metadataLanguage: 'en', answerLanguage: 'English',
  model: '', effort: '', timeoutMinutes: 15, scope: 'focus'
};


function modelOptions() {
  try {
    const root = process.env.CODEX_HOME || nodePath.join(homedir(), '.codex');
    const cache = JSON.parse(readFileSync(nodePath.join(root, 'models_cache.json'), 'utf8'));
    return (cache.models || []).filter(m => m.visibility !== 'hide' && m.slug).map(m => ({ value: m.slug, label: m.display_name || m.slug, efforts: (m.supported_reasoning_levels || []).map(r => r.effort) }));
  } catch { return []; }
}
class ReferenceModal extends Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; this.source = { ...plugin.context }; this.entries = extractReferences(this.source.text); }
  onOpen() {
    this.contentEl.addClass('cr-reference-picker');
    this.contentEl.createEl('h2', { text: '添加公式或图片' });
    this.contentEl.createEl('p', { text: '公式读取原始 LaTeX；图片作为视觉附件发送。可按公式编号、图号或章节搜索。' });
    const search = this.contentEl.createEl('input', { attr: { placeholder: '例如：公式 (23)、图 2、QK', 'aria-label': '搜索公式或图片' } });
    const kind = this.contentEl.createEl('select', { attr: { 'aria-label': '引用类型' } });
    for (const [value, text] of [['all', '全部'], ['formula', '公式'], ['image', '图片']]) kind.createEl('option', { value, text });
    const list = this.contentEl.createDiv({ cls: 'cr-reference-list' });
    this.component = new Component(); this.component.load(); let epoch = 0;
    const draw = async () => {
      const run = ++epoch; list.empty();
      const q = search.value.toLowerCase();
      const entries = this.entries.filter(e => (kind.value === 'all' || kind.value === e.kind) && `${e.label} ${e.heading} ${e.text}`.toLowerCase().includes(q));
      list.createDiv({ cls: 'cr-muted', text: `匹配 ${entries.length} 项，显示前 40 项` });
      for (const entry of entries.slice(0, 40)) {
        if (run !== epoch || !this.component) return;
        const row = list.createDiv({ cls: 'cr-reference-row' });
        row.createDiv({ text: entry.label }); row.createDiv({ cls: 'cr-muted', text: entry.heading });
        const preview = row.createDiv({ cls: 'cr-reference-preview markdown-rendered' });
        const add = row.createEl('button', { text: '添加到问题' });
        add.onclick = () => { try { this.plugin.addReference(entry, this.source); this.close(); } catch (e) { new Notice(e.message); } };
        if (entry.kind === 'formula') {
          await MarkdownRenderer.render(this.app, entry.text, preview, this.source.path, this.component);
        } else {
          const file = this.plugin.resolveImage(entry.link, this.source.path);
          if (file) preview.createEl('img', { attr: { src: this.app.vault.getResourcePath(file), alt: entry.label, loading: 'lazy' } });
          else { preview.setText('图片未保存在本地或格式不支持'); add.disabled = true; }
        }
      }
      await finishRenderMath();
    };
    const redraw = () => draw().catch(e => new Notice(e.message));
    search.oninput = redraw; kind.onchange = redraw; redraw(); search.focus();
  }
  onClose() { this.component?.unload(); this.component = null; this.contentEl.empty(); }
}

class ReaderView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.renderEpoch = 0; }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Paper Reader'; }
  getIcon() { return 'messages-square'; }
  async onOpen() {
    this.closed = false;
    const root = this.contentEl; root.empty(); root.addClass('codex-reader');
    const top = root.createDiv({ cls: 'cr-top' });
    top.createEl('h3', { text: 'Paper Reader' });
    this.newButton = top.createEl('button', { text: '新对话', attr: { title: '清空当前论文的侧栏对话，不删除已生成笔记' } });
    this.newButton.onclick = () => this.plugin.newConversation();
    this.contextEl = root.createDiv({ cls: 'cr-context' });
    const bar = root.createDiv({ cls: 'cr-tools' });
    const refresh = bar.createEl('button', { text: '获取阅读位置' });
    refresh.onclick = () => { this.plugin.capture(this.plugin.lastView).catch(e => this.plugin.report(e)); };
    const refs = bar.createEl('button', { text: '添加公式/图片' });
    refs.onclick = () => { if (this.plugin.context) new ReferenceModal(this.app, this.plugin).open(); else new Notice('先打开一篇笔记'); };
    const clear = bar.createEl('button', { text: '清除选区' });
    clear.onclick = () => { if (this.plugin.context) { this.plugin.context.selection = ''; this.plugin.context.attachments = []; } this.updateContext(); };
    const options = root.createDiv({ cls: 'cr-options' });
    this.modeEl = options.createEl('select', { attr: { 'aria-label': '操作类型' } });
    for (const [key, mode] of Object.entries(MODES)) this.modeEl.createEl('option', { value: key, text: mode.label });
    this.modeEl.value = this.plugin.mode;
    this.modeEl.onchange = () => { this.plugin.mode = this.modeEl.value; this.updateMode(); };
    const backendRow = root.createDiv({ cls: 'cr-model-row' });
    backendRow.createEl('label', { text: '执行后端' });
    this.backendEl = backendRow.createEl('select', { attr: { 'aria-label': '执行后端' } });
    for (const id of ['codex', 'opencode']) this.backendEl.createEl('option', { value: id, text: backendLabel(id) });
    this.backendEl.value = this.plugin.settings.backend;
    this.backendEl.onchange = async () => { this.plugin.settings.backend = this.backendEl.value; await this.plugin.persist(); this.refreshModels(); this.updateMode(); };
    const modelRow = root.createDiv({ cls: 'cr-model-row' });
    modelRow.createEl('label', { text: '模型' });
    this.modelEl = modelRow.createEl('select', { attr: { 'aria-label': '模型' } });
    const refreshModels = modelRow.createEl('button', { text: '刷新', attr: { 'aria-label': '刷新模型列表' } });
    refreshModels.onclick = () => this.refreshModels(true);
    this.customModel = root.createEl('input', { attr: { placeholder: '输入模型 ID，按 Enter 保存', 'aria-label': '自定义模型 ID' } }); this.customModel.style.display = 'none';
    this.modelEl.onchange = async () => {
      if (this.modelEl.value === '__custom__') { this.customModel.style.display = ''; this.customModel.focus(); return; }
      this.customModel.style.display = 'none'; this.plugin.setChoice('model', this.modelEl.value); this.updateEfforts(); await this.plugin.persist();
    };
    this.customModel.onkeydown = async event => {
      if (event.key !== 'Enter' || !this.customModel.value.trim()) return;
      event.preventDefault(); this.plugin.setChoice('model', this.customModel.value.trim());
      this.customModel.style.display = 'none'; this.drawModels(); await this.plugin.persist();
    };
    const effortRow = root.createDiv({ cls: 'cr-model-row' });
    effortRow.createEl('label', { text: '思考强度' });
    this.effortEl = effortRow.createEl('select', { attr: { 'aria-label': '思考强度' } });
    this.effortEl.onchange = async () => { this.plugin.setChoice('effort', this.effortEl.value); await this.plugin.persist(); };
    this.modelStatusEl = root.createDiv({ cls: 'cr-muted' });
    this.refreshModels();
    const scopeRow = root.createDiv({ cls: 'cr-model-row' }); scopeRow.createEl('label', { text: '上下文' });
    this.scopeEl = scopeRow.createEl('select', { attr: { 'aria-label': '上下文范围' } });
    for (const [value, text] of [['focus','选区附近（默认）'],['selection','仅选区与附件'],['chapter','较大范围'],['full','整篇笔记']]) this.scopeEl.createEl('option', { value, text });
    this.scopeEl.value = this.plugin.settings.scope;
    this.scopeEl.onchange = async () => { this.plugin.settings.scope = this.scopeEl.value; await this.plugin.persist(); this.updateContext(); };
    this.hintEl = root.createDiv({ cls: 'cr-hint' });
    this.messagesEl = root.createDiv({ cls: 'cr-messages', attr: { 'aria-live': 'polite' } });
    this.progressEl = root.createDiv({ cls: 'cr-progress', attr: { role: 'status' } });
    this.inputEl = root.createEl('textarea', { cls: 'cr-input', attr: { placeholder: '输入问题；⌘/Ctrl + Enter 发送', 'aria-label': 'Ask Paper Reader', rows: '4' } });
    this.inputEl.value = this.plugin.draft;
    this.inputEl.oninput = () => { this.plugin.draft = this.inputEl.value; };
    this.inputEl.onkeydown = event => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) { event.preventDefault(); this.send(); }
    };
    const actions = root.createDiv({ cls: 'cr-actions' });
    this.sendButton = actions.createEl('button', { text: '发送', cls: 'mod-cta' });
    this.sendButton.onclick = () => this.send();
    this.stopButton = actions.createEl('button', { text: '停止' });
    this.stopButton.onclick = () => this.plugin.stop();
    this.clearQueueButton = actions.createEl('button', { text: '清空排队' });
    this.clearQueueButton.onclick = () => this.plugin.clearQueue();
    root.createDiv({ cls: 'cr-footnote', text: '默认只附选区附近内容及近期对话；所选图片会作为附件发送。模型切换对下一条提交的问题生效。' });
    this.updateContext(); this.updateMode(); this.updateStatus(); await this.renderMessages();
  }
  async refreshModels(force = false) {
    const backend = this.plugin.settings.backend;
    this.customModel.style.display = 'none'; this.drawModels();
    if (backend !== 'opencode') { this.modelStatusEl.setText(''); return; }
    if (this.plugin.openCodeModels && !force) { this.modelStatusEl.setText(`已读取 ${this.plugin.openCodeModels.length} 个模型`); return; }
    this.modelStatusEl.setText('正在读取 OpenCode 模型…');
    try {
      this.plugin.openCodeModels = await discoverOpenCode({ binary: this.plugin.settings.opencodeBinary, cwd: this.app.vault.adapter.getBasePath() });
      if (this.closed || this.plugin.settings.backend !== backend) return;
      this.drawModels(); this.modelStatusEl.setText(`已读取 ${this.plugin.openCodeModels.length} 个模型；图片支持以所选模型为准`);
    } catch (e) { if (!this.closed && this.plugin.settings.backend === backend) this.modelStatusEl.setText('模型列表读取失败：' + e.message); }
  }
  drawModels() {
    const backend = this.plugin.settings.backend;
    const models = [...this.plugin.models()];
    const model = this.plugin.choice('model');
    if (model && !models.some(m => m.value === model)) models.push({ value: model, label: model });
    this.modelEl.empty(); this.modelEl.createEl('option', { value: '', text: `沿用 ${backendLabel(backend)} 配置` });
    for (const m of models) this.modelEl.createEl('option', { value: m.value, text: m.label });
    this.modelEl.createEl('option', { value: '__custom__', text: '自定义模型…' }); this.modelEl.value = model || '';
    this.customModel.placeholder = backend === 'opencode' ? 'provider/model，按 Enter 保存' : '输入模型 ID，按 Enter 保存';
    this.updateEfforts();
  }
  updateEfforts() {
    if (!this.effortEl) return;
    const known = this.plugin.models().find(m => m.value === this.plugin.choice('model'));
    const levels = known ? known.efforts || [] : this.plugin.settings.backend === 'opencode' ? [] : ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
    const labels = { low: '低', medium: '中', high: '高', xhigh: '很高', max: '最大', ultra: 'Ultra（自动任务委派）', none: '无', minimal: '最小' };
    this.effortEl.empty();
    this.effortEl.createEl('option', { value: '', text: `沿用 ${backendLabel(this.plugin.settings.backend)} 配置` });
    for (const level of levels) this.effortEl.createEl('option', { value: level, text: `${labels[level] || level} · ${level}` });
    if (known && this.plugin.choice('effort') && !levels.includes(this.plugin.choice('effort'))) this.plugin.setChoice('effort', '');
    this.effortEl.value = this.plugin.choice('effort') || '';
    this.effortEl.disabled = levels.length === 0;
    this.effortEl.title = levels.length ? '按当前后端声明的模型选项显示' : '当前模型没有声明可选思考强度';
  }
  send() {
    const question = this.inputEl.value.trim();
    if (!question) return new Notice('请输入问题或任务');
    if (this.plugin.enqueue(question)) { this.inputEl.value = ''; this.plugin.draft = ''; }
  }
  updateContext() {
    if (!this.contextEl) return;
    const c = this.plugin.context; this.contextEl.empty();
    if (!c) { this.contextEl.createDiv({ text: '打开一篇 Markdown 笔记，选中需要解释的内容。' }); return; }
    this.contextEl.createDiv({ cls: 'cr-source', text: c.path });
    if (c.heading) this.contextEl.createDiv({ text: c.heading });
    if (c.selection) this.contextEl.createEl('blockquote', { text: c.selection.slice(0, 450) + (c.selection.length > 450 ? '…' : '') });
    else this.contextEl.createDiv({ cls: 'cr-muted', text: '拖选正文可包含公式与图片；也可单击公式或图片。' });
    for (const ref of c.attachments || []) {
      const chip = this.contextEl.createDiv({ cls: 'cr-attachment' });
      chip.createSpan({ text: ref.kind === 'image' ? `图片：${ref.label}` : ref.label });
      const remove = chip.createEl('button', { text: '×', attr: { 'aria-label': `移除 ${ref.label}` } });
      remove.onclick = () => { c.attachments = c.attachments.filter(item => item.id !== ref.id); this.updateContext(); };
    }
    const excerpt = excerptFor(c, this.plugin.settings.scope);
    this.contextEl.createDiv({ cls: 'cr-muted', text: `笔记摘录 ${excerpt.text.length.toLocaleString()} 字符 · 图片 ${(c.attachments || []).filter(r => r.kind === 'image').length} 张` });
  }
  updateMode() {
    if (!this.modeEl) return;
    this.modeEl.value = this.plugin.mode; this.hintEl.setText(this.plugin.settings.backend === 'opencode' && this.plugin.mode === 'task' ? 'OpenCode 任务可修改文件、执行命令；其工具权限不等同于操作系统沙箱。' : MODES[this.plugin.mode].hint);
    this.hintEl.toggleClass('cr-task-hint', this.plugin.mode === 'task');
  }
  updateStatus() {
    if (!this.progressEl) return;
    this.progressEl.setText(this.plugin.status + (this.plugin.queue.length ? ` · 排队 ${this.plugin.queue.length} 项` : ''));
    this.sendButton.setText(this.plugin.active ? '加入队列' : '发送');
    this.stopButton.disabled = !this.plugin.active;
    this.clearQueueButton.disabled = !this.plugin.queue.length;
    this.newButton.disabled = !!this.plugin.active || !!this.plugin.queue.length;
  }
  async renderMessages() {
    if (!this.messagesEl) return;
    const epoch = ++this.renderEpoch;
    if (this.mdComponent) { this.removeChild(this.mdComponent); this.mdComponent = null; }
    this.mdComponent = new Component(); this.addChild(this.mdComponent);
    this.messagesEl.empty();
    const messages = this.plugin.history();
    if (!messages.length) this.messagesEl.createDiv({ cls: 'cr-empty', text: '选中段落后提问，或输入章节、公式编号。解读与想法会保存在所属论文目录。' });
    for (const message of messages) {
      if (epoch !== this.renderEpoch) return;
      const box = this.messagesEl.createDiv({ cls: `cr-message cr-${message.role}` });
      box.createDiv({ cls: 'cr-message-label', text: message.role === 'user' ? `你 · ${MODES[message.mode]?.label || '提问'}` : message.role === 'error' ? '未完成' : backendLabel(message.backend) });
      const body = box.createDiv({ cls: 'cr-body markdown-rendered' });
      if (message.role === 'assistant') {
        await MarkdownRenderer.render(this.app, normalizeMarkdown(message.text), body, message.source || '', this.mdComponent);
        await finishRenderMath();
        if (epoch !== this.renderEpoch) return;
      } else body.setText(message.text);
      if (message.usage) {
        const u = message.usage;
        box.createDiv({ cls: 'cr-usage', text: `Token · 输入 ${u.input_tokens ?? '—'}（含缓存 ${u.cached_input_tokens ?? 0}） · 输出 ${u.output_tokens ?? '—'}` });
      }
      if (message.model) box.createDiv({ cls: 'cr-muted', text: `模型：${message.model}${message.effort ? ` · 思考强度：${message.effort}` : ''}` });
      if (message.file) {
        const open = box.createEl('button', { text: '打开已保存笔记' });
        open.onclick = () => this.app.workspace.openLinkText(message.file, message.source || '', false);
      }
      if (message.role === 'assistant') {
        const copy = box.createEl('button', { text: '复制回答', cls: 'cr-copy' });
        copy.onclick = async () => { try { await navigator.clipboard.writeText(message.text); new Notice('已复制'); } catch { new Notice('复制失败，请手动选择文字'); } };
      }
    }
    if (this.streamEl?.isConnected) this.messagesEl.appendChild(this.streamEl);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    this.scheduleStream();
  }
  scheduleStream() {
    if (this.closed || this.plugin.disposed || this.streamTimer || this.streamBusy || !this.messagesEl) return;
    this.streamTimer = setTimeout(() => {
      this.streamTimer = null;
      this.renderStream().catch(e => console.error('Codex streaming render:', e));
    }, 120);
  }
  async renderStream() {
    const active = this.plugin.active;
    const text = active?.job.key === this.plugin.key() ? active.text || '' : '';
    if (!text) {
      this.streamEl?.remove(); this.streamEl = null;
      if (this.streamComponent) { this.removeChild(this.streamComponent); this.streamComponent = null; }
      this.streamText = ''; return;
    }
    if (text === this.streamText && this.streamEl?.isConnected) return;
    this.streamBusy = true;
    const epoch = this.renderEpoch;
    const follow = this.messagesEl.scrollHeight - this.messagesEl.scrollTop - this.messagesEl.clientHeight < 90;
    const component = new Component(); this.addChild(component);
    const box = document.createElement('div'); box.className = 'cr-message cr-assistant';
    box.createDiv({ cls: 'cr-message-label', text: `${backendLabel(active.job.backend)} · 正在输出` });
    const body = box.createDiv({ cls: 'cr-body markdown-rendered' });
    try {
      await MarkdownRenderer.render(this.app, normalizeMarkdown(text), body, active.job.context.path, component);
      await finishRenderMath();
      if (epoch !== this.renderEpoch || this.plugin.active !== active || active.job.key !== this.plugin.key() || !active.text) { this.removeChild(component); return; }
      if (this.streamComponent) this.removeChild(this.streamComponent);
      this.streamComponent = component;
      if (this.streamEl?.isConnected) this.streamEl.replaceWith(box); else this.messagesEl.appendChild(box);
      this.streamEl = box; this.streamText = text;
      if (follow) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    } catch (error) { this.removeChild(component); throw error; }
    finally {
      this.streamBusy = false;
      if (this.plugin.active?.text !== text || epoch !== this.renderEpoch) this.scheduleStream();
    }
  }
  async onClose() { this.closed = true; this.renderEpoch++; clearTimeout(this.streamTimer); this.streamTimer = null; }
}

class ReaderSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    this.containerEl.empty(); this.containerEl.createEl('h2', { text: 'Paper Reader' });
    for (const [key, label] of [['paperRoot', 'Paper root folder'], ['explainFolder', 'Explanation subfolder'], ['ideaFolder', 'Idea subfolder']]) {
      new Setting(this.containerEl).setName(label).setDesc('Relative vault folder. Changes apply to new requests.')
        .addText(input => input.setValue(this.plugin.settings[key]).onChange(async value => {
          try { archiveOptions({ ...this.plugin.settings, [key]: value }); }
          catch { return; }
          this.plugin.settings[key] = value; await this.plugin.persist();
          if (this.plugin.lastView) await this.plugin.capture(this.plugin.lastView);
        }));
    }
    new Setting(this.containerEl).setName('Metadata language').setDesc('Property names and archive backlinks for new notes.')
      .addDropdown(input => input.addOptions({ en: 'English', zh: '中文' }).setValue(this.plugin.settings.metadataLanguage).onChange(async value => { this.plugin.settings.metadataLanguage = value; await this.plugin.persist(); }));
    new Setting(this.containerEl).setName('Answer language').setDesc('Language requested from the model.')
      .addText(input => input.setValue(this.plugin.settings.answerLanguage).onChange(async value => { this.plugin.settings.answerLanguage = value.trim() || 'English'; await this.plugin.persist(); }));
    new Setting(this.containerEl).setName('Codex 可执行文件').setDesc('复用本机 codex login 的登录状态。macOS 建议使用绝对路径。')
      .addText(text => text.setValue(this.plugin.settings.binary).onChange(async value => { this.plugin.settings.binary = value.trim() || 'codex'; await this.plugin.persist(); }));
    new Setting(this.containerEl).setName('OpenCode 可执行文件').setDesc('复用本机 OpenCode 的模型厂商配置和认证。')
      .addText(text => text.setValue(this.plugin.settings.opencodeBinary).onChange(async value => { this.plugin.settings.opencodeBinary = value.trim() || 'opencode'; await this.plugin.persist(); }));
    new Setting(this.containerEl).setName('Codex 模型').setDesc('留空使用 Codex 当前配置；填写时使用实际可用的模型名称。')
      .addText(text => text.setValue(this.plugin.settings.model).onChange(async value => { this.plugin.settings.model = value.trim(); await this.plugin.persist(); }));
    new Setting(this.containerEl).setName('任务超时（分钟）').setDesc('超时后停止当前任务，范围 1–120。')
      .addText(text => text.setValue(String(this.plugin.settings.timeoutMinutes)).onChange(async value => {
        const n = Number(value); if (Number.isFinite(n) && n >= 1 && n <= 120) { this.plugin.settings.timeoutMinutes = n; await this.plugin.persist(); }
      }));
    this.containerEl.createEl('p', { text: '对话保存于插件 data.json，每个论文保留最近 40 条消息；每次发送附带最近 4 条上下文，总计最多 4,000 字符。侧栏不是当前桌面 Codex 对话的镜像。重载或退出 Obsidian 会停止运行及清空待处理队列。' });
  }
}

module.exports = class CodexReader extends Plugin {
  async onload() {
    const saved = await this.loadData() || {};
    this.settings = { ...DEFAULTS, ...saved.settings }; this.conversations = saved.conversations || {};
    this.queue = []; this.active = null; this.context = null; this.lastView = null;
    this.status = '就绪'; this.mode = 'ask'; this.draft = ''; this.captureVersion = 0;
    this.disposed = false; this.writeChain = Promise.resolve();
    for (const messages of Object.values(this.conversations)) {
      let interrupted = false;
      for (const message of messages) if (message.queued) { message.queued = false; interrupted = true; }
      if (interrupted) messages.push({ role: 'error', text: '上次关闭前的未完成请求没有自动重试，请重新发送。', time: Date.now() });
    }
    this.registerView(VIEW, leaf => new ReaderView(leaf, this));
    this.registerMarkdownPostProcessor((el, ctx) => {
      const info = ctx.getSectionInfo(el);
      if (info) { el.dataset.crStart = String(info.lineStart); el.dataset.crEnd = String(info.lineEnd); el.dataset.crSource = ctx.sourcePath; }
      el.querySelectorAll('img').forEach(img => { img.draggable = false; });
    });
    this.addSettingTab(new ReaderSettings(this.app, this));
    this.addRibbonIcon('messages-square', 'Paper Reader', () => this.open().catch(e => this.report(e)));
    this.addCommand({ id: 'open', name: '打开阅读侧栏', callback: () => this.open().catch(e => this.report(e)) });
    for (const [mode, label] of [['ask', 'Ask Paper Reader'], ['explain', '将选区展开为专题解读'], ['idea', '基于选区记录研究想法'], ['task', '发起 Codex 任务']]) {
      this.addCommand({ id: mode, name: label, editorCallback: (editor, view) => this.prepare(mode, view, editor.getSelection()) });
    }
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
      menu.addItem(item => item.setTitle('Ask Paper Reader').setIcon('messages-square').onClick(() => this.prepare('ask', view, editor.getSelection())));
      menu.addItem(item => item.setTitle('Save explanation with Paper Reader').setIcon('notebook-pen').onClick(() => this.prepare('explain', view, editor.getSelection())));
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => {
      if (leaf?.view instanceof MarkdownView) { this.lastView = leaf.view; this.capture(leaf.view).catch(e => this.report(e)); }
    }));
    this.registerEvent(this.app.workspace.on('file-open', () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) { this.lastView = view; this.capture(view).catch(e => this.report(e)); }
    }));
    this.registerEvent(this.app.workspace.on('editor-change', (editor, view) => {
      if (view instanceof MarkdownView) this.scheduleCapture(view);
    }));
    const captureSelection = () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) this.scheduleCapture(view);
    };
    this.registerDomEvent(document, 'selectionchange', captureSelection);
    this.registerDomEvent(document, 'keyup', captureSelection);
    this.registerDomEvent(document, 'mouseup', captureSelection);
    this.registerDomEvent(document, 'click', event => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (!view || !target || !view.containerEl.contains(target) || target.closest('.cr-body')) return;
      const object = target.closest('img, mjx-container');
      if (!object || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const selected = view.containerEl.ownerDocument.getSelection();
      if (selected && !selected.isCollapsed) return;
      clearTimeout(this.captureTimer);
      this.captureObject(view, object).catch(e => this.report(e));
    });
    this.app.workspace.onLayoutReady(() => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView) || this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view).find(view => view.file);
      if (view) { this.lastView = view; this.capture(view).catch(e => this.report(e)); }
    });
  }
  choice(field) { return this.settings[this.settings.backend === 'opencode' ? (field === 'model' ? 'opencodeModel' : 'opencodeEffort') : field] || ''; }
  setChoice(field, value) { this.settings[this.settings.backend === 'opencode' ? (field === 'model' ? 'opencodeModel' : 'opencodeEffort') : field] = value; }
  models() { return this.settings.backend === 'opencode' ? this.openCodeModels || [] : modelOptions(); }
  views() { return this.app.workspace.getLeavesOfType(VIEW).map(leaf => leaf.view); }
  notify(kind = 'status') {
    if (this.disposed) return;
    for (const view of this.views()) {
      view.updateStatus();
      if (kind === 'context') view.updateContext();
      if (kind === 'messages') view.renderMessages().catch(e => console.error('Codex Reader render:', e));
    }
  }
  report(error) { new Notice(error.message || String(error)); }
  key(context = this.context) { return context ? context.folder || context.path : '__none'; }
  history(key = this.key()) { return this.conversations[key] || []; }
  addMessage(key, message) {
    this.conversations[key] = [...this.history(key), { ...message, time: Date.now() }].slice(-40);
    this.persist().catch(e => this.report(e)); this.notify('messages');
  }
  persist() {
    const data = JSON.parse(JSON.stringify({ settings: this.settings, conversations: this.conversations }));
    this.writeChain = this.writeChain.catch(() => {}).then(() => this.saveData(data)); return this.writeChain;
  }
  async open() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); if (!leaf) throw new Error('无法打开右侧栏'); await leaf.setViewState({ type: VIEW, active: true }); }
    await this.app.workspace.revealLeaf(leaf); return leaf.view;
  }
  async prepare(mode, view, selection) {
    try {
      await this.capture(view, selection); this.mode = mode;
      const panel = await this.open(); panel.updateMode(); panel.inputEl.focus();
    } catch (e) { this.report(e); }
  }
  scheduleCapture(view) {
    clearTimeout(this.captureTimer);
    this.captureTimer = setTimeout(() => this.capture(view).catch(e => this.report(e)), 160);
  }
  async capture(view, explicitSelection) {
    if (this.disposed || !(view instanceof MarkdownView) || !view.file) return;
    const version = ++this.captureVersion;
    const file = view.file;
    const text = view.getMode() === 'source' ? view.editor.getValue() : await this.app.vault.cachedRead(file);
    let selection = explicitSelection;
    let line = view.getMode() === 'source' ? view.editor.getCursor('from').line : 0;
    if (selection === undefined) {
      if (view.getMode() === 'source') selection = view.editor.getSelection();
      else {
        const selected = view.containerEl.ownerDocument.getSelection();
        selection = selected && selected.anchorNode && selected.focusNode && view.containerEl.contains(selected.anchorNode) && view.containerEl.contains(selected.focusNode) ? selected.toString() : '';
      }
    }
    const rich = explicitSelection === undefined ? this.readMouseSelection(view, text) : null;
    if (rich && view.getMode() !== 'source') selection = rich.text;
    if (selection && view.getMode() !== 'source') {
      const at = text.indexOf(selection); if (at >= 0) line = text.slice(0, at).split('\n').length - 1;
    }
    const config = archiveOptions(this.settings);
    const folder = paperFolder(file.path, config.root);
    const front = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    let paper = (front.type === 'paper' || front['类型'] === '论文') ? file : null;
    if (!paper && typeof (front.paper || front['所属论文']) === 'string') {
      const link = (front.paper || front['所属论文']).replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0];
      paper = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
    }
    if (!paper && folder) paper = this.app.vault.getMarkdownFiles().find(f => f.parent?.path === folder && ['paper', '论文'].includes(this.app.metadataCache.getFileCache(f)?.frontmatter?.type || this.app.metadataCache.getFileCache(f)?.frontmatter?.['类型']));
    const paperFront = paper ? this.app.metadataCache.getFileCache(paper)?.frontmatter || {} : {};
    if (version !== this.captureVersion || this.disposed) return;
    const previousKey = this.key(); this.lastView = view;
    const previous = this.context?.path === file.path ? this.context.attachments || [] : [];
    const attachments = rich ? [...previous.filter(r => !r.fromSelection), ...rich.images] : previous;
    if (rich?.line !== undefined) line = rich.line;
    this.context = { attachments, path: file.path, text, selection: selection || '', heading: headingAt(text, line) || attachments[0]?.heading || '', folder, paper: paper?.path || '', paperId: paperFront.paper_id || paperFront['论文标识'] || front.paper_id || front['论文标识'] || '' };
    this.notify('context'); if (previousKey !== this.key()) this.notify('messages');
  }
  mathReference(element, text) {
    const block = element.closest('[data-cr-start]');
    if (!block) return null;
    const start = Number(block.dataset.crStart), end = Number(block.dataset.crEnd);
    const lines = text.split('\n');
    const snippet = lines.slice(start, end + 1).join('\n');
    const formulae = extractReferences(snippet).filter(ref => ref.kind === 'formula');
    const rendered = [...(block.matches('mjx-container') ? [block] : []), ...block.querySelectorAll('mjx-container')];
    const index = rendered.indexOf(element);
    const ref = formulae[index];
    if (!ref) return null;
    const prefix = lines.slice(0, start).join('\n').length + (start ? 1 : 0);
    return { ...ref, offset: prefix + ref.offset, line: start + ref.line, heading: headingAt(text, start + ref.line) };
  }
  imageReference(element, text, source) {
    const src = (element.currentSrc || element.getAttribute('src') || '').split('?')[0];
    for (const ref of extractReferences(text).filter(ref => ref.kind === 'image')) {
      const file = this.resolveImage(ref.link, source);
      if (file && this.app.vault.getResourcePath(file).split('?')[0] === src) return { ...ref, path: file.path, fromSelection: true };
    }
    return null;
  }
  readMouseSelection(view, text) {
    const selection = view.containerEl.ownerDocument.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !view.containerEl.contains(selection.anchorNode) || !view.containerEl.contains(selection.focusNode)) return null;
    const range = selection.getRangeAt(0); const images = []; let firstLine;
    const visit = node => {
      if (!range.intersectsNode(node)) return '';
      if (node.nodeType === 3) {
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : node.textContent.length;
        return node.textContent.slice(start, end);
      }
      if (node.nodeType !== 1) return '';
      if (firstLine === undefined && node.dataset.crStart !== undefined) firstLine = Number(node.dataset.crStart);
      if (node.matches('mjx-container')) {
        const ref = this.mathReference(node, text);
        return ref ? ref.text : '[无法定位公式源码，请用备用选择器指定公式]';
      }
      if (node.matches('img')) {
        const ref = this.imageReference(node, text, view.file.path);
        if (ref && !images.some(r => r.path === ref.path)) images.push(ref);
        return ref ? `\n${ref.text}\n` : '\n[此图片不是可发送的本地附件]\n';
      }
      if (node.matches('script, style, .copy-code-button, .heading-collapse-indicator, .collapse-indicator')) return '';
      const children = [...node.childNodes].map(visit).join('');
      return /^(P|DIV|H[1-6]|LI|TR|BLOCKQUOTE)$/.test(node.tagName) ? children + '\n' : children;
    };
    return { text: visit(view.contentEl || view.containerEl).trim(), images, line: firstLine };
  }
  async captureObject(view, element) {
    await this.capture(view, '');
    if (!this.context || this.context.path !== view.file?.path) return;
    const c = this.context;
    const ref = element.matches('img') ? this.imageReference(element, c.text, c.path) : this.mathReference(element, c.text);
    if (!ref) { new Notice('无法定位原始内容，可使用“添加公式/图片”备用入口'); return; }
    if (ref.kind === 'image') {
      this.context.attachments = [...(c.attachments || []).filter(r => r.path !== ref.path), ref];
      c.selection = ref.text;
    } else { c.selection = ref.text; c.attachments = (c.attachments || []).filter(r => !r.fromSelection); }
    c.heading = ref.heading;
    this.notify('context');
  }
  resolveImage(link, source) {
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(link)) return null;
    const file = this.app.metadataCache.getFirstLinkpathDest(link, source) || this.app.vault.getAbstractFileByPath(normalizePath(nodePath.posix.join(nodePath.posix.dirname(source), link)));
    return file instanceof TFile && /\.(png|jpe?g|webp|gif)$/i.test(file.path) ? file : null;
  }
  imageAbsolutePath(path) {
    const root = realpathSync(this.app.vault.adapter.getBasePath());
    const absolute = realpathSync(nodePath.resolve(root, path));
    const relative = nodePath.relative(root, absolute);
    if (relative.startsWith('..') || nodePath.isAbsolute(relative)) throw new Error('图片必须保存在当前知识库内');
    return absolute;
  }
  addReference(entry, source) {
    if (!this.context || this.context.path !== source.path) throw new Error('当前笔记已改变，请重新选择引用');
    const current = this.context.attachments || [];
    if (current.some(ref => ref.id === entry.id)) return;
    if (current.length >= 5) throw new Error('每次最多附带 5 个公式或图片');
    const ref = { ...entry };
    if (ref.kind === 'image') {
      const file = this.resolveImage(ref.link, source.path); if (!file) throw new Error('未找到本地图片');
      this.imageAbsolutePath(file.path); ref.path = file.path;
      if (current.filter(r => r.kind === 'image').length >= 3) throw new Error('每次最多附带 3 张图片');
    }
    this.context.attachments = [...current, ref];
    if (ref.heading) this.context.heading = ref.heading;
    this.notify('context');
  }
  enqueue(question) {
    if (!this.context) { new Notice('请先打开 Markdown 笔记'); return false; }
    if (MODES[this.mode].folder && !this.context.folder) { new Notice(`Open a note under ${this.settings.paperRoot || 'omni'}/<paper>/ to save explanations or ideas.`); return false; }
    if (!this.app.vault.adapter.getBasePath) { new Notice('本插件需要桌面端的本地知识库'); return false; }
    if ((this.context.attachments || []).filter(r => r.kind === 'image').length > 3) { new Notice('选区包含超过 3 张图片，请缩小选区或移除部分图片'); return false; }
    if (this.queue.length >= 10) { new Notice('队列已满，请等待当前任务完成'); return false; }
    const backend = this.settings.backend || 'codex';
    const known = this.models().find(m => m.value === this.choice('model'));
    if (backend === 'opencode' && known && !known.image && (this.context.attachments || []).some(r => r.kind === 'image')) { new Notice('该 OpenCode 模型不支持图片，请更换模型或移除图片'); return false; }
    const archive = archiveOptions(this.settings);
    const job = { archive, backend, binary: backend === 'opencode' ? this.settings.opencodeBinary : this.settings.binary, mode: this.mode, question, model: this.choice('model'), effort: this.choice('effort'), scope: this.settings.scope, context: { ...this.context, attachments: (this.context.attachments || []).map(ref => ({ ...ref })) }, key: this.key(), history: [] };
    this.queue.push(job);
    this.addMessage(job.key, { role: 'user', text: question, mode: job.mode, source: job.context.path, queued: true });
    this.notify(); this.drain(); return true;
  }
  async drain() {
    if (this.active || !this.queue.length || this.disposed) return;
    const job = this.queue.shift(); this.active = { job, run: null };
    this.status = `${MODES[job.mode].label}处理中 · ${job.context.path.split('/').pop()}`; this.notify();
    try {
      // Only completed pairs enter context; queued questions belong to later runs.
      const history = this.history(job.key).filter(m => m.role === 'assistant' || (m.role === 'user' && !m.queued));
      job.history = history;
      const run = (job.backend === 'opencode' ? startOpenCodeRun : startStreamRun)({ binary: job.binary, cwd: this.app.vault.adapter.getBasePath(), mode: job.mode, model: job.model, effort: job.effort, images: (job.context.attachments || []).filter(r => r.kind === 'image').map(r => this.imageAbsolutePath(r.path)),
        prompt: buildPrompt(job, history), timeoutMs: this.settings.timeoutMinutes * 60000,
        onText: text => {
          if (this.disposed || this.active?.job !== job) return;
          this.active.text = text;
          this.status = '正在生成回答…';
          for (const view of this.views()) view.scheduleStream();
        },
        onEvent: event => {
          if (this.disposed) return;
          if (event.method === 'thread/started') this.status = `${backendLabel(job.backend)} 已连接`;
          if (event.method === 'item/started' && event.params?.item?.type === 'commandExecution') this.status = 'Codex 正在读取或处理资料…';
          this.notify();
        }
      });
      this.active.run = run;
      const result = await run.promise;
      if (this.disposed) return;
      const message = { role: 'assistant', text: normalizeMarkdown(result.text), source: job.context.path, mode: job.mode, usage: result.usage, backend: job.backend, model: result.model || job.model || `${backendLabel(job.backend)} 默认配置`, effort: job.effort || '' };
      // Persist answer even when archiving fails, so it can be recovered/copied.
      this.active.text = '';
      this.markQuestion(job);
      this.addMessage(job.key, message);
      if (MODES[job.mode].folder) {
        try {
          const file = await this.archive(job, result.text);
          const last = [...this.history(job.key)].reverse().find(m => m.role === 'assistant'); if (last) last.file = file.path;
          await this.persist(); this.notify('messages'); new Notice(`已保存：${file.basename}`);
        } catch (e) {
          this.addMessage(job.key, { role: 'error', text: `回答已保留，归档未完成：${e.message}`, source: job.context.path });
        }
      }
      this.status = '完成';
    } catch (e) {
      this.markQuestion(job);
      if (e.partialText) this.addMessage(job.key, { role: 'error', text: `未完成的回答（未归档）：\n\n${e.partialText}`, source: job.context.path });
      this.addMessage(job.key, { role: 'error', text: e.message, source: job.context.path });
      this.status = '未完成';
    } finally {
      this.active = null; this.notify(); for (const view of this.views()) view.scheduleStream();
      if (!this.disposed && this.queue.length) this.drain();
    }
  }
  markQuestion(job) {
    const message = this.history(job.key).find(m => m.role === 'user' && m.queued && m.text === job.question);
    if (message) message.queued = false;
  }
  stop() {
    this.clearQueue();
    this.active?.run?.cancel(); this.status = '正在停止…'; this.notify();
  }
  clearQueue() {
    for (const job of this.queue) {
      this.markQuestion(job);
      this.addMessage(job.key, { role: 'error', text: `已取消排队：${job.question}`, source: job.context.path });
    }
    this.queue = []; this.notify();
  }
  newConversation() {
    if (this.active || this.queue.length) return;
    this.conversations[this.key()] = []; this.persist().catch(e => this.report(e)); this.notify('messages');
  }
  async ensureFolder(path) {
    let current = '';
    for (const part of path.split('/')) {
      current = current ? current + '/' + part : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }
  async archive(job, response) {
    const folder = job.context.folder;
    const config = job.archive || archiveOptions(this.settings);
    if (!folder || paperFolder(job.context.path, config.root) !== folder) throw new Error('无法确定所属论文目录');
    const type = MODES[job.mode]; const targetFolder = config[job.mode];
    if (!type?.folder || !targetFolder) throw new Error('This mode cannot archive notes');
    const dir = normalizePath(`${folder}/${targetFolder}`);
    await this.ensureFolder(dir);
    const title = normalizeMarkdown(response).match(/^#\s+(.+)$/m)?.[1] || job.question.replace(/\r?\n/g, ' ');
    const prefix = safeName(job.context.paperId?.split('-')[0] || folder.split('/').pop());
    const filenameTitle = title.replace(/\\([a-zA-Z]+)/g, '$1').replace(/[$`{}]/g, '');
    const base = `${prefix}-${job.mode}-${safeName(filenameTitle)}`;
    let target = `${dir}/${base}.md`; let i = 2;
    while (this.app.vault.getAbstractFileByPath(target)) target = `${dir}/${base}-${i++}.md`;
    const file = await this.app.vault.create(target, noteContent({ ...job, archive: config }, response));
    const source = this.app.vault.getAbstractFileByPath(job.context.path);
    if (source instanceof TFile) {
      try {
        const link = config.metadata === 'en' ? `> Further reading: ${title} ([[${file.path.replace(/\.md$/, '')}|Open note]])` : `> 延伸${type.folder}：${title}（[[${file.path.replace(/\.md$/, '')}|打开${type.folder}]]）`;
        await this.app.vault.process(source, content => {
          const lines = content.split('\n');
          const index = job.context.heading ? lines.findIndex(line => /^#{1,6}\s/.test(line) && line.replace(/^#+\s+/, '') === job.context.heading) : -1;
          if (index >= 0) { lines.splice(index + 1, 0, '', link); return lines.join('\n'); }
          return content.trimEnd() + '\n\n' + link + '\n';
        });
      } catch (e) { new Notice(`笔记已保存，但来源回链未写入：${e.message}`); }
    }
    return file;
  }
  onunload() {
    this.disposed = true; clearTimeout(this.captureTimer); this.captureVersion++;
    this.queue = []; this.active?.run?.cancel('插件已关闭，任务停止');
  }
};
