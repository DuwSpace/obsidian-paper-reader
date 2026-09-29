# Contributing

Use Node.js 22. Run `npm run check`, `npm test`, and `npm run build` before opening a PR. Commit the generated `main.js` with source changes. Keep backend tests offline and use fixture processes; do not require contributors to supply API credentials.

For selection/rendering changes, also verify in desktop Obsidian Reading view using `examples/`. Document the actual platform and app version tested. Do not claim Windows or Live Preview compatibility without testing it.

Keep changes scoped. Preserve existing vault content, history and user backend configuration. Do not include `data.json`, authentication files, private provider URLs or personal notes. Clearly explain any changes to transmitted context or execution permissions.
