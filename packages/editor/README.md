# `@ruxt/editor`

Private Nuxt layer containing the source-editing primitives shared by ruxt and its dedicated admin application.

## Boundary

This package owns:

- the CodeMirror Markdown/CSS editor and editor commands;
- sanitized CV Markdown rendering;
- scoped preview CSS processing;
- the dependencies required by those primitives.

It deliberately owns no routes, layouts, authentication, storage, template lifecycle, or application API calls. Domain types continue to live in `core`.

## Consumption

Add the workspace dependency and extend the layer from the consuming Nuxt config. Consuming apps also provide the declared CodeMirror peer dependencies so Vite resolves a single copy of `@codemirror/state`; loading multiple copies breaks CodeMirror extension identity checks.

```ts
export default defineNuxtConfig({
  extends: ["./packages/editor"],
})
```

For a sibling app, resolve the layer's repository path. `CodeMirror` and `CodePreview` are then available through Nuxt component discovery. Types and helpers may be imported from the package exports:

```ts
import type { EditorStats } from "@ruxt/editor/composables/useCodeMirror"
```

`CodeMirror` takes an optional `highlights` prop (`CodeMirrorHighlight[]`: `from`, `to`, extra `class`, `title`) that marks source ranges; the marks follow edits until the host passes new ones. Set `--highlight-color` through the extra class to colour them. The exposed `revealRange(from, to)` selects a range and scrolls it into view.

Keep product-specific workspaces in their respective applications and compose these primitives there.
