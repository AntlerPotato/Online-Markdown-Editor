// HTML blocks (```html): each is shown in an iframe sandboxed with only
// "allow-scripts" (its scripts run, but it has an opaque origin: it can't
// reach the editor's page or its storage). markdown.js writes a frame's
// box with the source in data-source; the iframe is made once the box comes
// near the view, and a small script put in front of the HTML tells the
// editor how tall the content is, passes link clicks out and takes the
// editor's colours and fonts. Bottom right: zoom, full screen, and a grip
// that sets the height by hand. Zoom and heights are kept for this visit
// only, by the block's source.
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
    // Editor tokens handed to the frame, so its HTML can use var(--accent)…
    const TOKENS = ['accent', 'accent-soft', 'accent-ring', 'on-accent', 'bg', 'surface', 'surface-sunken', 'surface-muted',
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
    // takes style updates, sends link clicks (and Esc) out
    const HELPER = `(function () {
var M = '${MSG}';
function post(data) { data[M] = 1; parent.postMessage(data, '*'); }
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
    const config = { onOpen: null, onEdit: null };
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
            + '<span class="html-grip" data-frame="grip" aria-hidden="true" title="拖动改变高度，双击恢复自动"></span>'
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
            + ':where(code,kbd,pre,samp){font-family:var(--font-code)}';
    }

    function srcdoc(source, css) {
        return '<!doctype html><html><head><meta charset="utf-8">'
            + '<meta name="viewport" content="width=device-width, initial-scale=1">'
            + `<style id="mde-base">${css}</style>`
            + `<script>${HELPER}<\/script>`
            + `</head><body>${source}</body></html>`;
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
        const record = { el, view: el.querySelector('.html-view'), iframe: null, key: el.dataset.key || keyOf(source), source, measured: null, css: '', scroller };
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
            record.css = baseCss(el, zoomOf(key));
            record.iframe.srcdoc = srcdoc(source, record.css);
        }
    }

    // The preview, rendered again: the frames whose source didn't change
    // stay (an iframe moved in the page would load again), in order, and
    // the rest of the page is replaced around them
    function patch(container, html) {
        const old = Array.from(container.children).filter((node) => node.matches('.html-block.is-loaded'));
        if (!old.length) {
            container.innerHTML = html;
            attach(container);
            return;
        }
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        const fresh = Array.from(tpl.content.childNodes);
        const reuse = new Map();
        let from = 0;
        fresh.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE || !node.matches('.html-block')) return;
            for (let k = from; k < old.length; k++) {
                if (old[k].dataset.key === node.dataset.key) {
                    reuse.set(node, old[k]);
                    from = k + 1;
                    break;
                }
            }
        });
        const kept = new Set(reuse.values());
        Array.from(container.childNodes).forEach((node) => {
            if (!kept.has(node)) node.remove();
        });
        let ref = container.firstChild;
        fresh.forEach((node) => {
            const same = reuse.get(node);
            if (same) ref = same.nextSibling;
            else container.insertBefore(node, ref);
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
        configure(options) {
            Object.assign(config, options);
        }
    };
})(window.MDE = window.MDE || {});
