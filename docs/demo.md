# Reproduce the reading workflow

This walkthrough uses an original synthetic example. It requires your own configured model account; no credentials or real research notes are included.

1. Copy `examples/Papers/Linear-interpolation/` to `Papers/Linear-interpolation/` in a test vault.
2. Install Paper Reader and keep the default paper root `Papers`.
3. Open `Paper.md` in **Reading view** and open the Paper Reader sidebar.
4. Drag from “For two vectors” to the end of the paragraph below the chart. The preview should contain complete `$...$` / `$$...$$` LaTeX and one image attachment.
5. Choose a backend and a model with image support, then ask: “Explain the derivative of this path and describe what the chart shows.” If your model is text-only, remove the image attachment and ask about the equation.
6. Watch the response grow in the sidebar. Markdown and closed math expressions render as they arrive.
7. Choose **保存解读** (Save explanation) and ask: “Expand the derivative into a short self-contained explanation.” After completion, a note should appear under `Papers/Linear-interpolation/Explanations/`, and `Paper.md` should have a “Further reading” link under the source heading.
8. Choose **记录想法** (Record idea) for an unverified hypothesis; the note appears under `Ideas/`.

## Expected result

```text
Papers/Linear-interpolation/
  Paper.md                         # original text plus a source backlink
  attachments/linear-path.png
  Explanations/Example-explain-*.md # explanatory note with provenance
  Ideas/Example-idea-*.md           # explicitly unverified note
```

Settings can use different root/subfolders and Chinese metadata. Changing archive settings affects new requests only. A formula title is rendered outside the wiki-link alias to avoid corrupting LaTeX.

## Manual regression checklist

- Select an inline formula, a display formula and the chart together.
- Click a formula or image individually.
- Move focus to the question input: the captured selection should remain available.
- Switch backend and verify its own model/effort choices.
- Queue another question, switch backend again, and verify the queued request keeps its original backend.
- Stop a streaming answer and verify the received text remains marked incomplete, without an automatic archive.
- Confirm the completed archived note links to the correct source section.

The fixture tests automate transport, permission and archive behavior. Desktop selection, visual rendering and configured provider access require manual verification.
