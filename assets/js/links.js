// Links in Markdown text: where each one is, its text and its address, and
// the source the link dialog writes back when one is edited. The kinds are
// inline links [text](url "title"), reference links [text][label] (only
// when the label is defined), autolinks <https://…> and bare addresses
// (https://…, www.…) that GFM turns into links by themselves.
(function (MDE) {
    const AUTOLINK = /<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*)>/y;
    const AUTOLINK_EMAIL = /<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)>/y;
    const HTML_TAG = /<!--[\s\S]*?-->|<\/?[A-Za-z][^<>]*>/y;
    // As marked (GFM) finds them, less the punctuation it leaves out at the end
    const BARE = /(?:(?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9-]+\.?)+[^\s<]*/iy;
    const BACKPEDAL = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
    // What may come before one, as GitHub has it (markdown.js has the same rule)
    const bareAllowed = (url, before) => (/^www\./i.test(url) ? !before || /[ \t\n\r\f\v*_~(]/.test(before) : !/[A-Za-z]/.test(before));
    const ESCAPED = /\\([!-/:-@[-`{-~])/g;
    const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*$/;
    // A reference definition, [label]: url "title", is not a link
    const DEFINITION = / {0,3}\[[^\]\n]+\]:[^\n]*/y;

    const unescape = (text) => text.replace(ESCAPED, '$1');

    // The address as marked writes it into the rendered link's href
    function href(url) {
        try {
            return encodeURI(url).replace(/%25/g, '%');
        } catch (e) {
            return null;
        }
    }

    // The end of the brackets opened at text[i] ("["), or -1
    function closeBracket(text, i) {
        let depth = 0;
        for (let k = i; k < text.length; k++) {
            const ch = text[k];
            if (ch === '\\') k++;
            else if (ch === '\n' && text[k + 1] === '\n') return -1;
            else if (ch === '[') depth++;
            else if (ch === ']' && --depth === 0) return k;
        }
        return -1;
    }

    // "(url "title")" from text[i]: the address and the title as written
    function destination(text, i) {
        let k = i + 1;
        while (text[k] === ' ' || text[k] === '\t' || text[k] === '\n') k++;
        let url = '';
        if (text[k] === '<') {
            const end = text.slice(k + 1).search(/[<>\n]/);
            if (end === -1 || text[k + 1 + end] !== '>') return null;
            url = text.slice(k + 1, k + 1 + end);
            k += end + 2;
        } else {
            const from = k;
            let depth = 0;
            for (; k < text.length; k++) {
                const ch = text[k];
                if (ch === '\\') k++;
                else if (ch === '(') depth++;
                else if (ch === ')' && depth-- === 0) break;
                else if (/\s/.test(ch)) break;
            }
            url = text.slice(from, k);
        }
        const tail = /^(?:[ \t\n]+(?:"[^"]*"|'[^']*'|\([^()]*\)))?[ \t\n]*\)/.exec(text.slice(k));
        if (!tail) return null;
        return { url: unescape(url), tail: tail[0].slice(0, -1), end: k + tail[0].length };
    }

    // Every link in the text, in order. resolve(label) gives the address of
    // a reference label (undefined when it isn't defined); without it,
    // reference links are not looked for.
    function scan(text, resolve) {
        const out = [];
        let i = 0;
        while (i < text.length) {
            const ch = text[i];
            if (i === 0 || text[i - 1] === '\n') {
                DEFINITION.lastIndex = i;
                const def = DEFINITION.exec(text);
                if (def) {
                    i += def[0].length;
                    continue;
                }
            }
            if (ch === '\\') {
                i += 2;
                continue;
            }
            // Code spans hold no links
            if (ch === '`') {
                const run = /`+/y;
                run.lastIndex = i;
                const ticks = run.exec(text)[0];
                const close = new RegExp(`(?<!\`)${ticks}(?!\`)`, 'g');
                close.lastIndex = i + ticks.length;
                const m = close.exec(text);
                i = m ? m.index + ticks.length : i + ticks.length;
                continue;
            }
            if (ch === '[' || (ch === '!' && text[i + 1] === '[')) {
                const image = ch === '!';
                const open = image ? i + 1 : i;
                const close = closeBracket(text, open);
                const found = close !== -1 && bracketLink(text, open, close, resolve);
                if (found) {
                    // An image is not a link (a link around one is found from its "[")
                    if (!image) out.push(found);
                    i = found.to;
                    continue;
                }
                i = open + 1;
                continue;
            }
            if (ch === '<') {
                AUTOLINK.lastIndex = AUTOLINK_EMAIL.lastIndex = HTML_TAG.lastIndex = i;
                const auto = AUTOLINK.exec(text);
                const email = !auto && AUTOLINK_EMAIL.exec(text);
                const m = auto || email;
                if (m) {
                    out.push({ kind: 'auto', from: i, to: i + m[0].length, text: '', url: m[1], href: href(email ? 'mailto:' + m[1] : m[1]) });
                    i += m[0].length;
                    continue;
                }
                const tag = HTML_TAG.exec(text);
                i = tag ? i + tag[0].length : i + 1;
                continue;
            }
            if (/[fhwFHW]/.test(ch)) {
                BARE.lastIndex = i;
                const m = BARE.exec(text);
                if (m && bareAllowed(m[0], text[i - 1] || '')) {
                    let url = m[0];
                    let prev;
                    do {
                        prev = url;
                        url = (BACKPEDAL.exec(url) || [''])[0];
                    } while (url !== prev);
                    if (url) {
                        // markdown.js links "www." over https
                        const www = /^www\./i.test(url);
                        out.push({ kind: 'bare', from: i, to: i + url.length, text: '', url, href: href(www ? 'https://' + url : url) });
                        i += url.length;
                        continue;
                    }
                }
            }
            i++;
        }
        return out;
    }

    // A link (or an image) whose text sits in text[open+1 … close-1]
    function bracketLink(text, open, close, resolve) {
        const inner = text.slice(open + 1, close);
        const base = { from: open, text: inner };
        if (text[close + 1] === '(') {
            const dest = destination(text, close + 1);
            if (dest) return { ...base, kind: 'inline', to: dest.end, url: dest.url, tail: dest.tail, href: href(dest.url) };
        }
        if (!resolve) return null;
        // [text][label], [text][] and [text]
        let label = null;
        let to = close + 1;
        const ref = /^\[([^\]\n]*)\]/.exec(text.slice(close + 1));
        if (ref) {
            label = ref[1] || null;
            to += ref[0].length;
        }
        const url = resolve(label || inner);
        if (url === undefined || url === null) return null;
        return { ...base, kind: 'ref', to, url, label, href: href(url) };
    }

    // The link holding the caret (strictly inside it) or the whole selection.
    // Only the paragraph around the selection is looked at.
    function at(text, start, end, resolve) {
        const before = text.lastIndexOf('\n\n', start - 1);
        const from = before === -1 ? 0 : before + 2;
        const after = text.indexOf('\n\n', end);
        const region = text.slice(from, after === -1 ? text.length : after);
        for (const link of scan(region, resolve)) {
            const a = from + link.from;
            const z = from + link.to;
            if (start === end ? a < start && start < z : a <= start && end <= z) return { ...link, from: a, to: z };
            if (a >= end) break;
        }
        return null;
    }

    // An address as a link destination: in <> when it has spaces or
    // brackets, or unbalanced parentheses
    function target(url) {
        let depth = 0;
        for (const ch of url) {
            if (ch === '(') depth++;
            else if (ch === ')' && --depth < 0) break;
        }
        return /[\s<>]/.test(url) || depth !== 0 ? `<${url.replace(/[<>]/g, '\\$&')}>` : url;
    }

    // An address on its own: as an autolink when it has a scheme
    function bare(url) {
        return SCHEME.test(url) ? `<${url}>` : `[${url}](${target(url)})`;
    }

    // The source of a link given new text and a new address, or null when
    // neither changed. No text means the address shows itself. What isn't
    // changed keeps its form: a reference stays a reference, a title stays.
    function rewrite(link, text, url) {
        const sameUrl = url === link.url;
        if (text === link.text && sameUrl) return null;
        if (link.kind === 'auto' || link.kind === 'bare') {
            if (text) return `[${text}](${target(url)})`;
            if (link.kind === 'bare') {
                BARE.lastIndex = 0;
                const m = BARE.exec(url);
                if (m && m[0] === url && (BACKPEDAL.exec(url) || [''])[0] === url) return url;
            }
            return bare(url);
        }
        if (!text) return bare(url);
        if (link.kind === 'ref' && sameUrl) return `[${text}][${link.label || link.text}]`;
        return `[${text}](${target(url)}${link.kind === 'inline' ? link.tail : ''})`;
    }

    // What is left once the link is taken off: its text (null when the
    // address shows itself, which would still be a link)
    function unlink(link) {
        return link.kind === 'inline' || link.kind === 'ref' ? link.text : null;
    }

    MDE.links = { scan, at, rewrite, unlink, href };
})(window.MDE = window.MDE || {});
