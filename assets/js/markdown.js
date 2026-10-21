// Markdown rendering: marked + highlight.js + KaTeX, with [TOC] support.
// highlight.js and KaTeX are loaded the first time a document needs them
// (see loader.js). Until they arrive, code is shown unhighlighted and
// formulas as their TeX source; render() reports which library it was
// waiting for, and the caller renders again once it has loaded.
// HTML written in the document is cleaned with DOMPurify, and links only
// get addresses that can't run script (see "Addresses" and "HTML written in
// the document").
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

    // --- Ids ------------------------------------------------------------------

    // Ids of the editor's own elements (its code looks them up by id), and
    // of the options its menus make later (code languages, commands)
    const APP_IDS = new Set(Array.from(document.querySelectorAll('[id]'), (el) => el.id));
    const isAppId = (id) => APP_IDS.has(id) || /^(?:lang-\d+|cmd-.+)$/.test(id);

    // A heading's id, unique in the document. The editor's ids count as
    // taken, so a heading "Toast" is #toast-1 (and a link to #toast finds it,
    // see app.js): two elements with one id would mix up the editor's code.
    function uniqueId(base, used) {
        if (!used[base] && isAppId(base)) used[base] = 1;
        if (used[base]) return `${base}-${used[base]++}`;
        used[base] = 1;
        return base;
    }

    // --- Addresses ------------------------------------------------------------

    // Links get http, https, mailto and tel addresses, #ids and relative
    // paths; anything else (javascript:, data:, …) leaves plain text. Images
    // may also be data: URIs. This is DOMPurify's own test, so the HTML of a
    // document gets the same rule, and it is made on the address as the
    // browser reads it (spaces and control characters dropped).
    const SAFE_URL = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
    const URL_SPACE = /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g;

    function safeUrl(url, image = false) {
        const value = String(url).replace(URL_SPACE, '');
        return SAFE_URL.test(value) || (image && /^data:/i.test(value));
    }

    // An address as written into an attribute, as the browser reads it back:
    // character references are decoded ("&#106;avascript:" is "javascript:")
    const attrProbe = document.createElement('template');

    function attrValue(raw) {
        if (!raw.includes('&')) return raw;
        attrProbe.innerHTML = '<a href="' + raw.replace(/"/g, '&quot;') + '"></a>';
        return attrProbe.content.firstChild.getAttribute('href');
    }

    // What marked writes into href / src (its cleanUrl); null: no link at all
    function writtenUrl(href) {
        try {
            return encodeURI(href).replace(/%25/g, '%');
        } catch (e) {
            return null;
        }
    }

    // --- HTML written in the document -------------------------------------------

    // marked passes HTML through as written. DOMPurify takes out what could
    // run script (<script>, onerror=…, javascript: links), leave the page
    // (forms, <meta> refresh), restyle or cover the editor (<style>,
    // position: fixed, the top layer) or act as the editor (frames of this
    // site). Only the top-level blocks that hold HTML are cleaned: cleaning a
    // long document whole takes longer than rendering it. Without DOMPurify
    // (it didn't load), HTML is shown as text.
    const purifier = window.DOMPurify && typeof window.DOMPurify.sanitize === 'function' ? window.DOMPurify(window) : null;

    // Features a frame's allow="…" may give the embedded page. Not the
    // camera, microphone or location: the browser would ask for them in the
    // editor's name.
    const FRAME_FEATURES = new Set(['autoplay', 'encrypted-media', 'fullscreen', 'picture-in-picture', 'accelerometer', 'gyroscope', 'clipboard-write', 'web-share']);
    const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-presentation';
    const MATH_ONLY = /^\s*(?:<!--MATH_BLOCK_\d+-->\s*)+$/;
    const MATH_COMMENT = /<!--MATH_BLOCK_\d+-->/g;

    // Frames show other sites' pages (videos, maps). With allow-same-origin
    // a page of this site would run as the editor, so those are dropped,
    // and so is srcdoc.
    function frameAllowed(src) {
        if (!src) return false;
        try {
            const url = new URL(src, document.baseURI);
            return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin !== location.origin;
        } catch (e) {
            return false;
        }
    }

    // position: fixed / sticky in a style attribute is dropped (it would pin
    // the text over the editor); the rest stays as written
    const styleProbe = document.createElement('div');
    const headingIds = new WeakMap();

    function unpinned(css) {
        styleProbe.style.cssText = css;
        const position = styleProbe.style.getPropertyValue('position').trim().toLowerCase();
        if (!position || position === 'static' || position === 'relative' || position === 'absolute') return css;
        styleProbe.style.removeProperty('position');
        return styleProbe.style.cssText;
    }

    if (purifier) {
        purifier.setConfig({
            FORCE_BODY: true,
            ALLOWED_URI_REGEXP: SAFE_URL,
            ADD_TAGS: ['iframe'],
            ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder'],   // on frames only (below)
            FORBID_TAGS: ['style', 'form', 'meta', 'base', 'link', 'object', 'embed', 'frame', 'frameset'],
            // Popovers and dialogs opened by a button would sit in the
            // browser's top layer, above the whole editor
            FORBID_ATTR: ['popover', 'popovertarget', 'popovertargetaction', 'command', 'commandfor']
        });
        // (Hooks on whole nodes only: with hooks on single attributes,
        // DOMPurify copies its lists on every call, 0.3 ms a block.)
        purifier.addHook('beforeSanitizeElements', (node) => {
            if (node.nodeName === 'IFRAME' && !frameAllowed(node.getAttribute('src'))) node.remove();
        });
        purifier.addHook('beforeSanitizeAttributes', (node) => {
            if (node.nodeType !== 1) return;
            const id = node.getAttribute('id');
            if (id !== null && isAppId(id.trim())) node.removeAttribute('id');
            // DOMPurify drops ids named like a property of document (a
            // heading "Title" is #title); on headings they are put back
            else if (id !== null && /^H[1-6]$/.test(node.nodeName) && !/[<>]/.test(id)) headingIds.set(node, id);
            const label = node.getAttribute('for');
            if (label !== null && isAppId(label.trim())) node.removeAttribute('for');
            const style = node.getAttribute('style');
            if (style !== null) {
                const kept = unpinned(style);
                if (kept !== style) node.setAttribute('style', kept);
            }
            if (node.nodeName === 'IFRAME') {
                // srcdoc would run as the editor; a frame's name would be a
                // global of the page (window.katex)
                node.removeAttribute('srcdoc');
                node.removeAttribute('name');
                const allow = node.getAttribute('allow');
                const kept = allow && allow.split(';').map((item) => item.trim())
                    .filter((item) => FRAME_FEATURES.has(item.split(/\s+/)[0].toLowerCase())).join('; ');
                if (kept) node.setAttribute('allow', kept);
                else node.removeAttribute('allow');
            } else {
                node.removeAttribute('allow');
                node.removeAttribute('allowfullscreen');
                node.removeAttribute('frameborder');
            }
        });
        purifier.addHook('afterSanitizeAttributes', (node) => {
            if (headingIds.has(node)) node.setAttribute('id', headingIds.get(node));
            if (node.nodeName !== 'IFRAME') return;
            node.setAttribute('sandbox', FRAME_SANDBOX);
            node.setAttribute('loading', 'lazy');
            node.setAttribute('referrerpolicy', 'no-referrer');
        });
    }

    // While a document with HTML is cleaned, what must not go through
    // DOMPurify waits in slots: the blocks without HTML, and (in the blocks
    // with HTML) formulas and HTML-block frames. DOMPurify would drop the
    // formulas' comments and the frames' data-source (it holds </style>);
    // both are ours, and KaTeX doesn't trust its input. The key is new on
    // every page load, so a document can't write a slot of its own.
    const SLOT_KEY = 's' + Math.random().toString(36).slice(2, 10);
    const SLOT_RE = new RegExp(`<span data-mde-slot="${SLOT_KEY}-(\\d+)"></span>`, 'g');
    let slots = null;
    let inRawBlock = false;

    function slot(html) {
        return `<span data-mde-slot="${SLOT_KEY}-${slots.push(html) - 1}"></span>`;
    }

    // A formula inside a tag ($ in an attribute: title="$5 and $10") goes
    // back to its text; other formulas wait in slots
    function slotMath(html, math) {
        return html.replace(MATH_COMMENT, (comment, at) => {
            const before = html.slice(0, at);
            if (before.lastIndexOf('<') <= before.lastIndexOf('>')) return slot(comment);
            return escapeHtml(math[Number(comment.slice(15, -3))]);
        });
    }

    // raw[i]: the top-level token i holds HTML; math: the formulas' source
    function parseCleaned(tokens, raw, math) {
        slots = [];
        let skeleton = '';
        let run = [];
        const flush = () => {
            if (run.length) skeleton += slot(marked.parser(run));
            run = [];
        };
        tokens.forEach((token, i) => {
            if (!raw[i]) {
                run.push(token);
                return;
            }
            flush();
            inRawBlock = true;
            skeleton += slotMath(marked.parser([token]), math);
            inRawBlock = false;
        });
        flush();
        const html = purifier.sanitize(skeleton).replace(SLOT_RE, (match, n) => slots[n]);
        slots = null;
        return html;
    }

    // --- Renderer -----------------------------------------------------------

    const renderer = new marked.Renderer();
    let headings = [];
    let usedIds = Object.create(null);
    let needs = null;              // libraries the current render had to do without
    let interactiveTasks = false;  // live mode lets task checkboxes be clicked (and opens an HTML block's source)

    const PLAIN_LANGS = new Set(['text', 'txt', 'plain', 'plaintext']);

    // TeX → HTML; shows the source until KaTeX has loaded
    function renderMath(tex, displayMode) {
        if (MDE.loader.ready('katex')) {
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
        if (!MDE.loader.ready('hljs')) {
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
        const id = uniqueId(baseId, usedIds);
        headings.push({ level, id, baseId, label });
        return `<h${level} id="${id}">${text}</h${level}>\n`;
    };

    // Code blocks: language label, copy button, line numbers
    renderer.code = function (code, infostring) {
        const language = ((infostring || '').match(/^\S*/) || [''])[0];
        if (language === 'math') {
            return `<div class="math-block">$$${escapeHtml(code)}$$</div>\n`;
        }
        // ```html runs in a sandboxed frame (html-frames.js); live mode adds
        // the button that opens its source
        if (language.toLowerCase() === 'html' && MDE.htmlFrames) {
            const frame = MDE.htmlFrames.markup(code.replace(/\n$/, ''), { edit: interactiveTasks }) + '\n';
            return inRawBlock ? slot(frame) : frame;
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

    // Links and images only with safe addresses (see "Addresses")
    renderer.link = function (href, title, text) {
        const url = writtenUrl(href);
        if (url !== null && !safeUrl(attrValue(url))) return text;
        return marked.Renderer.prototype.link.call(this, href, title, text);
    };

    renderer.image = function (href, title, text) {
        const url = writtenUrl(href);
        if (url !== null && !safeUrl(attrValue(url), true)) return text;
        return marked.Renderer.prototype.image.call(this, href, title, text);
    };

    // HTML as written (cleaned in render()), or as text without DOMPurify
    renderer.html = function (html, block) {
        if (purifier || MATH_ONLY.test(html)) return html;
        const text = escapeHtml(html).replace(/&lt;!--MATH_BLOCK_(\d+)--&gt;/g, '<!--MATH_BLOCK_$1-->');
        return block ? `<p>${text}</p>\n` : text;
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
        // https (GFM says http); and which top-level blocks hold HTML (the
        // formulas' placeholders are comments, but ours). One block at a
        // time: walkTokens joins arrays as it goes, slow on a long list.
        const raw = tokens.map((top) => {
            let found = false;
            marked.walkTokens([top], (token) => {
                if (token.type === 'link' && /^www\./i.test(token.raw)) token.href = 'https://' + token.raw;
                else if (token.type === 'html' && !MATH_ONLY.test(token.raw)) found = true;
            });
            return found;
        });
        const headingLines = headingSourceLines(tokens, shifts);
        let html = purifier && raw.includes(true) ? parseCleaned(tokens, raw, blocks) : marked.parser(tokens);
        const ownHeadings = headings;
        ownHeadings.forEach((item) => { item.label = restoreMath(item.label, blocks); });

        // (The table of contents comes after cleaning: its labels are the
        // headings' text with every tag taken out, and its ids are ours.)
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

    // The preview: frames of HTML blocks that didn't change are kept
    function renderInto(element, source) {
        const { html, headingLines } = render(source);
        if (MDE.htmlFrames) MDE.htmlFrames.patch(element, html);
        else element.innerHTML = html;
        return headingLines;
    }

    MDE.markdown = { render, renderInto, renderMath, highlightCode, mathSpans, escapeHtml, safeUrl, attrValue, isAppId, uniqueId, ICON_COPY };
})(window.MDE = window.MDE || {});
