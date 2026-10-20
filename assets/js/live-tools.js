// Floating tools of live mode: the slash menu (type "/" on an empty line to
// insert a block, keep typing to filter it) and the formatting toolbar over
// selected text. Both are popovers, so only one floating panel is open at
// a time; focus stays in the text, and live.js hands them their keys.
(function (MDE) {
    const { popover } = MDE;

    // Kinds of block shown as code-like source, where formatting makes no sense
    const PLAIN_KINDS = new Set(['code', 'html', 'def', 'hr']);
    const COARSE = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const normalize = (text) => text.toLowerCase().replace(/\s+/g, '');

    MDE.createLiveTools = function ({ live, scroller, slashMenu, toolbar, tip }) {
        const isOpen = (panel) => {
            const open = popover.current();
            return !!open && open.panel === panel;
        };

        // ====================================================================
        // Slash menu
        // ====================================================================

        const list = slashMenu.querySelector('[role="listbox"]');
        const foot = slashMenu.querySelector('.slash-foot');
        const options = Array.from(list.querySelectorAll('[role="option"]'));
        const groups = Array.from(list.querySelectorAll('[role="group"]'));
        // Each option matches its label and the words in data-match
        const terms = new Map(options.map((el) => [
            el,
            [el.querySelector('.slash-label').textContent].concat((el.dataset.match || '').split(' ')).map(normalize).filter(Boolean)
        ]));
        let shown = options;
        let best = 0;
        let index = 0;
        let slashAnchor = null;
        let lastQuery = null;

        // Show the options that match; the best match (its name starts with
        // the query, else one of its words does) is chosen first, so "/表"
        // picks 表格 over 任务列表
        function filter(query) {
            const q = normalize(query);
            let bestScore = 3;
            best = 0;
            shown = [];
            options.forEach((el) => {
                const words = terms.get(el);
                const score = !q || words[0].startsWith(q) ? 0
                    : words.some((word) => word.startsWith(q)) ? 1
                    : words.some((word) => word.includes(q)) ? 2
                    : 3;
                el.hidden = score === 3;
                if (el.hidden) return;
                if (score < bestScore) {
                    bestScore = score;
                    best = shown.length;
                }
                shown.push(el);
            });
            groups.forEach((group) => {
                group.hidden = !group.querySelector('[role="option"]:not([hidden])');
            });
            return shown.length > 0;
        }

        function select(i) {
            index = (i + shown.length) % shown.length;
            const current = shown[index];
            options.forEach((el) => el.setAttribute('aria-selected', String(el === current)));
            if (slashAnchor) slashAnchor.setAttribute('aria-activedescendant', current.id);
            // Keep it in view; the first option brings its group label along
            const top = index === 0 ? 0 : current.offsetTop - 4;
            const bottom = current.offsetTop + current.offsetHeight + 4;
            if (top < list.scrollTop) list.scrollTop = top;
            else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
        }

        // Under the "/" (above it when there is more room there), with the
        // option icons lined up with it, and only as tall as the room allows
        function placeSlash(panel) {
            const r = live.slashRect();
            panel.style.visibility = r ? '' : 'hidden';
            if (!r) return;
            const view = window.visualViewport;
            const viewportHeight = view ? Math.min(window.innerHeight, view.offsetTop + view.height) : window.innerHeight;
            const below = viewportHeight - r.bottom - 16;
            const above = r.top - 16;
            list.style.maxHeight = clamp(Math.max(below, above) - foot.offsetHeight - 2, 120, 520) + 'px';
            const height = panel.offsetHeight;
            const top = height <= below || below >= above ? r.bottom + 8 : r.top - height - 8;
            const width = panel.offsetWidth;
            panel.style.left = clamp(r.left - 16, 8, document.documentElement.clientWidth - width - 8) + 'px';
            panel.style.top = Math.max(8, top) + 'px';
        }

        function closedSlash() {
            if (slashAnchor) {
                slashAnchor.removeAttribute('aria-activedescendant');
                slashAnchor.removeAttribute('aria-controls');
            }
            slashAnchor = null;
            live.dismissSlash();
        }

        // From live.js: the text typed after "/" in the source editor el, or
        // null to close. Returns false when no block matches.
        function slash(query, el) {
            const opened = isOpen(slashMenu) && slashAnchor === el;
            // Asked again with the same text (the caret moved): keep the choice
            if (opened && query === lastQuery) return true;
            lastQuery = query;
            if (query === null || !filter(query)) {
                if (isOpen(slashMenu)) popover.close(false);
                return query === null;
            }
            if (!opened) {
                popover.close(false);
                slashAnchor = el;
                el.setAttribute('aria-controls', list.id);
                list.scrollTop = 0;
                popover.open(slashMenu, el, { place: placeSlash, onClose: closedSlash });
            } else {
                popover.update();
            }
            select(best);
            return true;
        }

        function choose(el) {
            if (el) live.applySlash(el.dataset.block);
        }

        // Focus stays in the text: the menu is used by pointer or by the
        // keys live.js passes on
        slashMenu.addEventListener('mousedown', (e) => e.preventDefault());

        // Hovering chooses too, but only when the pointer really moves: the
        // browser also reports moves when the menu opens or scrolls under a
        // resting pointer, which would undo the arrow keys' choice
        let pointer = '';
        list.addEventListener('pointermove', (e) => {
            const at = `${e.screenX},${e.screenY}`;
            if (at === pointer) return;
            pointer = at;
            const el = e.target.closest('[role="option"]');
            if (el && el !== shown[index]) select(shown.indexOf(el));
        });

        list.addEventListener('click', (e) => choose(e.target.closest('[role="option"]')));

        // ====================================================================
        // Selection toolbar
        // ====================================================================

        let barAnchor = null;
        let dismissed = null;   // the selection ("start:end") whose toolbar was closed with Esc
        let dragging = false;

        // Above the selection, centred on it; below it when there is no room
        // above, and on touch screens, where the system's own selection
        // menu sits above
        function placeToolbar(panel) {
            hideTip();
            const rect = live.selectionRect();
            panel.style.visibility = rect ? '' : 'hidden';
            if (!rect) return;
            const box = scroller.getBoundingClientRect();
            const width = panel.offsetWidth;
            const height = panel.offsetHeight;
            const above = rect.top - height - 8;
            const below = rect.bottom + 8;
            const fitsAbove = above >= box.top;
            const fitsBelow = below + height <= box.bottom;
            let top = COARSE.matches
                ? (fitsBelow || !fitsAbove ? below : above)
                : (fitsAbove || !fitsBelow ? above : below);
            if (!fitsAbove && !fitsBelow) top = box.top + 8;
            const left = rect.left + rect.width / 2 - width / 2;
            panel.style.left = clamp(left, 8, document.documentElement.clientWidth - width - 8) + 'px';
            panel.style.top = clamp(top, 8, window.innerHeight - height - 8) + 'px';
            panel.dataset.side = top < rect.top ? 'above' : 'below';
        }

        function closedToolbar() {
            barAnchor = null;
            hideTip();
        }

        // Show, move or hide the toolbar for the current selection
        function refresh() {
            const state = dragging ? null : live.selectionState();
            const key = state && `${state.start}:${state.end}`;
            if (dismissed && dismissed !== key) dismissed = null;
            const wanted = !!state && !state.collapsed && !PLAIN_KINDS.has(state.kind) && !dismissed;
            const open = popover.current();
            if (open && open.panel === toolbar) {
                if (wanted && barAnchor === state.el) {
                    popover.update();
                    return;
                }
                popover.close(false);
            }
            // Never push another open panel aside (a menu, the link dialog)
            if (!wanted || popover.current()) return;
            barAnchor = state.el;
            popover.open(toolbar, state.el, { place: placeToolbar, onClose: closedToolbar });
        }

        toolbar.addEventListener('mousedown', (e) => e.preventDefault());

        // No toolbar while a selection is being dragged out
        scroller.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'mouse' || e.button !== 0) return;
            dragging = true;
            refresh();
        });

        document.addEventListener('pointerup', () => {
            if (!dragging) return;
            dragging = false;
            requestAnimationFrame(refresh);
        }, true);

        // --- Tooltips: the button's name and shortcut ---------------------

        function showTip(button) {
            tip.textContent = button.getAttribute('aria-label');
            if (button.dataset.keys) {
                const keys = document.createElement('span');
                keys.textContent = button.dataset.keys;
                tip.appendChild(keys);
            }
            tip.hidden = false;
            const b = button.getBoundingClientRect();
            const bar = toolbar.getBoundingClientRect();
            // On the side away from the text
            const top = toolbar.dataset.side === 'below' ? bar.bottom + 6 : bar.top - tip.offsetHeight - 6;
            tip.style.left = clamp(b.left + b.width / 2 - tip.offsetWidth / 2, 8, document.documentElement.clientWidth - tip.offsetWidth - 8) + 'px';
            tip.style.top = Math.max(8, top) + 'px';
        }

        function hideTip() {
            tip.hidden = true;
        }

        toolbar.addEventListener('pointerover', (e) => {
            const button = e.target.closest('.tb');
            if (button && e.pointerType === 'mouse') showTip(button);
        });
        toolbar.addEventListener('pointerleave', hideTip);
        toolbar.addEventListener('click', hideTip);

        // ====================================================================
        // Shared
        // ====================================================================

        // Keys from the text, before live.js acts on them; true when taken
        function key(name) {
            if (isOpen(slashMenu)) {
                if (name === 'ArrowDown') select(index + 1);
                else if (name === 'ArrowUp') select(index - 1);
                else if (name === 'Enter' || name === 'Tab') choose(shown[index]);
                else if (name === 'Escape') popover.close(false);
                else return false;
                return true;
            }
            if (isOpen(toolbar) && name === 'Escape') {
                const state = live.selectionState();
                dismissed = state && `${state.start}:${state.end}`;
                popover.close(false);
                return true;
            }
            return false;
        }

        // Focus left the text (Tab, a click elsewhere): close both
        scroller.addEventListener('focusout', () => {
            requestAnimationFrame(() => {
                const open = popover.current();
                if (open && (open.panel === slashMenu || open.panel === toolbar) && !open.anchor.contains(document.activeElement)) {
                    popover.close(false);
                }
            });
        });

        return {
            slash,
            selection: refresh,
            key
        };
    };
})(window.MDE = window.MDE || {});
