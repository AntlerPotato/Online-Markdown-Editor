# Online Markdown Editor

A lightweight Markdown editor that runs entirely in the browser: live preview on the left, source on the right, with math, code highlighting and a table of contents. There is no build step and no server: open `index.html` and start writing.

<img width="1440" height="900" alt="Markdown 编辑器界面：左侧预览，右侧编辑" src="docs/screenshot.png" />

## Features

**Writing**
- Editor with line numbers, Markdown syntax highlighting and current-line highlight
- Floating toolbar: undo/redo, paragraph style (H1–H6), bold, italic, strikethrough, highlight, links, images, tables, code blocks, formulas, quotes, lists, task lists, table of contents, horizontal rules
- Table picker (up to 6 × 8, with column alignment) and a link/image dialog
- File / Edit / Insert / View menus, fully usable from the keyboard

**Preview**
- Math via KaTeX, code blocks via highlight.js (with line numbers and a copy button)
- `[TOC]` table of contents that marks the section you are reading
- Synchronised scrolling between preview and source, anchored on headings

**Workspace**
- Edit-only, split and preview-only views, with a draggable divider
- Light and dark themes, adjustable font size, word count and reading time
- Autosave in the browser, plus import and export of `.md` files

## Markdown extras

| Syntax | Result |
|:--|:--|
| `==text==` | Highlighted text |
| `$E=mc^2$` or `$$E=mc^2$$` on one line | Inline formula |
| `$$` on its own lines around a formula | Block formula |
| `[TOC]` on its own line | Table of contents |
| `- [ ]` / `- [x]` | Task list |

Standard GitHub-flavoured Markdown (tables, fenced code, strikethrough, autolinks) works as usual. A single line break is kept as a line break.

## Keyboard shortcuts

| Action | Windows / Linux | macOS |
|:--|:--|:--|
| Bold | `Ctrl+B` | `⌘B` |
| Italic | `Ctrl+I` | `⌘I` |
| Insert link | `Ctrl+K` | `⌘K` |
| Undo | `Ctrl+Z` | `⌘Z` |
| Redo | `Ctrl+Y` or `Ctrl+Shift+Z` | `⌘⇧Z` |

## Getting started

Open `index.html` in a modern browser (Chrome, Edge, Firefox or Safari). To serve it instead, any static server works:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

To deploy it, upload the folder to any static host (GitHub Pages, Netlify, Vercel, IPFS, etc.).

Libraries (marked, highlight.js, KaTeX) and fonts load from CDNs, so the first visit needs an internet connection.

## Your data

Documents are autosaved to your browser's `localStorage`. They never leave your device and are not synced anywhere. Clearing site data or using a private window removes them, so use **导出** (Export) to keep a `.md` copy of anything important.

## Project structure

```
index.html              App markup: header, menus, toolbar, panes, popovers
assets/
  css/
    tokens.css          Design tokens (colours, fonts, radii, shadows), light and dark
    base.css            Reset and shared controls (buttons, segmented control, inputs)
    layout.css          App shell: header, stage, toolbar, card, panes, splitter, status bar
    menus.css           Dropdown menus, table picker, link dialog
    editor.css          Source editor (transparent textarea over a highlighted backdrop)
    preview.css         Rendered Markdown, code theme, KaTeX tweaks
  js/
    store.js            Safe localStorage wrapper (settings and autosave)
    sample.js           Document shown on first visit
    markdown.js         Markdown → HTML (marked renderer, math, TOC)
    syntax.js           Markdown syntax highlighting for the editor
    editor.js           Editor component: backdrop, caret tracking, undo/redo
    commands.js         Formatting commands (wrap, headings, lists, tables, links)
    popover.js          Menu and popover positioning and keyboard handling
    app.js              Wires everything together
docs/
  screenshot.png
```

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE).
