'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
class TFile { constructor(path, text='') { this.path=path; this.text=text; this.basename=path.split('/').pop().replace(/\.md$/,''); } }
const original = Module._load;
Module._load = function(id, ...args) {
 if (id==='obsidian') return {Plugin:class{},ItemView:class{},MarkdownView:class{},MarkdownRenderer:{},Component:class{},Notice:class{},PluginSettingTab:class{},Modal:class{},finishRenderMath:async()=>{},Setting:class{},TFile,normalizePath:p=>p};
 return original.call(this,id,...args);
};
const Reader = require('../src/main');
Module._load = original;
function setup(){
 const plugin=new Reader(); const source=new TFile('omni/2024-SD3/paper.md','# Paper\n\n## Theory\n\nOriginal prose.\n');
 const files=new Map([[source.path,source]]);
 plugin.app={vault:{getAbstractFileByPath:p=>files.get(p),createFolder:async p=>files.set(p,{path:p}),create:async(p,text)=>{assert(!files.has(p));const f=new TFile(p,text);files.set(p,f);return f;},process:async(f,fn)=>{f.text=fn(f.text);}}};
 plugin.persist=async()=>{};plugin.notify=()=>{};plugin.conversations={};plugin.queue=[];plugin.active=null;plugin.mode='ask';plugin.status='';
 const context={path:source.path,folder:'omni/2024-SD3',paper:source.path,paperId:'SD3-2024',heading:'Theory',selection:'Original',text:source.text};
 plugin.context=context;plugin.settings={model:'',scope:'focus'};
 return {plugin,files,source,context};
}
test('archive stays under paper, deduplicates names and adds source backlink without replacing text',async()=>{
 const {plugin,files,source,context}=setup();
 const job={mode:'explain',question:'Explain theory',context};
 const a=await plugin.archive(job,'# Explanation\n\nUseful explanation.');
 const b=await plugin.archive(job,'# Explanation\n\nSecond version.');
 assert.equal(a.path,'omni/2024-SD3/解读/SD3-explain-Explanation.md');
 assert.equal(b.path,'omni/2024-SD3/解读/SD3-explain-Explanation-2.md');
 assert(a.text.includes('类型: "专题解读"'));assert(a.text.includes('paper#Theory'));
 assert(source.text.includes('Original prose.'));assert(source.text.includes(a.path.replace(/\.md$/,'')));
 assert.equal([...files.values()].filter(f=>f instanceof TFile).length,3);
});
test('idea saves in ideas folder with unverified state; rejects unscoped archive',async()=>{
 const {plugin,context}=setup();
 const saved=await plugin.archive({mode:'idea',question:'hypothesis',context},'# New idea\nNeed evidence.');
 assert(saved.path.includes('/想法/'));assert(saved.text.includes('状态: "待梳理"'));
 await assert.rejects(plugin.archive({mode:'explain',question:'x',context:{...context,folder:null}},'# X'),/所属论文/);
});
test('enqueue captures source and selection at submission; queue clears without changing active source',()=>{
 const {plugin,context}=setup();plugin.app.vault.adapter={getBasePath:()=>'/vault'};plugin.drain=()=>{};
 plugin.settings.effort='high';
 assert(plugin.enqueue('Question one'));plugin.settings.effort='low';assert.equal(plugin.queue[0].effort,'high');plugin.context={...context,path:'omni/Other/paper.md',selection:'different'};
 assert.equal(plugin.queue[0].context.path,context.path);assert.equal(plugin.queue[0].context.selection,'Original');
 assert(plugin.history('omni/2024-SD3').some(m=>m.role==='user'));
 plugin.clearQueue();assert.equal(plugin.queue.length,0);assert(plugin.history('omni/2024-SD3').some(m=>m.role==='error'));
});

test('backend switch keeps independent model settings and snapshots queued backend',()=>{
 const {plugin}=setup();plugin.app.vault.adapter={getBasePath:()=>'/vault'};plugin.drain=()=>{};
 plugin.settings={backend:'codex',binary:'/bin/codex',model:'codex-model',effort:'high',opencodeBinary:'/bin/opencode',opencodeModel:'vendor/model',opencodeEffort:'max'};
 plugin.settings.backend='opencode';assert.equal(plugin.choice('model'),'vendor/model');
 assert(plugin.enqueue('OpenCode question'));plugin.settings.backend='codex';
 assert.equal(plugin.choice('model'),'codex-model');assert.equal(plugin.queue[0].backend,'opencode');assert.equal(plugin.queue[0].model,'vendor/model');assert.equal(plugin.queue[0].binary,'/bin/opencode');
});

test('archive preserves math in visible extension title outside wiki alias',async()=>{
 const {plugin,source,context}=setup();
 const title='映射 $\\psi_t$ 与条件速度场 $u_t$';
 const file=await plugin.archive({mode:'explain',question:'解释',context},'# '+title+'\n\n正文 $\\psi_t$。');
 assert(!file.path.includes('$'));assert(!file.path.includes('-psi'));
 assert(file.text.includes('# '+title));
 assert(source.text.includes('> 延伸解读：'+title+'（[['));
 assert(source.text.includes('|打开解读]]）'));
 assert(!source.text.includes('|'+title));
});

test('public archive configuration changes folders, English metadata and backlink without changing source', async()=>{
 const {plugin,context,files}=setup();
 const source=new TFile('Research/Papers/Example/paper.md','# Example\n\n## Theory\nOriginal.');files.set(source.path,source);
 plugin.settings={paperRoot:'Research/Papers',explainFolder:'Notes/Explanations',ideaFolder:'Hypotheses',metadataLanguage:'en',answerLanguage:'English'};
 const current={...context,path:source.path,folder:'Research/Papers/Example',paper:source.path};
 const saved=await plugin.archive({mode:'explain',question:'Explain',context:current},'# Detail\nText');
 assert(saved.path.startsWith('Research/Papers/Example/Notes/Explanations/'));
 assert(saved.text.includes('type: "explanation"'));assert(saved.text.includes('## Reading source'));assert(source.text.includes('> Further reading: Detail'));assert(source.text.includes('Original.'));
 plugin.settings.paperRoot='../outside';await assert.rejects(plugin.archive({mode:'idea',context:current,question:'idea'},'# Idea'),/relative vault/);
});
