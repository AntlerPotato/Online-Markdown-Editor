// The block handles of live mode: a grip beside the block being edited and
// another beside the block under the mouse, which open the block menu or
// drag the block to another place; beside an empty line the grip is a "+"
// that opens the slash menu. The menu converts a block to another type, opens an
// empty line under it, copies it, or deletes it.
(function (MDE) {
    const { popover } = MDE;

    const COARSE = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };
    const DRAG_DISTANCE = 4;   // px the pointer moves before a press on the grip becomes a drag
    const EDGE = 48;           // px from the top or bottom of the view where a drag scrolls it
    const CONVERTIBLE = new Set(['paragraph', 'heading', 'quote', 'list', 'fence', 'code', 'math']);
    const LIST_MARK = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/;
    const FENCE = /^ {0,3}(`{3,}|~{3,})/;
    const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    // A block's text without its block syntax, line by line
    function plainLines({ kind, source }) {
        const lines = source.split('\n');
        switch (kind) {
            case 'heading':
                // "# Title", or "Title" over a line of = or -
                if (lines.length > 1) return lines.slice(0, -1);
                return [lines[0].replace(/^ {0,3}#{1,6}(?:[ \t]+|$)/, '').replace(/[ \t]+#+[ \t]*$/, '')];
            case 'quote':
                return lines.map((line) => line.replace(/^ {0,3}>[ \t]?/, ''));
            case 'list':
                return lines.map((line) => line.replace(LIST_MARK, '').trim());
            case 'fence':
            case 'math': {
                if (!FENCE.test(lines[0])) return source.trim().slice(2, -2).replace(/^\n|\n$/g, '').split('\n');
                const body = lines.slice(1);
                if (body.length && FENCE_CLOSE.test(body[body.length - 1])) body.pop();
                return body;
            }
            case 'code':
                return lines.map((line) => line.replace(/^(?: {4}|\t)/, ''));
            default:
                return lines;
        }
    }

    // The type the block menu shows as current
    function typeOf({ kind, depth }) {
        if (kind === 'paragraph') return 'p';
        if (kind === 'heading') return depth <= 2 ? 'h' + depth : null;
        if (kind === 'quote') return 'quote';
        if (kind === 'fence' || kind === 'code') return 'code';
        return null;
    }

    // The block as another type: its new source, and where the caret goes
    function convert(info, type) {
        const lines = plainLines(info);
        const text = lines.join('\n');
        if (type === 'h1' || type === 'h2') {
            return { source: (type === 'h1' ? '# ' : '## ') + lines.map((line) => line.trim()).filter(Boolean).join(' ') };
        }
        if (type === 'quote') return { source: lines.map((line) => '> ' + line).join('\n') };
        if (type === 'code') {
            let fence = '```';
            while (text.includes(fence)) fence += '`';
            return { source: `${fence}\n${text}\n${fence}`, caret: fence.length + 1 + text.length };
        }
        return { source: text };
    }

    MDE.createLiveBlocks = function ({ live, root, scroller, handle, dropLine, menu, copy, toast }) {
        const main = menu.querySelector('.block-menu-main');
        const sub = menu.querySelector('.block-menu-sub');
        const convertItem = main.querySelector('[data-block-action="convert"]');
        const itemsOf = (panel) => Array.from(panel.querySelectorAll('[role^="menuitem"]'));

        // Two handles: one stays beside the block being edited, the other
        // follows the mouse to the block under it
        const edited = { el: handle, block: null, placed: '' };
        const pointed = { el: handle.cloneNode(true), block: null, placed: '' };
        pointed.el.removeAttribute('id');
        handle.after(pointed.el);

        let pointer = null;      // the mouse, while it is over the live view (frame: in this HTML block's frame)
        let pageMoved = 0;       // when the page last heard of the mouse moving (performance.timeOrigin + timeStamp)
        let hovered = null;      // the block element under it
        let menuFrom = null;     // the handle whose menu is open
        let menuEditing = false; // a block was being edited when the menu opened
        let drag = null;
        let suppressClick = false;
        let slashWasOpen = false;  // pressed the "+" of the block the slash menu was open for
        let frame = 0;

        // ====================================================================
        // The handles
        // ====================================================================

        // The block at height y (anywhere across the view, margins too)
        function blockAtY(y) {
            const box = root.getBoundingClientRect();
            const hit = document.elementFromPoint(box.left + box.width / 2, y);
            const el = hit && hit.closest('.lv-block');
            return el && el.parentElement === root ? el : null;
        }

        // The block under the mouse; in the space between two blocks, the
        // one it was over a moment ago
        function blockUnderPointer() {
            if (!pointer || COARSE.matches) return null;
            const el = blockAtY(pointer.y);
            if (el || !hovered || !hovered.isConnected) return el;
            const r = hovered.getBoundingClientRect();
            return pointer.y > r.top - 40 && pointer.y < r.bottom + 40 ? hovered : null;
        }

        // Height of the middle of a block's first line, so the handle lines
        // up with it
        function firstLineMiddle(el, rect) {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            const range = document.createRange();
            let node;
            for (let n = 0; (node = walker.nextNode()) && n < 40; n++) {
                if (!node.data.trim() || node.parentElement.closest('.katex-mathml, .line-numbers, .html-block')) continue;
                range.selectNodeContents(node);
                const r = range.getClientRects()[0];
                if (!r || !r.height) continue;
                if (r.top - rect.top > 80) break;
                return (r.top + r.bottom) / 2;
            }
            const line = parseFloat(getComputedStyle(el).lineHeight) || 28;
            return rect.top + Math.min(rect.height, line) / 2;
        }

        function show(h, el) {
            const info = el && live.blockInfo(el);
            if (!info) {
                h.el.hidden = true;
                h.block = null;
                h.placed = '';
                return;
            }
            const box = scroller.getBoundingClientRect();
            const rect = el.getBoundingClientRect();
            const left = Math.round(rect.left - box.left + scroller.scrollLeft);
            const top = Math.round(firstLineMiddle(el, rect) - box.top + scroller.scrollTop - 12);
            // An empty line, or the "/" line of an open slash menu: a "+"
            const add = info.gap || info.slash;
            const key = `${add}:${info.active}:${left}:${top}`;
            h.block = el;
            h.el.hidden = false;
            if (key === h.placed) return;
            h.placed = key;
            h.el.dataset.kind = add ? 'add' : 'grip';
            h.el.classList.toggle('is-active', info.active);
            h.el.setAttribute('aria-label', add ? '插入块' : '块菜单');
            h.el.style.left = left + 'px';
            h.el.style.top = top + 'px';
        }

        function update() {
            frame = 0;
            if (drag && drag.started) return;
            hovered = blockUnderPointer();
            const active = live.activeElement();
            show(edited, active);
            // While a menu is open, its handle stays where it is
            if (menuFrom === pointed) return;
            show(pointed, menuFrom || hovered === active ? null : hovered);
        }

        function schedule() {
            if (!frame) frame = requestAnimationFrame(update);
        }

        scroller.addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'mouse') return;
            pointer = { x: e.clientX, y: e.clientY };
            schedule();
        }, { passive: true });

        scroller.addEventListener('pointerleave', () => {
            pointer = null;
            schedule();
        });

        // The mouse over the page again, outside the live view: it left the
        // frame it was in (no pointerleave: the page didn't see it go in)
        document.addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'mouse') return;
            pageMoved = performance.timeOrigin + e.timeStamp;
            if (pointer && pointer.frame && !scroller.contains(e.target)) {
                pointer = null;
                schedule();
            }
        }, { capture: true, passive: true });

        scroller.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);

        function clickHandle(h) {
            if (suppressClick) {
                suppressClick = false;
                return;
            }
            // Pressing it closed the slash menu: that is all it does
            if (slashWasOpen) {
                slashWasOpen = false;
                return;
            }
            const el = h.block;
            const info = el && live.blockInfo(el);
            if (!info) return;
            if (info.gap) {
                popover.close(false);
                live.startSlash();
            } else if (menuFrom) {
                popover.close(true);
            } else {
                openMenu(h, el, info);
            }
        }

        // ====================================================================
        // Block menu
        // ====================================================================

        function openSub(focus) {
            if (convertItem.getAttribute('aria-disabled') === 'true') return;
            if (sub.hidden) {
                sub.hidden = false;
                convertItem.setAttribute('aria-expanded', 'true');
                popover.update();
            }
            if (focus) (sub.querySelector('[aria-checked="true"]') || itemsOf(sub)[0]).focus();
        }

        function closeSub(focus) {
            if (!sub.hidden) {
                sub.hidden = true;
                convertItem.setAttribute('aria-expanded', 'false');
                popover.update();
            }
            if (focus) convertItem.focus();
        }

        function openMenu(h, el, info) {
            const type = typeOf(info);
            convertItem.setAttribute('aria-disabled', String(!CONVERTIBLE.has(info.kind)));
            itemsOf(sub).forEach((item) => item.setAttribute('aria-checked', String(item.dataset.convert === type)));
            sub.hidden = true;
            convertItem.setAttribute('aria-expanded', 'false');
            menuFrom = h;
            menuEditing = !!live.activeElement();
            popover.open(menu, h.el, {
                onOpen: () => itemsOf(main)[0].focus(),
                onClose: () => {
                    menuFrom = null;
                    schedule();
                },
                returnFocus: () => {
                    if (menuEditing) live.focus();
                }
            });
        }

        // Copy what the block shows (rich text, and its plain text), without
        // the code block's buttons and line numbers (an HTML block: its code)
        function copyRendered(el, info) {
            const probe = document.createElement('div');
            probe.className = 'markdown-preview';
            probe.style.cssText = 'position: fixed; top: 0; left: -10000px; width: 720px;';
            probe.innerHTML = live.blockHtml(el);
            probe.querySelectorAll('.code-block-head, .line-numbers').forEach((node) => node.remove());
            // An HTML block: its source, as code
            probe.querySelectorAll('.html-block').forEach((node) => {
                const pre = document.createElement('pre');
                const code = document.createElement('code');
                code.textContent = node.dataset.source || '';
                pre.appendChild(code);
                node.replaceWith(pre);
            });
            document.body.appendChild(probe);
            const html = probe.innerHTML;
            probe.querySelectorAll('.katex-mathml').forEach((node) => node.remove());
            const plain = probe.innerText.trim();
            probe.remove();
            return copy(plain || info.source, html);
        }

        function act(item, el, info) {
            const action = item.dataset.blockAction;
            if (item.dataset.convert) {
                if (item.dataset.convert === typeOf(info)) {
                    if (menuEditing) live.focus();
                    return;
                }
                const next = convert(info, item.dataset.convert);
                live.replaceBlock(el, next.source, next.caret);
            } else if (action === 'below') {
                live.insertBelow(el);
            } else if (action === 'delete') {
                live.removeBlock(el);
            } else if (action === 'copy' || action === 'copy-md') {
                const done = action === 'copy' ? copyRendered(el, info) : copy(info.source);
                done.then((ok) => toast(ok ? (action === 'copy' ? '已复制这一块' : '已复制为 Markdown') : '复制失败', ok));
                if (menuEditing) live.focus();
            }
        }

        menu.addEventListener('click', (e) => {
            const item = e.target.closest('[role^="menuitem"]');
            if (!item || item.getAttribute('aria-disabled') === 'true') return;
            if (item === convertItem) {
                if (sub.hidden) openSub(true);
                else closeSub(true);
                return;
            }
            const el = menuFrom && menuFrom.block;
            popover.close(false);
            const info = el && live.blockInfo(el);
            if (info) act(item, el, info);
        });

        // The mouse opens "转换为" by pointing at it
        main.addEventListener('pointerover', (e) => {
            if (e.pointerType !== 'mouse') return;
            const item = e.target.closest('[role^="menuitem"]');
            if (item === convertItem) openSub(false);
            else if (item) closeSub(false);
        });

        // Arrow keys move between the items; → opens "转换为", ← and Esc
        // go back from it (Esc in the first menu closes, in popover.js)
        menu.addEventListener('keydown', (e) => {
            const inSub = sub.contains(e.target);
            const items = itemsOf(inSub ? sub : main);
            const index = items.indexOf(document.activeElement);
            let next = null;
            switch (e.key) {
                case 'ArrowDown': next = items[(index + 1) % items.length]; break;
                case 'ArrowUp': next = items[(index - 1 + items.length) % items.length]; break;
                case 'Home': next = items[0]; break;
                case 'End': next = items[items.length - 1]; break;
                case 'ArrowRight':
                    if (e.target === convertItem) openSub(true);
                    break;
                case 'ArrowLeft':
                    if (inSub) closeSub(true);
                    break;
                case 'Escape':
                    if (!inSub) return;
                    e.stopPropagation();
                    closeSub(true);
                    break;
                case 'Tab':
                    popover.close(true);
                    break;
                default:
                    return;
            }
            e.preventDefault();
            if (next) next.focus();
        });

        // ====================================================================
        // Dragging a block
        // ====================================================================

        const blockSibling = (el, back) => {
            let node = back ? el.previousElementSibling : el.nextElementSibling;
            while (node && !node.classList.contains('lv-block')) node = back ? node.previousElementSibling : node.nextElementSibling;
            return node;
        };

        // Where a block dropped at height y goes: in front of blocks[index]
        function dropAt(y) {
            let el = null;
            for (let d = 0; d <= 64 && !el; d += 8) el = blockAtY(y - d) || blockAtY(y + d);
            const info = el && live.blockInfo(el);
            if (!info) return null;
            const r = el.getBoundingClientRect();
            const before = info.gap || y < (r.top + r.bottom) / 2;
            return { el, before, index: info.gap ? info.index : info.index + (before ? 0 : 1) };
        }

        // The line between the blocks where the dragged one would land
        function showLine(target) {
            const from = live.blockInfo(drag.el);
            if (!from || target.index === from.index || target.index === from.index + 1) {
                dropLine.hidden = true;
                return;
            }
            const r = target.el.getBoundingClientRect();
            const next = blockSibling(target.el, target.before);
            const s = next && next.getBoundingClientRect();
            const y = target.before ? (s ? (s.bottom + r.top) / 2 : r.top - 4) : (s ? (r.bottom + s.top) / 2 : r.bottom + 4);
            const box = scroller.getBoundingClientRect();
            const doc = root.getBoundingClientRect();
            const style = getComputedStyle(root);
            const left = doc.left + parseFloat(style.paddingLeft);
            dropLine.style.top = Math.round(y - box.top + scroller.scrollTop - 1) + 'px';
            dropLine.style.left = Math.round(left - box.left + scroller.scrollLeft) + 'px';
            dropLine.style.width = Math.round(doc.right - parseFloat(style.paddingRight) - left) + 'px';
            dropLine.hidden = false;
        }

        // Follow the pointer; near the top or bottom of the view, scroll
        function track() {
            const box = scroller.getBoundingClientRect();
            const y = drag.y;
            drag.speed = y < box.top + EDGE ? -Math.ceil((box.top + EDGE - y) / 4)
                : y > box.bottom - EDGE ? Math.ceil((y - box.bottom + EDGE) / 4)
                : 0;
            // Between blocks (no block within reach) the last place holds
            const target = dropAt(clamp(y, box.top + 2, box.bottom - 2));
            if (target) {
                showLine(target);
                drag.index = dropLine.hidden ? -1 : target.index;
            }
            if (drag.speed && !drag.frame) {
                drag.frame = requestAnimationFrame(() => {
                    drag.frame = 0;
                    const before = scroller.scrollTop;
                    scroller.scrollTop += drag.speed;
                    if (scroller.scrollTop !== before) track();
                });
            }
        }

        function startDrag() {
            drag.started = true;
            popover.close(false);
            drag.el.classList.add('is-dragged');
            drag.handle.classList.add('is-dragging');
            document.body.classList.add('is-dragging-block');
        }

        function endDrag(move) {
            const d = drag;
            drag = null;
            if (d.frame) cancelAnimationFrame(d.frame);
            if (d.handle.hasPointerCapture(d.id)) d.handle.releasePointerCapture(d.id);
            if (!d.started) return;
            // The click that follows the release is not a click on the grip
            suppressClick = true;
            d.el.classList.remove('is-dragged');
            d.handle.classList.remove('is-dragging');
            document.body.classList.remove('is-dragging-block');
            dropLine.hidden = true;
            edited.placed = pointed.placed = '';
            if (move && d.index !== -1) live.moveBlock(d.el, d.index);
            schedule();
        }

        [edited, pointed].forEach((h) => {
            // Focus stays in the text
            h.el.addEventListener('mousedown', (e) => e.preventDefault());
            h.el.addEventListener('click', () => clickHandle(h));

            h.el.addEventListener('pointerdown', (e) => {
                suppressClick = false;
                if (e.button !== 0 || h.el.dataset.kind !== 'grip' || !h.block) return;
                drag = { id: e.pointerId, handle: h.el, el: h.block, x: e.clientX, y: e.clientY, started: false, index: -1, speed: 0, frame: 0 };
                h.el.setPointerCapture(e.pointerId);
            });

            h.el.addEventListener('pointermove', (e) => {
                if (!drag || e.pointerId !== drag.id) return;
                if (!drag.started) {
                    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_DISTANCE) return;
                    startDrag();
                }
                drag.y = e.clientY;
                track();
            });

            h.el.addEventListener('pointerup', (e) => {
                if (drag && e.pointerId === drag.id) endDrag(true);
            });

            h.el.addEventListener('pointercancel', (e) => {
                if (drag && e.pointerId === drag.id) endDrag(false);
            });
        });

        // Pressing the "+" of the line the slash menu is open for closes the
        // menu (as a press outside it does, in popover.js); its click must
        // not open the menu again. Window capture runs before popover.js.
        window.addEventListener('pointerdown', (e) => {
            const h = [edited, pointed].find((x) => x.el.contains(e.target));
            const info = h && h.block && live.blockInfo(h.block);
            slashWasOpen = !!info && info.slash;
        }, true);

        // Esc puts the block back
        document.addEventListener('keydown', (e) => {
            if (!drag || !drag.started || e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            endDrag(false);
        }, true);

        return {
            // The blocks or the caret changed: place the handle again
            refresh: schedule,
            // The mouse moved in an HTML block's frame (at point, in the
            // page), or out of it (null): the page itself hears nothing of
            // the mouse in there (html-frames.js says). Not when the page
            // heard of the mouse later (it has left the frame since).
            pointAt(frameEl, point, time) {
                if (!root.contains(frameEl) || (Number.isFinite(time) && time <= pageMoved)) return;
                if (point) pointer = { x: point.x, y: point.y, frame: frameEl };
                else if (pointer && pointer.frame === frameEl) pointer = null;
                else return;
                schedule();
            }
        };
    };
})(window.MDE = window.MDE || {});
