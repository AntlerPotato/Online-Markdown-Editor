// Live mode. The document is cut into blocks with marked.lexer. Every block
// shows its rendered HTML, cached by a hash of its source, until the caret
// enters it; that block then shows its Markdown source, styled like the
// rendered text, and only it is rendered again when the caret leaves.
// Fenced code and formula blocks get editors of their own; a table stays
// rendered and only the cell with the caret shows its source.
//
// The hidden textarea editor keeps the one copy of the document: every
// change made here goes through editor.replaceRange and the caret through
// editor.select, so undo, autosave, the toolbar and the other views work
// exactly as before.
(function (MDE) {
    const { markdown } = MDE;

    const CACHE_LIMIT = 3000;          // rendered blocks kept in memory
    const REBUILD_DELAY = 120;         // ms of quiet typing before the block structure is checked again
    const CODE_HIGHLIGHT_DELAY = 150;  // ms of quiet typing before a code block is highlighted again
    const MATH_PREVIEW_DELAY = 60;
    const HTML_PREVIEW_DELAY = 400;    // ms of quiet typing before the HTML block's preview runs again
    const PLACEHOLDER = '输入 / 插入块，或直接开始写作';

    const HEADING_LABELS = ['一级标题', '二级标题', '三级标题', '四级标题', '五级标题', '六级标题'];
    const USES_DEFS = new Set(['paragraph', 'heading', 'quote', 'list', 'table', 'image', 'toc']);
    const MONO_KINDS = new Set(['code', 'fence', 'math', 'html', 'def', 'hr']);
    const PLAIN_ENTER_KINDS = new Set(['code', 'fence', 'math', 'html', 'def', 'table']);
    // Toolbar commands that rewrite whole lines, list commands, and ones
    // that insert a block
    const LINE_COMMANDS = new Set(['heading', 'quote']);
    const LIST_COMMANDS = new Set(['ul', 'ol', 'task']);
    const BLOCK_COMMANDS = new Set(['table', 'code', 'math', 'toc', 'hr']);
    // Lines inside a table cell
    const CELL_BREAK = /[ \t]*<br\s*\/?>[ \t]*/i;

    const IMAGE_ONLY = /^(?:[ \t]*!\[(?:\\.|[^\\\]\n])*\]\([^)\n]*\)[ \t]*(?:\n|$))+$/;
    const IMAGE_LINE = /^([ \t]*)!\[((?:\\.|[^\\\]\n])*)\]\(([^)\n]*)\)[ \t]*$/;
    // An HTML block of one <img>, on its own or in a <p> or <div>: shown
    // and edited as an image, like ![…](…)
    const ATTRS = String.raw`(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>\x60]+))?)*\s*`;
    const IMAGE_HTML = new RegExp(String.raw`^\s*(?:<(p|div)${ATTRS}>\s*)?<img${ATTRS}/?>\s*(?:</\1\s*>\s*)?$`, 'i');
    const ALIGNS = new Set(['left', 'center', 'right']);
    const MEDIA_DELAY = 400;            // ms of quiet typing before the images under an image's source follow it
    const TOC_LINE = /^[ \t]*\[TOC\][ \t]*$/m;
    const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})([^\n]*)/;
    const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})[^`\n]*$/;
    const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
    // One line between pipes ("| a | b |"), the last one not escaped
    const TABLE_HEADER = /^ {0,3}\|.*(?<!\\)\|[ \t]*$/;
    const QUOTE_PREFIX = /^ {0,3}>[ \t]?(?:>[ \t]?)*/;
    const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?/;
    const TASK_MARK = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\]/gm;
    const INLINE_MATH = /(\$\$?)([^$\n]+?)\1/g;
    // "/" typed on an empty line opens the slash menu, and what follows it
    // filters the menu. "、" is what the same key types with a Chinese
    // input method.
    const SLASH = /^[/、]([^\n]*)$/;
    const SLASH_KEYS = new Set(['/', '、']);
    const LEADING_TABS = /^( *)(\t+)/gm;
    const ICON_SAFE = '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>';

    // Firefox before 136 has no plaintext-only; pasting and Enter are
    // handled here either way, so plain contenteditable is a fine fallback
    const EDITABLE = (() => {
        const probe = document.createElement('div');
        try { probe.contentEditable = 'plaintext-only'; } catch (e) { /* unsupported */ }
        return probe.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true';
    })();

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    // What the slash menu puts in place of the "/…" line: the Markdown, the
    // selection in it (the caret goes to its end by default), and whether
    // the caret moves on to an empty line after it
    const TABLE_CELLS = ' 单元格 |'.repeat(3);
    const SLASH_BLOCKS = {
        p: { text: '' },
        h1: { text: '# ' },
        h2: { text: '## ' },
        task: { text: '- [ ] ' },
        ul: { text: '- ' },
        quote: { text: '> ' },
        table: { text: `| 标题1 | 标题2 | 标题3 |\n|---|---|---|\n|${TABLE_CELLS}\n|${TABLE_CELLS}`, select: [2, 5] },
        code: { text: '```\n\n```', select: [4, 4] },
        math: { text: '$$\n\n$$', select: [3, 3] },
        html: { text: '```html\n\n```', select: [8, 8] },
        toc: { text: '[TOC]', after: true }
    };

    // cyrb53: a fast 53-bit string hash, the key of the rendered-block cache
    function hash(str) {
        let h1 = 0xdeadbeef;
        let h2 = 0x41c6ce57;
        for (let i = 0; i < str.length; i++) {
            const ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return 4294967296 * (2097151 & h2) + (h1 >>> 0);
    }

    // ========================================================================
    // Splitting the document into blocks
    // ========================================================================

    function lineStarts(text) {
        const starts = [0];
        for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
        return starts;
    }

    // Index of the last entry <= pos in a sorted array
    function lastAtOrBefore(sorted, pos) {
        let lo = 0;
        let hi = sorted.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (sorted[mid] <= pos) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    // marked expands leading tabs before lexing (lexed is the text it
    // sees); map its offsets back to ours
    function offsetMapper(text) {
        const lexed = text.replace(LEADING_TABS, (m, lead, tabs) => lead + '    '.repeat(tabs.length));
        if (lexed === text) return { lexed, toSource: (pos) => pos };
        const ours = lineStarts(text);
        const theirs = lineStarts(lexed);
        const lineEnd = (starts, line, total) => (line + 1 < starts.length ? starts[line + 1] - 1 : total);
        return {
            lexed,
            toSource(pos) {
                const line = lastAtOrBefore(theirs, pos);
                const ourLength = lineEnd(ours, line, text.length) - ours[line];
                const extra = lineEnd(theirs, line, lexed.length) - theirs[line] - ourLength;
                return ours[line] + clamp(pos - theirs[line] - extra, 0, ourLength);
            }
        };
    }

    // Whole lines only: no trailing blank lines, but the last line keeps its
    // trailing spaces (marked sometimes hands them to the next token), so a
    // caret typed after them is still inside the block
    function trimRange(text, start, end) {
        for (;;) {
            while (end > start && text[end - 1] === '\n') end--;
            const lineStart = text.lastIndexOf('\n', end - 1) + 1;
            if (end > start && lineStart > start && !text.slice(lineStart, end).trim()) {
                end = lineStart;
                continue;
            }
            break;
        }
        while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
        const lineStart = start ? text.lastIndexOf('\n', start - 1) + 1 : 0;
        if (lineStart < start && !text.slice(lineStart, start).trim()) start = lineStart;
        return [start, end];
    }

    // A formula over several lines may contain blank lines, or lines that
    // look like lists or headings: keep everything it touches in one block
    function mergeMath(list, spans) {
        if (!spans.length) return list;
        const join = new Array(list.length).fill(false);
        let first = 0;
        spans.forEach((span) => {
            while (first < list.length && list[first].end <= span.start) first++;
            for (let k = first + 1; k < list.length && list[k].start < span.end; k++) join[k] = true;
        });
        const out = [];
        list.forEach((item, i) => {
            const prev = out[out.length - 1];
            if (join[i] && prev) {
                prev.end = Math.max(prev.end, item.end);
                prev.token = null;
            } else {
                out.push({ ...item });
            }
        });
        return out;
    }

    // A reference definition ([id]: url) that doesn't continue a paragraph
    // gets no token from marked: its text is skipped. marked's own rule
    // finds where it ends (sticky, to match at a given offset).
    const DEF = new RegExp(marked.Lexer.rules.block.gfm.def.source.replace(/^\^/, ''), 'y');

    function split(text) {
        const { lexed, toSource } = offsetMapper(text);
        const tokens = marked.lexer(text);
        const list = [];
        let pos = 0;
        let last = 0;
        const add = (from, to, token) => {
            let [start, end] = trimRange(text, toSource(from), toSource(to));
            start = Math.max(start, last);
            if (end <= start || !text.slice(start, end).trim()) return;
            list.push({ start, end, token });
            last = end;
        };
        // The definitions marked skipped before the token whose source is
        // next (null: the end): a block for each run of them, a blank line
        // ending a run. Only taken if the token then starts where it should.
        const skipDefinitions = (next) => {
            const runs = [];
            let from = pos;
            let at = pos;
            for (;;) {
                DEF.lastIndex = at;
                const def = DEF.exec(lexed);
                if (!def) break;
                at += def[0].length;
                if (def[0].endsWith('\n\n')) {
                    runs.push([from, at]);
                    from = at;
                }
            }
            if (from < at) runs.push([from, at]);
            if (!runs.length || (next !== null && !lexed.startsWith(next, at))) return;
            runs.forEach(([a, b]) => add(a, b, { type: 'def', raw: lexed.slice(a, b) }));
            pos = at;
        };
        tokens.forEach((token) => {
            skipDefinitions(token.raw);
            const from = pos;
            pos = Math.min(lexed.length, pos + token.raw.length);
            if (token.type !== 'space') add(from, pos, token);
        });
        skipDefinitions(null);
        return { list: mergeMath(list, markdown.mathSpans(text)), links: tokens.links || {} };
    }

    // The document's headings, for the outline: the level, where the
    // heading starts and where its first line ends, and its token (a line
    // inside a formula is never a heading)
    MDE.headingsOf = function (text) {
        return split(text).list.filter((item) => item.token && item.token.type === 'heading').map((item) => {
            const lineEnd = text.indexOf('\n', item.start);
            return { level: item.token.depth, start: item.start, end: lineEnd === -1 || lineEnd > item.end ? item.end : lineEnd, token: item.token };
        });
    };

    // The document's blocks and their kinds, for finding an annotated
    // passage in the rendered preview (html: a ```html frame)
    MDE.blocksOf = function (text) {
        return split(text).list.map((item) => {
            const k = kindOf(item.token, text.slice(item.start, item.end));
            return { start: item.start, end: item.end, kind: k.kind, html: k.kind === 'fence' && k.lang === 'html' };
        });
    };

    // ```html: shown in a sandboxed frame (html-frames.js)
    const isHtml = (b) => b.kind === 'fence' && b.lang === 'html' && !!MDE.htmlFrames;
    // Moving an element with moveBefore() doesn't load its frames again
    // (Chrome and Edge 133+); elsewhere moved blocks are made anew
    const CAN_MOVE = typeof Element.prototype.moveBefore === 'function';

    // ========================================================================
    // Image blocks: one ![…](…) per line, or one <img> written in HTML. The
    // image toolbar sets an image's width and alignment by writing it as
    // <img … width="50%">, in <p align="center"> when it isn't on the left.
    // ========================================================================

    const unescapeMd = (value) => value.replace(/\\([!-/:-@[-`{-~])/g, '$1');
    const escapeAttr = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const attrsOf = (el) => Array.from(el.attributes, (a) => [a.name, a.value]);
    const attrOf = (attrs, name) => {
        const found = attrs.find(([n]) => n === name);
        return found ? found[1] : null;
    };

    // ![alt](destination "title"): the destination and the title as written
    function splitTarget(inner) {
        const m = /^\s*(<[^<>\n]*>|\S*)(?:\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))?\s*$/.exec(inner);
        return m ? { dest: m[1], title: m[2] || '' } : { dest: inner.trim(), title: '' };
    }

    const srcOf = (dest) => unescapeMd(dest.startsWith('<') ? dest.slice(1, -1) : dest);
    const titleOf = (title) => (title ? unescapeMd(title.slice(1, -1)) : null);

    // Where the alt="…" of the <img> in an HTML source ends (without one:
    // the end of its attributes)
    function altEndIn(source) {
        const re = /\s+([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/y;
        re.lastIndex = Math.max(0, source.search(/<img/i)) + 4;
        let end = re.lastIndex;
        let m;
        while ((m = re.exec(source))) {
            end = re.lastIndex;
            if (m[1].toLowerCase() === 'alt' && m[2] !== undefined) return end - (/^["']/.test(m[2]) ? 1 : 0);
        }
        return end;
    }

    // The images of an image block's source: where each one is (from, to;
    // altEnd: the end of its description), its address, description,
    // title, width (an attribute's value, or null) and alignment; for one
    // in HTML its attributes and those of the <p>/<div> around it, for one
    // in Markdown how its parts are written (md)
    function imagesOf(source, htmlImage) {
        if (htmlImage) {
            const tpl = document.createElement('template');
            tpl.innerHTML = source;
            const img = tpl.content.querySelector('img');
            if (!img) return [];
            const attrs = attrsOf(img);
            const parent = img.parentElement;
            const wrap = parent ? { tag: parent.localName, attrs: attrsOf(parent) } : null;
            const align = ((wrap && attrOf(wrap.attrs, 'align')) || '').toLowerCase();
            return [{
                from: 0,
                to: source.length,
                altEnd: altEndIn(source),
                source,
                html: true,
                indent: '',
                src: attrOf(attrs, 'src') || '',
                alt: attrOf(attrs, 'alt') || '',
                title: attrOf(attrs, 'title'),
                width: attrOf(attrs, 'width'),
                align: ALIGNS.has(align) ? align : 'left',
                attrs,
                wrap
            }];
        }
        const images = [];
        let at = 0;
        source.split('\n').forEach((line) => {
            const m = IMAGE_LINE.exec(line);
            if (m) {
                const target = splitTarget(m[3]);
                images.push({
                    from: at,
                    to: at + line.length,
                    altEnd: at + m[1].length + 2 + m[2].length,
                    source: line,
                    html: false,
                    indent: m[1],
                    src: srcOf(target.dest),
                    alt: unescapeMd(m[2]),
                    title: titleOf(target.title),
                    width: null,
                    align: 'left',
                    md: { alt: m[2], dest: target.dest, title: target.title }
                });
            }
            at += line.length + 1;
        });
        return images;
    }

    // An image's source: Markdown while it needs nothing else (no width,
    // on the left, no other attributes), else HTML. caret: where its
    // description ends.
    function writeImage(image) {
        const SET = ['src', 'alt', 'title', 'width'];
        const extra = image.html ? image.attrs.filter(([n]) => !SET.includes(n)) : [];
        let wrapAttrs = image.wrap ? image.wrap.attrs.slice() : [];
        if (image.align === 'left') wrapAttrs = wrapAttrs.filter(([n]) => n !== 'align');
        else if (attrOf(wrapAttrs, 'align') !== null) wrapAttrs = wrapAttrs.map(([n, v]) => [n, n === 'align' ? image.align : v]);
        else wrapAttrs.push(['align', image.align]);

        if (!image.width && !extra.length && !wrapAttrs.length) {
            // As written where it didn't change
            const md = image.md || {};
            const alt = md.alt !== undefined && unescapeMd(md.alt) === image.alt ? md.alt : image.alt.replace(/[\\[\]]/g, '\\$&');
            let dest = md.dest !== undefined && srcOf(md.dest) === image.src ? md.dest
                : image.src.replace(/[()<>]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
            if (/\s/.test(dest) && !dest.startsWith('<')) dest = `<${dest}>`;
            const title = image.title === null ? ''
                : ' ' + (md.title && titleOf(md.title) === image.title ? md.title : `"${image.title.replace(/["\\]/g, '\\$&')}"`);
            const head = `${image.indent}![${alt}`;
            return { text: `${head}](${dest}${title})`, caret: head.length, html: false };
        }

        const values = { src: image.src, alt: image.alt, title: image.title, width: image.width };
        let attrs = image.html ? image.attrs.map(([n, v]) => [n, n in values ? values[n] : v])
            : [['src', image.src], ['alt', image.alt], ['title', image.title]];
        if (attrOf(attrs, 'alt') === null) attrs.splice(attrOf(attrs, 'src') === null ? 0 : attrs.findIndex(([n]) => n === 'src') + 1, 0, ['alt', image.alt]);
        if (image.width && !attrs.some(([n]) => n === 'width')) attrs.push(['width', image.width]);
        attrs = attrs.filter(([, v]) => v !== null && v !== undefined);
        let text = '<img';
        let caret = 0;
        attrs.forEach(([n, v]) => {
            text += ` ${n}="${escapeAttr(v)}`;
            if (n === 'alt') caret = text.length;
            text += '"';
        });
        text += '>';
        if (wrapAttrs.length) {
            const tag = image.wrap ? image.wrap.tag : 'p';
            const open = `<${tag}${wrapAttrs.map(([n, v]) => ` ${n}="${escapeAttr(v)}"`).join('')}>`;
            text = open + text + `</${tag}>`;
            caret += open.length;
        }
        return { text: image.indent + text, caret: image.indent.length + caret, html: true };
    }

    // ========================================================================
    // Lists and quotes being edited: only the lines with the caret show
    // their markers. On the others the markers stay in place, transparent,
    // and live.css draws what the rendered list shows there.
    // ========================================================================

    const LINE_KINDS = new Set(['list', 'quote']);
    const ITEM_HTML = '<span class="t-list">';    // an item's marker, from syntax.js
    const columns = (space) => space.replace(/\t/g, '    ').length;

    function alpha(n) {
        let out = '';
        for (; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(97 + (n - 1) % 26) + out;
        return out || String(n);
    }

    function roman(n) {
        if (n <= 0 || n >= 4000) return String(n);
        let out = '';
        [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
            .forEach(([value, letters]) => {
                for (; n >= value; n -= value) out += letters;
            });
        return out;
    }

    // How each item's marker looks rendered, as preview.css draws it: •, ◦
    // and ▪ by depth; 1. 2. …, then a. b. …, then i. ii. …, counted on from
    // the list's first number; a box for a task. Nesting goes by indent; a
    // quote's own lists start afresh. items[i]: line i is a list item to
    // the highlighter (not, say, a line of code).
    function listMarkers(lines, items) {
        let open = [];    // the lists around the line, outermost first
        let quotes = -1;
        return lines.map((line, i) => {
            const quote = QUOTE_PREFIX.exec(line);
            const depth = quote ? quote[0].split('>').length - 1 : 0;
            if (depth !== quotes) {
                open = [];
                quotes = depth;
            }
            const m = items[i] && LIST_ITEM.exec(quote ? line.slice(quote[0].length) : line);
            if (!m) return null;
            const indent = columns(m[1]);
            const ordered = /\d/.test(m[2]);
            const marker = ordered ? m[2].slice(-1) : m[2];
            while (open.length && indent < open[open.length - 1].indent) open.pop();
            let list = open[open.length - 1];
            if (list && indent >= list.content) {
                list = null;
            } else if (list && (list.ordered !== ordered || list.marker !== marker)) {
                // Another bullet or delimiter starts another list
                open.pop();
                list = null;
            }
            if (!list) {
                list = { indent, ordered, marker, next: ordered ? parseInt(m[2], 10) : 1, depth: open.filter((l) => l.ordered === ordered).length };
                open.push(list);
            }
            list.content = indent + m[2].length + columns(m[3]);
            const n = list.next++;
            if (m[4]) return { m: /x/i.test(m[4]) ? 'done' : 'task' };
            if (!ordered) return { m: ['disc', 'circle', 'square'][Math.min(list.depth, 2)] };
            return { m: 'num', n: (list.depth === 0 ? String(n) : list.depth === 1 ? alpha(n) : roman(n)) + '.' };
        });
    }

    // The lines of text that start..end touches: [first, last]
    function linesTouched(text, start, end) {
        const lineOf = (pos) => {
            let line = 0;
            for (let i = text.indexOf('\n'); i !== -1 && i < pos; i = text.indexOf('\n', i + 1)) line++;
            return line;
        };
        return [lineOf(start), lineOf(end > start ? end - 1 : end)];
    }

    // A block that opens a fence on its first line and never closes it:
    // the fence that would close it (as long as the opening one), else null
    function unclosedFence(source) {
        const lines = source.split('\n');
        const open = FENCE_LINE.exec(lines[0]);
        if (!open) return null;
        const mark = open[1];
        const close = new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},}[ \\t]*$`);
        return lines.slice(1).some((line) => close.test(line)) ? null : mark;
    }

    function isMathBlock(source) {
        const s = source.trim();
        return s.length > 4 && s.startsWith('$$') && s.endsWith('$$') && s.includes('\n') && !s.slice(2, -2).includes('$$');
    }

    function kindOf(token, source) {
        if (!token) return { kind: isMathBlock(source) ? 'math' : 'paragraph' };
        switch (token.type) {
            case 'heading':
                // (its token gives the outline its text)
                return { kind: 'heading', depth: token.depth, token };
            case 'code': {
                if (token.codeBlockStyle === 'indented') return { kind: 'code' };
                const lang = ((token.lang || '').trim().split(/\s+/)[0] || '').toLowerCase();
                return lang === 'math' ? { kind: 'math' } : { kind: 'fence', lang };
            }
            case 'paragraph':
                if (isMathBlock(source)) return { kind: 'math' };
                if (source.trim() === '[TOC]') return { kind: 'toc' };
                if (IMAGE_ONLY.test(source)) return { kind: 'image', htmlImage: false };
                return { kind: 'paragraph' };
            case 'blockquote':
                return { kind: 'quote' };
            case 'list':
                return { kind: 'list', ordered: token.ordered, task: token.items.some((item) => item.task) };
            case 'html':
                if (IMAGE_HTML.test(source)) return { kind: 'image', htmlImage: true };
                return { kind: 'html' };
            case 'table':
            case 'hr':
            case 'def':
                return { kind: token.type };
            default:
                return { kind: 'paragraph' };
        }
    }

    function describe(text, item) {
        const source = text.slice(item.start, item.end);
        return { start: item.start, end: item.end, hash: hash(source), toc: TOC_LINE.test(source), ...kindOf(item.token, source) };
    }

    // Reference definitions ([id]: url) live in their own block, but every
    // block that might use them is rendered with them
    function definitions(links) {
        return Object.keys(links).map((label) => {
            const link = links[label];
            const title = link.title ? ` "${link.title.replace(/"/g, '\\"')}"` : '';
            return `[${label}]: <${link.href}>${title}`;
        }).join('\n');
    }

    // Rough height of a block that hasn't been laid out yet, so the
    // scrollbar doesn't jump much while content-visibility skips it
    function estimateHeight(b, source) {
        const lines = source.split('\n').length;
        if (isHtml(b)) return MDE.htmlFrames.estimate(partsOf(source).content) + 2;
        switch (b.kind) {
            case 'fence':
            case 'code':
                return lines * 24 + 66;
            case 'math':
                return 40 + lines * 12;
            case 'table':
                return lines * 42;
            case 'image':
                return 240;
            case 'heading':
                return 48;
            default:
                return Math.max(lines, Math.ceil(source.length / 46)) * 28;
        }
    }

    // ========================================================================
    // Code and formula editors: the block split into head, content and tail
    // ========================================================================

    function partsOf(source) {
        const fence = FENCE_OPEN.exec(source);
        if (fence) {
            const head = fence[0];
            const body = source.length > head.length ? source.slice(head.length + 1) : '';
            const lastBreak = body.lastIndexOf('\n');
            const lastLine = body.slice(lastBreak + 1);
            const close = FENCE_CLOSE.exec(lastLine);
            const closed = !!close && close[1][0] === fence[2][0] && close[1].length >= fence[2].length;
            return {
                fence: fence[1] + fence[2],
                info: fence[3],
                open: head + '\n',
                content: closed ? (lastBreak === -1 ? '' : body.slice(0, lastBreak)) : body,
                close: closed ? '\n' + lastLine : ''
            };
        }
        // $$ … $$
        const indent = source.match(/^\s*/)[0];
        const tail = source.match(/\s*$/)[0];
        const inner = source.slice(indent.length + 2, source.length - tail.length - 2);
        const lead = inner.startsWith('\n') ? '\n' : '';
        const trail = inner.length > lead.length && inner.endsWith('\n') ? '\n' : '';
        return {
            open: indent + '$$' + lead,
            content: inner.slice(lead.length, inner.length - trail.length),
            close: trail + '$$' + tail
        };
    }

    // highlight.js output split into lines; spans crossing a line break are
    // closed at its end and opened again on the next line
    function splitLines(html) {
        const lines = [];
        const open = [];
        let line = '';
        const re = /<span[^>]*>|<\/span>|\n|[^<\n]+/g;
        let m;
        while ((m = re.exec(html))) {
            const t = m[0];
            if (t === '\n') {
                lines.push(line + '</span>'.repeat(open.length));
                line = open.join('');
            } else if (t === '</span>') {
                open.pop();
                line += t;
            } else {
                if (t.startsWith('<span')) open.push(t);
                line += t;
            }
        }
        lines.push(line);
        return lines;
    }

    // ========================================================================
    // DOM text offsets inside a source editor. The editor only ever holds
    // text nodes (in spans) plus a trailing <br>, so its text is exactly
    // its textContent.
    // ========================================================================

    function offsetIn(root, node, offset) {
        const range = document.createRange();
        range.setStart(root, 0);
        range.setEnd(node, offset);
        return range.toString().length;
    }

    function pointAt(root, offset) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let last = null;
        let node;
        while ((node = walker.nextNode())) {
            if (offset <= node.data.length) return { node, offset };
            offset -= node.data.length;
            last = node;
        }
        return last ? { node: last, offset: last.data.length } : { node: root, offset: 0 };
    }

    function readSelection(root) {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
        const anchor = offsetIn(root, sel.anchorNode, sel.anchorOffset);
        const focus = offsetIn(root, sel.focusNode, sel.focusOffset);
        return { start: Math.min(anchor, focus), end: Math.max(anchor, focus), backward: focus < anchor };
    }

    function writeSelection(root, start, end) {
        const a = pointAt(root, start);
        const b = pointAt(root, end);
        window.getSelection().setBaseAndExtent(a.node, a.offset, b.node, b.offset);
    }

    // Screen box of the caret at a text offset
    function caretRect(root, offset) {
        const p = pointAt(root, offset);
        const range = document.createRange();
        range.setStart(p.node, p.offset);
        range.collapse(true);
        const rect = range.getClientRects()[0];
        if (rect) return rect;
        // A collapsed range at an element boundary has no box: measure a neighbour
        if (p.node.nodeType === Node.TEXT_NODE && p.node.data.length) {
            const after = p.offset < p.node.data.length;
            range.setStart(p.node, after ? p.offset : p.offset - 1);
            range.setEnd(p.node, after ? p.offset + 1 : p.offset);
            const r = range.getClientRects()[0];
            if (r) return { top: r.top, bottom: r.bottom, left: after ? r.left : r.right, height: r.height };
        }
        const box = root.getBoundingClientRect();
        return { top: box.top, bottom: Math.min(box.bottom, box.top + 28), left: box.left, height: Math.min(box.height, 28) };
    }

    function pointFromXY(x, y) {
        if (document.caretPositionFromPoint) {
            const p = document.caretPositionFromPoint(x, y);
            return p && { node: p.offsetNode, offset: p.offset };
        }
        if (document.caretRangeFromPoint) {
            const r = document.caretRangeFromPoint(x, y);
            return r && { node: r.startContainer, offset: r.startOffset };
        }
        return null;
    }

    const historyKind = (type) => (!type ? 'insert'
        : type.startsWith('delete') ? 'delete'
        : type.startsWith('insertFrom') ? 'paste'
        : 'insert');

    // ========================================================================
    // The live view
    // ========================================================================

    // onSlash(query, el) opens or filters the slash menu for the source
    // editor el (query null: close it) and returns false when nothing
    // matches; onSelection tells the selection toolbar to look again;
    // onKey(key) lets them take a key press first (true: taken);
    // toast(message) confirms a copy.
    MDE.createLive = function ({ root, scroller, editor, onCaret, onRender, onSlash, onSelection, onKey, toast }) {
        const cache = new Map();
        const byElement = new WeakMap();
        let blocks = [];
        let text = null;           // the document the blocks were built from
        let defs = '';
        let refs = Object.create(null); // reference definitions: label → { href, title }
        let tocHeadings = [];
        let tocKey = '';
        let active = null;         // the block, or empty line ("gap"), being edited
        let editing = false;       // the caret belongs in the live view
        let visible = false;
        let composing = false;
        let selfEdit = null;       // typing inside the active block: { from, to, length }
        let structural = false;    // rebuild at once, and swap editors if the block changed kind
        let quiet = 0;             // following a change to the document (the caret didn't leave a block by itself)
        let lastChange = null;     // the change update() was told of: { start, end, length } (null: not told)
        let suppressFocus = false;
        let ignoreFocus = false;
        let keyboardCaret = false; // the caret last moved by keyboard (typewriter scrolling)
        let rebuildTimer = 0;
        let selectionFrame = 0;
        let slash = null;          // the slash menu is open for this block element: { el }
        let roomBelow = 0;         // room kept in view under the caret's line (the slash menu on phones)
        let cellDrag = null;       // a press in the table being edited, until the button is let go (see "Selecting cells")
        let cellDragEnded = false; // …and just let go: the click that follows edits no other block
        const settings = { typewriter: false, focusMode: false, htmlPreview: false };

        const bubble = document.createElement('div');
        bubble.className = 'lv-bubble';
        bubble.setAttribute('aria-hidden', 'true');
        bubble.hidden = true;
        scroller.appendChild(bubble);

        const sourceOf = (b) => (b.gap ? '' : text.slice(b.start, b.end));
        // The address of a reference label ([text][label]), if it is defined
        const resolveRef = (label) => {
            const link = refs[label.replace(/\s+/g, ' ').toLowerCase()];
            return link ? link.href : undefined;
        };
        const baseOf = (b) => (b.gap ? b.pos : b.start);
        const isHtmlImage = (b) => b.kind === 'image' && !!b.htmlImage;
        const editorFor = (b) => (b.kind === 'fence' ? 'code' : b.kind === 'math' ? 'math' : b.kind === 'table' ? 'table' : 'source');
        // The text editor of the block (a source block, or a table's open
        // cell) and the document offset its text starts at
        const textEditor = (b) => (b && (b.mode === 'source' || b.mode === 'table') ? b.ui.src : null);
        const textBase = (b) => (b.mode === 'table' ? b.ui.base : baseOf(b));

        // Number of blocks that start before pos
        function countBefore(pos) {
            let lo = 0;
            let hi = blocks.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (blocks[mid].start < pos) lo = mid + 1;
                else hi = mid;
            }
            return lo;
        }

        function blockAt(pos) {
            const k = countBefore(pos + 1) - 1;
            return k >= 0 && pos <= blocks[k].end ? k : -1;
        }

        const indexOf = (b) => (b.gap ? b.index : countBefore(b.start + 1) - 1);

        function labelOf(b) {
            switch (b.kind) {
                case 'gap': return '空段落';
                case 'heading': return HEADING_LABELS[b.depth - 1];
                case 'fence': return isHtml(b) ? 'HTML 块' : `代码块 · ${b.lang || '纯文本'}`;
                case 'code': return '代码块';
                case 'math': return '公式块';
                case 'list': return b.task ? '任务列表' : b.ordered ? '有序列表' : '无序列表';
                case 'quote': return '引用';
                case 'table': {
                    if (b.mode !== 'table' || !b.ui.cell) return '表格';
                    const range = rangeOf(b);
                    return range ? `表格 · 已选 ${range.rows * range.columns} 格` : `表格 · 第 ${b.ui.cell.r + 1} 行第 ${b.ui.cell.c + 1} 列`;
                }
                case 'hr': return '分隔线';
                case 'toc': return '目录';
                case 'image': return '图片';
                case 'html': return 'HTML';
                case 'def': return '链接定义';
                default: return '段落';
            }
        }

        // --- Rendering ------------------------------------------------------

        function rendered(source) {
            const key = hash(source);
            let entry = cache.get(key);
            if (!entry) {
                entry = markdown.render(source, { tasks: true });
                if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
                cache.set(key, entry);
            }
            return entry;
        }

        function entryFor(b) {
            const source = sourceOf(b);
            const full = defs && USES_DEFS.has(b.kind) ? source + '\n\n' + defs : source;
            if (b.toc) return markdown.render(full, { tasks: true, toc: tocHeadings });
            return rendered(full);
        }

        // Focus mode dims the other blocks only while one is being edited.
        // (Toggled sparingly: it restyles every block.)
        function markActive() {
            root.classList.toggle('has-active', !!active);
            const focus = settings.focusMode && active ? 'on' : 'off';
            if (root.dataset.focus !== focus) root.dataset.focus = focus;
        }

        function blockClass(b) {
            let cls = 'lv-block lv-k-' + b.kind;
            if (b.kind === 'heading') cls += ' lv-k-h' + b.depth;
            if (b === active) cls += ' is-active';
            return cls;
        }

        function renderBlock(b) {
            const source = sourceOf(b);
            const entry = entryFor(b);
            const parked = b.parked;
            b.parked = null;
            b.entry = entry;
            b.mode = 'rendered';
            b.ui = null;
            b.el.className = blockClass(b);
            b.el.style.containIntrinsicSize = `auto ${estimateHeight(b, source)}px`;
            if (parked && parked.html === entry.html && parked.frame.parentNode === b.el) {
                // An HTML block whose code came back unchanged: its frame
                // shows again as it was (its scripts didn't run again)
                Array.from(b.el.childNodes).forEach((node) => {
                    if (node !== parked.frame) node.remove();
                });
                parked.frame.classList.remove('is-parked');
            } else {
                // Blocks that render to nothing (link definitions, comments) show their source
                b.el.innerHTML = entry.html.trim() ? entry.html : `<div class="lv-raw">${markdown.escapeHtml(source)}</div>`;
            }
            if (b.ids) applyIds(b);
            // (an HTML block, or one in a list or a quote)
            if (MDE.htmlFrames && entry.html.includes('class="html-block"')) MDE.htmlFrames.attach(b.el, scroller);
        }

        function createBlock(desc) {
            const b = { ...desc, el: document.createElement('div'), ids: null, mode: null, ui: null };
            byElement.set(b.el, b);
            renderBlock(b);
            return b;
        }

        function applyIds(b) {
            b.el.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]').forEach((el, i) => {
                if (b.ids[i] && el.id !== b.ids[i]) el.id = b.ids[i];
            });
        }

        // Blocks render on their own, so heading ids are made unique here,
        // and [TOC] gets the whole document's headings
        function refreshHeadings() {
            const hasToc = blocks.some((b) => b.toc);
            const used = Object.create(null);
            const list = [];
            blocks.forEach((b) => {
                const entry = b.mode === 'rendered' || !hasToc ? b.entry : entryFor(b);
                const ids = [];
                if (entry) {
                    entry.headings.forEach((h) => {
                        const id = markdown.uniqueId(h.baseId, used);
                        ids.push(id);
                        list.push({ level: h.level, id, label: h.label });
                    });
                }
                const changed = !b.ids || ids.length !== b.ids.length || ids.some((id, k) => id !== b.ids[k]);
                b.ids = ids;
                if (changed && b.mode === 'rendered') applyIds(b);
            });
            if (!hasToc) return;
            const key = JSON.stringify(list);
            if (key === tocKey) return;
            tocKey = key;
            tocHeadings = list;
            blocks.forEach((b) => {
                if (b.toc && b.mode === 'rendered') renderBlock(b);
            });
        }

        // --- Rebuilding -----------------------------------------------------

        // Where the source block being edited is in the new text value
        // (text is the one the blocks were made from), blank lines left out
        function editedRange(value) {
            const b = active;
            let a = baseOf(b);
            let z = b.gap ? b.pos : b.end;
            if (text !== value) {
                // The change as made (undo and redo don't say: the smallest one)
                let { start: p, end, length } = lastChange || {};
                if (lastChange === null) {
                    const max = Math.min(text.length, value.length);
                    p = 0;
                    while (p < max && text[p] === value[p]) p++;
                    let s = 0;
                    while (s < max - p && text[text.length - 1 - s] === value[value.length - 1 - s]) s++;
                    end = text.length - s;
                    length = value.length - s - p;
                }
                if (p < a) a = end <= a ? a + length - (end - p) : p;
                if (p <= z) z = end >= z ? p + length : z + length - (end - p);
            }
            while (a < z && value[a] === '\n') a++;
            while (z > a && value[z - 1] === '\n') z--;
            return [a, z];
        }

        // The document's blocks. A fence just typed in the source block
        // being edited has no closing line yet, and everything after it
        // would be code until Enter (or leaving the block) writes one: the
        // text is split as if the block ended with it.
        function splitDocument(value) {
            const result = split(value);
            if (!active || active.mode !== 'source' || text === null) return result;
            const [a, z] = editedRange(value);
            const fence = result.list.find((item) => item.start >= a && item.start < z && item.end > z
                && item.token && item.token.type === 'code' && item.token.codeBlockStyle !== 'indented');
            const open = fence && FENCE_OPEN.exec(value.slice(fence.start, z));
            if (!open) return result;
            const insert = '\n' + open[2];
            const closed = split(value.slice(0, z) + insert + value.slice(z));
            const back = (pos) => (pos <= z ? pos : Math.max(z, pos - insert.length));
            closed.list.forEach((item) => {
                item.start = back(item.start);
                item.end = back(item.end);
            });
            return closed;
        }

        // A fence typed in a source block that is left before it was
        // closed: its closing line goes into the document (an undo step of
        // its own), so what follows doesn't turn into code. Not when the
        // caret moves because the document changed (undo, a command).
        // Returns where it went.
        function closeOpenFence(b) {
            if (quiet || !b || b.gap || b.mode !== 'source' || b.kind !== 'fence' || text !== editor.getValue()) return null;
            const mark = unclosedFence(sourceOf(b));
            if (!mark || !text.slice(b.end).trim()) return null;
            const at = b.end;
            const insert = '\n' + mark;
            const sel = editor.getSelection();
            const map = (pos) => (pos <= at ? pos : pos + insert.length);
            const was = editing;
            editing = false;   // (the caret is about to move anyway)
            editor.replaceRange(at, at, insert, map(sel.start), map(sel.end), 'command');
            editing = was;
            return { at, length: insert.length };
        }

        // Split the document again and update the DOM: unchanged blocks
        // (same hash) keep their element; the element being edited is kept
        // for whichever new block holds the caret, so typing never loses
        // focus or an input method's state.
        function rebuild() {
            clearTimeout(rebuildTimer);
            rebuildTimer = 0;
            const value = editor.getValue();
            const { list, links } = splitDocument(value);
            text = value;
            const nextDefs = definitions(links);
            const defsChanged = nextDefs !== defs;
            defs = nextDefs;
            refs = links;
            const next = list.map((item) => describe(value, item));

            const old = blocks.slice();
            if (active && active.gap) old.splice(active.index, 0, active);

            let i = 0;
            while (i < old.length && i < next.length && old[i] !== active && old[i].hash === next[i].hash) i++;
            let oldEnd = old.length;
            let newEnd = next.length;
            while (oldEnd > i && newEnd > i && old[oldEnd - 1] !== active && old[oldEnd - 1].hash === next[newEnd - 1].hash) {
                oldEnd--;
                newEnd--;
            }
            const moved = (b, d) => {
                b.start = d.start;
                b.end = d.end;
            };
            for (let k = 0; k < i; k++) moved(old[k], next[k]);
            for (let k = 0; k < old.length - oldEnd; k++) moved(old[oldEnd + k], next[newEnd + k]);

            const removed = old.slice(i, oldEnd);
            const added = next.slice(i, newEnd);
            const sel = editor.getSelection();
            const keep = active && removed.includes(active) ? active : null;
            const host = keep ? added.findIndex((d) => d.start <= sel.start && sel.start <= d.end) : -1;
            const before = host !== -1 ? host : added.filter((d) => d.end < sel.start).length;
            const ref = oldEnd < old.length ? old[oldEnd].el : null;

            // A block that only moved (dragged elsewhere, cut and pasted)
            // keeps its element, so an HTML block's frame isn't loaded again
            const reused = new Map();      // index in added → old block
            if (CAN_MOVE && removed.length > 1) {
                const pool = new Map();
                removed.forEach((b) => {
                    if (b === keep || b.gap) return;
                    if (!pool.has(b.hash)) pool.set(b.hash, []);
                    pool.get(b.hash).push(b);
                });
                added.forEach((d, k) => {
                    const list = k !== host && pool.get(d.hash);
                    const at = list ? list.findIndex((b) => b.kind === d.kind) : -1;
                    if (at !== -1) reused.set(k, list.splice(at, 1)[0]);
                });
            }
            const stays = new Set(reused.values());

            removed.forEach((b) => {
                if (b !== keep && !stays.has(b)) b.el.remove();
            });
            if (active && !keep && removed.includes(active)) active = null;

            const created = added.map((d, k) => {
                if (reused.has(k)) return Object.assign(reused.get(k), d);
                if (k !== host) return createBlock(d);
                // The edited element now shows this block
                keep.gap = false;
                Object.assign(keep, d);
                return keep;
            });
            // In place, from the last: the elements before the edited one go
            // in front of it, the others in front of the blocks that follow
            let follower = ref;
            for (let k = created.length - 1; k >= 0; k--) {
                const b = created[k];
                if (keep && host === -1 && k === before - 1) follower = keep.el;
                if (b === keep) {
                    follower = keep.el;
                    continue;
                }
                if (b.el.nextSibling !== follower || b.el.parentNode !== root) {
                    if (stays.has(b)) root.moveBefore(b.el, follower);
                    else root.insertBefore(b.el, follower);
                }
                follower = b.el;
            }

            if (keep && host === -1) {
                if (keep.mode === 'source') {
                    // Its text is gone (all of it deleted): it stays as an empty line
                    Object.assign(keep, { gap: true, kind: 'gap', pos: sel.start, index: i + before });
                    refreshEditor(keep);
                } else {
                    keep.el.remove();
                    active = null;
                }
            }

            blocks = old.slice(0, i).concat(created.filter((b) => !b.gap), old.slice(oldEnd));
            if (active && active.gap) active.index = countBefore(active.pos);

            if (defsChanged) {
                blocks.forEach((b) => {
                    if (b.mode === 'rendered' && USES_DEFS.has(b.kind)) renderBlock(b);
                });
            }
            if (keep && active === keep && !keep.gap) refreshEditor(keep);
            refreshHeadings();
            root.classList.toggle('is-empty', !blocks.length);
            markActive();
            if (onRender) onRender();
        }

        function scheduleRebuild() {
            clearTimeout(rebuildTimer);
            rebuildTimer = setTimeout(() => {
                rebuildTimer = 0;
                if (!visible) return;
                if (composing) {
                    scheduleRebuild();
                    return;
                }
                settle();
            }, REBUILD_DELAY);
        }

        // Bring a pending rebuild forward (before moving between blocks)
        function flush() {
            if (!rebuildTimer || composing) return;
            settle();
        }

        function settle() {
            quiet++;
            try {
                captureSelection();
                rebuild();
                if (editing) placeCaret();
            } finally {
                quiet--;
            }
        }

        // Typing inside the active block: shift the offsets now, look at the
        // block on its own (so "# " turns it into a heading at once) and
        // leave the rest of the document to the next rebuild
        function fastPath(edit, value) {
            const b = active;
            if (edit.from < b.start || edit.to > b.end) return false;
            const delta = edit.length - (edit.to - edit.from);
            const index = indexOf(b);
            text = value;
            b.end += delta;
            for (let k = index + 1; k < blocks.length; k++) {
                blocks[k].start += delta;
                blocks[k].end += delta;
            }
            const source = sourceOf(b);
            b.hash = hash(source);
            if (b.mode === 'source') {
                const { list } = split(source);
                if (list.length !== 1) return false;
                Object.assign(b, kindOf(list[0].token, source), { toc: TOC_LINE.test(source) });
                b.el.className = blockClass(b);
                b.ui.typing = true;
                refreshEditor(b);
            } else if (b.mode === 'table') {
                refreshTable(b);
            }
            scheduleRebuild();
            return true;
        }

        // Called after every change to the document (change: what it
        // replaced, when the editor says)
        function update(change = null) {
            if (!visible) return;
            const value = editor.getValue();
            const edit = selfEdit;
            selfEdit = null;
            quiet++;
            lastChange = change;
            try {
                if (value !== text && !(edit && !structural && active && !active.gap && fastPath(edit, value))) {
                    // (not typing: the images under an image's source follow at once)
                    if (active && active.mode === 'source') active.ui.typing = false;
                    rebuild();
                }
                structural = false;
                if (editing) placeCaret();
                // Undo, a command: the "/" line may be gone
                updateSlash(false);
            } finally {
                quiet--;
                lastChange = null;
            }
        }

        // --- Editors --------------------------------------------------------

        function sourceClass(b) {
            let cls = 'lv-src';
            if (b.kind === 'heading') cls += ' lv-heading lv-h' + b.depth;
            else if (b.kind === 'quote') cls += ' lv-quote';
            else if (b.kind === 'table') cls += ' lv-mono lv-table';
            else if (MONO_KINDS.has(b.kind) || isHtmlImage(b)) cls += ' lv-mono';
            if (!sourceOf(b)) cls += ' is-empty';
            return cls;
        }

        // The lines of the block being edited that the caret or the
        // selection is on (the document's selection: [first, last]), or null
        function caretLines(b, value) {
            const sel = editor.getSelection();
            if (sel.end < b.start || sel.start > b.end) return null;
            return linesTouched(value, clamp(sel.start - b.start, 0, value.length), clamp(sel.end - b.start, 0, value.length));
        }

        // A list or a quote: every line in a span (is-caret on those with
        // the caret), and every item's marker with how it looks rendered
        function lineSpans(b, value, lines) {
            const markers = listMarkers(value.split('\n'), lines.map((html) => html.includes(ITEM_HTML)));
            const [first, last] = caretLines(b, value) || [-1, -2];
            return lines.map((html, i) => {
                const marker = markers[i];
                if (marker) html = html.replace(ITEM_HTML, `<span class="t-list" data-m="${marker.m}"${marker.n ? ` data-n="${marker.n}"` : ''}>`);
                return `<span class="lv-line${i >= first && i <= last ? ' is-caret' : ''}">${html}</span>`;
            });
        }

        // The caret or the selection moved: its lines show their markers
        function markCaretLines() {
            const b = active;
            if (!visible || !b || b.gap || b.mode !== 'source' || !LINE_KINDS.has(b.kind) || composing) return;
            const src = b.ui.src;
            const sel = document.activeElement === src ? readSelection(src) : null;
            const value = src.textContent;
            const [first, last] = sel ? linesTouched(value, sel.start, sel.end) : caretLines(b, value) || [-1, -2];
            let i = 0;
            for (const line of src.children) {
                if (!line.classList.contains('lv-line')) continue;
                line.classList.toggle('is-caret', i >= first && i <= last);
                i++;
            }
        }

        function sourceHtml(b) {
            const value = sourceOf(b);
            let lines = MDE.syntax.highlight(value);
            if (LINE_KINDS.has(b.kind)) lines = lineSpans(b, value, lines);
            let html = lines.join('\n') + (!value || value.endsWith('\n') ? '<br>' : '');
            // While the slash menu is open, its "/" is a marker
            if (slash && slash.el === b.el && SLASH_KEYS.has(value[0]) && html[0] === value[0]) {
                html = `<span class="t-mark">${value[0]}</span>` + html.slice(1);
            }
            return html;
        }

        function mountSource(b) {
            const media = b.kind === 'image' ? Array.from(b.el.querySelectorAll('img')) : [];
            const src = document.createElement('div');
            src.className = sourceClass(b);
            src.contentEditable = EDITABLE;
            src.spellcheck = false;
            src.setAttribute('autocapitalize', 'off');
            src.setAttribute('autocorrect', 'off');
            src.setAttribute('role', 'textbox');
            src.setAttribute('aria-multiline', 'true');
            src.setAttribute('aria-label', `${labelOf(b)}（Markdown 源码）`);
            src.dataset.placeholder = PLACEHOLDER;
            src.innerHTML = sourceHtml(b);
            b.el.className = blockClass(b);
            b.el.style.containIntrinsicSize = '';
            b.el.replaceChildren(src);
            b.mode = 'source';
            b.ui = { src, mountedKind: b.kind, media: null, wraps: [], images: [], selected: -1, mediaTimer: 0, typing: false };
            // An image keeps showing (without reloading) under its source line
            if (b.kind === 'image') syncMedia(b, media);
        }

        // --- Images under the source of an image block ------------------------
        // Each image of the source in a span.lv-img (as wide as the image
        // shows), under the source line. The one the caret is on is
        // selected: a ring, corner handles to drag its width, and room
        // above it for the image toolbar (live-tools.js).

        const imageHandles = () => {
            const frag = document.createDocumentFragment();
            ['nw', 'ne', 'sw', 'se'].forEach((corner) => {
                const handle = document.createElement('span');
                handle.className = 'lv-img-handle';
                handle.dataset.corner = corner;
                frag.appendChild(handle);
            });
            const size = document.createElement('span');
            size.className = 'lv-img-size';
            frag.appendChild(size);
            return Array.from(frag.childNodes);
        };

        // Show the images the source has now; an image whose address didn't
        // change keeps its element (it doesn't load again). pool: the images
        // of the rendered block, when editing starts.
        function syncMedia(b, pool = []) {
            const ui = b.ui;
            clearTimeout(ui.mediaTimer);
            ui.mediaTimer = 0;
            ui.images = b.kind === 'image' ? imagesOf(sourceOf(b), b.htmlImage) : [];
            if (!ui.images.length) {
                if (ui.media) ui.media.remove();
                ui.media = null;
                ui.wraps = [];
                ui.selected = -1;
                return;
            }
            if (!ui.media) {
                ui.media = document.createElement('div');
                ui.media.className = 'lv-media';
                ui.media.contentEditable = 'false';
                b.el.appendChild(ui.media);
            }
            const old = pool.concat(ui.wraps.filter(Boolean).map((wrap) => wrap.querySelector('img')));
            const tpl = document.createElement('template');
            ui.wraps = ui.images.map((image, i) => {
                // As the image renders on its own (an address that isn't
                // allowed shows no image)
                tpl.innerHTML = rendered(image.html ? image.source : image.source.trim()).html;
                const fresh = tpl.content.querySelector('img');
                if (!fresh) return null;
                const k = old.findIndex((img) => img && img.getAttribute('src') === fresh.getAttribute('src'));
                let img = fresh;
                if (k !== -1) {
                    img = old[k];
                    old[k] = null;
                    Array.from(img.attributes).forEach((a) => {
                        if (!fresh.hasAttribute(a.name)) img.removeAttribute(a.name);
                    });
                    Array.from(fresh.attributes).forEach((a) => {
                        if (img.getAttribute(a.name) !== a.value) img.setAttribute(a.name, a.value);
                    });
                }
                const wrap = ui.wraps[i] || document.createElement('span');
                wrap.className = 'lv-img';
                wrap.dataset.align = image.align;
                const width = img.getAttribute('width') || '';
                const pct = /^\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(width);
                const px = parseFloat(width);
                wrap.style.width = pct ? pct[1] + '%' : px > 0 ? px + 'px' : '';
                wrap.classList.toggle('has-width', !!wrap.style.width);
                wrap.querySelectorAll('img').forEach((el) => {
                    if (el !== img) el.remove();
                });
                if (wrap.firstChild !== img) wrap.prepend(img);
                return wrap;
            });
            ui.media.replaceChildren(...ui.wraps.filter(Boolean));
            ui.selected = -1;
            markImage();
        }

        // While typing, the images follow once typing pauses (no loading
        // every half-typed address)
        function queueMedia(b) {
            clearTimeout(b.ui.mediaTimer);
            b.ui.mediaTimer = setTimeout(() => {
                if (active === b && b.mode === 'source') syncMedia(b);
            }, MEDIA_DELAY);
        }

        // The image of an image block that holds offset `at` of its source
        function imageAt(images, at) {
            let k = 0;
            while (k + 1 < images.length && images[k + 1].from <= at) k++;
            return k;
        }

        // The caret moved: the image it is on is the selected one
        function markImage() {
            const b = active;
            if (!b || b.gap || b.mode !== 'source' || !b.ui.media) return;
            const ui = b.ui;
            const sel = document.activeElement === ui.src ? readSelection(ui.src) : null;
            const at = sel ? sel.start : clamp(editor.getSelection().start - b.start, 0, b.end - b.start);
            const k = imageAt(ui.images, at);
            if (k === ui.selected) return;
            ui.selected = k;
            ui.wraps.forEach((wrap, i) => {
                if (wrap) wrap.classList.toggle('is-selected', i === k);
            });
            if (!ui.handles) ui.handles = imageHandles();
            if (ui.wraps[k]) ui.wraps[k].append(...ui.handles);
            else ui.handles.forEach((el) => el.remove());
        }

        // The selected image of the block being edited, or null
        function selectedImage() {
            const b = active;
            if (!b || b.gap || b.kind !== 'image' || b.mode !== 'source' || !b.ui.media) return null;
            const k = b.ui.selected;
            const image = b.ui.images[k];
            const wrap = b.ui.wraps[k];
            return image && wrap ? { b, k, image, wrap, img: wrap.querySelector('img') } : null;
        }

        // Click on an image of an image block: edit the block with the caret
        // at the end of that image's description; the image stays where it
        // is on screen (so a corner handle can be grabbed at once)
        function selectImageAt(b, img) {
            const top = img.getBoundingClientRect().top;
            if (b !== active) switchTo(b);
            editing = true;
            const ui = b.ui;
            if (b.mode !== 'source' || !ui.media) return;
            const k = Math.max(0, ui.wraps.findIndex((wrap) => wrap && wrap.contains(img)));
            const at = b.start + ui.images[k].altEnd;
            editor.select(at, at);
            applySelection();
            if (img.isConnected) scroller.scrollTop += img.getBoundingClientRect().top - top;
        }

        // The image toolbar: align the selected image, set its width (a
        // percentage of the text's width; 100 on an image at least that
        // wide is no width at all), give it another address and
        // description, or delete it
        function imageCommand(name, value) {
            const sel = selectedImage();
            if (!sel) return;
            const { b, k, image } = sel;
            const images = b.ui.images;
            if (name === 'delete') {
                deleteImage(b, images, k);
                return;
            }
            const next = { ...image };
            if (ALIGNS.has(name)) next.align = name;
            else if (name === 'width') next.width = widthFor(sel, value);
            else if (name === 'replace') Object.assign(next, { src: value.src, alt: value.alt });
            if (next.align === image.align && next.width === image.width && next.src === image.src && next.alt === image.alt) return;
            const written = writeImage(next);
            let from = image.from;
            let to = image.to;
            let insert = written.text;
            let caret = written.caret;
            if (written.html) {
                // HTML runs on to the next blank line: one of several images
                // gets a block of its own, and a blank line follows it
                if (k > 0) {
                    from--;
                    insert = '\n\n' + insert;
                    caret += 2;
                }
                if (k < images.length - 1) {
                    to++;
                    insert += '\n\n';
                } else if (/^\n[ \t]*[^\s]/.test(text.slice(b.start + to))) {
                    insert += '\n';
                }
            }
            const at = b.start + from + caret;
            editing = true;
            structural = true;
            editor.replaceRange(b.start + from, b.start + to, insert, at, at, 'command');
        }

        function widthFor(sel, percent) {
            if (percent < 100) return percent + '%';
            const natural = sel.img ? sel.img.naturalWidth : 0;
            return !natural || natural >= sel.b.ui.media.clientWidth ? null : '100%';
        }

        // One of several images: its line goes, and the caret to the end of
        // the description of the image now in its place (else the one before)
        function deleteImage(b, images, k) {
            if (images.length === 1) {
                removeBlock(b);
                return;
            }
            const image = images[k];
            const from = k > 0 ? image.from - 1 : image.from;
            const to = k > 0 ? image.to : image.to + 1;
            const next = images[k + 1];
            const at = b.start + (next ? next.altEnd - (to - from) : images[k - 1].altEnd);
            editing = true;
            structural = true;
            editor.replaceRange(b.start + from, b.start + to, '', at, at, 'command');
        }

        function mountCode(b) {
            b.el.className = blockClass(b);
            b.el.style.containIntrinsicSize = '';
            const html = '<div class="code-block lv-code">'
                + '<div class="code-block-head">'
                + '<button type="button" class="lv-lang" aria-haspopup="listbox" aria-expanded="false" aria-controls="langList"><span class="lv-lang-name"></span>'
                + '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>'
                + `<button type="button" class="lv-safe" aria-label="安全渲染：在沙箱 iframe 中运行，只允许脚本，读不到编辑器页面和本地存储">${ICON_SAFE}安全渲染<span class="lv-safe-more"> · 沙箱 · 仅允许脚本</span></button>`
                + `<button type="button" class="code-copy" aria-label="复制代码">${markdown.ICON_COPY}<span>复制</span></button>`
                + '<button type="button" class="lv-html-toggle" aria-pressed="false" aria-label="编辑时预览渲染结果">预览</button>'
                + '</div>'
                + '<div class="code-block-body"><div class="line-numbers" aria-hidden="true"></div>'
                + '<div class="lv-code-area"><pre class="lv-code-view" aria-hidden="true"><code></code></pre>'
                + '<textarea class="lv-code-input" wrap="off" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="代码"></textarea>'
                + '</div></div></div>';
            // An HTML block's frame stays in the page, hidden, after the code
            // (removing an iframe unloads it)
            const parked = b.parked && b.parked.frame;
            if (parked && parked.parentNode === b.el) {
                Array.from(b.el.childNodes).forEach((node) => {
                    if (node !== parked) node.remove();
                });
                parked.insertAdjacentHTML('beforebegin', html);
            } else {
                b.parked = null;
                b.el.innerHTML = html;
            }
            const block = b.el.querySelector('.lv-code');
            const ui = {
                parts: partsOf(sourceOf(b)),
                block,
                lang: block.querySelector('.lv-lang'),
                toggle: block.querySelector('.lv-html-toggle'),
                preview: null,     // the HTML block's frame under the code, when 预览 is on
                previewTimer: 0,
                input: block.querySelector('.lv-code-input'),
                view: block.querySelector('.lv-code-view code'),
                numbers: block.querySelector('.line-numbers'),
                lines: [],
                text: '',
                count: 0,
                timer: 0
            };
            // The pill only explains; neither button takes focus from the code on a click
            block.querySelector('.lv-safe').addEventListener('mousedown', (e) => e.preventDefault());
            ui.toggle.addEventListener('mousedown', (e) => e.preventDefault());
            ui.toggle.addEventListener('click', () => {
                settings.htmlPreview = !settings.htmlPreview;
                showHtmlPreview(ui);
            });
            ui.input.value = ui.parts.content;
            showLanguage(ui);
            ui.lineHeight = parseFloat(getComputedStyle(ui.input).lineHeight) || 24;
            b.mode = 'code';
            b.ui = ui;
            paintCode(ui);
        }

        function mountMath(b) {
            b.el.className = blockClass(b);
            b.el.style.containIntrinsicSize = '';
            b.el.innerHTML = '<div class="lv-math">'
                + '<div class="lv-math-head"><span class="lv-math-lang">LaTeX</span><span>公式块</span></div>'
                + '<textarea class="lv-math-input" rows="1" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="LaTeX 公式"></textarea>'
                + '<div class="lv-math-preview"><span class="lv-math-tag">预览</span><div class="lv-math-out"></div></div>'
                + '</div>';
            const ui = {
                parts: partsOf(sourceOf(b)),
                input: b.el.querySelector('.lv-math-input'),
                out: b.el.querySelector('.lv-math-out'),
                timer: 0
            };
            ui.input.value = ui.parts.content;
            ui.lineHeight = parseFloat(getComputedStyle(ui.input).lineHeight) || 24;
            b.mode = 'math';
            b.ui = ui;
            paintMath(ui);
            sizeMath(ui);
        }

        function mount(b) {
            const type = b.gap ? 'source' : editorFor(b);
            // An HTML block's frame waits, hidden, while its code is edited:
            // the code back as it was, it shows again (see renderBlock)
            const frame = type === 'code' && b.mode === 'rendered' && isHtml(b) && b.el.querySelector(':scope > .html-block');
            b.parked = frame ? { frame, html: b.entry.html } : null;
            if (frame) frame.classList.add('is-parked');
            if (type === 'code') mountCode(b);
            else if (type === 'math') mountMath(b);
            else if (type === 'table') mountTable(b);
            else mountSource(b);
        }

        // The model changed under the open editor (typing, undo, a command)
        function refreshEditor(b) {
            // (a fence not closed yet stays in the source until it is)
            const open = b.mode === 'source' && b.kind === 'fence' && unclosedFence(sourceOf(b));
            if (!b.gap && editorFor(b) !== b.mode && (structural || b.mode !== 'source') && !composing && !open) {
                mount(b);
                return;
            }
            b.el.className = blockClass(b);
            if (b.mode === 'source') {
                const src = b.ui.src;
                src.className = sourceClass(b);
                if (composing) return;
                const html = sourceHtml(b);
                if (src.innerHTML !== html) src.innerHTML = html;
                if (b.kind === 'image' || b.ui.media) {
                    if (!b.ui.typing) {
                        syncMedia(b);
                    } else {
                        // (where the images are in the source is known at once)
                        b.ui.images = b.kind === 'image' ? imagesOf(sourceOf(b), b.htmlImage) : [];
                        queueMedia(b);
                    }
                }
                return;
            }
            if (b.mode === 'table') {
                refreshTable(b);
                return;
            }
            const parts = partsOf(sourceOf(b));
            b.ui.parts = parts;
            if (b.ui.input.value !== parts.content) {
                b.ui.input.value = parts.content;
                if (b.mode === 'code') {
                    paintCode(b.ui);
                    queueHtmlPreview(b.ui);
                } else {
                    paintMath(b.ui);
                }
            }
            if (b.mode === 'code') showLanguage(b.ui);
            if (b.mode === 'math') sizeMath(b.ui);
        }

        // --- Code editor ----------------------------------------------------

        const infoWord = (ui) => ui.parts.info.trim().split(/\s+/)[0] || '';
        const codeLanguage = (ui) => infoWord(ui).toLowerCase();

        // The language chip at the top left (live-tools.js opens its menu).
        // An HTML block shows 安全渲染 and 预览 instead of 复制.
        function showLanguage(ui) {
            const lang = infoWord(ui);
            if (ui.lang.dataset.lang === lang) return;
            ui.lang.dataset.lang = lang;
            ui.lang.firstChild.textContent = lang || '纯文本';
            ui.lang.setAttribute('aria-label', `代码语言：${lang || '纯文本'}`);
            ui.html = codeLanguage(ui) === 'html' && !!MDE.htmlFrames;
            ui.block.classList.toggle('is-html', ui.html);
            ui.input.setAttribute('aria-label', ui.html ? 'HTML 代码' : '代码');
            showHtmlPreview(ui);
        }

        // 预览 (on for every HTML block until the page is reloaded): the
        // rendered frame under the code, run again once typing pauses
        function showHtmlPreview(ui) {
            const on = ui.html && settings.htmlPreview;
            ui.toggle.setAttribute('aria-pressed', String(on));
            if (on && !ui.preview) {
                const box = document.createElement('div');
                box.className = 'lv-html-preview';
                box.innerHTML = '<span class="lv-math-tag">预览</span>' + MDE.htmlFrames.markup(ui.input.value);
                ui.block.appendChild(box);
                ui.preview = box.querySelector('.html-block');
                MDE.htmlFrames.attach(ui.preview, scroller);
            } else if (!on && ui.preview) {
                clearTimeout(ui.previewTimer);
                ui.preview.parentNode.remove();
                ui.preview = null;
            }
        }

        function queueHtmlPreview(ui) {
            if (!ui.preview) return;
            clearTimeout(ui.previewTimer);
            ui.previewTimer = setTimeout(() => {
                if (ui.preview) MDE.htmlFrames.update(ui.preview, ui.input.value);
            }, HTML_PREVIEW_DELAY);
        }

        // Another language for the code block being edited: the first word
        // of its info string (anything after it stays; none for plain
        // text). The caret goes back into the code.
        function setCodeLanguage(lang) {
            const b = active;
            if (!b || b.mode !== 'code') return;
            const ui = b.ui;
            const rest = ui.parts.info.trim().replace(/^\S*\s*/, '');
            const info = lang && rest ? `${lang} ${rest}` : lang;
            if (info !== ui.parts.info.trim()) {
                ui.parts.info = info;
                ui.parts.open = ui.parts.fence + info + '\n';
                showLanguage(ui);
                commitParts(b, 'command');
                paintCode(ui);
            }
            editing = true;
            ui.input.focus({ preventScroll: true });
        }

        // Line numbers, and a textarea exactly as tall as its lines (plus a
        // horizontal scrollbar when a line is too long)
        function setLineNumbers(ui, count) {
            if (ui.count !== count) {
                ui.count = count;
                ui.numbers.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
            }
            ui.input.style.height = (count * ui.lineHeight + ui.input.offsetHeight - ui.input.clientHeight) + 'px';
        }

        function paintCode(ui) {
            clearTimeout(ui.timer);
            ui.timer = 0;
            ui.text = ui.input.value;
            ui.lines = splitLines(markdown.highlightCode(ui.text, codeLanguage(ui), false).html);
            ui.view.innerHTML = ui.lines.join('\n') + '\n';
            setLineNumbers(ui, ui.lines.length);
        }

        // While typing only the edited lines lose their colours; the whole
        // block is highlighted again once typing pauses
        function paintCodeQuickly(ui) {
            const next = ui.input.value.split('\n');
            const prev = ui.text.split('\n');
            let a = 0;
            while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
            let z = 0;
            while (z < prev.length - a && z < next.length - a && prev[prev.length - 1 - z] === next[next.length - 1 - z]) z++;
            ui.lines = ui.lines.slice(0, a)
                .concat(next.slice(a, next.length - z).map(markdown.escapeHtml), ui.lines.slice(ui.lines.length - z));
            ui.text = ui.input.value;
            ui.view.innerHTML = ui.lines.join('\n') + '\n';
            setLineNumbers(ui, ui.lines.length);
            clearTimeout(ui.timer);
            ui.timer = setTimeout(() => paintCode(ui), CODE_HIGHLIGHT_DELAY);
        }

        function codeOffsetAt(ui, x, y) {
            const box = ui.input.getBoundingClientRect();
            const style = getComputedStyle(ui.input);
            const lines = ui.input.value.split('\n');
            const line = clamp(Math.floor((y - box.top) / ui.lineHeight), 0, lines.length - 1);
            const context = document.createElement('canvas').getContext('2d');
            context.font = `${style.fontSize} ${style.fontFamily}`;
            const width = context.measureText('0').width || 8;
            const col = clamp(Math.round((x - box.left + ui.input.scrollLeft) / width), 0, lines[line].length);
            return lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + col;
        }

        // --- Formula editor -------------------------------------------------

        function paintMath(ui) {
            clearTimeout(ui.timer);
            ui.timer = 0;
            const tex = ui.input.value;
            ui.out.innerHTML = tex.trim() ? markdown.renderMath(tex, true) : '<span class="lv-math-empty">空公式</span>';
        }

        function sizeMath(ui) {
            ui.input.style.height = '0px';
            ui.input.style.height = ui.input.scrollHeight + 'px';
        }

        // --- Table editor ---------------------------------------------------
        // The table stays rendered. The cell with the caret (ui.cell, its
        // row and column) shows its Markdown source in ui.src, whose text
        // starts at document offset ui.base; the other cells keep their
        // rendered HTML.

        const cellHtml = (value) => MDE.syntax.inline(value) + (value ? '' : '<br>');

        function mountTable(b) {
            b.el.className = blockClass(b);
            b.el.style.containIntrinsicSize = '';
            b.el.innerHTML = entryFor(b).html;
            b.mode = 'table';
            b.ui = {
                table: b.el.querySelector('table'),
                parsed: MDE.table.parse(sourceOf(b)),
                cell: null,
                td: null,
                src: null,
                base: 0,
                text: '',
                rendered: null,
                renderedHash: null,
                range: null
            };
        }

        // A cell as rendered from the table's current source
        function renderedCell(b, r, c) {
            const ui = b.ui;
            if (ui.renderedHash !== b.hash) {
                const tpl = document.createElement('template');
                tpl.innerHTML = entryFor(b).html;
                ui.rendered = tpl.content.querySelector('table');
                ui.renderedHash = b.hash;
            }
            const row = ui.rendered && ui.rendered.rows[r];
            return row && row.cells[c] ? row.cells[c].innerHTML : '';
        }

        const tdAt = (b, r, c) => {
            const row = b.ui.table && b.ui.table.rows[r];
            return (row && row.cells[c]) || null;
        };

        function closeCell(b) {
            const ui = b.ui;
            if (!ui.cell) return;
            ui.td.classList.remove('is-current');
            ui.td.innerHTML = renderedCell(b, ui.cell.r, ui.cell.c);
            ui.cell = ui.td = ui.src = null;
        }

        // Show the source of a cell that exists in the source (see goToCell)
        function openCell(b, r, c) {
            const ui = b.ui;
            if (ui.cell && ui.cell.r === r && ui.cell.c === c) return;
            const cell = ui.parsed.rows[r].cells[c];
            const td = tdAt(b, r, c);
            if (!cell || !td) return;
            closeCell(b);
            const src = document.createElement('div');
            src.className = 'lv-src lv-cell';
            src.contentEditable = EDITABLE;
            src.spellcheck = false;
            src.setAttribute('autocapitalize', 'off');
            src.setAttribute('autocorrect', 'off');
            src.setAttribute('role', 'textbox');
            src.setAttribute('aria-label', `表格第 ${r + 1} 行第 ${c + 1} 列（Markdown 源码）`);
            src.innerHTML = cellHtml(cell.text);
            td.replaceChildren(src);
            td.classList.add('is-current');
            Object.assign(ui, { cell: { r, c }, td, src, base: b.start + cell.from, text: cell.text });
        }

        // The cell holding a document offset (a pipe or the delimiter line
        // counts with the cell before it)
        function cellAt(b, pos) {
            const { rows, delimiter, cols } = b.ui.parsed;
            const rel = pos - b.start;
            let r = rows.findIndex((row) => rel <= row.to);
            if (r === -1) r = rows.length - 1;
            if (delimiter && rel >= delimiter.from && rel <= delimiter.to) r = 0;
            const cells = rows[r].cells;
            let c = 0;
            while (c + 1 < Math.min(cells.length, cols) && cells[c + 1].from <= rel) c++;
            return { r, c };
        }

        // Put the caret in a cell: where = 'start', 'end' or 'all' (its
        // text selected); with x, at that column of its first ('start') or
        // last ('end') line
        function goToCell(b, r, c, where, x) {
            const row = b.ui.parsed.rows[r];
            const cell = row.cells[c];
            editing = true;
            if (!cell) {
                // A row with fewer cells than the header: fill it up first
                const line = text.slice(b.start + row.from, b.start + row.to);
                const padded = MDE.table.padRow(line, b.ui.parsed.cols);
                const at = b.start + row.from + MDE.table.parse(padded).rows[0].cells[c].from;
                structural = true;
                editor.replaceRange(b.start + row.from, b.start + row.to, padded, at, at, null);
                return;
            }
            const from = b.start + cell.from;
            const to = b.start + cell.to;
            let [start, end] = where === 'all' ? [from, to] : where === 'end' ? [to, to] : [from, from];
            if (x !== undefined && cell.text) {
                openCell(b, r, c);
                const src = b.ui.src;
                const line = caretRect(src, where === 'end' ? cell.text.length : 0);
                const hit = pointFromXY(x, (line.top + line.bottom) / 2);
                if (hit && src.contains(hit.node)) start = end = from + offsetIn(src, hit.node, hit.offset);
            }
            editor.select(start, end);
            applySelection();
        }

        // A click on a cell of the table being edited
        function clickCell(b, td, x, y) {
            const r = td.parentElement.rowIndex;
            const c = td.cellIndex;
            if (!b.ui.parsed.rows[r] || c >= b.ui.parsed.cols) return;
            if (!b.ui.parsed.rows[r].cells[c]) {
                goToCell(b, r, c, 'start');
                return;
            }
            editing = true;
            openCell(b, r, c);
            const offset = offsetAtPoint(b.ui.src, x, y);
            editor.select(b.ui.base + offset, b.ui.base + offset);
            applySelection();
        }

        // The document changed under the table (typing, undo, a command)
        function refreshTable(b) {
            const ui = b.ui;
            const old = ui.parsed;
            const parsed = MDE.table.parse(sourceOf(b));
            ui.parsed = parsed;
            const width = (p, row) => Math.min(row.cells.length, p.cols);
            const same = parsed.cols === old.cols
                && parsed.rows.length === old.rows.length
                && parsed.align.every((a, k) => a === old.align[k])
                && parsed.rows.every((row, k) => width(parsed, row) === width(old, old.rows[k]));
            if (!same) {
                // Rows, columns or alignment changed: the caret's cell opens
                // again when the selection is applied
                if (!composing) mountTable(b);
                return;
            }
            parsed.rows.forEach((row, r) => {
                row.cells.slice(0, parsed.cols).forEach((cell, c) => {
                    const isOpen = ui.cell && ui.cell.r === r && ui.cell.c === c;
                    const td = tdAt(b, r, c);
                    if (!isOpen && td && cell.text !== old.rows[r].cells[c].text) td.innerHTML = renderedCell(b, r, c);
                });
            });
            if (!ui.cell) return;
            const cell = parsed.rows[ui.cell.r].cells[ui.cell.c];
            ui.base = b.start + cell.from;
            ui.text = cell.text;
            if (composing) return;
            const html = cellHtml(cell.text);
            if (ui.src.innerHTML !== html) ui.src.innerHTML = html;
        }

        // highlight.js or KaTeX arrived: the rendered cells again
        function repaintCells(b) {
            const ui = b.ui;
            ui.renderedHash = null;
            ui.parsed.rows.forEach((row, r) => {
                for (let c = 0; c < ui.parsed.cols; c++) {
                    const td = tdAt(b, r, c);
                    if (td && !(ui.cell && ui.cell.r === r && ui.cell.c === c)) td.innerHTML = renderedCell(b, r, c);
                }
            });
        }

        // Replace the whole table (one undo step) and put the caret at `at`
        function replaceTable(b, source, at, kind = 'command') {
            editing = true;
            structural = true;
            editor.replaceRange(b.start, b.end, source, at, at, kind);
        }

        // An empty row after row r, with the caret in its column c
        function addRow(b, r, c) {
            const next = MDE.table.insertRow(sourceOf(b), r, b.ui.parsed.cols);
            replaceTable(b, next, b.start + MDE.table.parse(next).rows[r + 1].cells[c].from, 'break');
        }

        // Typing in the open cell: one line, pipes escaped
        function handleCellInput(type) {
            const b = active;
            const ui = b.ui;
            const value = ui.src.textContent;
            const old = ui.text;
            if (value === old) return;
            const sel = readSelection(ui.src) || { start: value.length, end: value.length };
            let p = 0;
            const max = Math.min(old.length, value.length);
            while (p < max && old[p] === value[p]) p++;
            let s = 0;
            while (s < max - p && old[old.length - 1 - s] === value[value.length - 1 - s]) s++;
            const typed = value.slice(p, value.length - s);
            const insert = MDE.table.escapeCell(typed);
            const map = (pos) => ui.base + (pos >= p + typed.length ? pos + insert.length - typed.length : pos);
            const cell = ui.parsed.rows[ui.cell.r].cells[ui.cell.c];
            if (!old && cell.end > cell.start) {
                // The first text in an empty cell: one space on each side
                const at = b.start + cell.start;
                selfEdit = { from: at, to: b.start + cell.end, length: insert.length + 2 };
                editor.replaceRange(selfEdit.from, selfEdit.to, ` ${insert} `, map(sel.start) - ui.base + at + 1, map(sel.end) - ui.base + at + 1, historyKind(type));
                return;
            }
            selfEdit = { from: ui.base + p, to: ui.base + old.length - s, length: insert.length };
            editor.replaceRange(selfEdit.from, selfEdit.to, insert, map(sel.start), map(sel.end), historyKind(type));
        }

        // Enter: the cell below (a new row after the last one)
        function cellEnter(b) {
            const { r, c } = b.ui.cell;
            if (r + 1 < b.ui.parsed.rows.length) goToCell(b, r + 1, c, 'all');
            else addRow(b, r, c);
        }

        // Tab and Shift+Tab: the next or previous cell, its text selected;
        // Tab in the last cell adds a row
        function cellTab(b, back) {
            const { r, c } = b.ui.cell;
            const last = b.ui.parsed.cols - 1;
            if (back) {
                if (c > 0) goToCell(b, r, c - 1, 'all');
                else if (r > 0) goToCell(b, r - 1, last, 'all');
            } else if (c < last) {
                goToCell(b, r, c + 1, 'all');
            } else if (r + 1 < b.ui.parsed.rows.length) {
                goToCell(b, r + 1, 0, 'all');
            } else {
                addRow(b, r, 0);
            }
        }

        // Arrow keys at the edge of a cell go to the next cell, and out of
        // the table from its edges
        function cellArrow(e, b) {
            const src = b.ui.src;
            const sel = readSelection(src);
            if (!sel || sel.start !== sel.end) return;
            const length = src.textContent.length;
            const { r, c } = b.ui.cell;
            const rows = b.ui.parsed.rows.length;
            const last = b.ui.parsed.cols - 1;
            const key = e.key;
            const back = key === 'ArrowUp' || key === 'ArrowLeft';
            let target = null;
            let x;
            if (key === 'ArrowLeft' && sel.start === 0) {
                target = c > 0 ? [r, c - 1, 'end'] : r > 0 ? [r - 1, last, 'end'] : 'out';
            } else if (key === 'ArrowRight' && sel.start === length) {
                target = c < last ? [r, c + 1, 'start'] : r + 1 < rows ? [r + 1, 0, 'start'] : 'out';
            } else if (key === 'ArrowUp' || key === 'ArrowDown') {
                // Only from the first or last line of a cell whose text wraps
                const caret = caretRect(src, sel.start);
                const edge = caretRect(src, back ? 0 : length);
                const mid = (caret.top + caret.bottom) / 2;
                if (length && (back ? mid > edge.bottom : mid < edge.top)) return;
                x = caret.left;
                const next = r + (back ? -1 : 1);
                target = next < 0 || next >= rows ? 'out' : [next, c, back ? 'end' : 'start'];
            }
            if (!target) return;
            e.preventDefault();
            if (target !== 'out') {
                goToCell(b, target[0], target[1], target[2], x);
                return;
            }
            const index = indexOf(b);
            const neighbour = back ? blocks[index - 1] : blocks[index + 1];
            if (neighbour) enter(neighbour, back ? 'end' : 'start', x);
            else if (key === 'ArrowDown') goToGap(text.length, blocks.length);
        }

        // Backspace in the first cell of a row with nothing in it (not the
        // header): the row goes, and the caret to the end of the row above
        function deleteEmptyRow(b) {
            const { r, c } = b.ui.cell;
            const row = b.ui.parsed.rows[r];
            if (r === 0 || c !== 0 || row.cells.some((cell) => cell.text.trim())) return;
            const next = MDE.table.deleteRow(sourceOf(b), r);
            const cells = MDE.table.parse(next).rows[r - 1].cells;
            replaceTable(b, next, b.start + cells[Math.min(b.ui.parsed.cols, cells.length) - 1].to);
        }

        // A list command in a cell: the markers go in front of each line of
        // the cell (lines split by <br>), as text; an empty cell gets
        // placeholder text, selected
        function cellList(b, kind) {
            const ui = b.ui;
            const old = ui.text;
            const parts = old.split(CELL_BREAK);
            const { lines, on, placeholder } = MDE.toggleListLines(parts, kind);
            const blank = parts.length === 1 && !old.trim() && on;
            const value = lines.join('<br>') + (blank ? placeholder : '');
            const cell = ui.parsed.rows[ui.cell.r].cells[ui.cell.c];
            // An empty cell gets one space on each side, as when typing in it
            const [from, to, pad] = !old && cell.end > cell.start
                ? [b.start + cell.start, b.start + cell.end, ' ']
                : [ui.base, ui.base + old.length, ''];
            const base = from + pad.length;
            const sel = editor.getSelection();
            let start = base;
            let end = base + value.length;
            if (blank) {
                start = end - placeholder.length;
            } else if (parts.length === 1) {
                const shift = (pos) => clamp(pos + value.length - old.length, base, base + value.length);
                start = shift(sel.start);
                end = shift(sel.end);
            }
            editing = true;
            structural = true;
            editor.replaceRange(from, to, pad + value + pad, start, end);
        }

        // The start of the cell (r, c) of a table's source, or of the last
        // cell its row has
        function cellStart(source, r, c) {
            const cells = MDE.table.parse(source).rows[r].cells;
            return cells[Math.min(c, cells.length - 1)].from;
        }

        // --- Selecting cells -------------------------------------------------
        // Pressing on a cell and dragging to another, Shift+click, or
        // Shift+an arrow key at the edge of the open cell selects a
        // rectangle of cells. The open cell is one corner (ui.cell, it keeps
        // focus and a caret, at `at` in its text) and ui.range = { r, c,
        // at } the other. The cells are copied as a table, cleared, aligned
        // or deleted together; any other key, typing, pasting or a click
        // lets go of them first.

        // The rectangle: rows top…bottom, columns left…right (null: none)
        function rangeOf(b) {
            const ui = b.ui;
            if (!ui || !ui.range || !ui.cell) return null;
            const top = Math.min(ui.cell.r, ui.range.r);
            const bottom = Math.max(ui.cell.r, ui.range.r);
            const left = Math.min(ui.cell.c, ui.range.c);
            const right = Math.max(ui.cell.c, ui.range.c);
            return { top, bottom, left, right, rows: bottom - top + 1, columns: right - left + 1 };
        }

        function paintRange(b) {
            const range = rangeOf(b);
            const table = b.ui.table;
            if (!table) return;
            table.classList.toggle('has-range', !!range);
            Array.from(table.rows).forEach((row, r) => {
                Array.from(row.cells).forEach((td, c) => {
                    td.classList.toggle('is-picked', !!range && r >= range.top && r <= range.bottom && c >= range.left && c <= range.right);
                });
            });
        }

        function rangeChanged(b) {
            paintRange(b);
            hideBubble();
            notifyCaret();
            notifySelection();
        }

        // Select from the open cell to (r, c); there again, no cells are
        // selected. at: where the caret stays (default: where the
        // selection in the open cell started)
        function setRange(b, r, c, at = null) {
            const ui = b.ui;
            if (!ui.cell) return;
            if (r === ui.cell.r && c === ui.cell.c) {
                clearRange(b);
                return;
            }
            if (ui.range && ui.range.r === r && ui.range.c === c) return;
            if (!ui.range) {
                const s = readSelection(ui.src);
                ui.range = { r, c, at: at !== null ? at : s ? (s.backward ? s.end : s.start) : 0 };
            } else {
                Object.assign(ui.range, { r, c });
            }
            rangeChanged(b);
        }

        function clearRange(b) {
            if (!b || b.mode !== 'table' || !b.ui.range) return false;
            b.ui.range = null;
            rangeChanged(b);
            return true;
        }

        // The cell under a point, or the nearest one at the table's edge
        function cellFromPoint(b, x, y) {
            const rows = Array.from(b.ui.table.rows);
            let r = rows.findIndex((row) => y < row.getBoundingClientRect().bottom);
            if (r === -1) r = rows.length - 1;
            const cells = Array.from(rows[r].cells).slice(0, b.ui.parsed.cols);
            let c = cells.findIndex((td) => x < td.getBoundingClientRect().right);
            if (c === -1) c = cells.length - 1;
            return { r, c };
        }

        // The text offset under a point in a source editor (its start or
        // end when the point is outside it)
        function offsetAtPoint(src, x, y) {
            const hit = pointFromXY(x, y);
            if (hit && src.contains(hit.node)) return offsetIn(src, hit.node, hit.offset);
            const box = src.getBoundingClientRect();
            return y < box.top || (y <= box.bottom && x < box.left) ? 0 : src.textContent.length;
        }

        // Keep a cell in view (in a wide table, sideways too)
        function revealCell(td) {
            const box = scroller.getBoundingClientRect();
            const rect = td.getBoundingClientRect();
            if (rect.top < box.top + 32) scroller.scrollTop -= box.top + 32 - rect.top;
            else if (rect.bottom > box.bottom - 32) scroller.scrollTop += rect.bottom - box.bottom + 32;
            const wrap = td.closest('.table-wrap');
            if (!wrap) return;
            const outer = wrap.getBoundingClientRect();
            if (rect.left < outer.left) wrap.scrollLeft -= outer.left - rect.left;
            else if (rect.right > outer.right) wrap.scrollLeft += rect.right - outer.right;
        }

        const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
        const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'ContextMenu']);

        // Shift+an arrow key: from the edge of the open cell's text (the end
        // the selection moves) the cells start being selected, then each
        // press takes in one more row or column. True when taken.
        function extendRange(b, key) {
            const ui = b.ui;
            const [dr, dc] = ARROWS[key];
            const rows = ui.table.rows.length;
            const cols = ui.parsed.cols;
            if (ui.range) {
                const r = clamp(ui.range.r + dr, 0, rows - 1);
                const c = clamp(ui.range.c + dc, 0, cols - 1);
                setRange(b, r, c);
                const td = tdAt(b, r, c);
                if (td) revealCell(td);
                return true;
            }
            const src = ui.src;
            const s = readSelection(src);
            if (!s) return false;
            const focus = s.backward ? s.start : s.end;
            const length = src.textContent.length;
            let atEdge;
            if (key === 'ArrowLeft') atEdge = focus === 0;
            else if (key === 'ArrowRight') atEdge = focus === length;
            else {
                // The first or last line of a cell whose text wraps
                const caret = caretRect(src, focus);
                const edge = caretRect(src, dr < 0 ? 0 : length);
                const mid = (caret.top + caret.bottom) / 2;
                atEdge = !length || (dr < 0 ? mid <= edge.bottom : mid >= edge.top);
            }
            const r = ui.cell.r + dr;
            const c = ui.cell.c + dc;
            if (!atEdge || r < 0 || r >= rows || c < 0 || c >= cols) return false;
            writeSelection(src, focus, focus);
            setRange(b, r, c, focus);
            const td = tdAt(b, r, c);
            if (td) revealCell(td);
            return true;
        }

        // Keys while cells are selected (and Shift+arrows to start): true
        // when taken. Copy and cut keys go on to the copy and cut events;
        // any other key lets go of the cells first and then does what it
        // does in the open cell.
        function cellKey(e, b) {
            const mods = e.ctrlKey || e.metaKey || e.altKey;
            if (ARROWS[e.key] && e.shiftKey && !mods) return extendRange(b, e.key);
            if (!b.ui.range || MODIFIER_KEYS.has(e.key)) return false;
            const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
            const clipboard = ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (key === 'c' || key === 'x'))
                || (e.ctrlKey && key === 'Insert') || (e.shiftKey && !mods && key === 'Delete');
            if (clipboard) return false;
            if (e.key === 'Escape' && !mods && !e.shiftKey) {
                clearRange(b);
                return true;
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && !mods && !e.shiftKey) {
                flush();
                if (active === b && b.mode === 'table') clearCells(b);
                return true;
            }
            clearRange(b);
            return false;
        }

        // Empty the selected cells (one undo step); they stay selected
        function clearCells(b) {
            const range = rangeOf(b);
            if (!range) return;
            const { rows } = b.ui.parsed;
            const cells = [];
            for (let r = range.top; r <= range.bottom; r++) {
                for (let c = range.left; c <= range.right; c++) {
                    const cell = rows[r] && rows[r].cells[c];
                    if (cell && cell.to > cell.from) cells.push(cell);
                }
            }
            if (!cells.length) return;
            const source = sourceOf(b);
            let next = source;
            cells.sort((x, y) => y.from - x.from).forEach((cell) => {
                next = next.slice(0, cell.from) + next.slice(cell.to);
            });
            // The caret: the start of the open cell
            const open = rows[b.ui.cell.r].cells[b.ui.cell.c];
            const at = open.from - cells.filter((cell) => cell.to <= open.from).reduce((sum, cell) => sum + cell.to - cell.from, 0);
            replaceTable(b, next, b.start + at);
        }

        // The selected cells as a Markdown table (with the header of their
        // columns when it isn't selected, and their alignment) and as an
        // HTML table of just those cells
        function cellsAsTable(b) {
            const range = rangeOf(b);
            const { rows, delimiter } = b.ui.parsed;
            const columns = [];
            for (let c = range.left; c <= range.right; c++) columns.push(c);
            const body = [];
            for (let r = Math.max(range.top, 1); r <= range.bottom; r++) body.push(r);
            const textOf = (r, c) => {
                const cell = rows[r] && rows[r].cells[c];
                return cell ? cell.text.trim() : '';
            };
            const line = (r) => '| ' + columns.map((c) => textOf(r, c)).join(' | ') + ' |';
            const marks = columns.map((c) => {
                const cell = delimiter && delimiter.cells[c];
                return cell ? cell.text.trim() : '---';
            });
            const text = [line(0), '|' + marks.join('|') + '|'].concat(body.map(line)).join('\n');
            const htmlOf = (tag, r, c) => {
                const inner = renderedCell(b, r, c);
                const row = b.ui.rendered && b.ui.rendered.rows[r];
                const align = row && row.cells[c] ? row.cells[c].getAttribute('align') : null;
                return `<${tag}${align ? ` align="${align}"` : ''}>${inner}</${tag}>`;
            };
            const tr = (tag, r) => '<tr>' + columns.map((c) => htmlOf(tag, r, c)).join('') + '</tr>';
            let html = '<table>';
            if (range.top === 0) html += '<thead>' + tr('th', 0) + '</thead>';
            if (body.length) html += '<tbody>' + body.map((r) => tr('td', r)).join('') + '</tbody>';
            html += '</table>';
            return { text, html, count: range.rows * range.columns };
        }

        // Ctrl+C / Ctrl+X while cells are selected (the copy and cut events
        // also come with nothing selected in the open cell)
        function copyCells(e, cut) {
            const b = active;
            if (!b || b.mode !== 'table' || !b.ui.range || !inSource(b, e.target) || !e.clipboardData) return;
            e.preventDefault();
            const { text: plain, html, count } = cellsAsTable(b);
            e.clipboardData.setData('text/plain', plain);
            e.clipboardData.setData('text/html', html);
            if (cut) {
                flush();
                if (active === b && b.mode === 'table') clearCells(b);
            }
            if (toast) toast(cut ? `已剪切 ${count} 格` : `已复制 ${count} 格`);
        }

        // The table toolbar: align the caret's column, add a row below or a
        // column to the right of its cell, delete its row (not the header)
        // or its column (not the last one), or delete the table. With cells
        // selected: align all their columns, add the row under them or the
        // column right of them, delete all their rows (not with the header)
        // or columns (not all of them).
        function tableCommand(name) {
            const b = active;
            if (!b || b.mode !== 'table' || !b.ui.cell) return;
            const { r, c } = b.ui.cell;
            const { rows, cols } = b.ui.parsed;
            if (name === 'delete') {
                removeBlock(b);
                return;
            }
            const range = rangeOf(b) || { top: r, bottom: r, left: c, right: c, rows: 1, columns: 1 };
            const source = sourceOf(b);
            const offset = clamp(editor.getSelection().start - b.ui.base, 0, b.ui.text.length);
            let next = source;
            let at = null;
            let keep = null;
            if (name === 'row') {
                next = MDE.table.insertRow(source, range.bottom, cols);
                at = MDE.table.parse(next).rows[range.bottom + 1].cells[c].from;
            } else if (name === 'column') {
                next = MDE.table.insertColumn(source, range.right);
                at = MDE.table.parse(next).rows[r].cells[range.right + 1].from;
            } else if (name === 'delete-row') {
                // The caret goes to the row that comes up (the one above after the last)
                if (range.top === 0) return;
                next = MDE.table.deleteRow(source, range.top, range.rows);
                at = cellStart(next, range.top < rows.length - range.rows ? range.top : range.top - 1, c);
            } else if (name === 'delete-column') {
                if (range.columns === cols) return;
                next = MDE.table.deleteColumn(source, range.left, range.columns);
                at = cellStart(next, r, range.left < cols - range.columns ? range.left : range.left - 1);
            } else {
                for (let k = range.left; k <= range.right; k++) next = MDE.table.setAlign(next, k, name);
                at = MDE.table.parse(next).rows[r].cells[c].from + offset;
                // (the cells stay selected)
                keep = b.ui.range && { ...b.ui.range, at: offset };
            }
            if (next === source) return;
            replaceTable(b, next, b.start + at);
            if (keep && active === b && b.mode === 'table' && b.ui.cell && b.ui.cell.r === r && b.ui.cell.c === c) {
                b.ui.range = keep;
                rangeChanged(b);
            }
        }

        // Write a code/formula editor back into the document
        function commitParts(b, kind) {
            const ui = b.ui;
            const old = sourceOf(b);
            const next = ui.parts.open + ui.input.value + ui.parts.close;
            if (next === old) return;
            let p = 0;
            const max = Math.min(old.length, next.length);
            while (p < max && old[p] === next[p]) p++;
            let s = 0;
            while (s < max - p && old[old.length - 1 - s] === next[next.length - 1 - s]) s++;
            const offset = b.start + ui.parts.open.length;
            selfEdit = { from: b.start + p, to: b.start + old.length - s, length: next.length - p - s };
            editor.replaceRange(selfEdit.from, selfEdit.to, next.slice(p, next.length - s),
                offset + ui.input.selectionStart, offset + ui.input.selectionEnd, kind);
        }

        // --- Moving the caret between blocks ---------------------------------

        function leave(b) {
            hideBubble();
            closeSlash();
            if (cellDrag && cellDrag.b === b) cellDrag = null;
            if (b.gap) {
                b.el.remove();
            } else {
                if (b.ui && b.ui.timer) clearTimeout(b.ui.timer);
                if (b.ui && b.ui.previewTimer) clearTimeout(b.ui.previewTimer);
                if (b.ui && b.ui.mediaTimer) clearTimeout(b.ui.mediaTimer);
                renderBlock(b);
                refreshHeadings();
            }
            notifySelection();
        }

        // Edit `target` instead of the current block. With `anchor`, the
        // target stays where it was on screen while the old block re-renders.
        function switchTo(target, anchor) {
            const prev = active;
            if (prev && prev !== target) {
                const closed = closeOpenFence(prev);
                // (an empty line opened under it goes under the closing line)
                if (closed && target.gap && target.pos >= closed.at) {
                    target.pos += closed.length;
                    target.index = countBefore(target.pos);
                }
            }
            const top = anchor ? target.el.getBoundingClientRect().top : 0;
            active = target;
            if (prev && prev !== target) leave(prev);
            if (anchor) {
                const shift = target.el.getBoundingClientRect().top - top;
                if (shift) scroller.scrollTop += shift;
            }
            mount(target);
            markActive();
        }

        function makeGap(pos, index) {
            const el = document.createElement('div');
            const gap = { gap: true, kind: 'gap', pos, index, el, mode: null, ui: null };
            byElement.set(el, gap);
            root.insertBefore(el, blocks[index] ? blocks[index].el : null);
            return gap;
        }

        // Newlines needed around text typed on an empty line, so it starts a
        // paragraph of its own instead of joining its neighbours
        function gapPadding(pos) {
            const before = text.slice(0, pos);
            const after = text.slice(pos);
            return {
                lead: !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n',
                trail: !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
            };
        }

        function shouldFocus() {
            const el = document.activeElement;
            if (!el || el === document.body || scroller.contains(el)) return true;
            // Leave focus in another visible text field, e.g. an open dialog
            const typing = el.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="file"]), textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
            return !(typing && el.getClientRects().length);
        }

        // Put the DOM selection where the document's selection is
        function applySelection() {
            const b = active;
            if (!b) return;
            const sel = editor.getSelection();
            const focus = !suppressFocus && shouldFocus();
            if (b.mode === 'table') {
                const { r, c } = cellAt(b, sel.start);
                // The caret left the cell the selected cells go from (or
                // selects text): they are let go
                if (b.ui.range && (sel.start !== sel.end || !b.ui.cell || r !== b.ui.cell.r || c !== b.ui.cell.c)) {
                    b.ui.range = null;
                    paintRange(b);
                }
                openCell(b, r, c);
            }
            const base = textBase(b);
            if (textEditor(b)) {
                const src = b.ui.src;
                const length = src.textContent.length;
                const start = clamp(sel.start - base, 0, length);
                const end = clamp(sel.end - base, 0, length);
                if (b.mode === 'table' && b.ui.range) b.ui.range.at = start;
                if (focus && document.activeElement !== src) {
                    ignoreFocus = true;
                    src.focus({ preventScroll: true });
                    ignoreFocus = false;
                }
                if (document.activeElement === src) {
                    const now = readSelection(src);
                    if (!now || now.start !== start || now.end !== end) writeSelection(src, start, end);
                }
            } else if (b.mode !== 'table') {
                const input = b.ui.input;
                const offset = base + b.ui.parts.open.length;
                const length = input.value.length;
                const start = clamp(sel.start - offset, 0, length);
                const end = clamp(sel.end - offset, 0, length);
                if (focus && document.activeElement !== input && document.activeElement !== b.ui.lang) input.focus({ preventScroll: true });
                if (input.selectionStart !== start || input.selectionEnd !== end) input.setSelectionRange(start, end);
            }
            markCaretLines();
            markImage();
            revealCaret();
            notifyCaret();
            updateBubble();
            notifySelection();
        }

        // Activate whatever holds the document's caret
        function placeCaret() {
            const sel = editor.getSelection();
            // An empty line opened with Enter sits at its neighbour's edge
            if (!(active && active.gap && sel.start === active.pos && sel.end === active.pos)) {
                const k = blockAt(sel.start);
                if (k !== -1) {
                    if (blocks[k] !== active) switchTo(blocks[k]);
                } else {
                    const index = countBefore(sel.start);
                    if (active && active.gap && active.index === index) active.pos = sel.start;
                    else switchTo(makeGap(sel.start, index));
                }
            }
            applySelection();
        }

        // Mirror the DOM selection into the document's selection
        function captureSelection() {
            const b = active;
            if (!b || composing) return false;
            let range = null;
            if (b.mode === 'source') {
                const s = readSelection(b.ui.src);
                if (s) range = b.gap ? { start: b.pos, end: b.pos } : { start: b.start + s.start, end: b.start + s.end };
            } else if (b.mode === 'table') {
                const s = b.ui.src && readSelection(b.ui.src);
                // (while cells are selected the caret stays where it was,
                // whatever a drag does to the text selection)
                const at = b.ui.range && b.ui.base + b.ui.range.at;
                if (s) range = b.ui.range ? { start: at, end: at } : { start: b.ui.base + s.start, end: b.ui.base + s.end };
            } else if (b.ui && document.activeElement === b.ui.input) {
                const offset = b.start + b.ui.parts.open.length;
                range = {
                    start: clamp(offset + b.ui.input.selectionStart, b.start, b.end),
                    end: clamp(offset + b.ui.input.selectionEnd, b.start, b.end)
                };
            }
            if (!range) return false;
            const cur = editor.getSelection();
            if (cur.start !== range.start || cur.end !== range.end) editor.select(range.start, range.end);
            return true;
        }

        function notifyCaret() {
            if (!onCaret) return;
            const { end: pos, value } = editor.getSelection();
            let line = 0;
            for (let i = value.indexOf('\n'); i !== -1 && i < pos; i = value.indexOf('\n', i + 1)) line++;
            const col = pos - (pos ? value.lastIndexOf('\n', pos - 1) + 1 : 0);
            onCaret({ line, col, pos, label: active ? labelOf(active) : '' });
        }

        function caretBox() {
            const b = active;
            if (!b || !b.ui) return null;
            if (b.mode === 'source' || b.mode === 'table') {
                const s = textEditor(b) && readSelection(b.ui.src);
                return s ? caretRect(b.ui.src, s.end) : null;
            }
            const input = b.ui.input;
            const box = input.getBoundingClientRect();
            const line = input.value.slice(0, input.selectionEnd).split('\n').length - 1;
            const top = box.top + line * b.ui.lineHeight;
            return { top, bottom: top + b.ui.lineHeight };
        }

        // Keep the caret in view; in typewriter mode keep it near the middle.
        // With room kept under its line (keepRoom), the line stays above that
        // room, as far as the view is tall enough (up to 8px from its top).
        function revealCaret(center) {
            const rect = caretBox();
            if (!rect) return;
            const box = scroller.getBoundingClientRect();
            const margin = 32;
            let by = 0;
            if (center || (settings.typewriter && keyboardCaret)) by = (rect.top + rect.bottom) / 2 - (box.top + box.height * (center ? 0.4 : 0.45));
            else if (rect.top < box.top + margin) by = rect.top - box.top - margin;
            else if (rect.bottom > box.bottom - margin) by = rect.bottom - box.bottom + margin;
            if (roomBelow) by = Math.max(by, rect.bottom - box.bottom + Math.min(roomBelow, box.height - 8 - (rect.bottom - rect.top)));
            if (by) scroller.scrollTop += by;
        }

        // Enter a block from its neighbour; x keeps the caret's column when
        // moving up or down
        function enter(target, edge, x) {
            switchTo(target);
            editing = true;
            const b = active;
            const base = baseOf(b);
            if (b.mode === 'table') {
                // The first or last row, in the column under x
                const r = edge === 'end' ? b.ui.parsed.rows.length - 1 : 0;
                const tds = b.ui.table ? Array.from(b.ui.table.rows[r].cells) : [];
                let c = x === undefined ? (edge === 'end' ? b.ui.parsed.cols - 1 : 0)
                    : tds.findIndex((td) => x < td.getBoundingClientRect().right);
                if (c === -1) c = b.ui.parsed.cols - 1;
                goToCell(b, r, clamp(c, 0, b.ui.parsed.cols - 1), edge === 'end' ? 'end' : 'start', x);
                return;
            }
            if (b.mode === 'source') {
                const src = b.ui.src;
                const length = src.textContent.length;
                let offset = edge === 'end' ? length : 0;
                if (x !== undefined && length) {
                    const line = () => caretRect(src, offset);
                    const box = scroller.getBoundingClientRect();
                    let r = line();
                    if (r.top < box.top || r.bottom > box.bottom) {
                        scroller.scrollTop += r.top < box.top ? r.top - box.top - 32 : r.bottom - box.bottom + 32;
                        r = line();
                    }
                    const hit = pointFromXY(x, (r.top + r.bottom) / 2);
                    if (hit && src.contains(hit.node)) offset = offsetIn(src, hit.node, hit.offset);
                }
                editor.select(base + offset, base + offset);
            } else {
                const value = b.ui.input.value;
                const pos = edge === 'end' ? (x !== undefined ? value.lastIndexOf('\n') + 1 : value.length) : 0;
                const at = Math.min(base + b.ui.parts.open.length + pos, b.end);
                editor.select(at, at);
            }
            applySelection();
        }

        function goToGap(pos, index) {
            if (!(active && active.gap && active.pos === pos)) switchTo(makeGap(pos, index));
            editing = true;
            // (switchTo may have moved it: see closeOpenFence)
            editor.select(active.pos, active.pos);
            applySelection();
        }

        // Click on a block: edit it, with the caret about where the click was
        function activateAt(b, x, y) {
            const top = b.el.getBoundingClientRect().top;
            switchTo(b, true);
            editing = true;
            const box = b.el.getBoundingClientRect();
            y = clamp(y + box.top - top, box.top + 1, box.bottom - 1);
            const base = baseOf(b);
            if (b.mode === 'table') {
                const hit = document.elementFromPoint(x, y);
                const td = hit && hit.closest('td, th');
                if (td && b.ui.table && b.ui.table.contains(td)) clickCell(b, td, x, y);
                else goToCell(b, 0, 0, 'start');
                return;
            }
            if (b.mode === 'source') {
                const src = b.ui.src;
                const hit = pointFromXY(x, y);
                const offset = hit && src.contains(hit.node) ? offsetIn(src, hit.node, hit.offset) : src.textContent.length;
                editor.select(base + offset, base + offset);
            } else {
                const offset = base + b.ui.parts.open.length;
                const pos = b.mode === 'code' ? codeOffsetAt(b.ui, x, y) : b.ui.input.value.length;
                editor.select(Math.min(offset + pos, b.end), Math.min(offset + pos, b.end));
            }
            applySelection();
        }

        function clickBetween(x, y) {
            const last = blocks[blocks.length - 1];
            if (!last || y > last.el.getBoundingClientRect().bottom) {
                goToGap(text.length, blocks.length);
                return;
            }
            let best = null;
            let distance = Infinity;
            for (const b of blocks) {
                const r = b.el.getBoundingClientRect();
                const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
                if (d < distance) {
                    distance = d;
                    best = b;
                }
                if (r.top > y) break;
            }
            if (best) activateAt(best, x, y);
        }

        function stopEditing(focusView) {
            flush();
            hideBubble();
            const b = active;
            closeOpenFence(b);
            active = null;
            if (b) leave(b);
            editing = false;
            markActive();
            if (visible) notifyCaret();
            if (focusView) {
                ignoreFocus = true;
                scroller.focus({ preventScroll: true });
                ignoreFocus = false;
            }
        }

        // --- Editing the source -----------------------------------------------

        function edit(from, to, insert, caret, kind = 'command') {
            structural = true;
            editor.replaceRange(from, to, insert, caret, caret, kind);
        }

        // The browser changed the text of the source editor
        function handleInput(type) {
            const b = active;
            if (b.mode === 'table') {
                handleCellInput(type);
                return;
            }
            const src = b.ui.src;
            const value = src.textContent;
            const old = sourceOf(b);
            src.classList.toggle('is-empty', !value);
            if (value === old) return;
            const sel = readSelection(src) || { start: value.length, end: value.length };
            const kind = historyKind(type);
            if (b.gap) {
                // A new paragraph: its own undo step, as Enter is in the source editor
                const pad = gapPadding(b.pos);
                const at = b.pos + pad.lead.length;
                structural = true;
                editor.replaceRange(b.pos, b.pos, pad.lead + value + pad.trail, at + sel.start, at + sel.end, 'break');
            } else {
                let p = 0;
                const max = Math.min(old.length, value.length);
                while (p < max && old[p] === value[p]) p++;
                let s = 0;
                while (s < max - p && old[old.length - 1 - s] === value[value.length - 1 - s]) s++;
                selfEdit = { from: b.start + p, to: b.start + old.length - s, length: value.length - p - s };
                editor.replaceRange(selfEdit.from, selfEdit.to, value.slice(p, value.length - s), b.start + sel.start, b.start + sel.end, kind);
            }
            updateSlash(!old && SLASH_KEYS.has(value));
        }

        function insertText(str, kind) {
            const b = active;
            const sel = readSelection(b.ui.src) || { start: 0, end: 0 };
            if (b.mode === 'table') {
                const value = MDE.table.escapeCell(str);
                edit(b.ui.base + sel.start, b.ui.base + sel.end, value, b.ui.base + sel.start + value.length, kind);
            } else if (b.gap) {
                const pad = gapPadding(b.pos);
                edit(b.pos, b.pos, pad.lead + str + pad.trail, b.pos + pad.lead.length + str.length, kind);
            } else {
                edit(b.start + sel.start, b.start + sel.end, str, b.start + sel.start + str.length, kind);
            }
        }

        function handleEnter(soft) {
            const b = active;
            if (b.gap) return;
            if (b.mode === 'table') {
                cellEnter(b);
                return;
            }
            const sel = readSelection(b.ui.src);
            if (!sel) return;
            const value = sourceOf(b);
            const base = b.start;
            const { start, end } = sel;
            const collapsed = start === end;
            const lineStart = start ? value.lastIndexOf('\n', start - 1) + 1 : 0;
            let lineEnd = value.indexOf('\n', end);
            if (lineEnd === -1) lineEnd = value.length;
            const line = value.slice(lineStart, lineEnd);
            const insert = (str, caret = str.length) => edit(base + start, base + end, str, base + start + caret, 'break');

            // ``` or $$ just typed on a line of its own: close the block and
            // continue inside it
            if (collapsed && lineStart === 0 && start === lineEnd) {
                const fence = FENCE_LINE.exec(line);
                if (fence && b.ui.mountedKind !== 'fence') {
                    insert('\n\n' + fence[1], 1);
                    return;
                }
                if (/^\$\$[ \t]*$/.test(line) && b.ui.mountedKind !== 'math' && !value.slice(lineEnd).includes('$$')) {
                    insert('\n\n$$', 1);
                    return;
                }
            }

            // Lists and quotes continue on the next line; an empty item ends them
            if (collapsed && (b.kind === 'list' || b.kind === 'quote')) {
                const quote = QUOTE_PREFIX.exec(line);
                const outer = quote ? quote[0] : '';
                const item = LIST_ITEM.exec(line.slice(outer.length));
                const prefixLength = outer.length + (item ? item[0].length : 0);
                if ((item || outer) && start >= lineStart + prefixLength) {
                    if (!line.slice(prefixLength).trim() && start === lineEnd) {
                        const keep = item ? outer : '';
                        edit(base + lineStart, base + lineEnd, keep, base + lineStart + keep.length, 'break');
                        return;
                    }
                    let next = outer;
                    if (item) {
                        const marker = /^\d/.test(item[2]) ? (parseInt(item[2], 10) + 1) + item[2].slice(-1) : item[2];
                        next += item[1] + marker + item[3] + (item[4] ? '[ ] ' : '');
                    }
                    insert('\n' + next);
                    return;
                }
            }

            // "| 姓名 | 年龄 |" on a line of its own: Enter makes it the header
            // of a table, with the delimiter line and an empty row (the
            // caret in its first cell); one undo step gives the line back
            if (b.kind === 'paragraph' && !soft && collapsed && start === value.length && TABLE_HEADER.test(value)) {
                const header = MDE.table.parse(value).rows[0].cells;
                if (header.some((cell) => cell.text.trim())) {
                    const table = value.trimEnd() + '\n|' + '---|'.repeat(header.length) + '\n|' + '   |'.repeat(header.length);
                    const at = base + MDE.table.parse(table).rows[1].cells[0].from;
                    editing = true;
                    structural = true;
                    editor.replaceRange(base, base + value.length, table, at, at, 'command');
                    return;
                }
            }

            // Tables get a new empty row
            if (b.kind === 'table' && collapsed && start === lineEnd && line.trim().startsWith('|')) {
                const delimiter = value.split('\n')[1] || '';
                const cols = Math.max(1, delimiter.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length);
                insert('\n|' + '   |'.repeat(cols), 3);
                return;
            }

            // (An image in HTML: at either end Enter opens an empty line, as below)
            if (PLAIN_ENTER_KINDS.has(b.kind) || (isHtmlImage(b) && !(collapsed && (start === 0 || start === value.length)))) {
                insert('\n' + (b.kind === 'code' ? line.match(/^\s*/)[0] : ''));
                return;
            }

            // Paragraphs, headings and the rest: Enter at either end opens an
            // empty line next to the block, in between it splits the block
            if (collapsed && start === value.length) goToGap(b.end, indexOf(b) + 1);
            else if (collapsed && start === 0) goToGap(b.start, indexOf(b));
            else insert(soft ? '\n' : '\n\n');
        }

        // Backspace at the start or Delete at the end of a block works on the
        // line break between blocks, as it would in the source
        function handleDeleteKey(e, backward) {
            const b = active;
            const sel = readSelection(b.ui.src);
            if (!sel || sel.start !== sel.end) return;
            if (backward ? sel.start !== 0 : sel.start !== b.ui.src.textContent.length) return;
            e.preventDefault();
            // Cells are not joined; Backspace at the start of an empty row
            // takes the row out
            if (b.mode === 'table') {
                if (backward) deleteEmptyRow(b);
                return;
            }
            if (b.gap) {
                const target = backward ? blocks[b.index - 1] : blocks[b.index];
                if (target) enter(target, backward ? 'end' : 'start');
                return;
            }
            if (backward && b.start > 0) edit(b.start - 1, b.start, '', b.start - 1, 'delete');
            else if (!backward && b.end < text.length) edit(b.end, b.end + 1, '', b.end, 'delete');
        }

        function handleArrow(e) {
            const b = active;
            if (b.mode === 'table') {
                cellArrow(e, b);
                return;
            }
            const key = e.key;
            const back = key === 'ArrowUp' || key === 'ArrowLeft';
            const vertical = key === 'ArrowUp' || key === 'ArrowDown';
            let atEdge;
            let x;
            if (b.mode === 'source') {
                const src = b.ui.src;
                const sel = readSelection(src);
                if (!sel || sel.start !== sel.end) return;
                const length = src.textContent.length;
                if (key === 'ArrowLeft') atEdge = sel.start === 0;
                else if (key === 'ArrowRight') atEdge = sel.start === length;
                else {
                    const caret = caretRect(src, sel.start);
                    const edge = caretRect(src, back ? 0 : length);
                    const mid = (caret.top + caret.bottom) / 2;
                    atEdge = !length || (back ? mid <= edge.bottom : mid >= edge.top);
                    x = caret.left;
                }
            } else {
                const input = b.ui.input;
                if (e.target !== input || input.selectionStart !== input.selectionEnd) return;
                const value = input.value;
                const pos = input.selectionStart;
                if (key === 'ArrowLeft') atEdge = pos === 0;
                else if (key === 'ArrowRight') atEdge = pos === value.length;
                else if (key === 'ArrowUp') atEdge = value.lastIndexOf('\n', pos - 1) === -1 || pos === 0;
                else atEdge = value.indexOf('\n', pos) === -1;
            }
            if (!atEdge) return;
            const index = indexOf(b);
            const target = back ? blocks[index - 1] : blocks[b.gap ? index : index + 1];
            if (target) {
                e.preventDefault();
                enter(target, back ? 'end' : 'start', vertical ? x : undefined);
            } else if (key === 'ArrowDown' && !b.gap) {
                // Past the last block: an empty line to continue writing
                e.preventDefault();
                goToGap(text.length, blocks.length);
            }
        }

        // A click on a task's checkbox ticks it in the source
        function toggleTask(b, index) {
            const source = sourceOf(b);
            TASK_MARK.lastIndex = 0;
            let m;
            let n = 0;
            while ((m = TASK_MARK.exec(source))) {
                if (n++ !== index) continue;
                const at = b.start + m.index + m[0].length - 2;
                const sel = editor.getSelection();
                suppressFocus = true;
                editor.replaceRange(at, at + 1, m[1] === ' ' ? 'x' : ' ', sel.start, sel.end);
                suppressFocus = false;
                return;
            }
        }

        // --- Inline formula preview ---------------------------------------------

        function hideBubble() {
            bubble.hidden = true;
        }

        function updateBubble() {
            const b = active;
            const src = textEditor(b);
            if (!src || composing || (b.mode === 'table' && b.ui.range)) return hideBubble();
            const sel = readSelection(src);
            if (!sel || sel.start !== sel.end) return hideBubble();
            const value = src.textContent;
            const lineStart = sel.start ? value.lastIndexOf('\n', sel.start - 1) + 1 : 0;
            let lineEnd = value.indexOf('\n', sel.start);
            if (lineEnd === -1) lineEnd = value.length;
            const line = value.slice(lineStart, lineEnd);
            INLINE_MATH.lastIndex = 0;
            let found = null;
            let m;
            while ((m = INLINE_MATH.exec(line))) {
                const from = lineStart + m.index;
                const to = from + m[0].length;
                if (from >= sel.start) break;
                // Skip $…$ inside `code`
                const ticks = (line.slice(0, m.index).match(/`/g) || []).length;
                if (sel.start < to && ticks % 2 === 0) {
                    found = { from, to, tex: m[2] };
                    break;
                }
            }
            if (!found) return hideBubble();
            bubble.innerHTML = markdown.renderMath(found.tex, false);
            bubble.hidden = false;
            const range = document.createRange();
            const a = pointAt(src, found.from);
            const z = pointAt(src, found.to);
            range.setStart(a.node, a.offset);
            range.setEnd(z.node, z.offset);
            const rects = range.getClientRects();
            if (!rects.length) return hideBubble();
            const box = scroller.getBoundingClientRect();
            const left = rects[0].left - box.left + scroller.scrollLeft;
            bubble.style.left = clamp(left, 8, Math.max(8, scroller.clientWidth - bubble.offsetWidth - 8)) + 'px';
            bubble.style.top = (rects[rects.length - 1].bottom - box.top + scroller.scrollTop + 6) + 'px';
        }

        // --- Slash menu and selection toolbar ------------------------------------

        function notifySelection() {
            if (onSelection) onSelection();
        }

        function closeSlash() {
            if (!slash) return;
            const el = slash.el;
            slash = null;
            paintSlash(el);
            if (onSlash) onSlash(null);
        }

        // The slash menu opened or closed for this block: redraw its "/"
        function paintSlash(el) {
            const b = active;
            if (!b || b.el !== el || b.mode !== 'source' || composing) return;
            const src = b.ui.src;
            const html = sourceHtml(b);
            if (src.innerHTML === html) return;
            const sel = document.activeElement === src ? readSelection(src) : null;
            src.innerHTML = html;
            if (sel) writeSelection(src, sel.start, sel.end);
        }

        // After typing or a caret move: open the slash menu when "/" was just
        // typed on an empty line, filter it while the line is "/…", and close
        // it once the line or the caret leaves that shape
        function updateSlash(typed) {
            const b = active;
            const m = b && !b.gap && b.mode === 'source' ? SLASH.exec(sourceOf(b)) : null;
            if (typed && m && onSlash) {
                slash = { el: b.el };
                paintSlash(b.el);
            }
            if (!slash) return;
            const sel = m && slash.el === b.el ? readSelection(b.ui.src) : null;
            if (!sel || sel.start === 0 || /^\s/.test(m[1]) || onSlash(m[1], b.ui.src) === false) closeSlash();
        }

        // Replace the "/…" line with a block chosen in the slash menu
        function applySlash(id) {
            const spec = SLASH_BLOCKS[id];
            const b = active;
            const ready = spec && slash && b && !b.gap && b.mode === 'source';
            closeSlash();
            if (!ready) return;
            const [from, to] = spec.select || [spec.text.length, spec.text.length];
            editing = true;
            structural = true;
            editor.replaceRange(b.start, b.end, spec.text, b.start + from, b.start + to);
            if (spec.after && active && !active.gap) goToGap(active.end, indexOf(active) + 1);
        }

        // A box on screen, or null while it is scrolled out of the document's view
        function onScreen(rect) {
            const box = scroller.getBoundingClientRect();
            return rect && rect.bottom > box.top && rect.top < box.bottom ? rect : null;
        }

        function rangeIn(src, start, end) {
            const a = pointAt(src, start);
            const z = pointAt(src, end);
            const range = document.createRange();
            range.setStart(a.node, a.offset);
            range.setEnd(z.node, z.offset);
            return range;
        }

        // Where the "/" of the slash menu is
        function slashRect() {
            const b = active;
            if (!slash || !b || b.gap || b.mode !== 'source') return null;
            return onScreen(rangeIn(b.ui.src, 0, 1).getBoundingClientRect());
        }

        // The document's selection (or caret) inside the block being edited.
        // This holds while focus is elsewhere, e.g. in the link dialog.
        function selectionRect() {
            const b = active;
            const src = textEditor(b);
            if (!src || b.gap) return null;
            const sel = editor.getSelection();
            const length = src.textContent.length;
            const start = clamp(sel.start - textBase(b), 0, length);
            const end = clamp(sel.end - textBase(b), 0, length);
            if (start === end) {
                const r = caretRect(src, start);
                return onScreen({ top: r.top, bottom: r.bottom, left: r.left, right: r.left, width: 0, height: r.bottom - r.top });
            }
            return onScreen(rangeIn(src, start, end).getBoundingClientRect());
        }

        // What the selection toolbar needs to know, or null when there is no
        // selection in a source editor that has focus (or cells are selected)
        function selectionState() {
            const b = active;
            const src = textEditor(b);
            if (!visible || !src || b.gap || composing || document.activeElement !== src || (b.mode === 'table' && b.ui.range)) return null;
            const s = readSelection(src);
            if (!s) return null;
            const base = textBase(b);
            // (an image written in HTML is HTML to the selection toolbar)
            return { el: src, kind: isHtmlImage(b) ? 'html' : b.kind, start: base + s.start, end: base + s.end, collapsed: s.start === s.end };
        }

        // --- Links: the link bubble ---------------------------------------------

        // The link the caret is in, in the text being edited: its range in
        // the document and the boxes of its source on screen. The preview
        // of an inline formula keeps the place under the caret to itself.
        function caretLink() {
            const b = active;
            const src = textEditor(b);
            if (!visible || !src || b.gap || composing || document.activeElement !== src || !bubble.hidden || (b.mode === 'table' && b.ui.range)) return null;
            const s = readSelection(src);
            if (!s || s.start !== s.end) return null;
            const link = MDE.links.at(src.textContent, s.start, s.end, resolveRef);
            if (!link) return null;
            const rects = Array.from(rangeIn(src, link.from, link.to).getClientRects());
            const base = textBase(b);
            return { ...link, from: base + link.from, to: base + link.to, rects };
        }

        // The source of a link in a rendered block (or in a rendered cell of
        // the table being edited). The anchor is the k-th one with its
        // address in its block (its cell, in a table), so it shows the k-th
        // link with that address in the source. Null when there is none,
        // e.g. for a link written in HTML.
        function linkOf(a) {
            const el = a.closest('.lv-block');
            const b = el && el.parentElement === root ? blockOf(el) : null;
            if (!b || b.gap || b.mode === 'source') return null;
            const address = a.getAttribute('href');
            let scope = el;
            let start = b.start;
            let source = sourceOf(b);
            const td = b.kind === 'table' ? a.closest('td, th') : null;
            if (td) {
                const parsed = b.mode === 'table' ? b.ui.parsed : MDE.table.parse(source);
                const row = parsed.rows[td.parentElement.rowIndex];
                const cell = row && row.cells[td.cellIndex];
                if (!cell) return null;
                scope = td;
                start = b.start + cell.from;
                source = cell.text;
            }
            const anchors = Array.from(scope.querySelectorAll('a[href]')).filter((x) => x.getAttribute('href') === address);
            const links = MDE.links.scan(source, resolveRef).filter((link) => link.href === address);
            const link = links[anchors.indexOf(a)];
            return link ? { ...link, from: start + link.from, to: start + link.to } : null;
        }

        // --- Whole blocks: the block handle and its menu ------------------------

        // The block an element of the live view shows (null once it is gone)
        function blockOf(el) {
            const b = el && el.isConnected ? byElement.get(el) : null;
            return b && (b.gap ? b === active : blocks.includes(b)) ? b : null;
        }

        // An empty line under the block, with the caret on it
        function insertBelow(b) {
            if (!b.gap) goToGap(b.end, indexOf(b) + 1);
        }

        // Where the caret goes when the text [from, to) is replaced by
        // `length` characters: it moves with the text after the change, and
        // a caret inside it goes to its start
        const mapper = (from, to, length) => (pos) => (pos < from ? pos : pos >= to ? pos + length - (to - from) : from);

        // Take a block out with the blank lines that separate it from its
        // neighbours. A caret inside it goes to where the next block now is.
        function removeBlock(b) {
            if (b.gap) return;
            const k = indexOf(b);
            const next = blocks[k + 1];
            const prev = blocks[k - 1];
            const from = next ? b.start : prev ? prev.end : 0;
            const to = next ? next.start : prev ? b.end : text.length;
            const sel = editor.getSelection();
            const map = mapper(from, to, 0);
            const edited = b === active;
            structural = true;
            editor.replaceRange(from, to, '', map(sel.start), map(sel.end));
            // It was being edited: the caret goes on to the start of the next
            // block (the end of the one before), not to an empty line in its place
            if (edited && active && active.gap) {
                const at = blockAt(from);
                if (at !== -1) enter(blocks[at], next ? 'start' : 'end');
            }
        }

        // New source for a block (converted to another type); the caret goes
        // to `caret` in it and the block is edited
        function replaceBlock(b, source, caret = source.length) {
            if (b.gap) return;
            editing = true;
            structural = true;
            editor.replaceRange(b.start, b.end, source, b.start + caret, b.start + caret);
        }

        // Move a block in front of blocks[index] (blocks.length: to the end),
        // as one undo step. The caret moves with the text it is in.
        function moveBlock(b, index) {
            const k = indexOf(b);
            if (b.gap || index === k || index === k + 1 || index < 0 || index > blocks.length) return;
            const source = sourceOf(b);
            const next = blocks[k + 1];
            const prev = blocks[k - 1];
            const [from, to] = next ? [b.start, next.start] : [prev.end, b.end];
            const out = mapper(from, to, 0);
            const rest = text.slice(0, from) + text.slice(to);
            const target = blocks[index];
            const at = target ? out(target.start) : out(blocks[blocks.length - 1].end);
            const before = rest.slice(0, at);
            const after = rest.slice(at);
            const lead = !before.trim() || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
            const trail = !after.trim() || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
            const value = before + lead + source + trail + after;
            const moved = (pos) => (pos >= b.start && pos <= b.end ? at + lead.length + pos - b.start
                : out(pos) >= at ? out(pos) + lead.length + source.length + trail.length : out(pos));
            // The smallest replacement that turns the text into the new one
            let p = 0;
            const max = Math.min(text.length, value.length);
            while (p < max && text[p] === value[p]) p++;
            let s = 0;
            while (s < max - p && text[text.length - 1 - s] === value[value.length - 1 - s]) s++;
            const sel = editor.getSelection();
            structural = true;
            editor.replaceRange(p, text.length - s, value.slice(p, value.length - s), moved(sel.start), moved(sel.end));
        }

        // What the block handle shows and its menu acts on
        function blockInfo(el) {
            const b = blockOf(el);
            if (!b) return null;
            return {
                kind: b.kind,
                depth: b.depth || 0,
                gap: !!b.gap,
                // The slash menu is open for it (its handle stays a "+")
                slash: !!slash && slash.el === b.el,
                active: b === active,
                index: indexOf(b),
                source: sourceOf(b)
            };
        }

        // The "+" beside an empty line: type "/" there, so the slash menu
        // opens. If the menu is then closed unused, the "/" goes again.
        function startSlash() {
            const b = active;
            if (!b || !(b.gap || (b.mode === 'source' && !sourceOf(b)))) return;
            editing = true;
            insertText('/', 'break');
            updateSlash(true);
            if (slash) slash.auto = editor.getValue();
        }

        const inSource = (b, target) => !!textEditor(b) && b.ui.src.contains(target);
        const inInput = (b, target) => b && (b.mode === 'code' || b.mode === 'math') && target === b.ui.input;

        root.addEventListener('compositionstart', () => {
            composing = true;
            clearRange(active);
            hideBubble();
            notifySelection();
        });

        root.addEventListener('compositionend', (e) => {
            composing = false;
            const b = active;
            if (inSource(b, e.target)) handleInput('insertCompositionText');
            else if (inInput(b, e.target)) commitParts(b, 'insert');
        });

        root.addEventListener('beforeinput', (e) => {
            const b = active;
            const source = inSource(b, e.target);
            if (!source && !inInput(b, e.target)) return;
            if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
                e.preventDefault();
                if (e.inputType === 'historyUndo') editor.undo();
                else editor.redo();
                return;
            }
            if (!source || composing || e.isComposing) return;
            // Typing goes into the open cell, the selected cells are let go
            clearRange(b);
            // Usually handled on keydown; this catches virtual keyboards
            if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
                e.preventDefault();
                if (!(onKey && onKey('Enter'))) handleEnter(e.inputType === 'insertLineBreak');
            } else if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward') {
                handleDeleteKey(e, e.inputType === 'deleteContentBackward');
            }
        });

        root.addEventListener('input', (e) => {
            const b = active;
            if (!b) return;
            if (inSource(b, e.target)) {
                if (!composing && !e.isComposing) handleInput(e.inputType);
            } else if (inInput(b, e.target)) {
                if (b.mode === 'code') {
                    paintCodeQuickly(b.ui);
                    queueHtmlPreview(b.ui);
                } else {
                    sizeMath(b.ui);
                    clearTimeout(b.ui.timer);
                    b.ui.timer = setTimeout(() => paintMath(b.ui), MATH_PREVIEW_DELAY);
                }
                if (!composing && !e.isComposing) commitParts(b, historyKind(e.inputType));
            }
        });

        root.addEventListener('paste', (e) => {
            const b = active;
            if (!inSource(b, e.target)) return;
            e.preventDefault();
            clearRange(b);
            const data = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
            if (data) insertText(data.replace(/\r\n?/g, '\n'), 'paste');
        });

        root.addEventListener('copy', (e) => copyCells(e, false));
        root.addEventListener('cut', (e) => copyCells(e, true));

        root.addEventListener('drop', (e) => {
            if (e.dataTransfer && e.dataTransfer.files.length) e.preventDefault();
        });

        root.addEventListener('scroll', (e) => {
            const b = active;
            if (b && b.mode === 'code' && e.target === b.ui.input) b.ui.input.previousElementSibling.scrollLeft = b.ui.input.scrollLeft;
        }, true);

        root.addEventListener('keydown', (e) => {
            keyboardCaret = true;
            const b = active;
            if (e.defaultPrevented || !b || !b.ui) return;
            const source = inSource(b, e.target);
            const field = inInput(b, e.target) || (b.mode === 'code' && e.target === b.ui.lang);
            if (!source && !field) return;
            if (e.isComposing || composing || e.keyCode === 229) return;
            // Selected cells take a few keys (and Shift+arrows select them)
            if (source && b.mode === 'table' && cellKey(e, b)) {
                e.preventDefault();
                return;
            }
            const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
            // The slash menu and the selection toolbar get their keys first
            if (source && plain && onKey && onKey(e.key)) {
                e.preventDefault();
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                stopEditing(true);
                return;
            }
            // Ctrl+Enter: an empty line under the block
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                flush();
                if (active === b) insertBelow(b);
                return;
            }
            // The language chip is a button (live-tools.js opens its menu)
            if (e.target === b.ui.lang) return;
            switch (e.key) {
                case 'Enter':
                    if (source && plain) {
                        e.preventDefault();
                        flush();
                        if (active === b) handleEnter(e.shiftKey);
                    }
                    break;
                case 'Backspace':
                case 'Delete':
                    if (source && !e.shiftKey && !e.metaKey) handleDeleteKey(e, e.key === 'Backspace');
                    break;
                case 'ArrowUp':
                case 'ArrowDown':
                    if (plain && !e.shiftKey) handleArrow(e);
                    break;
                case 'ArrowLeft':
                case 'ArrowRight':
                    if (!e.shiftKey && !e.metaKey) handleArrow(e);
                    break;
                case 'Tab':
                    if (source && b.mode === 'table' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                        e.preventDefault();
                        flush();
                        if (active === b) cellTab(b, e.shiftKey);
                    }
                    break;
                default:
                    break;
            }
        });

        scroller.addEventListener('pointerdown', () => {
            keyboardCaret = false;
        }, true);

        // In the table being edited, a press on another cell opens that
        // cell; after a press elsewhere in the table (its border, its
        // scrollbar) focus goes back to the open cell. Ctrl/⌘ + click still
        // follows a link. Dragging on to other cells, or Shift+click,
        // selects cells (see "Selecting cells").
        root.addEventListener('mousedown', (e) => {
            const b = active;
            if (e.button !== 0 || !b || b.mode !== 'table' || !b.el.contains(e.target)) return;
            if ((e.ctrlKey || e.metaKey) && e.target.closest('a[href]')) return;
            const td = e.target.closest('td, th');
            if (!td || !b.ui.table.contains(td)) {
                requestAnimationFrame(() => {
                    const src = active === b && b.mode === 'table' ? b.ui.src : null;
                    if (src && !src.contains(document.activeElement)) src.focus({ preventScroll: true });
                });
                return;
            }
            const r = td.parentElement.rowIndex;
            const c = td.cellIndex;
            if (e.shiftKey && b.ui.cell && (td !== b.ui.td || b.ui.range) && c < b.ui.parsed.cols) {
                e.preventDefault();
                flush();
                if (active !== b || b.mode !== 'table') return;
                setRange(b, r, c);
                cellDrag = { b, native: false, at: null };
                return;
            }
            clearRange(b);
            // In the open cell's text the browser selects it (a press
            // beside it, in the cell's padding, puts the caret there)
            if (td === b.ui.td && b.ui.src && b.ui.src.contains(e.target)) {
                cellDrag = { b, native: true, at: null };
                return;
            }
            e.preventDefault();
            flush();
            if (active !== b || b.mode !== 'table') return;
            clickCell(b, td, e.clientX, e.clientY);
            const s = active === b && b.mode === 'table' && b.ui.src ? readSelection(b.ui.src) : null;
            cellDrag = s ? { b, native: false, at: s.start } : null;
        });

        // The button held down after that press: over another cell the cells
        // between are selected; back over the open cell its text is (the
        // browser does that only when the press was in the open cell)
        window.addEventListener('mousemove', (e) => {
            const drag = cellDrag;
            if (!drag) return;
            const b = active;
            if (!(e.buttons & 1) || b !== drag.b || b.mode !== 'table' || !b.ui.cell) {
                endCellDrag();
                return;
            }
            const { r, c } = cellFromPoint(b, e.clientX, e.clientY);
            if (r !== b.ui.cell.r || c !== b.ui.cell.c) setRange(b, r, c, drag.at);
            else clearRange(b);
            if (!b.ui.range && !drag.native && drag.at !== null) writeSelection(b.ui.src, drag.at, offsetAtPoint(b.ui.src, e.clientX, e.clientY));
        });

        function endCellDrag() {
            const drag = cellDrag;
            cellDrag = null;
            if (!drag) return;
            // (the click that follows lands wherever the button was let go,
            // perhaps on another block)
            cellDragEnded = true;
            setTimeout(() => { cellDragEnded = false; });
            const b = active;
            // The open cell keeps only its caret (not what the drag selected in it)
            if (b === drag.b && b.mode === 'table' && b.ui.range && b.ui.src) writeSelection(b.ui.src, b.ui.range.at, b.ui.range.at);
        }

        window.addEventListener('mouseup', endCellDrag);

        scroller.addEventListener('click', (e) => {
            // Only the document and the margins around it (not the block handle)
            if (e.defaultPrevented || e.button !== 0 || (e.target !== scroller && !root.contains(e.target))) return;
            if (cellDragEnded) return;
            const el = e.target.closest('.lv-block');
            const b = el && byElement.get(el);
            // An image of an image block: that one is selected
            const img = b && b.kind === 'image' && !e.target.closest('.lv-img-handle') ? e.target.closest('img') : null;
            if (img && blocks.includes(b)) {
                flush();
                if (b.el.isConnected && blocks.includes(b)) selectImageAt(b, img);
                return;
            }
            if (b && b === active) return;
            // An HTML block's frame is for using the HTML; its toolbar has 编辑源码
            if (e.target.closest('.html-block')) return;
            const check = e.target.closest('input.task-check');
            if (check && b) {
                e.preventDefault();
                toggleTask(b, Array.from(el.querySelectorAll('input.task-check')).indexOf(check));
                return;
            }
            // Links open with Ctrl/⌘ (handled by the app); a plain click edits
            if (e.target.closest('a[href]')) e.preventDefault();
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed && el && el.contains(selection.anchorNode)) return;
            flush();
            if (b && b.el.isConnected && blocks.includes(b)) activateAt(b, e.clientX, e.clientY);
            else clickBetween(e.clientX, e.clientY);
        });

        // Tabbing into the document starts editing where the caret was
        scroller.addEventListener('focus', (e) => {
            if (ignoreFocus || e.target !== scroller || !scroller.matches(':focus-visible')) return;
            editing = true;
            flush();
            placeCaret();
        });

        function scheduleCapture() {
            if (!visible || !active || selectionFrame) return;
            selectionFrame = requestAnimationFrame(() => {
                selectionFrame = 0;
                if (!active || composing) return;
                if (captureSelection()) {
                    notifyCaret();
                    updateBubble();
                    updateSlash(false);
                    if (keyboardCaret && settings.typewriter) revealCaret();
                }
                notifySelection();
            });
        }

        document.addEventListener('selectionchange', () => {
            markCaretLines();
            if (visible && !composing) markImage();
            scheduleCapture();
        });
        // Selection changes inside a textarea don't reach the document everywhere
        root.addEventListener('keyup', scheduleCapture);
        root.addEventListener('mouseup', scheduleCapture);

        window.addEventListener('resize', hideBubble);

        // The view got shorter (on a phone: the on-screen keyboard came up,
        // or the quick bar): keep the caret in sight
        if ('ResizeObserver' in window) {
            let viewHeight = 0;
            new ResizeObserver(() => {
                const height = scroller.clientHeight;
                if (height < viewHeight && visible && editing && active) revealCaret();
                viewHeight = height;
            }).observe(scroller);
        }

        // --- Public API ---------------------------------------------------------

        return {
            update,

            show({ focus } = {}) {
                visible = true;
                if (text !== editor.getValue()) rebuild();
                if (focus) {
                    editing = true;
                    placeCaret();
                    revealCaret(true);
                }
            },

            hide() {
                flush();
                stopEditing(false);
                visible = false;
            },

            stopEditing,

            // The headings for the outline, from the blocks (as
            // MDE.headingsOf has them); null while the blocks are behind
            headings() {
                if (!visible || text !== editor.getValue()) return null;
                return blocks.filter((b) => b.kind === 'heading').map((b) => {
                    const lineEnd = text.indexOf('\n', b.start);
                    return { level: b.depth, start: b.start, end: lineEnd === -1 || lineEnd > b.end ? b.end : lineEnd, token: b.token };
                });
            },

            // Start (or go back to) editing where the document's caret is
            focus() {
                if (!visible) return;
                editing = true;
                flush();
                placeCaret();
            },

            // Take the selection in the text into the document now, before
            // focus moves elsewhere (into the command palette)
            captureSelection() {
                if (visible) captureSelection();
            },

            // Before a toolbar command: the command works on the document's
            // selection, so an empty line opened with Enter is made real
            // first. In a table cell, commands that work on whole lines
            // would break the table: headings and quotes do nothing, lists
            // put their markers in the cell (both answer false: the command
            // is done), and new blocks go under the table.
            beforeCommand(name) {
                if (!visible) return true;
                editing = true;
                flush();
                captureSelection();
                const b = active;
                if (b && b.mode === 'table') {
                    // (on the open cell, not on the selected cells)
                    clearRange(b);
                    if (LIST_COMMANDS.has(name) && b.ui.cell) cellList(b, name);
                    if (LINE_COMMANDS.has(name) || LIST_COMMANDS.has(name)) return false;
                    if (BLOCK_COMMANDS.has(name)) editor.select(b.end, b.end);
                }
                if (b && b.gap) {
                    const pad = gapPadding(b.pos);
                    const at = b.pos + pad.lead.length;
                    if (pad.lead || pad.trail) editor.replaceRange(b.pos, b.pos, pad.lead + pad.trail, at, at, null);
                }
                // A command that turns the block into code or a formula
                // opens that block's editor
                structural = true;
                queueMicrotask(() => { structural = false; });
                return true;
            },

            // Slash menu: insert the chosen block, or forget the "/" once
            // the menu was closed some other way (it stays as text, unless
            // the "+" beside an empty line typed it); startSlash: the "+"
            applySlash,
            dismissSlash() {
                const b = active;
                const auto = slash && slash.auto;
                const el = slash && slash.el;
                slash = null;
                paintSlash(el);
                // Opened with the "+" button and closed unused (Esc, or a
                // click elsewhere): take the "/" away
                if (auto && editor.getValue() === auto && textEditor(b) && document.activeElement === b.ui.src) editor.undo();
            },
            startSlash,

            // Keep px of the view under the caret's line (0: stop): the
            // slash menu on phones. The view scrolls now, and when it gets
            // shorter (the on-screen keyboard); past the end of the
            // document too, while the room is kept.
            keepRoom(px) {
                roomBelow = px;
                scroller.style.paddingBottom = px ? px + 'px' : '';
                if (px && editing && active) revealCaret();
            },

            slashRect,
            selectionRect,
            selectionState,

            // The link bubble
            caretLink,
            linkOf,

            // The language menu of the code block being edited
            setCodeLanguage(lang) {
                flush();
                setCodeLanguage(lang);
            },

            // The table toolbar: the caret's cell, or the selected cells
            // (range; align is theirs when all their columns have the same
            // one, null counting as left, else 'mixed')
            tableState() {
                const b = active;
                if (!visible || !b || b.mode !== 'table' || !b.ui.cell || document.activeElement !== b.ui.src) return null;
                const { r, c } = b.ui.cell;
                const { align, cols } = b.ui.parsed;
                const range = rangeOf(b);
                let shared = align[c] || null;
                if (range) {
                    const list = align.slice(range.left, range.right + 1).map((a) => a || 'left');
                    shared = list.every((a) => a === list[0]) ? list[0] : 'mixed';
                }
                return { el: b.el, td: b.ui.td, align: shared, row: r, cols, range };
            },
            tableCommand(name) {
                flush();
                tableCommand(name);
            },

            // The image toolbar: the selected image of the image block being
            // edited (its box, alignment and width; full: it is as wide as
            // the text), while its source has focus
            imageState() {
                const sel = visible && !composing ? selectedImage() : null;
                if (!sel || document.activeElement !== sel.b.ui.src) return null;
                const { image, wrap } = sel;
                const full = wrap.getBoundingClientRect().width >= sel.b.ui.media.clientWidth - 0.5;
                return { el: sel.b.el, wrap, align: image.align, width: image.width, full, src: image.src, alt: image.alt };
            },
            // …its box, while focus is elsewhere (in the dialog that replaces it)
            imageRect() {
                const sel = visible ? selectedImage() : null;
                return sel ? onScreen(sel.wrap.getBoundingClientRect()) : null;
            },
            // name: left, center, right, width (value: a percentage),
            // replace (value: { src, alt }) or delete
            imageCommand(name, value) {
                flush();
                captureSelection();
                imageCommand(name, value);
            },

            // Annotations: the blocks that overlap [from, to) (where they
            // are, their kind, source and element, how they show, and the
            // open cell of a table being edited)…
            blocksIn(from, to) {
                const out = [];
                if (!visible) return out;
                for (let k = Math.max(0, countBefore(from + 1) - 1); k < blocks.length && blocks[k].start < to; k++) {
                    const b = blocks[k];
                    if (b.end <= from) continue;
                    const cell = b.mode === 'table' && b.ui.cell ? { r: b.ui.cell.r, c: b.ui.cell.c } : null;
                    out.push({ start: b.start, end: b.end, kind: b.kind, el: b.el, mode: b.mode, cell, source: sourceOf(b) });
                }
                return out;
            },
            // …and a range over the part of [from, to) in the source being
            // edited (a block's, or a table cell's), null when none is
            textRange(from, to) {
                const b = active;
                const src = textEditor(b);
                if (!visible || !src || b.gap) return null;
                const base = textBase(b);
                const start = Math.max(from, base) - base;
                const end = Math.min(to, base + src.textContent.length) - base;
                return start < end ? rangeIn(src, start, end) : null;
            },

            // The frame's 编辑源码: edit the HTML block, the caret at the
            // start of its code (the block stays where it is on screen)
            editFrame(frame) {
                flush();
                const b = blockOf(frame && frame.closest('.lv-block'));
                if (!b || b.gap) return;
                switchTo(b, true);
                editing = true;
                const at = b.mode === 'code' ? Math.min(b.start + b.ui.parts.open.length, b.end) : b.start;
                editor.select(at, at);
                applySelection();
                revealCaret();
            },

            // The block handle: blocks are named by their element
            blockInfo,
            activeElement: () => (active ? active.el : null),
            blockHtml(el) {
                const b = blockOf(el);
                return b && !b.gap ? entryFor(b).html : '';
            },
            insertBelow(el) {
                flush();
                const b = blockOf(el);
                if (b) insertBelow(b);
            },
            removeBlock(el) {
                flush();
                const b = blockOf(el);
                if (b) removeBlock(b);
            },
            replaceBlock(el, source, caret) {
                flush();
                const b = blockOf(el);
                if (b) replaceBlock(b, source, caret);
            },
            moveBlock(el, index) {
                flush();
                const b = blockOf(el);
                if (b) moveBlock(b, index);
            },

            // highlight.js or KaTeX arrived: render what was waiting for them
            refreshLibraries() {
                cache.clear();
                blocks.forEach((b) => {
                    if (b.mode === 'rendered' && b.entry && (b.entry.needs.math || b.entry.needs.code)) renderBlock(b);
                });
                if (active && active.mode === 'code') paintCode(active.ui);
                if (active && active.mode === 'math') paintMath(active.ui);
                if (active && active.mode === 'table') repaintCells(active);
                updateBubble();
                tocKey = '';
                refreshHeadings();
            },

            setFocusMode(on) {
                settings.focusMode = on;
                markActive();
            },

            setTypewriter(on) {
                settings.typewriter = on;
                root.dataset.typewriter = on ? 'on' : 'off';
                if (on && active) revealCaret(true);
            }
        };
    };
})(window.MDE = window.MDE || {});
