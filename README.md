# Paper Reader

Read a paper in Obsidian, select a difficult passage with its equations and images, and discuss it with a local **Codex or OpenCode** backend. Save longer explanations and research ideas as linked notes alongside the paper.

Independent community project; not affiliated with Obsidian, OpenAI, or OpenCode. MIT licensed.

## Features

- Drag across text, inline math, display equations and local images in **Reading view**. Equations are recovered as LaTeX; selected images become attachments. Click a formula or image to reference it individually. A searchable picker provides a fallback.
- Switch between Codex and OpenCode. Each backend keeps its own model and reasoning setting. Model availability depends on your account and provider configuration.
- Read streaming Markdown, tables and math. Incomplete delimiters may appear briefly while a formula or code block is still arriving.
- Ask without editing notes; save explanations or ideas into configurable subfolders, with source metadata and backlinks.
- Run explicit editing tasks, queue questions, stop a run, and keep partial answers after interruption. Stopping does not undo completed file changes.
- Limit context to the selection, a nearby excerpt, a larger excerpt, or the whole note. Display reported input, cache and output token usage.

[Walk through the example](docs/demo.md) · [Data and permissions](docs/privacy.md) · [中文说明](docs/README.zh-CN.md)

## Requirements

- Desktop Obsidian **1.13.7 or newer**. This is the oldest version tested; mobile is unsupported.
- At least one separately installed backend: Codex CLI or OpenCode. The plugin does not download or install them.
- Configure authentication and model access in that backend first. An account, subscription or paid API usage may be required by the selected provider; the plugin is free.
- Verified on macOS with Codex CLI 0.155.1 and OpenCode 1.3.0. Linux/Windows app behavior is not yet verified. Fixture tests run on macOS and Linux.

The initial interface retains some Chinese labels from its research workflow. English documentation, configurable response language and English archive metadata are included; full interface localization is not yet implemented.

## Install

Until accepted into the community directory, use a GitHub release:

1. Download `main.js`, `manifest.json` and `styles.css` from [Releases](https://github.com/DuwSpace/obsidian-paper-reader/releases).
2. Create `<vault>/.obsidian/plugins/paper-reader/` and place the three files there.
3. Reload Obsidian and enable **Paper Reader** in Community plugins.
4. Open **Settings → Paper Reader**. Set the executable paths if automatic detection does not find your backend. Use absolute paths, especially when Obsidian starts outside a terminal.

## First question

1. Open a Markdown note in Reading view and open Paper Reader using its ribbon icon or the command palette.
2. Select a passage, including any formulas or images you want to discuss. Check the context preview and attachment count.
3. Under **执行后端** (Backend), choose Codex or OpenCode. Select a model; OpenCode IDs use `provider/model`.
4. Select **提问** (Ask), enter a question, and press Send or `Cmd/Ctrl+Enter`.

**刷新** refreshes the model list. Reasoning choices come from the backend's model catalog; an empty list means no selectable variant is advertised. The default inherits backend configuration. OpenCode requires either an explicit model or a configured default.

Model, backend and archive settings are captured when a question is submitted. Changing settings does not reroute already queued jobs. Switching backends carries the plugin's recent text context, not the other backend's internal session state.

## Organize paper notes

The default layout is:

```text
Papers/
  Example/
    Paper.md
    Explanations/
    Ideas/
    attachments/
```

Configure **Paper root folder**, **Explanation subfolder**, **Idea subfolder**, **Metadata language**, and **Answer language** in settings. Nested relative paths such as `Research/Papers` are supported. Archive actions require a note inside `<root>/<paper>/`; Ask works elsewhere too. Existing notes are not moved when these settings change.

For automatic paper identification, use these properties in the main paper note:

```yaml
---
type: paper
paper_id: Example-2026
---
```

Generated English metadata includes `type`, `paper_id`, `paper`, `source_section`, `related`, `status`, `created` and `method`. Chinese metadata is also supported, and existing Chinese paper properties are recognized. Ideas start as unverified; explanations start as drafts. Review model-generated claims before treating them as established results.

| Mode | Behavior |
| --- | --- |
| 提问 — Ask | Displays an answer without archiving a note. |
| 保存解读 — Save explanation | Creates an explanation note and adds a source backlink after a complete answer. |
| 记录想法 — Record idea | Creates an unverified idea note and adds a source backlink. |
| 执行任务 — Run task | Allows the backend to edit files and run commands within its permissions. State the task scope explicitly. |

## Limits and data flow

- Default note excerpt: 6,000 characters near the selection; larger excerpt: 12,000; whole-note cap: 70,000. Selected text is separately capped at 12,000.
- Recent context: up to 4 messages, 2,000 characters per message and 4,000 total. Up to 40 messages are saved for each paper in plugin `data.json`.
- Images: up to 3 local PNG, JPEG, WebP or GIF files. OpenCode additionally requires declared image input support and limits each image to 20 MB. Remote image URLs are not downloaded automatically.
- Rich formula/image drag selection is tested in Reading view. Editing/Live Preview uses the editor selection; equivalent rich DOM selection there is not guaranteed.
- Streaming is real backend output, coalesced into UI updates. Reasoning and tool work can have pauses with no answer text.
- Token totals depend on backend reporting. Cached input is included in displayed input. Backend instructions, tool use and images add overhead; shorter excerpts do not guarantee a particular cost reduction.

See [Data and permissions](docs/privacy.md) before enabling task mode. No analytics are implemented by this plugin.

## Development

Node.js 22 is used in CI. No package installation is needed for building or the fixture tests:

```sh
npm run check
npm test
npm run build
```

- `src/main.js`: Obsidian UI, selection capture, queue, settings, and archive links.
- `src/core.js`: Codex integration, prompt construction, Markdown handling and metadata.
- `src/opencode.js`: authenticated loopback server, SSE streaming and OpenCode permissions.
- `tests/`: fake backend processes and Obsidian interface fixtures. Tests do not call paid APIs.
- `examples/`: original sample notes and an image for manual checks.

The GitHub release tag must exactly match `manifest.json` (for example `0.5.0`, with no `v` prefix). The initial release was tested, built and uploaded manually. CI and release workflow files are prepared locally; enabling them is pending GitHub authorization for the `workflow` scope. Source `main.js` is committed for review.

## Feedback

Please [open an issue](https://github.com/DuwSpace/obsidian-paper-reader/issues) with your Obsidian/backend version, mode and reproduction steps. Remove prompts, note content, credentials and private URLs from logs. Do not attach your `data.json` or backend authentication files.

Interfaces: [Obsidian API](https://github.com/obsidianmd/obsidian-api), [Codex App Server](https://learn.chatgpt.com/docs/app-server), [OpenCode Server](https://opencode.ai/docs/server/).
