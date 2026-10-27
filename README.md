# Online Markdown Editor

A Markdown editor that runs entirely in the browser. In live mode you write in the formatted page itself: the block you are editing shows its Markdown, everything else stays rendered. Source, split and preview views are one click away. Math, code highlighting, tables, a table of contents, HTML that runs in a sandbox and annotations for revising with an AI are built in. There is no build step and no server: open `index.html` and start writing.

<img width="1440" height="900" alt="Markdown 编辑器的实时模式：左侧大纲，中间是排好版的文档，正在编辑的一块显示 Markdown 标记" src="docs/screenshot.png" />

## Contents

- [Highlights](#highlights)
- [Getting started](#getting-started)
- [A tour of the window](#a-tour-of-the-window)
- [Writing in live mode](#writing-in-live-mode)
- [Tables, images, links, code and formulas](#tables-images-links-code-and-formulas)
- [HTML blocks](#html-blocks)
- [Revising with an AI: annotations](#revising-with-an-ai-annotations)
- [On phones](#on-phones)
- [Markdown extras](#markdown-extras)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Your data and safety](#your-data-and-safety)
- [Browser support](#browser-support)
- [Working on the code](#working-on-the-code)
- [Project structure](#project-structure)

## Highlights

- **Live mode (实时)**: edit in the formatted page; only the block under the caret shows its Markdown, and it is formatted again as soon as you leave it
- **Insert anything with `/`**: a menu of headings, lists, tables, code, formulas, HTML and more, filtered as you type in Chinese, English or pinyin
- **Tables edited cell by cell**, with a toolbar for alignment and rows and columns, and cells you can select and copy as a table
- **Images** aligned and resized from a toolbar or by dragging their corners
- **HTML blocks** that run as small web pages in a sandboxed frame
- **Annotations**: mark passages with notes, copy them all for an AI, paste the revision back and see which ones changed
- **Outline, command palette and typography settings** (page width, fonts, line spacing)
- **Phones**: a compact top bar and a row of buttons above the on-screen keyboard
- **Fast on long documents** and **private**: everything stays in your browser

## Getting started

Open `index.html` in a modern browser. To serve it instead, any static server works:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

To publish it, upload the folder to any static host (GitHub Pages, Netlify, Vercel, IPFS, …).

The first visit opens a sample document that walks through the interface; it is a good place to try things. Start your own from the **md** menu at the top left: **新建文档** (new), **导入 Markdown 文件** (import) or **导出 Markdown 文件** (export). The document is saved in the browser as you type.

Libraries (marked, DOMPurify, highlight.js, KaTeX) and fonts load from CDNs, so the first visit needs an internet connection. Each library is pinned to a version with its hash (`integrity`), so the browser refuses a changed file. highlight.js and KaTeX are fetched only when a document first needs them; offline, code shows unhighlighted and formulas as their TeX source.

## A tour of the window

**The top bar** has two rows. The first holds the **md** file menu, the outline switch, the document's name, the command palette, the save state, the four views, typography settings (the gear), dark mode and export. The second row is the formatting toolbar, with the **标注** (annotations) panel's button at its end. When the window is narrow, the toolbar's last groups move into a **⋯** menu.

**Four views** edit the same document:

| View | For | What you see |
|:--|:--|:--|
| 实时 Live | Everyday writing | The formatted page; the block you are in shows its Markdown |
| 源码 Source | Bulk edits | The whole text, with line numbers and syntax highlighting |
| 分栏 Split | Writing while watching the result | Preview on the left, source on the right, a divider to drag; scrolling is kept in step, anchored on headings |
| 预览 Preview | Reading it through | The formatted page only |

**The outline** beside the document lists its headings and marks the section you are editing (or reading). Click one to go there. It hides on windows narrower than 861px.

**The command palette** (`Ctrl+Shift+P`, or the magnifier in the top bar) runs any command by name: type part of its Chinese or English name, or pinyin (`bt` finds 标题, `dc` finds 导出). Commands that have a shortcut show it.

**Typography settings** (the gear) set the page width (窄 640, 适中 760, 宽 960, 铺满, or a slider; you can also drag the page's edges while the panel is open), the Latin font (Outfit, Inter, Roboto, Lora, Merriweather), the Chinese font (system font, 思源黑体, 思源宋体, 霞鹜文楷, 站酷小薇), the code font (JetBrains Mono, Fira Code, Source Code Pro) and the line spacing. A font is downloaded only once you choose it. The settings apply to the document, not to the interface, and are kept in the browser.

**The status bar** shows the block type in live mode (or the size of the selection), the caret's line, the word and line count, reading time, the font size, and switches for **打字机** (typewriter: the caret's line stays in the middle of the screen), **专注** (focus: every block but the one you are editing fades) and synchronised scrolling in the split view.

## Writing in live mode

**Moving around.** Click a block to edit it where it is; the arrow keys move from one block to the next. Enter starts a new paragraph (in a list or a quote it adds an item or a line), Shift+Enter in the middle of a line breaks the line there, Ctrl+Enter opens an empty line below the block, and Esc stops editing. In a list or a quote only the lines the caret is on show their `- `, `1.` or `>`; the other lines keep their bullets, numbers and checkboxes.

**Inserting a block.** On an empty line, type `/` (or click the **+** beside the line) for a menu: 正文 (paragraph), 标题 1–2 (headings), 任务列表 (tasks), 无序列表 (bullets), 引用 (quote), 表格 (table), 代码块 (code), 公式块 (formula), HTML 块 and 目录 (table of contents). Keep typing to filter it: `/表`, `/bg` and `/table` all find the table. ↑ ↓ and Enter pick an option, Esc closes the menu.

You can also just type the Markdown: `#` and a space make a heading, `` ``` `` or `$$` and Enter start a code or formula block (until you press Enter the rest of the document is left alone, and leaving the line closes the block for you), and a line such as `| Name | Age |` followed by Enter becomes a table.

**Formatting text.** Select some text for a toolbar above it: bold, italic, strikethrough, highlight, inline code, inline formula, link, clear formatting, and **标注** (annotate). `Ctrl+B`, `Ctrl+I` and `Ctrl+K` work as usual, and `Ctrl+1`–`Ctrl+6` / `Ctrl+0` turn a block into a heading or back into a paragraph.

**Moving and converting blocks.** Hover over a block for a handle at its left. Drag the handle to move the block; click it for a menu: **转换为** (turn it into a paragraph, heading, quote, list or code block), **在下方插入** (insert below), **复制这一块** (copy it formatted), **复制为 Markdown** and **删除** (delete).

Undo and redo (`Ctrl+Z`, `Ctrl+Y`) work across all views, and moving a block or applying a toolbar command is one step to undo.

## Tables, images, links, code and formulas

**Tables** are edited cell by cell. Tab and Shift+Tab move between cells (Tab in the last cell adds a row), Enter goes to the cell below (and adds a row at the end), the arrow keys cross from cell to cell, and Backspace at the start of an empty row removes it. A toolbar above the table sets the alignment, inserts or deletes rows and columns, and deletes the table. To work on several cells, drag across them, Shift+click, or press Shift and an arrow key at the edge of a cell's text. Then `Ctrl+C` copies them as a Markdown table, with an HTML table alongside for spreadsheets and word processors; `Ctrl+X` cuts them, Delete empties them, and alignment and deleting rows or columns apply to all of them. A `|` typed in a cell is written as `\|` for you.

**Images**: click one for a toolbar to align it left, centre or right, make it 50% or 100% of the text's width, replace it or delete it. Drag its corners to set the width in steps of 5%. A width or an alignment is written as HTML that GitHub shows too, `<img src="…" alt="…" width="50%">`, wrapped in `<p align="center">` when centred. Back at full width on the left it becomes `![…](…)` again.

**Links**: hover over a link, or put the caret in it, for a bubble that opens, edits, copies or removes it. `Ctrl+K` edits the link the caret is in, and Ctrl/⌘-click opens a link. Bare addresses become links as on GitHub, so leave a space after an address: in `https://a.com，然后` the Chinese text is part of the link.

**Code blocks** are edited in a code editor with line numbers. The language at the top left opens a searchable list of languages; a name not in the list can be used too. Highlighting comes from highlight.js, with line numbers and a copy button.

**Formulas** use KaTeX. A formula block shows a live preview under its LaTeX, and an inline formula shows one while the caret is in it.

**Tasks**: click a task's checkbox to tick it.

## HTML blocks

A fenced code block whose language is `html` runs as a small web page inside the document, for example a button, a chart or a layout that Markdown can't do:

````markdown
```html
<style>
  .card { padding: 16px; border-radius: 12px; background: var(--accent-soft); }
</style>
<div class="card">
  <button onclick="this.textContent = '已订阅'">订阅</button>
</div>
```
````

- It runs in a frame sandboxed with only `allow-scripts`: scripts work, but they can't reach the editor's page or its storage. The frame is made when it scrolls near the view and grows with its content, up to 80% of the view's height
- The editor's colours and fonts are available as CSS variables (`var(--accent)`, `var(--text)`, `var(--font-doc)` …) and follow light and dark mode
- Its bottom-right corner has **</>** (edit the code), zoom (50–200%) and full screen, and a grip in the very corner sets the height by hand: drag it, or focus it with Tab and press ↑ ↓ (20px at a time). Double-click it or press Home to follow the content again
- While you edit the code, **安全渲染** says what the sandbox allows and **预览** shows the result under the code. If you leave the code unchanged, the frame comes back exactly as it was, still running
- The preview and the split view show the same frames; while you type, frames whose HTML didn't change keep running

## Revising with an AI: annotations

Annotations let you mark what should change, hand all the notes to an AI in one go, and check its revision.

1. **Mark a passage.** Select it and choose **标注** on the selection toolbar (or press `Ctrl+Alt+M`). Pick a phrase (看不懂，换个说法 / 删掉 / 写详细一点 / 待定, or one you saved with **+ 常用语**) or write a note. The passage is tinted, underlined and numbered in the live view and the preview; a formula is tinted as a whole, and text inside an HTML block is tinted inside its frame.
2. **Review them** in the annotation panel (**标注** at the end of the toolbar). Click one to jump to its text; edit or delete it there. Deleted annotations go to the **历史** (history) tab, where they can be restored.
3. **Copy them all** with **复制全部标注**. You get plain text to paste into an AI chat along with the document:

   ```text
   # 标注 2 条 · 周报.md

   ## 1 · 下周计划 › 第 12 行
   原文：块级缓存已经接上
   修改：写详细一点

   ## 2 · 下周计划 › 第 14 行
   原文：第二段文字。
   修改：删掉
   ```

4. **Paste the revision back.** In the source view, select all and paste the revised document. Each annotation looks for its text again: those still there stay marked; the copied ones whose text the AI changed show **已复制 · 原文已改动**, so you can see which notes were dealt with.

Annotations are kept in the browser beside the document. They are not written into the `.md` file, and they move to the history when you start a new document or import one.

## On phones

- A compact top bar: the **md** menu, the file name and its save state, a switch between live and source, and a **⋯** menu with the other views, dark mode, the status bar's switches and font size, typography settings, the annotation panel and the word count
- While you edit a block, a row of buttons sits above the on-screen keyboard: insert a block (`/`), bold, italic, task list, link, undo, and hide the keyboard
- The `/` menu opens under the line and reaches down to that row at most; if the keyboard leaves too little room, the text moves up to make room for a few options
- Selecting text shows the formatting toolbar below the selection (the system's own menu is above it)
- In the source and split views the formatting tools have a row of their own; what doesn't fit goes into its **⋯** menu

## Markdown extras

| Syntax | Result |
|:--|:--|
| `==text==` | Highlighted text |
| `$E=mc^2$` or `$$E=mc^2$$` on one line | Inline formula |
| `$$` on its own lines around a formula | Block formula |
| `[TOC]` on its own line | Table of contents that marks the section you are reading |
| `- [ ]` / `- [x]` | Task list |
| A fenced code block in `html` | The HTML, run in a sandboxed frame |
| `<p align="center"><img src="…" width="50%"></p>` | An image half the text's width, centred (what the image toolbar writes) |

Standard GitHub-flavoured Markdown (tables, fenced code, strikethrough, autolinks, reference links) works as usual, and a single line break is kept as a line break. A bare address is a link up to the next space, and `www.` straight after another character (`访问www.a.com`) is not a link, as on GitHub.

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
| HTML block's grip (focused with Tab): height 20px less / more, follow the content | `↑` / `↓`, `Home` | `↑` / `↓`, `Home` |

The toolbar and all menus can be used from the keyboard: Tab to the toolbar, then the arrow keys.

## Your data and safety

Documents, settings and annotations are saved in your browser's `localStorage`. They never leave your device and are not synced anywhere. Clearing site data or using a private window removes them, so use **导出** (export) to keep a `.md` copy of anything important.

HTML blocks run in sandboxed frames that can't read this storage (they can still load things from the internet, as any web page can). Other HTML written into a document is cleaned with [DOMPurify](https://github.com/cure53/DOMPurify) before it is shown: scripts, `onclick`-style attributes, `<style>`, forms, `<meta>` and `position: fixed` are taken out, and an `<iframe>` may only show another site (a video, a map), sandboxed. Links and images only get `http`, `https`, `mailto` and `tel` addresses (images also `data:`), in-page `#ids` and relative paths; a `javascript:` link stays plain text. For styled or interactive content, use an `html` code block. If DOMPurify can't load, HTML in documents is shown as text.

## Browser support

The editor is developed and tested in Chromium, which covers desktop Chrome and Edge. Firefox, Safari and real phones haven't been tested yet. A few touches need recent browsers, and older ones simply go without them:

- Annotation tints use the CSS Custom Highlight API (Chrome and Edge 105+, Safari 17.2+, Firefox 140+)
- Moving a block without reloading the HTML frames in it uses `moveBefore()` (Chrome and Edge 133+); elsewhere the frames start again
- Zooming an HTML block uses CSS `zoom` (Firefox 126+)
- Firefox may keep `Ctrl+Shift+P` for a private window; use the command palette's button there

## Working on the code

Clone the repository rather than downloading a ZIP, so your edits can be committed and pushed back:

```bash
git clone https://github.com/AntlerPotato/Online-Markdown-Editor.git
cd Online-Markdown-Editor
```

If you prefer not to use the command line, GitHub Desktop's **File › Clone repository** does the same.

There is nothing to install or build: edit the files, refresh the browser, then commit. The code is plain HTML, CSS and JavaScript with 4-space indentation. A few files keep everyone's setup consistent:

- `.gitattributes` stores text files with LF line endings on every platform, so editing on Windows doesn't mark every line as changed
- `.editorconfig` tells most editors to use UTF-8, LF and 4-space indentation, matching the existing code (VS Code needs the EditorConfig extension)
- `.gitignore` keeps OS and editor clutter (`.DS_Store`, `Thumbs.db`, `.vscode/`, `.idea/`, …) out of commits

When the interface changes, update the sample document (`assets/js/sample.js`) and this README with it.

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
    html-frames.js      HTML blocks: sandboxed frames, made near the view; height (the grip, with the keyboard too), zoom, full screen, annotations' tint; frames kept when the preview is rendered again
    markdown.js         Markdown → HTML (marked renderer, math, TOC); cleans HTML in documents (DOMPurify) and unsafe link addresses
    syntax.js           Markdown syntax highlighting for the editor
    editor.js           Editor component: backdrop, caret tracking, undo/redo; holds the document for every view
    table.js            Table text: cells, alignment, inserting and deleting rows and columns
    links.js            Links in Markdown text: finding, editing and removing them
    live.js             Live mode: splits the document into blocks, caches their HTML, edits one block at a time (moved blocks keep their elements); table cells (and selecting them), images' width and alignment
    commands.js         Formatting commands (wrap, headings, lists, tables, links)
    popover.js          Menu and popover positioning and keyboard handling
    live-tools.js       Live mode: slash menu, selection, table and image toolbars, link bubble, code language menu
    live-blocks.js      Live mode: block handles (also with the mouse in an HTML block's frame), the block menu, dragging blocks
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
