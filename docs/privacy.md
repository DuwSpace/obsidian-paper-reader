# Data and permissions

## What leaves the vault

Sending a question passes your prompt, selected text, note excerpt, selected local images and recent conversation to the chosen locally installed backend. That backend sends requests to the model provider configured in its account or settings. There is no fixed developer-operated proxy. The backend can read relevant files when its tools and permissions allow it. Model responses can be incorrect.

Codex authentication and configuration are managed by Codex; OpenCode authentication and provider configuration are managed by OpenCode. Provider usage can require an account or payment. Applicable policies include [OpenAI privacy](https://openai.com/policies/privacy-policy/) when using OpenAI services and the policies of each provider you configure in OpenCode. Backend-specific telemetry and logging are controlled by the backend and its configuration; this plugin implements no telemetry.

## Files outside the vault

The plugin runs the executable you configure and inherits the desktop application's environment. It reads Codex's `models_cache.json` under `CODEX_HOME` or `~/.codex` to populate model choices. Each backend reads its own local configuration and credentials outside the vault. The plugin does not copy those credentials into notes or plugin settings.

OpenCode is launched on a random loopback-only port, with a random per-process Basic Auth password. Its model catalog is queried locally. That service and its process group are terminated after each run. OpenCode may persist sessions and logs in its own local data directory. Codex threads are requested as ephemeral; this does not override provider-side data handling or other backend logs.

## Local storage

Questions and answers are saved in plugin `data.json`. If you sync your vault, that file may sync too. A new conversation clears that paper's sidebar history but does not remove archived notes or backend records. Explanations and ideas are created through the Obsidian vault API only after successful completion. Interrupted answers are retained as incomplete and are not automatically archived.

## Execution permissions

Codex receives `read-only` for Ask, Save explanation and Record idea; task mode uses `workspace-write`. Approval policy is `never`.

OpenCode gets an explicit session allowlist: `read`, `glob`, `grep`, and `list` for analysis, plus `edit` and `bash` for task mode. Other tools and external-directory permissions are denied. Interactive permission/question requests end the run instead of being approved automatically. **OpenCode tool permissions are not an operating-system sandbox**; shell commands in task mode may access anything allowed to your OS account. Installed backend plugins or startup hooks are governed by that backend, not by this plugin's tool allowlist.

Stopping kills the owned backend process group. It does not reverse writes or other side effects that already happened. Use task mode only for work you intend to authorize.
