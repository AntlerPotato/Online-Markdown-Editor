# Online Markdown Editor

A lightweight Markdown editor that runs entirely in the browser. Write in live mode, where the block you are editing shows its Markdown and everything else stays rendered, or use the source, split and preview views. Math, code highlighting and a table of contents are built in. There is no build step and no server: open `index.html` and start writing.

<img width="1440" height="900" alt="Markdown 编辑器的实时模式：左侧大纲，中间是排好版的文档，正在编辑的一块显示 Markdown 标记" src="docs/screenshot.png" />

## Features

**Live mode (实时)**
- The document is shown rendered; the block the caret is in shows its Markdown markers, keeping its size, weight and colour, and is rendered again as soon as the caret leaves it. In a list or a quote only the lines with the caret show their markers; the others keep their bullets, numbers and checkboxes
- Click a block to edit it there; the arrow keys move between blocks. Enter starts a new paragraph (or continues a list or quote), Shift+Enter in the middle of a line breaks it there, Esc stops editing
- Type `/` on an empty line (or click the **+** beside it) for a menu of blocks to insert — headings, lists, quote, table, code, formula, HTML, table of contents — filtered as you type, in Chinese, English or pinyin
- Select text for a toolbar above it: bold, italic, strikethrough, highlight, inline code, inline formula, link, clear formatting, and **标注**
- A handle beside each block: drag it to move the block, or click it for a menu (turn it into a paragraph, heading, quote, list or code block; insert below; copy; copy as Markdown; delete). Ctrl+Enter opens an empty line below the block being edited
- Tables are edited cell by cell: Tab and Enter move between cells and add a row at the end, the arrow keys cross cell edges, Backspace at the start of an empty row removes it, and a toolbar above the table sets the column's alignment, inserts or deletes rows and columns, or deletes the table. A line like `| Name | Age |` becomes a table when you press Enter at its end
- In the table being edited, drag across cells (or Shift+click, or Shift+an arrow key at the edge of a cell's text) to select several: Ctrl+C copies them as a Markdown table, with an HTML table beside it for spreadsheets and word processors; Ctrl+X cuts them, Delete empties them, and the toolbar's alignment and delete buttons work on all of them. Esc or a click lets go
- Click an image for a toolbar above it: align it left, centre or right, make it 50% or 100% of the text's width, replace it or delete it; drag its corners to set the width (in steps of 5%). An image with a width or alignment is written as HTML that GitHub also shows: `<img src="…" alt="…" width="50%">`, in `<p align="center">` when centred. Back at full width on the left it is `![…](…)` again
- Hovering over a link, or putting the caret in it, shows a bubble to open, edit, copy or remove it; Ctrl+K edits the link the caret is in
- Code blocks are edited in a code editor with line numbers; the language chip at its top left opens a searchable list of languages; formula blocks show a live preview under their LaTeX, and an inline formula shows one while the caret is in it
- `html` code blocks run as web pages, in a frame sandboxed with only `allow-scripts`: their scripts work, but they can't reach the editor's page or its storage. A frame is made when it scrolls near the view and grows with its content (up to 80% of the view's height); its bottom-right corner has zoom (50–200%), full screen, **</>** to edit the code, and a grip to set the height by hand (double-click it to follow the content again). While the code is being edited, the 安全渲染 label says what the sandbox allows and 预览 shows the result under the code. The editor's colours are there as CSS variables (`var(--accent)`, `var(--text)` …) and follow the theme
- Click a task's checkbox to tick it; Ctrl/⌘-click a link to open it
- Blocks that render to nothing, such as reference definitions (`[id]: https://…`), show their source in grey
- Typing `` ``` `` or `$$` on a line of its own and pressing Enter creates a code or formula block. Until then what follows the `` ``` `` stays as it is, and leaving the line writes the closing `` ``` ``
- 打字机 (typewriter) keeps the caret line in the middle of the screen; 专注 (focus) fades every block but the one being edited
- Fast on long documents: only the edited block is re-rendered, rendered blocks are cached, and off-screen blocks skip layout

**On phones**
- A 60px top bar: the file menu, the file name and its save state, a switch between live and source, and a **⋯** menu with the other views, dark mode, the status bar's switches and font size, typography settings and the annotation panel
- While a block is being edited, a row of buttons above the on-screen keyboard: insert a block (`/`), bold, italic, task list, link, undo, and hide the keyboard

**Source editing**
- Editor with line numbers, Markdown syntax highlighting and current-line highlight
- A two-row top bar: the logo opens the file menu (new, import, export), then the outline switch and the document's name, the command palette, the save state, view modes, typography settings, theme and export; the formatting tools are on the second row, with the annotation panel's button at its end
- Formatting tools: undo/redo, paragraph style (H1–H6), bold, italic, strikethrough, highlight, links, images, tables, code blocks, formulas, quotes, lists, task lists, table of contents, horizontal rules
- On narrow windows the trailing tool groups move into a **⋯** (more) menu
- Table picker (up to 6 × 8, with column alignment) and a link/image dialog
- Toolbar and menus are fully usable from the keyboard

**Preview**
- Math via KaTeX, code blocks via highlight.js (with line numbers and a copy button); both are downloaded only once a document contains a formula or a code block
- `html` code blocks run in the same sandboxed frames; while you type in the split view, frames whose HTML didn't change keep running
- `[TOC]` table of contents that marks the section you are reading
- Synchronised scrolling between preview and source, anchored on headings

**Workspace**
- Live, source, split and preview views, with a draggable divider in the split view
- An outline of the document's headings beside it, marking the section being edited (or read); click a heading to go to it
- A command palette (`Ctrl+Shift+P`) with every command, found by its Chinese or English name or by pinyin
- Annotations for revising with an AI: select text, choose **标注** on the selection toolbar (or `Ctrl+Alt+M`) and pick a phrase or write a note. Annotated text is tinted and numbered in the live view and the preview; the annotation panel lists them, and **复制全部标注** copies them all as text (section, line, the original Markdown and the change wanted) to paste into an AI chat. After copying, each one shows whether its text has changed since. Deleted ones stay in a history. Annotations are kept in the browser, never in the `.md` file
- Typography settings: page width (presets, a slider, or drag the page's edges), Latin, Chinese and code fonts, and line spacing. A font is downloaded only once chosen; the settings are kept in the browser
- Light and dark themes; the status bar holds the block type (in live mode; the size of the selection while text is selected), the caret position, word and line count, reading time, the typewriter, focus and sync-scroll switches and the font size
- Autosave in the browser, plus import and export of `.md` files. The save indicator next to the view switch names its state in its tooltip and stays expanded if saving fails

## Markdown extras

| Syntax | Result |
|:--|:--|
| `==text==` | Highlighted text |
| `$E=mc^2$` or `$$E=mc^2$$` on one line | Inline formula |
| `$$` on its own lines around a formula | Block formula |
| `[TOC]` on its own line | Table of contents |
| `- [ ]` / `- [x]` | Task list |
| A fenced code block in `html` | The HTML, run in a sandboxed frame |
| `<p align="center"><img src="…" width="50%"></p>` | An image half the text's width, centred (what the image toolbar writes) |

Standard GitHub-flavoured Markdown (tables, fenced code, strikethrough, autolinks) works as usual. A single line break is kept as a line break. Bare addresses are linked as on GitHub: everything up to the next space is part of the link (`https://a.com，然后` links `https://a.com，然后`, so leave a space after an address), and `www.` right after another character (`访问www.a.com`) is not a link.

HTML written straight into the document (not in an `html` code block) is cleaned with [DOMPurify](https://github.com/cure53/DOMPurify) before it is shown: scripts, `onclick`-style attributes, `<style>`, forms, `<meta>` and `position: fixed` are taken out, and an `<iframe>` may only show another site (a video, a map), sandboxed. Links and images only get `http`, `https`, `mailto` and `tel` addresses (images also `data:`), in-page `#ids` and relative paths; a `javascript:` link stays plain text. For styled or interactive content, use an `html` code block.

## Keyboard shortcuts

| Action | Windows / Linux | macOS |
|:--|:--|:--|
| Bold | `Ctrl+B` | `⌘B` |
| Italic | `Ctrl+I` | `⌘I` |
| Insert link (or edit the link the caret is in) | `Ctrl+K` | `⌘K` |
| Paragraph / heading 1–6 | `Ctrl+0` / `Ctrl+1`–`Ctrl+6` | `⌘0` / `⌘1`–`⌘6` |
| Undo | `Ctrl+Z` | `⌘Z` |
| Redo | `Ctrl+Y` or `Ctrl+Shift+Z` | `⌘⇧Z` |
| Annotate the selection | `Ctrl+Alt+M` | `⌘⌥M` |
| Command palette | `Ctrl+Shift+P` | `⌘⇧P` |
| Live mode: an empty line below the block | `Ctrl+Enter` | `⌘↩` |
| Live mode: stop editing the block | `Esc` | `Esc` |
| Live mode, in a table: select cells | `Shift`+click, or `Shift+←↑→↓` at the edge of a cell's text | `⇧`+click, or `⇧←↑→↓` |

## Getting started

Open `index.html` in a modern browser (Chrome, Edge, Firefox or Safari). To serve it instead, any static server works:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

To deploy it, upload the folder to any static host (GitHub Pages, Netlify, Vercel, IPFS, etc.).

Libraries (marked, DOMPurify, highlight.js, KaTeX) and fonts load from CDNs, so the first visit needs an internet connection. Each library is pinned to a version with its hash (`integrity`), so the browser refuses a changed file. highlight.js and KaTeX are fetched the first time a document needs them; offline, code shows unhighlighted and formulas as their TeX source. If DOMPurify can't load, HTML in documents is shown as text.

## Working on the code

Clone the repository rather than downloading a ZIP, so your edits can be committed and pushed back:

```bash
git clone https://github.com/AntlerPotato/Online-Markdown-Editor.git
cd Online-Markdown-Editor
```

If you prefer not to use the command line, GitHub Desktop's **File › Clone repository** does the same.

There is nothing to install or build: edit the files, refresh the browser, then commit. A few files keep everyone's setup consistent:

- `.gitattributes` stores text files with LF line endings on every platform, so editing on Windows doesn't mark every line as changed
- `.editorconfig` tells most editors to use UTF-8, LF and 4-space indentation, matching the existing code (VS Code needs the EditorConfig extension)
- `.gitignore` keeps OS and editor clutter (`.DS_Store`, `Thumbs.db`, `.vscode/`, `.idea/`, …) out of commits

## Your data

Documents are autosaved to your browser's `localStorage`. They never leave your device and are not synced anywhere. HTML blocks run in sandboxed frames that can't read this storage (they can still load things from the internet, as any web page can); other HTML in a document is cleaned, so it can't run script in the editor's page at all. Clearing site data or using a private window removes them, so use **导出** (Export) to keep a `.md` copy of anything important. Annotations are kept the same way, beside the document; they are not part of the exported file.

## Project structure

```
index.html              App markup: top bar, toolbar, outline, panes, panels, status bar, popovers
assets/
  css/
    tokens.css          Design tokens (colours, fonts, radii, shadows), light and dark
    base.css            Reset and shared controls (buttons, segmented control, inputs)
    layout.css          App shell: stage, card, top bar, toolbar, outline, typography settings, panes, splitter, annotation panel, status bar, phone layout
    menus.css           Menus and popovers: file, paragraph style, more tools, phone menu, table picker, link dialog, slash menu, floating toolbars, block menu, link bubble, language menu, command palette, annotation dialog, toast
    editor.css          Source editor (transparent textarea over a highlighted backdrop)
    preview.css         Rendered Markdown, code theme, KaTeX tweaks, HTML block frames, annotation marks
    live.css            Live mode: blocks, the block being edited, code, formula and table editing (and selected cells), images and their corner handles, block handles
  js/
    store.js            Safe localStorage wrapper (settings and autosave)
    typography.js       Typography settings (page width, fonts, line spacing), applied before the first paint
    sample.js           Document shown on first visit
    loader.js           Loads highlight.js and KaTeX on first use, checking their hashes
    html-frames.js      HTML blocks: sandboxed frames, made near the view; height, zoom, full screen
    markdown.js         Markdown → HTML (marked renderer, math, TOC); cleans HTML in documents (DOMPurify) and unsafe link addresses
    syntax.js           Markdown syntax highlighting for the editor
    editor.js           Editor component: backdrop, caret tracking, undo/redo; holds the document for every view
    table.js            Table text: cells, alignment, inserting and deleting rows and columns
    links.js            Links in Markdown text: finding, editing and removing them
    live.js             Live mode: splits the document into blocks, caches their HTML, edits one block at a time; table cells (and selecting them), images' width and alignment
    commands.js         Formatting commands (wrap, headings, lists, tables, links)
    popover.js          Menu and popover positioning and keyboard handling
    live-tools.js       Live mode: slash menu, selection, table and image toolbars, link bubble, code language menu
    live-blocks.js      Live mode: block handles, the block menu, dragging blocks
    outline.js          The outline of headings beside the document
    palette.js          The command palette
    annotations.js      Annotations without the page: following passages through edits, finding them in rendered text, the copied text
    annotate.js         The annotation dialog, panel and marks in the document
    app.js              Wires everything together (including the toolbar overflow)
  img/
    sample.svg          The picture in the sample document
docs/
  screenshot.png
.gitattributes          Line endings (LF) and binary file rules
.editorconfig           Shared editor settings
.gitignore              Files kept out of the repository
```

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE).
