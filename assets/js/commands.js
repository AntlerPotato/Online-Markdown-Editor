// Formatting commands that rewrite the Markdown source around the selection.
(function (MDE) {
    const INLINE = {
        bold: { marker: '**', placeholder: '粗体文本', re: /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g },
        italic: { marker: '*', placeholder: '斜体文本', re: /(?<![*\\])\*(?![\s*])(.+?)(?<![\s*\\])\*(?!\*)|(?<![\w\\])_(?![\s_])(.+?)(?<![\s_\\])_(?!\w)/g },
        strike: { marker: '~~', placeholder: '删除线文本', re: /~~(?=\S)(.+?)(?<=\S)~~/g },
        highlight: { marker: '==', placeholder: '高亮文本', re: /==(?=\S)(.+?)(?<=\S)==/g },
        code: { marker: '`', placeholder: '代码', re: /(?<!`)`(?!`)([^`\n]+?)`(?!`)/g },
        math: { marker: '$', placeholder: 'E=mc^2', re: /(?<![$\\])\$(?!\$)([^$\n]+?)\$(?!\$)/g }
    };

    // What "clear formatting" takes apart: every inline wrap, then links
    // (their text stays). Images are left alone.
    const CLEARABLE = ['code', 'math', 'bold', 'strike', 'highlight', 'italic']
        .map((name) => ({ re: INLINE[name].re, len: INLINE[name].marker.length }))
        .concat({ re: /(?<![!\\])\[([^\]\n]*)\]\([^)\n]*\)/g, link: true });

    const LIST_PREFIX = /^(\s*)(?:[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d{1,9}[.)][ \t]+)/;
    const LISTS = {
        ul: { test: /^\s*[-*+][ \t]+(?!\[[ xX]\][ \t])/, prefix: () => '- ', placeholder: '列表项' },
        ol: { test: /^\s*\d{1,9}[.)][ \t]+/, prefix: (n) => `${n + 1}. `, placeholder: '列表项' },
        task: { test: /^\s*[-*+][ \t]+\[[ xX]\][ \t]+/, prefix: () => '- [ ] ', placeholder: '任务项' }
    };

    const lineStartOf = (value, pos) => (pos <= 0 ? 0 : value.lastIndexOf('\n', pos - 1) + 1);

    // A kind of list on some lines: added to all of them (replacing another
    // kind), or taken off when they all have it already. Also used for the
    // lines of a table cell in live mode.
    MDE.toggleListLines = function (lines, kind) {
        const spec = LISTS[kind];
        const filled = lines.filter((line) => line.trim());
        const allOn = filled.length > 0 && filled.every((line) => spec.test.test(line));
        let n = 0;
        const out = lines.map((line) => {
            if (!line.trim() && lines.length > 1) return line;
            const m = LIST_PREFIX.exec(line);
            const indent = m ? m[1] : line.match(/^\s*/)[0];
            const body = m ? line.slice(m[0].length) : line.slice(indent.length);
            return allOn ? indent + body : indent + spec.prefix(n++) + body;
        });
        return { lines: out, on: !allOn, placeholder: spec.placeholder };
    };

    MDE.createCommands = function (editor) {
        // --- Inline wraps ---------------------------------------------------

        // The marked-up span (e.g. **text**) containing the selection, if any
        function findSpan(name, value, start, end) {
            if (value.slice(start, end).includes('\n')) return null;
            const { re, marker } = INLINE[name];
            const lineStart = lineStartOf(value, start);
            let lineEnd = value.indexOf('\n', end);
            if (lineEnd === -1) lineEnd = value.length;
            const line = value.slice(lineStart, lineEnd);

            re.lastIndex = 0;
            let m;
            while ((m = re.exec(line))) {
                const from = lineStart + m.index;
                const to = from + m[0].length;
                const inside = (start > from && end < to) || (start === from && end === to && start !== end);
                if (inside) {
                    const len = marker.length;
                    return { from, to, inner: m[0].slice(len, m[0].length - len), len };
                }
            }
            return null;
        }

        function toggleInline(name) {
            const { start, end, value } = editor.getSelection();
            const span = findSpan(name, value, start, end);

            if (span) {
                const shift = (pos) => Math.min(Math.max(pos - span.len, span.from), span.from + span.inner.length);
                editor.replaceRange(span.from, span.to, span.inner, shift(start), shift(end));
                return;
            }

            // Keep surrounding whitespace outside the markers
            const { marker, placeholder } = INLINE[name];
            const raw = value.slice(start, end);
            const lead = raw.length - raw.trimStart().length;
            const trail = raw.length - raw.trimEnd().length;
            const text = raw.trim() || placeholder;
            const from = raw.trim() ? start + lead : start;
            const to = raw.trim() ? end - trail : end;
            editor.replaceRange(from, to, marker + text + marker, from + marker.length, from + marker.length + text.length);
        }

        function isActive(name) {
            const { start, end, value } = editor.getSelection();
            return !!findSpan(name, value, start, end);
        }

        // Remove the inline formatting in the selection: every wrap that
        // overlaps it (or holds the caret) is taken off, one at a time, so
        // nested ones like ***text*** come apart too
        function clearInline() {
            const { start, end, value } = editor.getSelection();
            const lineStart = lineStartOf(value, start);
            let lineEnd = value.indexOf('\n', end);
            if (lineEnd === -1) lineEnd = value.length;
            let text = value.slice(lineStart, lineEnd);
            let from = start - lineStart;
            let to = end - lineStart;

            const unwrapOne = () => {
                for (const { re, len, link } of CLEARABLE) {
                    re.lastIndex = 0;
                    let m;
                    while ((m = re.exec(text))) {
                        const a = m.index;
                        const z = a + m[0].length;
                        if (a >= to || z <= from) continue;
                        const inner = link ? m[1] : m[0].slice(len, m[0].length - len);
                        const lead = link ? 1 : len;
                        const map = (pos) => (pos <= a ? pos
                            : pos >= z ? pos - (m[0].length - inner.length)
                            : Math.min(Math.max(pos - lead, a), a + inner.length));
                        text = text.slice(0, a) + inner + text.slice(z);
                        from = map(from);
                        to = map(to);
                        re.lastIndex = 0;
                        return true;
                    }
                }
                return false;
            };
            let changed = false;
            while (unwrapOne()) changed = true;
            if (changed) editor.replaceRange(lineStart, lineEnd, text, lineStart + from, lineStart + to);
        }

        // --- Line-based edits -----------------------------------------------

        function lineBlock() {
            const { start, end, value } = editor.getSelection();
            const from = lineStartOf(value, start);
            const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
            let to = value.indexOf('\n', last);
            if (to === -1) to = value.length;
            return { start, end, from, to, lines: value.slice(from, to).split('\n') };
        }

        function applyLines(block, out, placeholder) {
            const { start, end, from, to, lines } = block;

            // A single empty line gets placeholder text, selected for typing over
            if (placeholder && lines.length === 1 && !lines[0].trim() && out[0] !== lines[0]) {
                const text = out[0] + placeholder;
                editor.replaceRange(from, to, text, from + out[0].length, from + text.length);
                return;
            }

            const text = out.join('\n');
            if (lines.length === 1) {
                const delta = text.length - lines[0].length;
                const clamp = (pos) => Math.min(Math.max(pos + delta, from), from + text.length);
                editor.replaceRange(from, to, text, clamp(start), clamp(end));
            } else {
                editor.replaceRange(from, to, text, from, from + text.length);
            }
        }

        function headingLevel() {
            const { start, value } = editor.getSelection();
            const from = lineStartOf(value, start);
            const m = /^ {0,3}(#{1,6})(?:[ \t]|$)/.exec(value.slice(from, from + 8));
            return m ? m[1].length : 0;
        }

        function setHeading(level) {
            const block = lineBlock();
            const out = block.lines.map((line) => {
                const m = /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(line);
                const body = m ? line.slice(m[0].length) : line.replace(/^ {0,3}/, '');
                if (!level) return body;
                if (!body && block.lines.length > 1) return line;
                return '#'.repeat(level) + ' ' + body;
            });
            applyLines(block, out, level ? '标题' : '');
        }

        function toggleList(kind) {
            const block = lineBlock();
            const { lines, on, placeholder } = MDE.toggleListLines(block.lines, kind);
            applyLines(block, lines, on ? placeholder : '');
        }

        function toggleQuote() {
            const block = lineBlock();
            const filled = block.lines.filter((line) => line.trim());
            const allOn = filled.length > 0 && filled.every((line) => /^ {0,3}>/.test(line));
            const out = block.lines.map((line) => {
                if (allOn) return line.replace(/^ {0,3}> ?/, '');
                if (!line.trim()) return block.lines.length > 1 ? '>' : '> ';
                return '> ' + line;
            });
            applyLines(block, out, allOn ? '' : '引用内容');
        }

        // --- Block inserts --------------------------------------------------

        // Insert a block on its own lines, separated by blank lines
        function insertBlock(text, selectFrom, selectTo) {
            const { start, end, value } = editor.getSelection();
            const before = value.slice(0, start);
            const after = value.slice(end);
            const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
            const trail = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
            const base = start + lead.length;
            const selStart = base + (selectFrom === undefined ? text.length : selectFrom);
            const selEnd = base + (selectTo === undefined ? (selectFrom === undefined ? text.length : selectFrom) : selectTo);
            editor.replaceRange(start, end, lead + text + trail, selStart, selEnd);
        }

        function selectedOr(placeholder) {
            const { start, end, value } = editor.getSelection();
            return value.slice(start, end) || placeholder;
        }

        function codeBlock() {
            const open = '```javascript\n';
            const inner = selectedOr('代码内容');
            insertBlock(open + inner + '\n```', open.length, open.length + inner.length);
        }

        function mathBlock() {
            const inner = selectedOr('E=mc^2');
            insertBlock('$$\n' + inner + '\n$$', 3, 3 + inner.length);
        }

        function insertToc() {
            insertBlock('[TOC]');
        }

        function insertRule() {
            insertBlock('---');
        }

        function insertTable(rows, cols, align) {
            const delimiter = { left: ':---', center: ':---:', right: '---:' }[align] || '---';
            const header = Array.from({ length: cols }, (_, i) => `标题${i + 1}`);
            const lines = [
                '| ' + header.join(' | ') + ' |',
                '|' + Array(cols).fill(delimiter).join('|') + '|'
            ];
            for (let r = 1; r < rows; r++) {
                lines.push('| ' + Array(cols).fill('单元格').join(' | ') + ' |');
            }
            insertBlock(lines.join('\n'), 2, 2 + header[0].length);
        }

        function insertLink({ text, url, image, start, end }) {
            const label = text || (image ? '图片描述' : '链接文本');
            const target = /\s/.test(url) ? `<${url}>` : url;
            const markdown = `${image ? '!' : ''}[${label}](${target})`;
            const labelStart = start + (image ? 2 : 1);
            if (text) {
                editor.replaceRange(start, end, markdown);
            } else {
                editor.replaceRange(start, end, markdown, labelStart, labelStart + label.length);
            }
        }

        return {
            toggleInline,
            isActive,
            clearInline,
            headingLevel,
            setHeading,
            toggleList,
            toggleQuote,
            codeBlock,
            mathBlock,
            insertToc,
            insertRule,
            insertTable,
            insertLink
        };
    };
})(window.MDE = window.MDE || {});
