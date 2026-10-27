// HTML blocks (```html): each is shown in an iframe sandboxed with only
// "allow-scripts" (its scripts run, but it has an opaque origin: it can't
// reach the editor's page or its storage). markdown.js writes a frame's
// box with the source in data-source; the iframe is made once the box comes
// near the view, and a small script put in front of the HTML tells the
// editor how tall the content is, passes link clicks out (and the mouse
// going in or out), takes the editor's colours and fonts and tints
// annotated passages in the frame's text (annotate.js says which). Bottom
// right: zoom, full screen, and a grip that sets the height by hand (or
// with ↑ ↓). Zoom and heights are kept for this visit only, by the block's
// source. An iframe taken out of the page loads again, so frames are moved
// only with moveBefore() (see patch, and live.js's rebuild).
(function (MDE) {
    const MSG = 'mde-html-frame';
    const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
    const MIN_HEIGHT = 48;
    const MAX_SHARE = 0.8;         // of the view's height, unless set by hand
    const MANUAL_MAX = 5000;
    const DEFAULT_HEIGHT = 160;
    const HEIGHTS_KEPT = 500;
    const CREATE_MARGIN = '200px 0px';
    const LINK_PROTOCOLS = /^(https?|mailto|tel):$/i;
    const GRIP_STEP = 20;          // px per ↑ or ↓ on the grip
    const POINTER_EVERY = 100;     // ms between the frame's reports of the mouse moving in it
    // An iframe moved with moveBefore() doesn't load again (Chrome and Edge 133+)
    const CAN_MOVE = typeof Element.prototype.moveBefore === 'function';
    // Editor tokens handed to the frame, so its HTML can use var(--accent)…
    const TOKENS = ['accent', 'accent-soft', 'accent-soft-strong', 'accent-mid', 'accent-ring', 'on-accent', 'bg', 'surface', 'surface-sunken', 'surface-muted',
        'hover', 'hover-strong', 'pressed', 'border', 'border-strong', 'border-soft', 'text', 'text-strong', 'text-control',
        'text-body', 'text-soft', 'muted', 'faint', 'link', 'warm', 'number', 'danger', 'mark-bg', 'code-bg', 'code-border',
        'inline-code-bg', 'rule', 'font-doc', 'font-code'];

    const ICON = {
        edit: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>',
        out: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>',
        in: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
        full: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/></svg>',
        leave: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="m14 10 7-7"/><path d="m3 21 7-7"/></svg>',
        close: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
    };

    // Runs in the frame before its HTML: reports the content's height,
    // takes style updates, sends link clicks (and Esc) out, and tints the
    // annotated passages it is sent (each one's text without white space
    // and which occurrence of it; found again when the page changes). It
    // leaves out the same elements as annotations.js's frame text.
    const HELPER = `(function () {
var M = '${MSG}';
function post(data) { data[M] = 1; parent.postMessage(data, '*'); }
var marks = [];
var HIDDEN = /^(script|style|template|title|textarea|select|noscript|iframe|object|noembed|noframes|xmp)$/i;
function paint() {
    if (typeof Highlight !== 'function' || !window.CSS || !CSS.highlights) return;
    var all = new Highlight(), current = new Highlight();
    current.priority = 1;
    if (marks.length && document.body) {
        var chars = [], nodes = [], offsets = [], node;
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
            if (n.nodeType === 3) return NodeFilter.FILTER_ACCEPT;
            return HIDDEN.test(n.localName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        } });
        while ((node = walker.nextNode())) {
            for (var i = 0; i < node.data.length; i++) {
                if (node.data[i].trim()) { chars.push(node.data[i]); nodes.push(node); offsets.push(i); }
            }
        }
        var text = chars.join('');
        marks.forEach(function (m) {
            var at = -1;
            for (var i = text.indexOf(m.text), k = 0; m.text && i !== -1 && k <= m.count; i = text.indexOf(m.text, i + 1), k++) at = i;
            if (at === -1) return;
            var last = at + m.text.length - 1;
            var range = document.createRange();
            range.setStart(nodes[at], offsets[at]);
            range.setEnd(nodes[last], offsets[last] + 1);
            (m.current ? current : all).add(range);
        });
    }
    CSS.highlights.set('mde-ann', all);
    CSS.highlights.set('mde-ann-current', current);
}
if (window.MutationObserver) new MutationObserver(function () { if (marks.length) paint(); }).observe(document.documentElement, { childList: true, characterData: true, subtree: true });
document.addEventListener('DOMContentLoaded', function () { post({ type: 'ready' }); });
var last = -1;
function measure() {
    var root = document.documentElement;
    var h = root.getBoundingClientRect().height;
    if (root.scrollHeight > root.clientHeight + 1) h = Math.max(h, root.scrollHeight);
    h = Math.ceil(h);
    if (h !== last) { last = h; post({ type: 'height', height: h }); }
}
if (window.ResizeObserver) new ResizeObserver(measure).observe(document.documentElement);
document.addEventListener('DOMContentLoaded', measure);
addEventListener('load', measure);
addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== parent || !d || !d[M]) return;
    if (d.type === 'style') {
        var s = document.getElementById('mde-base');
        if (s) s.textContent = d.css;
        last = -1;
        measure();
    } else if (d.type === 'marks') {
        marks = d.marks || [];
        paint();
    }
});
addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || !e.target.closest) return;
    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    e.preventDefault();
    if (href.charAt(0) === '#') {
        var id = href.slice(1);
        try { id = decodeURIComponent(id); } catch (err) {}
        var t = id && (document.getElementById(id) || document.getElementsByName(id)[0]);
        if (t) scrollTo(0, t.getBoundingClientRect().top + scrollY);
        else if (!id) scrollTo(0, 0);
        return;
    }
    post({ type: 'open', href: a.href });
});
addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !e.defaultPrevented) post({ type: 'key', key: 'Escape' });
});
var moved = null, moveTimer = 0, moveSent = 0;
function sendMove() {
    moveTimer = 0;
    moveSent = Date.now();
    post({ type: 'pointer', inside: true, x: moved.x, y: moved.y, time: moved.time });
}
addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    moved = { x: e.clientX, y: e.clientY, time: performance.timeOrigin + e.timeStamp };
    var wait = ${POINTER_EVERY} - (Date.now() - moveSent);
    if (wait <= 0) sendMove();
    else if (!moveTimer) moveTimer = setTimeout(sendMove, wait);
});
addEventListener('pointerout', function (e) {
    if (e.relatedTarget || e.pointerType !== 'mouse') return;
    clearTimeout(moveTimer);
    moveTimer = 0;
    post({ type: 'pointer', inside: false, time: performance.timeOrigin + e.timeStamp });
});
})();`;

    const escapeHtml = (text) => String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    // FNV-1a, with the length: a frame's key, to keep its zoom and height
    function keyOf(source) {
        let h = 0x811c9dc5;
        for (let i = 0; i < source.length; i++) {
            h ^= source.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return source.length.toString(36) + '-' + (h >>> 0).toString(36);
    }

    const heights = new Map();     // key → height last measured
    const manual = new Map();      // key → height set with the grip
    const zooms = new Map();       // key → zoom
    const records = new Map();     // the frame's window → record
    const observers = new Map();   // scroller → IntersectionObserver
    const config = { onOpen: null, onEdit: null, onPointer: null };
    let expanded = null;           // the record shown over the window (no full-screen API)

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const zoomOf = (key) => zooms.get(key) || 1;

    // The frame's box, as markdown.js writes it; `edit` adds the button
    // that opens the source (live mode)
    function markup(source, { edit = false } = {}) {
        const button = (action, label, icon) => `<button type="button" class="html-tool" data-frame="${action}" aria-label="${label}" title="${label}">${icon}</button>`;
        return `<div class="html-block" data-key="${keyOf(source)}" data-source="${escapeHtml(source)}">`
            + '<div class="html-view"></div>'
            + '<div class="html-marks"></div>'
            + `<button type="button" class="html-close" data-frame="fullscreen" aria-label="退出全屏" title="退出全屏">${ICON.close}</button>`
            + '<div class="html-tools" role="toolbar" aria-label="HTML 块">'
            + (edit ? `<span class="html-edit">${button('edit', '编辑源码', ICON.edit)}<span class="html-sep" aria-hidden="true"></span></span>` : '')
            + button('zoom-out', '缩小', ICON.out)
            + '<button type="button" class="html-zoom" data-frame="zoom-reset" aria-label="缩放 100%，恢复 100%" title="恢复 100%">100%</button>'
            + button('zoom-in', '放大', ICON.in)
            + '<span class="html-sep" aria-hidden="true"></span>'
            + button('fullscreen', '全屏查看', ICON.full)
            + '</div>'
            + `<span class="html-grip" data-frame="grip" role="separator" tabindex="0" aria-orientation="horizontal" aria-label="调整高度" aria-valuemin="${MIN_HEIGHT}" aria-valuemax="${MANUAL_MAX}" title="拖动或按 ↑ ↓ 改变高度，双击或按 Home 恢复自动"></span>`
            + '</div>';
    }

    // --- Style handed to the frame ------------------------------------------

    // The page's part: tokens, theme, line height
    function pageStyle() {
        const root = getComputedStyle(document.documentElement);
        return {
            vars: TOKENS.map((name) => `--${name}:${root.getPropertyValue('--' + name).trim()};`).join(''),
            scheme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
            lineHeight: root.getPropertyValue('--doc-line-height').trim() || '1.85'
        };
    }

    // …and the frame's: its font size (the document's) and zoom
    function baseCss(el, zoom, page = pageStyle()) {
        return `:root{${page.vars}color-scheme:${page.scheme};zoom:${zoom}}`
            + `:where(html){font-family:var(--font-doc);font-size:${getComputedStyle(el).fontSize};line-height:${page.lineHeight};`
            + 'color:var(--text-body);background:transparent;-webkit-text-size-adjust:100%;overflow-wrap:break-word}'
            + ':where(body){margin:16px}'
            + ':where(a){color:var(--link)}'
            + ':where(code,kbd,pre,samp){font-family:var(--font-code)}'
            // Annotated passages (as preview.css's)
            + '::highlight(mde-ann){background-color:var(--accent-soft);text-decoration:underline 2px var(--accent-mid);text-decoration-skip-ink:none;text-underline-offset:0.26em}'
            + '::highlight(mde-ann-current){background-color:var(--accent-soft-strong);text-decoration:underline 2px var(--accent);text-decoration-skip-ink:none;text-underline-offset:0.26em}';
    }

    function srcdoc(source, css) {
        return '<!doctype html><html><head><meta charset="utf-8">'
            + '<meta name="viewport" content="width=device-width, initial-scale=1">'
            + `<style id="mde-base">${css}</style>`
            + `<script>${HELPER}<\/script>`
            + `</head><body>${source}</body></html>`;
    }

    // --- Annotations' tint ------------------------------------------------------

    // list: [{ text, count, current }] for the passages in the frame (their
    // text without white space and how many times it shows before them, as
    // annotations.js finds it); [] clears them. Sent once the frame's page
    // is ready, and again when it is loaded anew.
    function mark(el, list) {
        const record = recordOf(el);
        const json = JSON.stringify(list);
        if (!record || record.marks === json) return;
        record.marks = json;
        sendMarks(record);
    }

    function sendMarks(record) {
        if (!record.ready || !record.iframe || !record.el.isConnected) return;
        record.iframe.contentWindow.postMessage({ [MSG]: 1, type: 'marks', marks: JSON.parse(record.marks) }, '*');
    }

    function sendStyle(record, page) {
        if (!record.iframe || !record.el.isConnected) return;
        const css = baseCss(record.el, zoomOf(record.key), page);
        if (css === record.css) return;
        record.css = css;
        record.iframe.contentWindow.postMessage({ [MSG]: 1, type: 'style', css }, '*');
    }

    // The theme, the fonts or the font size changed
    let styleFrame = 0;
    new MutationObserver(() => {
        if (styleFrame) return;
        styleFrame = requestAnimationFrame(() => {
            styleFrame = 0;
            const page = pageStyle();
            records.forEach((record) => sendStyle(record, page));
        });
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });

    // --- Height ---------------------------------------------------------------

    function maxHeight(record) {
        const view = record.scroller && record.scroller.clientHeight ? record.scroller.clientHeight : window.innerHeight;
        return Math.max(MIN_HEIGHT, Math.round(view * MAX_SHARE));
    }

    function applyHeight(record) {
        const set = manual.get(record.key);
        const measured = record.measured != null ? record.measured : heights.get(record.key);
        const h = set != null ? set : clamp(measured != null ? measured : DEFAULT_HEIGHT, MIN_HEIGHT, maxHeight(record));
        const value = h + 'px';
        if (record.view.style.height !== value) record.view.style.height = value;
        // The grip tells a screen reader the height (and that it follows the content)
        const grip = record.grip;
        const text = set != null ? `${h} 像素` : `${h} 像素（自动）`;
        if (grip && grip.getAttribute('aria-valuetext') !== text) {
            grip.setAttribute('aria-valuenow', String(h));
            grip.setAttribute('aria-valuetext', text);
        }
    }

    // Height of a frame not made yet (live.js's estimate for its block)
    function estimate(source) {
        const key = keyOf(source);
        const set = manual.get(key);
        if (set != null) return set;
        return clamp(heights.has(key) ? heights.get(key) : DEFAULT_HEIGHT, MIN_HEIGHT, Math.round(window.innerHeight * MAX_SHARE));
    }

    // --- Making the frames ------------------------------------------------------

    function sweep() {
        records.forEach((record, win) => {
            if (!record.el.isConnected) records.delete(win);
        });
    }

    function create(record) {
        if (record.iframe || !record.el.isConnected) return;
        const iframe = document.createElement('iframe');
        iframe.className = 'html-frame';
        iframe.setAttribute('sandbox', 'allow-scripts');
        iframe.title = 'HTML 块（沙箱）';
        record.css = baseCss(record.el, zoomOf(record.key));
        iframe.srcdoc = srcdoc(record.source, record.css);
        record.view.appendChild(iframe);
        record.iframe = iframe;
        record.el.classList.add('is-loaded');
        records.set(iframe.contentWindow, record);
    }

    function observerFor(scroller) {
        let observer = observers.get(scroller);
        if (!observer) {
            observer = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    observer.unobserve(entry.target);
                    const record = recordOf(entry.target.closest('.html-block'));
                    if (record && record.el.isConnected) create(record);
                });
            }, { root: scroller, rootMargin: CREATE_MARGIN });
            observers.set(scroller, observer);
        }
        return observer;
    }

    const byElement = new WeakMap();
    const recordOf = (el) => (el ? byElement.get(el) : null);

    function setUp(el, scroller) {
        const source = el.dataset.source || '';
        const record = { el, view: el.querySelector('.html-view'), grip: el.querySelector('.html-grip'), iframe: null, key: el.dataset.key || keyOf(source), source, measured: null, css: '', scroller, ready: false, marks: '[]' };
        byElement.set(el, record);
        applyHeight(record);
        showZoom(record);
        if (scroller && 'IntersectionObserver' in window) observerFor(scroller).observe(record.view);
        else create(record);
        return record;
    }

    // The frames under root (or root itself) that aren't set up yet. They
    // are made once they come near the view of `scroller` (by default the
    // view they are in; root needn't be in the page yet when it is given).
    function attach(root, scroller = root.closest('.preview-scroll')) {
        sweep();
        const list = root.matches('.html-block') ? [root] : Array.from(root.querySelectorAll('.html-block'));
        list.forEach((el) => {
            if (!byElement.has(el)) setUp(el, scroller);
        });
    }

    // Show a new source in the same frame (the preview of the code editor)
    function update(el, source) {
        const record = recordOf(el);
        if (!record || record.source === source) return;
        const key = keyOf(source);
        if (zooms.has(record.key)) zooms.set(key, zooms.get(record.key));
        if (manual.has(record.key)) manual.set(key, manual.get(record.key));
        record.key = el.dataset.key = key;
        record.source = el.dataset.source = source;
        if (record.iframe) {
            record.ready = false;
            record.css = baseCss(el, zoomOf(key));
            record.iframe.srcdoc = srcdoc(source, record.css);
        }
    }

    // The preview, rendered again: the frames whose source didn't change
    // stay, in order, and the rest of the page is replaced around them. An
    // iframe taken out of the page loads again, so a frame in a list or a
    // quote (rendered anew around it) is moved into the new one with
    // moveBefore(); without it only the top-level frames stay.
    function patch(container, html) {
        const inside = (node, parent) => CAN_MOVE || node.parentNode === parent;
        const old = Array.from(container.querySelectorAll('.html-block.is-loaded')).filter((node) => inside(node, container));
        if (!old.length) {
            container.innerHTML = html;
            attach(container);
            return;
        }
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        const fresh = Array.from(tpl.content.childNodes);
        const reuse = new Map();       // new frame → old frame
        let from = 0;
        const frames = Array.from(tpl.content.querySelectorAll('.html-block')).filter((node) => inside(node, tpl.content));
        frames.forEach((node) => {
            for (let k = from; k < old.length; k++) {
                if (old[k].dataset.key === node.dataset.key) {
                    reuse.set(node, old[k]);
                    from = k + 1;
                    break;
                }
            }
        });
        // Top-level frames that stay top-level (in order) don't move at all
        const stay = new Map();
        reuse.forEach((was, node) => {
            if (node.parentNode === tpl.content && was.parentNode === container) stay.set(node, was);
        });
        // …and frames that changed places with another find theirs too
        if (CAN_MOVE) {
            const used = new Set(reuse.values());
            frames.forEach((node) => {
                const was = !reuse.has(node) && old.find((o) => !used.has(o) && o.dataset.key === node.dataset.key);
                if (!was) return;
                reuse.set(node, was);
                used.add(was);
            });
        }
        const kept = new Set(stay.values());
        const before = Array.from(container.childNodes);
        let ref = container.firstChild;
        fresh.forEach((node) => {
            const same = stay.get(node);
            if (same) ref = same.nextSibling;
            else container.insertBefore(node, ref);
        });
        // (the old page is still there, so the frames move within the page)
        reuse.forEach((was, node) => {
            if (stay.has(node)) return;
            node.parentNode.moveBefore(was, node);
            node.remove();
        });
        before.forEach((node) => {
            if (!kept.has(node) && node.parentNode === container) node.remove();
        });
        attach(container);
    }

    // --- Messages from the frames ---------------------------------------------

    window.addEventListener('message', (e) => {
        const record = records.get(e.source);
        const data = e.data;
        if (!record || !data || data[MSG] !== 1) return;
        if (data.type === 'height' && Number.isFinite(data.height)) {
            const h = Math.max(0, Math.round(data.height));
            record.measured = h;
            heights.delete(record.key);
            heights.set(record.key, h);
            if (heights.size > HEIGHTS_KEPT) heights.delete(heights.keys().next().value);
            applyHeight(record);
            sendStyle(record);
        } else if (data.type === 'open' && typeof data.href === 'string') {
            // Only for a real click in the frame (its scripts can't open tabs on their own)
            if (navigator.userActivation && !navigator.userActivation.isActive) return;
            let url = null;
            try { url = new URL(data.href); } catch (err) { /* not an address */ }
            if (url && LINK_PROTOCOLS.test(url.protocol)) {
                if (config.onOpen) config.onOpen(url.href);
                else window.open(url.href, '_blank', 'noopener');
            }
        } else if (data.type === 'key' && data.key === 'Escape' && expanded === record) {
            setExpanded(record, false);
        } else if (data.type === 'ready') {
            record.ready = true;
            sendMarks(record);
        } else if (data.type === 'pointer' && config.onPointer && record.iframe) {
            // The page hears nothing of the mouse over a frame: where it is
            // (in the page's coordinates), or null when it left; and when
            // that was (the time of the event, as performance.timeOrigin +
            // timeStamp: the frame's messages come late)
            let point = null;
            if (data.inside && Number.isFinite(data.x) && Number.isFinite(data.y)) {
                const r = record.iframe.getBoundingClientRect();
                point = { x: r.left + clamp(data.x, 0, r.width), y: r.top + clamp(data.y, 0, r.height) };
            }
            config.onPointer(record.el, point, Number(data.time));
        }
    });

    // --- Zoom ---------------------------------------------------------------------

    function showZoom(record) {
        const zoom = zoomOf(record.key);
        const label = record.el.querySelector('.html-zoom');
        if (label) {
            const text = Math.round(zoom * 100) + '%';
            label.textContent = text;
            label.setAttribute('aria-label', `缩放 ${text}，恢复 100%`);
        }
        const out = record.el.querySelector('[data-frame="zoom-out"]');
        const inc = record.el.querySelector('[data-frame="zoom-in"]');
        if (out) out.setAttribute('aria-disabled', String(zoom <= ZOOMS[0]));
        if (inc) inc.setAttribute('aria-disabled', String(zoom >= ZOOMS[ZOOMS.length - 1]));
    }

    function setZoom(record, step) {
        const zoom = zoomOf(record.key);
        let next = 1;
        if (step > 0) next = ZOOMS.find((z) => z > zoom + 0.001) || zoom;
        else if (step < 0) next = ZOOMS.slice().reverse().find((z) => z < zoom - 0.001) || zoom;
        if (next === 1) zooms.delete(record.key);
        else zooms.set(record.key, next);
        showZoom(record);
        sendStyle(record);
    }

    // --- Full screen ----------------------------------------------------------------

    const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
    const canFullscreen = (el) => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) && !!(el.requestFullscreen || el.webkitRequestFullscreen);

    function showFullscreen() {
        const current = fullscreenElement();
        document.querySelectorAll('.html-block').forEach((el) => {
            const on = el === current || (expanded && expanded.el === el);
            el.classList.toggle('is-fullscreen', on);
            const button = el.querySelector('.html-tools [data-frame="fullscreen"]');
            if (button && button.dataset.on !== String(on)) {
                button.dataset.on = String(on);
                button.innerHTML = on ? ICON.leave : ICON.full;
                button.setAttribute('aria-label', on ? '退出全屏' : '全屏查看');
                button.title = on ? '退出全屏' : '全屏查看';
            }
        });
    }

    // Without the full-screen API (an iPhone): the frame covers the window.
    // Blocks around it that contain their content (content-visibility)
    // would hold it inside them, so they let go while it is open.
    function setExpanded(record, on) {
        if (on) {
            if (expanded) setExpanded(expanded, false);
            expanded = record;
            record.released = [];
            for (let node = record.el.parentElement; node && node !== document.body; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (style.contentVisibility !== 'visible' || style.contain !== 'none') {
                    record.released.push([node, node.style.contentVisibility, node.style.contain]);
                    node.style.contentVisibility = 'visible';
                    node.style.contain = 'none';
                }
            }
            record.el.classList.add('is-expanded');
            const close = record.el.querySelector('.html-close');
            if (close) close.focus({ preventScroll: true });
        } else if (expanded === record) {
            expanded = null;
            record.el.classList.remove('is-expanded');
            (record.released || []).forEach(([node, visibility, contain]) => {
                node.style.contentVisibility = visibility;
                node.style.contain = contain;
            });
            record.released = null;
            const button = record.el.querySelector('.html-tools [data-frame="fullscreen"]');
            if (button) button.focus({ preventScroll: true });
        }
        showFullscreen();
    }

    function toggleFullscreen(record) {
        const el = record.el;
        if (expanded === record) {
            setExpanded(record, false);
            return;
        }
        if (fullscreenElement() === el) {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            return;
        }
        if (!canFullscreen(el)) {
            setExpanded(record, true);
            return;
        }
        create(record);
        const request = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        if (request && request.catch) request.catch(() => setExpanded(record, true));
    }

    document.addEventListener('fullscreenchange', showFullscreen);
    document.addEventListener('webkitfullscreenchange', showFullscreen);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && expanded && !e.defaultPrevented) {
            e.preventDefault();
            setExpanded(expanded, false);
        }
    });

    // --- The toolbar and the grip -------------------------------------------------------

    // Capture phase, so live.js sees the click as handled and doesn't start
    // editing the block
    document.addEventListener('click', (e) => {
        const button = e.target.closest && e.target.closest('.html-block [data-frame]');
        if (!button || button.dataset.frame === 'grip') return;
        const el = button.closest('.html-block');
        const record = recordOf(el);
        e.preventDefault();
        if (!record || button.getAttribute('aria-disabled') === 'true') return;
        switch (button.dataset.frame) {
            case 'edit':
                if (config.onEdit) config.onEdit(el);
                break;
            case 'zoom-in': setZoom(record, 1); break;
            case 'zoom-out': setZoom(record, -1); break;
            case 'zoom-reset': setZoom(record, 0); break;
            case 'fullscreen': toggleFullscreen(record); break;
            default: break;
        }
    }, true);

    // Dragging the grip sets the height (the frame stops following its
    // content); a double click goes back to following it
    document.addEventListener('pointerdown', (e) => {
        const grip = e.target.closest && e.target.closest('.html-grip');
        if (!grip || e.button !== 0) return;
        const record = recordOf(grip.closest('.html-block'));
        if (!record || record.el.classList.contains('is-fullscreen')) return;
        e.preventDefault();
        const startY = e.clientY;
        const startH = record.view.getBoundingClientRect().height;
        let moved = false;
        grip.setPointerCapture(e.pointerId);
        record.el.classList.add('is-resizing');
        const move = (ev) => {
            if (!moved && Math.abs(ev.clientY - startY) < 2) return;
            moved = true;
            const h = Math.round(clamp(startH + ev.clientY - startY, MIN_HEIGHT, MANUAL_MAX));
            manual.set(record.key, h);
            applyHeight(record);
        };
        const end = () => {
            record.el.classList.remove('is-resizing');
            grip.removeEventListener('pointermove', move);
            grip.removeEventListener('pointerup', end);
            grip.removeEventListener('pointercancel', end);
        };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', end);
        grip.addEventListener('pointercancel', end);
    });

    document.addEventListener('dblclick', (e) => {
        const grip = e.target.closest && e.target.closest('.html-grip');
        const record = grip && recordOf(grip.closest('.html-block'));
        if (!record) return;
        e.preventDefault();
        manual.delete(record.key);
        applyHeight(record);
    });

    // The keyboard: ↑ ↓ move the grip 20px (from the height it has), Home
    // goes back to following the content
    document.addEventListener('keydown', (e) => {
        const grip = e.target.closest && e.target.closest('.html-grip');
        const record = grip && recordOf(grip.closest('.html-block'));
        if (!record || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            const h = Math.round(record.view.getBoundingClientRect().height);
            manual.set(record.key, clamp(h + (e.key === 'ArrowDown' ? GRIP_STEP : -GRIP_STEP), MIN_HEIGHT, MANUAL_MAX));
        } else if (e.key === 'Home') {
            manual.delete(record.key);
        } else {
            return;
        }
        e.preventDefault();
        applyHeight(record);
        grip.scrollIntoView({ block: 'nearest' });
    });

    // The view's height sets the frames' highest
    window.addEventListener('resize', () => {
        records.forEach((record) => {
            if (record.el.isConnected) applyHeight(record);
        });
    });

    MDE.htmlFrames = {
        markup,
        attach,
        patch,
        update,
        estimate,
        mark,
        configure(options) {
            Object.assign(config, options);
        }
    };
})(window.MDE = window.MDE || {});
