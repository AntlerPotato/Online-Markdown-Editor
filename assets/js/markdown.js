// Markdown rendering: marked + highlight.js + KaTeX, with [TOC] support.
(function (MDE) {
    const ICON_COPY = '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';
    const ICON_TOC = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M8 12h12"/><path d="M8 18h12"/></svg>';

    // Fenced code and inline code are matched first so a "$" inside code is
    // left alone; anything else shaped like $…$ or $$…$$ is treated as math.
    const MATH_RE = new RegExp([
        String.raw`(^ {0,3}(\`{3,}|~{3,})[^\n]*(?:\n[\s\S]*?)??(?:\n {0,3}\2[\`~]*[ \t]*(?=\n|(?![\s\S]))|(?![\s\S])))`,
        String.raw`((\`+)(?!\`)[^\n]*?[^\`\n]\4(?!\`))`,
        String.raw`(\$\$[\s\S]*?\$\$|\$[^\n\r$]+?\$)`
    ].join('|'), 'gm');

    const KATEX_OPTIONS = {
        delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
        ],
        throwOnError: false,
        errorColor: '#cc0000',
        strict: false,
        trust: false,
        macros: {
            '\\RR': '\\mathbb{R}',
            '\\NN': '\\mathbb{N}',
            '\\ZZ': '\\mathbb{Z}',
            '\\QQ': '\\mathbb{Q}',
            '\\CC': '\\mathbb{C}'
        }
    };

    const escapeHtml = (text) => String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    function countNewlines(text, from, to) {
        let count = 0;
        for (let i = text.indexOf('\n', from); i !== -1 && i < to; i = text.indexOf('\n', i + 1)) count++;
        return count;
    }

    // --- Renderer -----------------------------------------------------------

    const renderer = new marked.Renderer();
    let headings = [];
    let usedIds = Object.create(null);

    // ==highlight==
    renderer.text = function (text) {
        return text.replace(/==(.*?)==/g, '<mark>$1</mark>');
    };

    // Headings get ids (for the TOC and in-page links)
    renderer.heading = function (text, level) {
        // Keep math placeholders in the TOC label so formulas render there too
        const label = text.replace(/<(?!!--MATH_BLOCK_)[^>]*>/g, '');
        const plain = label.replace(/<!--MATH_BLOCK_\d+-->/g, '').replace(/&[#\w]+;/g, ' ');
        let id = plain.toLowerCase().replace(/[^\w\u4E00-\u9FA5]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
        if (usedIds[id]) {
            id = `${id}-${usedIds[id]++}`;
        } else {
            usedIds[id] = 1;
        }
        headings.push({ level, id, label });
        return `<h${level} id="${id}">${text}</h${level}>\n`;
    };

    // Code blocks: language label, copy button, line numbers
    renderer.code = function (code, infostring) {
        const language = ((infostring || '').match(/^\S*/) || [''])[0];
        if (language === 'math') {
            return `<div class="math-block">$$${escapeHtml(code)}$$</div>\n`;
        }

        const source = code.replace(/\n$/, '');
        let highlighted;
        let detected = '';
        try {
            if (language && hljs.getLanguage(language)) {
                highlighted = hljs.highlight(source, { language, ignoreIllegals: true }).value;
            } else {
                const result = hljs.highlightAuto(source);
                highlighted = result.value;
                detected = result.language || '';
            }
        } catch (e) {
            highlighted = escapeHtml(source);
        }

        const label = language || detected || 'text';
        const lineNumbers = source.split('\n').map((_, i) => i + 1).join('\n');
        return '<div class="code-block">'
            + `<div class="code-block-head"><span class="code-lang">${escapeHtml(label)}</span>`
            + `<button type="button" class="code-copy" aria-label="复制代码">${ICON_COPY}<span>复制</span></button></div>`
            + `<div class="code-block-body"><div class="line-numbers" aria-hidden="true">${lineNumbers}</div>`
            + `<pre class="code-content"><code class="hljs${language ? ' language-' + escapeHtml(language) : ''}">${highlighted}</code></pre></div>`
            + '</div>\n';
    };

    renderer.list = function (body, ordered, start) {
        const type = ordered ? 'ol' : 'ul';
        const startAttr = (ordered && start !== 1) ? ` start="${start}"` : '';
        return `<${type}${startAttr}>\n${body}</${type}>\n`;
    };

    // marked already puts the checkbox into `text` for task items
    renderer.listitem = function (text, task, checked) {
        if (task) {
            return `<li class="task-list-item${checked ? ' is-done' : ''}">${text}</li>\n`;
        }
        return `<li>${text}</li>\n`;
    };

    renderer.checkbox = function (checked) {
        return `<input type="checkbox" class="task-check" disabled${checked ? ' checked' : ''}>`;
    };

    // Tables scroll inside a rounded wrapper
    renderer.table = function (header, body) {
        return '<div class="table-wrap"><table>\n'
            + `<thead>\n${header}</thead>\n`
            + (body ? `<tbody>${body}</tbody>` : '')
            + '</table></div>\n';
    };

    marked.setOptions({
        renderer,
        gfm: true,
        breaks: true
    });

    // --- Table of contents --------------------------------------------------

    function buildToc() {
        if (headings.length === 0) return '';
        let html = `<nav class="toc" aria-label="目录"><div class="toc-title">${ICON_TOC}目录</div>`;
        const stack = [];
        headings.forEach((item) => {
            if (!stack.length) {
                html += '<ul><li>';
                stack.push(item.level);
            } else if (item.level > stack[stack.length - 1]) {
                html += '<ul><li>';
                stack.push(item.level);
            } else {
                while (stack.length > 1 && item.level < stack[stack.length - 1]) {
                    html += '</li></ul>';
                    stack.pop();
                }
                if (item.level > stack[stack.length - 1]) {
                    html += '<ul><li>';
                    stack.push(item.level);
                } else {
                    html += '</li><li>';
                }
            }
            html += `<a href="#${item.id}">${item.label}</a>`;
        });
        html += '</li></ul>'.repeat(stack.length) + '</nav>';
        return html;
    }

    // --- Math placeholders --------------------------------------------------

    // Math is swapped for HTML comments before parsing so marked cannot mangle
    // it, then restored afterwards for KaTeX. `shifts` records how many
    // newlines each placeholder swallowed, to map parsed lines back to source.
    function extractMath(source) {
        const blocks = [];
        const shifts = [];
        let removed = 0;
        let line = 0;
        let scanned = 0;

        const text = source.replace(MATH_RE, (match, fence, fenceMark, code, ticks, math, offset) => {
            if (!math) return match;

            line += countNewlines(source, scanned, offset);
            scanned = offset;
            const newlines = countNewlines(match, 0, match.length);
            if (newlines) {
                shifts.push({ line: line - removed, count: newlines });
                removed += newlines;
            }

            // $$…$$ written on a single line is rendered as inline math
            let processed = match;
            if (match.startsWith('$$') && !match.includes('\n')) {
                processed = '$' + match.substring(2, match.length - 2) + '$';
            }
            const index = blocks.push(processed) - 1;
            return `<!--MATH_BLOCK_${index}-->`;
        });

        return { text, blocks, shifts };
    }

    function restoreMath(html, blocks) {
        return html.replace(/<p>\s*<!--MATH_BLOCK_(\d+)-->\s*<\/p>|<!--MATH_BLOCK_(\d+)-->/g, (full, inParagraph, inline) => {
            return escapeHtml(blocks[parseInt(inParagraph || inline, 10)]);
        });
    }

    // Source line (0-based) of every top-level heading, in document order
    function headingSourceLines(tokens, shifts) {
        const lines = [];
        let line = 0;
        tokens.forEach((token) => {
            if (token.type === 'heading') {
                let source = line;
                shifts.forEach((shift) => {
                    if (shift.line < line) source += shift.count;
                });
                lines.push(source);
            }
            line += countNewlines(token.raw || '', 0, Infinity);
        });
        return lines;
    }

    // --- Public API ---------------------------------------------------------

    function render(source) {
        headings = [];
        usedIds = Object.create(null);

        const { text, blocks, shifts } = extractMath(source);
        const tokens = marked.lexer(text);
        const headingLines = headingSourceLines(tokens, shifts);
        let html = marked.parser(tokens);

        if (html.includes('[TOC]')) {
            const toc = buildToc();
            html = html
                .replace(/<p>\[TOC\]<\/p>/g, toc)
                .replace(/<p>\[TOC\]<br>\n?/g, toc + '<p>');
        }

        html = restoreMath(html, blocks);
        return { html, headingLines };
    }

    function renderInto(element, source) {
        const { html, headingLines } = render(source);
        element.innerHTML = html;

        if (window.renderMathInElement) {
            try {
                renderMathInElement(element, KATEX_OPTIONS);
            } catch (e) {
                console.warn('KaTeX rendering error:', e);
            }
        }
        return headingLines;
    }

    MDE.markdown = { render, renderInto };
})(window.MDE = window.MDE || {});
