// Line-by-line Markdown highlighting for the editor backdrop.
// The output only wraps characters in spans and never adds or removes
// any, so the backdrop keeps lining up with the textarea above it.
(function (MDE) {
    const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const wrap = (cls, html) => (html ? `<span class="${cls}">${html}</span>` : '');
    const mark = (text) => wrap('t-mark', esc(text));
    const isWordChar = (ch) => !!ch && /[\p{L}\p{N}_]/u.test(ch);

    // --- Inline -------------------------------------------------------------

    const INLINE_RULES = [
        // Backslash escapes stay plain
        { start: '\\', re: /\\[\\`*_{}[\]()#+\-.!|~=$<>]/y, render: (m) => esc(m[0]) },
        // `code`
        { start: '`', re: /(`+)(?!`)(.*?[^`])\1(?!`)/y, render: (m) => mark(m[1]) + wrap('t-code', esc(m[2])) + mark(m[1]) },
        // $math$ and $$math$$ on one line
        { start: '$', re: /(\$\$?)([^$\n]+?)\1/y, render: (m) => mark(m[1]) + wrap('t-math', esc(m[2])) + mark(m[1]) },
        // **bold** / __bold__
        {
            start: '*_',
            re: /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/y,
            guard: (text, i) => text[i] === '*' || !isWordChar(text[i - 1]),
            render: (m, pipes) => mark(m[1]) + wrap('t-bold', inline(m[2], pipes)) + mark(m[1])
        },
        // ~~strike~~
        { start: '~', re: /~~(?=\S)(.+?)(?<=\S)~~/y, render: (m, pipes) => mark('~~') + wrap('t-strike', inline(m[1], pipes)) + mark('~~') },
        // ==highlight==
        { start: '=', re: /==(?=\S)(.+?)(?<=\S)==/y, render: (m, pipes) => mark('==') + wrap('t-hl', inline(m[1], pipes)) + mark('==') },
        // *italic* / _italic_
        {
            start: '*_',
            re: /([*_])(?![\s*_])(.+?)(?<![\s*_])\1(?![*_])/y,
            guard: (text, i) => text[i] === '*' || !isWordChar(text[i - 1]),
            render: (m, pipes) => mark(m[1]) + wrap('t-italic', inline(m[2], pipes)) + mark(m[1])
        },
        // [text](url) and ![alt](src)
        {
            start: '![',
            re: /(!?\[)([^\]\n]*)(\]\()([^)\s]*)((?:\s+"[^"\n]*")?\))/y,
            render: (m, pipes) => mark(m[1]) + (m[1] === '[' ? wrap('t-link', inline(m[2], pipes)) : inline(m[2], pipes))
                + mark(m[3]) + wrap('t-url', esc(m[4])) + mark(m[5])
        },
        // Inline HTML and comments
        { start: '<', re: /<!--.*?-->|<\/?[A-Za-z][^<>\n]*>/y, render: (m) => wrap('t-html', esc(m[0])) },
        // Bare URLs
        {
            start: 'h',
            re: /https?:\/\/[^\s<>()]+/y,
            guard: (text, i) => !isWordChar(text[i - 1]),
            render: (m) => wrap('t-url', esc(m[0]))
        }
    ];

    function inline(text, pipes) {
        let out = '';
        let plainStart = 0;
        let i = 0;

        while (i < text.length) {
            const ch = text[i];
            let html = null;
            let length = 0;

            if (pipes && ch === '|') {
                html = mark('|');
                length = 1;
            } else {
                for (const rule of INLINE_RULES) {
                    if (!rule.start.includes(ch)) continue;
                    if (rule.guard && !rule.guard(text, i)) continue;
                    rule.re.lastIndex = i;
                    const m = rule.re.exec(text);
                    if (m) {
                        html = rule.render(m, pipes);
                        length = m[0].length;
                        break;
                    }
                }
            }

            if (html !== null) {
                out += esc(text.slice(plainStart, i)) + html;
                i += length;
                plainStart = i;
            } else {
                i++;
            }
        }
        return out + esc(text.slice(plainStart));
    }

    // --- Code inside fences -------------------------------------------------

    const PLAIN_LANGS = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'md', 'markdown']);
    const HASH_COMMENT_LANGS = new Set([
        'python', 'py', 'sh', 'bash', 'shell', 'zsh', 'console', 'yaml', 'yml', 'ruby', 'rb',
        'r', 'perl', 'toml', 'ini', 'conf', 'dockerfile', 'makefile', 'powershell', 'ps1'
    ]);

    function codeLine(line, lang) {
        if (PLAIN_LANGS.has(lang)) return esc(line);
        const hashComments = HASH_COMMENT_LANGS.has(lang);
        let out = '';
        let plainStart = 0;
        let i = 0;

        while (i < line.length) {
            const ch = line[i];
            let length = 0;
            let cls = '';

            if ((hashComments && ch === '#') || (!hashComments && ch === '/' && line[i + 1] === '/')) {
                length = line.length - i;
                cls = 't-comment';
            } else if (ch === '"' || ch === "'" || ch === '`') {
                let j = i + 1;
                while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
                length = Math.min(j + 1, line.length) - i;
                cls = 't-string';
            }

            if (length) {
                out += esc(line.slice(plainStart, i)) + wrap(cls, esc(line.slice(i, i + length)));
                i += length;
                plainStart = i;
            } else {
                i++;
            }
        }
        return out + esc(line.slice(plainStart));
    }

    // --- Block level --------------------------------------------------------

    const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
    const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
    const MATH_OPEN = /^(\s*)\$\$(?!.*\$\$)(.*)$/;
    const TOC = /^\s*\[TOC\]\s*$/;
    const HEADING = /^( {0,3})(#{1,6})(?=\s|$)(\s*)(.*)$/;
    const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
    const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$|^\s*\|\s*:?-+:?\s*\|?\s*$/;
    const QUOTE = /^( {0,3}>[ \t]?(?:>[ \t]?)*)(.*)$/;
    const LIST = /^(\s*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/;

    function listOrText(line) {
        const m = LIST.exec(line);
        if (m) return esc(m[1]) + wrap('t-list', mark(m[2] + m[3] + (m[4] || ''))) + inline(m[5]);
        return inline(line, /^\s*\|/.test(line));
    }

    function blockLine(line) {
        let m;
        if (TOC.test(line)) return wrap('t-accent', esc(line));
        if ((m = HEADING.exec(line))) return esc(m[1]) + wrap('t-heading', mark(m[2] + m[3]) + inline(m[4]));
        if (HR.test(line) || TABLE_DELIMITER.test(line)) return mark(line);
        if ((m = QUOTE.exec(line))) return mark(m[1]) + listOrText(m[2]);
        return listOrText(line);
    }

    // Highlighted lines are cached by their text (and fence language), so
    // typing only re-runs the rules on the line being edited.
    const cache = new Map();
    const CACHE_LIMIT = 20000;

    function cached(key, compute) {
        let html = cache.get(key);
        if (html === undefined) {
            html = compute();
            if (cache.size >= CACHE_LIMIT) cache.clear();
            cache.set(key, html);
        }
        return html;
    }

    // Returns one HTML string per source line
    function highlight(text) {
        const lines = text.split('\n');
        const out = new Array(lines.length);
        let fence = null;
        let inMath = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let m;

            if (fence) {
                m = FENCE_CLOSE.exec(line);
                if (m && m[1][0] === fence.char && m[1].length >= fence.length) {
                    out[i] = mark(line);
                    fence = null;
                } else {
                    const lang = fence.lang;
                    out[i] = cached(`c${lang}\u0000${line}`, () => codeLine(line, lang));
                }
                continue;
            }

            if (inMath) {
                const end = line.indexOf('$$');
                if (end === -1) {
                    out[i] = wrap('t-math', esc(line));
                } else {
                    out[i] = wrap('t-math', esc(line.slice(0, end))) + mark('$$') + inline(line.slice(end + 2));
                    inMath = false;
                }
                continue;
            }

            m = FENCE_OPEN.exec(line);
            if (m && !(m[2][0] === '`' && m[3].includes('`'))) {
                fence = { char: m[2][0], length: m[2].length, lang: (m[3].trim().split(/\s+/)[0] || '').toLowerCase() };
                out[i] = esc(m[1]) + mark(m[2]) + wrap('t-lang', esc(m[3]));
                continue;
            }

            m = MATH_OPEN.exec(line);
            if (m) {
                inMath = true;
                out[i] = esc(m[1]) + mark('$$') + wrap('t-math', esc(m[2]));
                continue;
            }

            out[i] = cached(`b\u0000${line}`, () => blockLine(line));
        }
        return out;
    }

    // highlight: one HTML string per line of a document; inline: the
    // inline rules alone (a table cell in live mode)
    MDE.syntax = { highlight, inline: (text) => inline(text, false) };
})(window.MDE = window.MDE || {});
