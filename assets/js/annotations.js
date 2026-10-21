// Annotations: notes on passages of the document ("这句太长，拆成两句"),
// kept in this browser beside it and copied out as text for an AI to act
// on. The parts here need no page: following a passage while the document
// is edited, the text of a passage as it shows once rendered (to find it
// in the rendered HTML), the section and line a passage is in, and the
// text that is copied.
(function (MDE) {
    const CONTEXT = 24;     // characters before a passage kept to tell repeats of its text apart

    // --- Following the text --------------------------------------------------

    // The smallest single replacement that turns a into b: [start, end) of
    // a becomes `length` characters
    function diff(a, b) {
        const max = Math.min(a.length, b.length);
        let p = 0;
        while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
        let s = 0;
        while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
        return { start: p, end: a.length - s, length: b.length - s - p };
    }

    // Where an edge of a passage goes when [start, end) is replaced. Text
    // typed at either edge stays outside the passage; an edge inside the
    // replaced stretch moves in proportion, so a passage in a paragraph
    // that was rewritten lands about where it was.
    function moveEdge(pos, change, isEnd) {
        const { start, end, length } = change;
        if (pos < start || (isEnd && pos === start)) return pos;
        if (pos >= end) return pos + length - (end - start);
        return start + Math.round(((pos - start) * length) / (end - start));
    }

    // The occurrence of a passage's text in text[lo, hi) after the text
    // that came before it last time (the nearest to `near` on a tie)
    function search(text, item, lo, hi, near) {
        const quote = item.quote;
        const before = item.before || '';
        lo = Math.max(0, lo);
        hi = Math.min(text.length, hi);
        let best = -1;
        let bestScore = -1;
        let bestDistance = Infinity;
        for (let i = text.indexOf(quote, lo); i !== -1 && i + quote.length <= hi; i = text.indexOf(quote, i + 1)) {
            let score = 0;
            while (score < before.length && i - 1 - score >= 0 && text[i - 1 - score] === before[before.length - 1 - score]) score++;
            const distance = Math.abs(i - near);
            if (score > bestScore || (score === bestScore && distance < bestDistance)) {
                best = i;
                bestScore = score;
                bestDistance = distance;
            }
        }
        return best;
    }

    // The passages after one change to the document (text is the new
    // document). A passage whose text went (deleted, or inside a stretch
    // that was replaced as a whole) is looked for in what came instead,
    // so undoing a deletion, or pasting a document over itself, finds it
    // again. Typing that goes on from a change to a passage's end (its
    // last words selected and typed over) stays in it: `typing` holds the
    // end of the passage the last change left the caret at.
    function follow(items, change, text) {
        const delta = change.length - (change.end - change.start);
        const caret = change.start + change.length;
        items.forEach((item) => {
            const { from, to } = item;
            const typing = item.typing === to;
            item.typing = null;
            if (typing && from < to && change.start === to && change.end === to) {
                item.to = item.typing = caret;
                item.quote = text.slice(from, item.to);
                return;
            }
            if (change.start > to || (change.start === to && from < to)) return;
            if (change.end < from - CONTEXT) {
                item.from += delta;
                item.to += delta;
                return;
            }
            let a = moveEdge(from, change, false);
            let z = Math.max(a, moveEdge(to, change, true));
            if (change.start < to && change.end > from && z === caret && a < z) item.typing = z;
            const swallowed = change.start <= from && change.end >= to && change.end - change.start > to - from;
            if ((a === z || swallowed) && item.quote && text.slice(a, z) !== item.quote) {
                const lo = Math.min(a, change.start) - item.quote.length;
                const hi = Math.max(z, change.start + change.length) + item.quote.length;
                const found = search(text, item, lo, hi, a);
                if (found !== -1) {
                    a = found;
                    z = found + item.quote.length;
                }
            }
            item.from = a;
            item.to = z;
            if (a < z) item.quote = text.slice(a, z);
            item.before = text.slice(Math.max(0, a - CONTEXT), a);
        });
    }

    // A stored passage against the stored document: when its text isn't
    // where it was (the document changed elsewhere), it is looked for in
    // the whole document; not found, it counts as deleted
    function relocate(item, text) {
        const clamp = (pos) => Math.min(text.length, Math.max(0, pos));
        item.from = clamp(item.from);
        item.to = Math.max(item.from, clamp(item.to));
        if (item.from === item.to || !item.quote || text.slice(item.from, item.to) === item.quote) return;
        const found = search(text, item, 0, text.length, item.from);
        if (found !== -1) {
            item.from = found;
            item.to = found + item.quote.length;
        } else {
            item.to = item.from;
        }
        item.before = text.slice(Math.max(0, item.from - CONTEXT), item.from);
    }

    // A passage's text and what came before it, when it is made
    function anchor(text, from, to) {
        return { from, to, quote: text.slice(from, to), before: text.slice(Math.max(0, from - CONTEXT), from) };
    }

    // The selection less the white space at its ends ([start, start] when
    // nothing else is selected)
    function trimSelection(text, start, end) {
        while (start < end && !text[start].trim()) start++;
        while (end > start && !text[end - 1].trim()) end--;
        return [start, end];
    }

    // --- The text a passage shows ---------------------------------------------
    // Rendered HTML has no offsets into the source, so a passage is found
    // there by its text: the characters of its source that show once it is
    // rendered (no Markdown markers), white space left out on both sides.

    const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', middot: '·', times: '×' };
    const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~=$<>]/;
    const isWordChar = (ch) => !!ch && /[\p{L}\p{N}_]/u.test(ch);

    const CODE = /(`+)(?!`)[^\n]*?[^`\n]\1(?!`)/y;
    const MATH = /(\$\$?)[^$\n]+?\1/y;
    const BOLD = /(\*\*|__)(?=\S).+?(?<=\S)\1/y;
    const ITALIC = /([*_])(?![\s*_]).+?(?<![\s*_])\1(?![*_])/y;
    const STRIKE = /(~~)(?=\S).+?(?<=\S)\1/y;
    const MARK = /(==)(?=\S).+?(?<=\S)\1/y;
    const IMAGE = /!\[[^\]\n]*\](?:\([^)\n]*\)|\[[^\]\n]*\])/y;
    const LINK = /\[([^\]\n]*)\](?:\([^)\n]*\)|\[[^\]\n]*\])/y;
    const AUTOLINK = /<((?:https?|ftp|mailto):[^\s<>]*|[^\s<>@]+@[^\s<>@]+)>/y;
    const TAG = /<!--[\s\S]*?-->|<\/?[A-Za-z][^<>\n]*>/y;
    const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]{2,8}));/y;

    const QUOTE_PREFIX = /^ {0,3}>[ \t]?(?:>[ \t]?)*/;
    const LIST_MARKER = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/;
    const ATX = /^ {0,3}#{1,6}(?=[ \t]|$)[ \t]*/;
    const ATX_CLOSE = /[ \t]+#+[ \t]*$/;
    const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
    const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
    const FENCE = /^ {0,3}(?:`{3,}|~{3,})/;
    const FENCE_CLOSE = /^ {0,3}(?:`{3,}|~{3,})[ \t]*$/;

    function decode(m) {
        if (m[3]) return ENTITIES[m[3]] || null;
        const code = m[1] ? parseInt(m[1], 10) : parseInt(m[2], 16);
        try { return String.fromCodePoint(code); } catch (e) { return null; }
    }

    // { text, pos }: the characters of a block's source (of the given
    // kind, as live.js names them; 'passage': any stretch of text) that
    // show once rendered, without white space (with it, when `spaces`),
    // and the offset of each in the source
    function visible(source, kind, spaces = false) {
        const chars = [];
        const pos = [];
        const keep = (ch, at) => {
            if (spaces || ch.trim()) {
                chars.push(ch);
                pos.push(at);
            }
        };
        const plain = (a, b) => {
            for (let i = a; i < b; i++) keep(source[i], i);
        };
        const at = (re, i, b) => {
            re.lastIndex = i;
            const m = re.exec(source);
            return m && i + m[0].length <= b ? m : null;
        };
        const eachLine = (fn) => {
            let start = 0;
            for (let index = 0; start <= source.length; index++) {
                let end = source.indexOf('\n', start);
                if (end === -1) end = source.length;
                fn(start, end, index, end === source.length);
                start = end + 1;
            }
        };

        function inline(a, b) {
            let i = a;
            while (i < b) {
                const ch = source[i];
                let m = null;
                if (ch === '\\') {
                    // At the end of a line it breaks the line
                    if (i + 1 === b) break;
                    if (ESCAPABLE.test(source[i + 1])) {
                        keep(source[i + 1], i + 1);
                        i += 2;
                        continue;
                    }
                } else if (ch === '`' || ch === '$') {
                    if ((m = at(ch === '`' ? CODE : MATH, i, b))) {
                        plain(i + m[1].length, i + m[0].length - m[1].length);
                        i += m[0].length;
                        continue;
                    }
                } else if (ch === '*' || ch === '_' || ch === '~' || ch === '=') {
                    const emphasis = ch === '*' || (ch === '_' && !isWordChar(source[i - 1]));
                    m = emphasis ? at(BOLD, i, b) || at(ITALIC, i, b) : ch === '~' ? at(STRIKE, i, b) : ch === '=' ? at(MARK, i, b) : null;
                    if (m) {
                        inline(i + m[1].length, i + m[0].length - m[1].length);
                        i += m[0].length;
                        continue;
                    }
                } else if (ch === '!' && source[i + 1] === '[') {
                    if ((m = at(IMAGE, i, b))) {
                        i += m[0].length;
                        continue;
                    }
                } else if (ch === '[') {
                    if ((m = at(LINK, i, b))) {
                        inline(i + 1, i + 1 + m[1].length);
                        i += m[0].length;
                        continue;
                    }
                } else if (ch === '<') {
                    if ((m = at(AUTOLINK, i, b))) {
                        plain(i + 1, i + 1 + m[1].length);
                        i += m[0].length;
                        continue;
                    }
                    if ((m = at(TAG, i, b))) {
                        i += m[0].length;
                        continue;
                    }
                } else if (ch === '&') {
                    const decoded = (m = at(ENTITY, i, b)) && decode(m);
                    if (decoded) {
                        keep(decoded, i);
                        i += m[0].length;
                        continue;
                    }
                } else if (ch === '|' && kind === 'table') {
                    i++;
                    continue;
                }
                keep(ch, i);
                i++;
            }
        }

        // HTML: the text between the tags
        function html(a, b) {
            let i = a;
            while (i < b) {
                const m = source[i] === '<' ? at(TAG, i, b) : source[i] === '&' ? at(ENTITY, i, b) : null;
                if (m && m[0][0] === '<') {
                    i += m[0].length;
                } else if (m && decode(m)) {
                    keep(decode(m), i);
                    i += m[0].length;
                } else {
                    keep(source[i], i);
                    i++;
                }
            }
        }

        switch (kind) {
            case 'hr':
            case 'def':
            case 'toc':
            case 'image':
                break;
            case 'code':
                plain(0, source.length);
                break;
            case 'html':
                html(0, source.length);
                break;
            case 'fence':
            case 'math':
                if (FENCE.test(source)) {
                    // The code between the fences
                    eachLine((a, b, index, last) => {
                        if (index > 0 && !(last && FENCE_CLOSE.test(source.slice(a, b)))) plain(a, b);
                    });
                } else {
                    // The TeX between the $$
                    const open = source.indexOf('$$');
                    const close = source.lastIndexOf('$$');
                    if (open !== -1 && close > open) plain(open + 2, close);
                }
                break;
            default: {
                const any = kind === 'passage';
                eachLine((a, b, index, last) => {
                    const line = source.slice(a, b);
                    let m;
                    if ((kind === 'table' || any) && TABLE_DELIMITER.test(line) && line.includes('-')) return;
                    if ((kind === 'heading' || any) && index > 0 && SETEXT.test(line)) return;
                    if ((kind === 'quote' || any) && (m = QUOTE_PREFIX.exec(line))) a += m[0].length;
                    if ((kind === 'list' || kind === 'quote' || any) && (m = LIST_MARKER.exec(source.slice(a, b)))) a += m[0].length;
                    if (((kind === 'heading' && index === 0) || any) && (m = ATX.exec(source.slice(a, b)))) {
                        a += m[0].length;
                        const close = ATX_CLOSE.exec(source.slice(a, b));
                        if (close) b -= close[0].length;
                    }
                    inline(a, b);
                    if (spaces && !last) keep(' ', b);
                });
            }
        }
        return { text: chars.join(''), pos };
    }

    // A passage as it reads, for the panel: no Markdown markers, its
    // lines joined
    function plain(source) {
        return visible(source, 'passage', true).text.replace(/\s+/g, ' ').trim();
    }

    // The part of a visible text that comes from source [from, to), and
    // how many times that text shows before it (to find the same one in
    // the rendered text). Null when none of it shows.
    function needle(vis, from, to) {
        let s = 0;
        while (s < vis.pos.length && vis.pos[s] < from) s++;
        let e = s;
        while (e < vis.pos.length && vis.pos[e] < to) e++;
        if (e === s) return null;
        const text = vis.text.slice(s, e);
        let count = 0;
        for (let i = vis.text.indexOf(text); i !== -1 && i < s; i = vis.text.indexOf(text, i + 1)) count++;
        return { text, count };
    }

    // The index of the count-th occurrence of text in haystack (the last
    // one before it when there aren't that many; -1: none)
    function nth(haystack, text, count) {
        let found = -1;
        for (let i = haystack.indexOf(text), k = 0; i !== -1 && k <= count; i = haystack.indexOf(text, i + 1), k++) found = i;
        return found;
    }

    // --- Where a passage is, and the copied text ----------------------------------

    // The headings a position is under, outermost first (their texts). A
    // lone level-1 heading at the top of the headings is the document's
    // title, not a section.
    function sectionOf(headings, pos) {
        const title = headings.length && headings[0].level === 1 && headings.filter((h) => h.level === 1).length === 1 ? headings[0] : null;
        const path = [];
        for (const h of headings) {
            if (h.start > pos) break;
            if (h === title) continue;
            while (path.length && path[path.length - 1].level >= h.level) path.pop();
            path.push(h);
        }
        return path.map((h) => h.text || '（空标题）');
    }

    // Line numbers (from 1) of positions in a text
    function linesOf(text, positions) {
        const order = positions.map((pos, i) => [pos, i]).sort((x, y) => x[0] - y[0]);
        const out = new Array(positions.length);
        let line = 1;
        let at = 0;
        order.forEach(([pos, i]) => {
            for (let n = text.indexOf('\n', at); n !== -1 && n < pos; n = text.indexOf('\n', n + 1)) {
                line++;
                at = n + 1;
            }
            out[i] = line;
        });
        return out;
    }

    // What "复制全部标注" copies, for an AI: a heading with the count and
    // the file's name, then each passage's number, section, line, text
    // (its Markdown) and what to change.
    // entries: [{ n, path, line, quote, note }]
    function format(name, entries) {
        const out = [`# 标注 ${entries.length} 条 · ${name}`];
        entries.forEach((e) => {
            out.push('', `## ${e.n} · ${e.path.concat(`第 ${e.line} 行`).join(' › ')}`, `原文：${e.quote}`, `修改：${e.note}`);
        });
        return out.join('\n');
    }

    MDE.annotations = { diff, follow, relocate, anchor, trimSelection, visible, plain, needle, nth, sectionOf, linesOf, format };
})(window.MDE = window.MDE || {});
