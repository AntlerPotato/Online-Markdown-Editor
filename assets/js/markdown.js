// Markdown rendering: marked + highlight.js + KaTeX, with [TOC] support.
// highlight.js and KaTeX are loaded the first time a document needs them
// (see loader.js). Until they arrive, code is shown unhighlighted and
// formulas as their TeX source; render() reports which library it was
// waiting for, and the caller renders again once it has loaded.
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
    let needs = null;              // libraries the current render had to do without
    let interactiveTasks = false;  // live mode lets task checkboxes be clicked

    const PLAIN_LANGS = new Set(['text', 'txt', 'plain', 'plaintext']);

    // TeX → HTML; shows the source until KaTeX has loaded
    function renderMath(tex, displayMode) {
        if (window.katex) {
            try {
                return katex.renderToString(tex, { ...KATEX_OPTIONS, displayMode });
            } catch (e) {
                return `<span class="katex-error">${escapeHtml(tex)}</span>`;
            }
        }
        if (needs) needs.math = true;
        else MDE.loader.request('katex');
        const delimiter = displayMode ? '$$' : '$';
        return `<span class="math-pending${displayMode ? ' is-display' : ''}">${escapeHtml(delimiter + tex + delimiter)}</span>`;
    }

    // Highlighted HTML for a code block. `auto` guesses the language when it
    // is missing or unknown (the preview does; the live code editor doesn't).
    function highlightCode(source, language, auto = true) {
        if (PLAIN_LANGS.has(language) || (!language && !auto)) return { html: escapeHtml(source), language: '' };
        if (!window.hljs) {
            if (needs) needs.code = true;
            else MDE.loader.request('hljs');
            return { html: escapeHtml(source), language: '' };
        }
        try {
            if (language && hljs.getLanguage(language)) {
                return { html: hljs.highlight(source, { language, ignoreIllegals: true }).value, language };
            }
            if (auto) {
                const result = hljs.highlightAuto(source);
                return { html: result.value, language: result.language || '' };
            }
        } catch (e) {
            /* fall through to plain text */
        }
        return { html: escapeHtml(source), language: '' };
    }

    // ==highlight==
    renderer.text = function (text) {
        return text.replace(/==(.*?)==/g, '<mark>$1</mark>');
    };

    // Headings get ids (for the TOC and in-page links)
    renderer.heading = function (text, level) {
        // Keep math placeholders in the TOC label so formulas render there too
        const label = text.replace(/<(?!!--MATH_BLOCK_)[^>]*>/g, '');
        const plain = label.replace(/<!--MATH_BLOCK_\d+-->/g, '').replace(/&[#\w]+;/g, ' ');
        const baseId = plain.toLowerCase().replace(/[^\w\u4E00-\u9FA5]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
        let id = baseId;
        if (usedIds[id]) {
            id = `${id}-${usedIds[id]++}`;
        } else {
            usedIds[id] = 1;
        }
        headings.push({ level, id, baseId, label });
        return `<h${level} id="${id}">${text}</h${level}>\n`;
    };

    // Code blocks: language label, copy button, line numbers
    renderer.code = function (code, infostring) {
        const language = ((infostring || '').match(/^\S*/) || [''])[0];
        if (language === 'math') {
            return `<div class="math-block">$$${escapeHtml(code)}$$</div>\n`;
        }

        const source = code.replace(/\n$/, '');
        const { html: highlighted, language: detected } = highlightCode(source, language);

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
        return `<input type="checkbox" class="task-check"${interactiveTasks ? '' : ' disabled'}${checked ? ' checked' : ''}>`;
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

    function buildToc(headings) {
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
            const math = blocks[parseInt(inParagraph || inline, 10)];
            const display = math.startsWith('$$');
            const tex = display ? math.slice(2, -2) : math.slice(1, -1);
            const out = renderMath(tex, display);
            return inParagraph && !display ? `<p>${out}</p>` : out;
        });
    }

    // Formulas written over several lines ($$ … $$), as [start, end) offsets
    function mathSpans(source) {
        const spans = [];
        source.replace(MATH_RE, (match, fence, fenceMark, code, ticks, math, offset) => {
            if (math && math.includes('\n')) spans.push({ start: offset, end: offset + match.length });
            return match;
        });
        return spans;
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

    // options.toc: headings for [TOC] (live mode renders one block at a time,
    // so it passes the whole document's); options.tasks: clickable checkboxes
    function render(source, options = {}) {
        headings = [];
        usedIds = Object.create(null);
        needs = { math: false, code: false };
        interactiveTasks = !!options.tasks;

        const { text, blocks, shifts } = extractMath(source);
        const tokens = marked.lexer(text);
        // Addresses starting "www." that GFM links by themselves open over
        // https (GFM says http)
        marked.walkTokens(tokens, (token) => {
            if (token.type === 'link' && /^www\./i.test(token.raw)) token.href = 'https://' + token.raw;
        });
        const headingLines = headingSourceLines(tokens, shifts);
        let html = marked.parser(tokens);
        const ownHeadings = headings;
        ownHeadings.forEach((item) => { item.label = restoreMath(item.label, blocks); });

        if (html.includes('[TOC]')) {
            const toc = buildToc(options.toc || ownHeadings);
            html = html
                .replace(/<p>\[TOC\]<\/p>/g, toc)
                .replace(/<p>\[TOC\]<br>\n?/g, toc + '<p>');
        }

        html = restoreMath(html, blocks);
        const result = { html, headingLines, headings: ownHeadings, needs };
        if (needs.math) MDE.loader.request('katex');
        if (needs.code) MDE.loader.request('hljs');
        needs = null;
        interactiveTasks = false;
        return result;
    }

    function renderInto(element, source) {
        const { html, headingLines } = render(source);
        element.innerHTML = html;
        return headingLines;
    }

    MDE.markdown = { render, renderInto, renderMath, highlightCode, mathSpans, escapeHtml, ICON_COPY };
})(window.MDE = window.MDE || {});
