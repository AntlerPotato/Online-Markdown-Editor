// Floating tools of live mode: the slash menu (type "/" on an empty line to
// insert a block, keep typing to filter it), the formatting toolbar over
// selected text, the toolbars of the table and the image being edited (and
// the image's corner handles), the bubble of a link and the language menu
// of a code block. The menus and toolbars are
// popovers, so only one of them is open at a time; focus stays in the
// text, and live.js hands them their keys. The link bubble is not a
// popover: it scrolls with the text and leaves the others alone.
(function (MDE) {
    const { popover } = MDE;

    // Kinds of block shown as code-like source, where formatting makes no sense
    const PLAIN_KINDS = new Set(['code', 'html', 'def', 'hr']);
    const COARSE = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };
    // A phone's touch screen: the quick bar and the on-screen keyboard under the text
    const PHONE = window.matchMedia ? window.matchMedia('(max-width: 640px) and (pointer: coarse)') : { matches: false };
    // On phones the view makes room under the "/" for three options of the
    // slash menu and half of the fourth (so it shows that the rest
    // scrolls); with less room the menu shrinks to one and a half before
    // it goes over the "/" line
    const SLASH_ROOM_OPTIONS = 3.5;
    const SLASH_LEAST_OPTIONS = 1.5;
    const LINK_DELAY = 300;    // ms the mouse rests on a link before its bubble shows
    const LINK_LINGER = 200;   // ms the bubble stays after the mouse leaves (time to reach it)

    // The code language menu: highlight.js names (the languages its common
    // build highlights) and the other words that find them; "" is plain text
    const LANGUAGES = [
        ['python', 'py'], ['javascript', 'js jsx node'], ['typescript', 'ts tsx'], ['bash', 'sh shell zsh'],
        ['json', ''], ['html', 'htm'], ['css', ''], ['java', ''], ['c', 'h'], ['cpp', 'c++ hpp'],
        ['csharp', 'cs c#'], ['go', 'golang'], ['rust', 'rs'], ['sql', ''], ['yaml', 'yml'],
        ['markdown', 'md'], ['php', ''], ['ruby', 'rb'], ['kotlin', 'kt'], ['swift', ''], ['xml', 'svg'],
        ['diff', 'patch'], ['scss', 'sass'], ['less', ''], ['lua', ''], ['r', ''], ['perl', 'pl'],
        ['objectivec', 'objc'], ['makefile', 'make'], ['ini', 'toml'], ['graphql', 'gql'], ['vbnet', 'vb'],
        ['', 'text txt plain plaintext 纯文本 chunwenben cwb']
    ].map(([name, words]) => ({ name, words: [name || '纯文本'].concat(words.split(' ')).filter(Boolean) }));

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const normalize = (text) => text.toLowerCase().replace(/\s+/g, '');

    // links: what the link bubble's buttons do ({ open(href), edit(link,
    // { anchor, rect, editing }), copy(url), unlink(link, { editing }) },
    // from app.js; editing: a block was being edited). replaceImage(state,
    // button): the image toolbar's 替换图片 (app.js opens the dialog).
    // onSlashMenu(open): the slash menu opened or closed (the quick bar's
    // "/" shows it).
    MDE.createLiveTools = function ({ live, scroller, slashMenu, toolbar, tableBar, imageBar, tip, linkBubble, langMenu, links, replaceImage, onSlashMenu }) {
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
        let slashRoom = false;  // just opened on a phone: room for it is still to be made

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

        // The height of the list down to option n, counting from 1 (3.5:
        // halfway through the fourth), group labels included
        function listHeightTo(n) {
            const i = Math.min(Math.ceil(n), shown.length) - 1;
            const option = shown[i];
            if (!option) return 120;
            const part = i === Math.ceil(n) - 1 ? n - i : 1;
            return Math.round(option.offsetTop + option.offsetHeight * part + 6);
        }

        // Under the "/" (above it when there is more room there), with the
        // option icons lined up with it, and only as tall as the room allows.
        // On a phone it stays under the "/", down to the quick bar at most
        // (the keyboard leaves little room above the "/" or below it): when
        // it opens the view scrolls to leave room for a few options under
        // the "/" line, and keeps it while the keyboard comes up.
        function placeSlash(panel) {
            let r = live.slashRect();
            const phone = PHONE.matches;
            if (phone && slashRoom && r) {
                slashRoom = false;
                live.keepRoom(listHeightTo(SLASH_ROOM_OPTIONS) + foot.offsetHeight + 2 + 16);
                r = live.slashRect();
            }
            const least = phone ? listHeightTo(SLASH_LEAST_OPTIONS) : 120;
            panel.style.visibility = r ? '' : 'hidden';
            if (!r) return;
            const view = popover.viewport();
            const below = view.bottom - r.bottom - 16;
            const above = r.top - view.top - 16;
            list.style.maxHeight = clamp((phone ? below : Math.max(below, above)) - foot.offsetHeight - 2, least, 520) + 'px';
            const height = panel.offsetHeight;
            // (on a phone, scrolled by hand until the room is too small: it
            // stays above the quick bar, over the "/" line)
            const top = phone ? Math.min(r.bottom + 8, view.bottom - 8 - height)
                : height <= below || below >= above ? r.bottom + 8 : r.top - height - 8;
            const width = panel.offsetWidth;
            panel.style.left = clamp(r.left - 16, 8, document.documentElement.clientWidth - width - 8) + 'px';
            panel.style.top = Math.max(view.top + 8, top) + 'px';
        }

        function closedSlash() {
            if (slashAnchor) {
                slashAnchor.removeAttribute('aria-activedescendant');
                slashAnchor.removeAttribute('aria-controls');
            }
            slashAnchor = null;
            slashRoom = false;
            live.keepRoom(0);
            live.dismissSlash();
            if (onSlashMenu) onSlashMenu(false);
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
                slashRoom = true;
                popover.open(slashMenu, el, { place: placeSlash, onClose: closedSlash });
                if (onSlashMenu) onSlashMenu(true);
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
        // Selection toolbar, table toolbar and image toolbar
        // ====================================================================

        let dismissed = null;   // the selection ("start:end") whose toolbar was closed with Esc
        let dragging = false;
        let table = null;       // live.tableState() while the table toolbar is open
        let image = null;       // live.imageState() while the image toolbar is open
        let resizing = null;    // a corner handle of the image is being dragged

        // Above the selection, centred on it; below it when there is no room
        // above, and on touch screens, where the system's own selection
        // menu sits above
        function placeToolbar(panel) {
            hideTip();
            const rect = live.selectionRect();
            panel.style.visibility = rect ? '' : 'hidden';
            if (!rect) return;
            const box = scroller.getBoundingClientRect();
            const view = popover.viewport();
            const width = panel.offsetWidth;
            const height = panel.offsetHeight;
            const above = rect.top - height - 8;
            const below = rect.bottom + 8;
            const fitsAbove = above >= box.top;
            const fitsBelow = below + height <= Math.min(box.bottom, view.bottom);
            let top = COARSE.matches
                ? (fitsBelow || !fitsAbove ? below : above)
                : (fitsAbove || !fitsBelow ? above : below);
            if (!fitsAbove && !fitsBelow) top = box.top + 8;
            const left = rect.left + rect.width / 2 - width / 2;
            panel.style.left = clamp(left, 8, document.documentElement.clientWidth - width - 8) + 'px';
            panel.style.top = clamp(top, view.top + 8, view.bottom - height - 8) + 'px';
            panel.dataset.side = top < rect.top ? 'above' : 'below';
        }

        // Above the table, at its left edge; when that is out of view, under
        // it, else just outside the cell being edited
        function placeTableBar(panel) {
            hideTip();
            const box = scroller.getBoundingClientRect();
            const view = popover.viewport();
            const bottom = Math.min(box.bottom, view.bottom);
            const rect = (table.el.querySelector('.table-wrap') || table.el).getBoundingClientRect();
            const visible = rect.bottom > box.top && rect.top < bottom;
            panel.style.visibility = visible ? '' : 'hidden';
            if (!visible) return;
            const width = panel.offsetWidth;
            const height = panel.offsetHeight;
            let top = rect.top - height - 8;
            if (top < box.top + 4) {
                const cell = table.td.getBoundingClientRect();
                top = rect.bottom + 8 + height <= bottom ? rect.bottom + 8
                    : cell.top - height - 8 >= box.top + 4 ? cell.top - height - 8
                    : cell.bottom + 8;
            }
            panel.style.left = clamp(rect.left, 8, document.documentElement.clientWidth - width - 8) + 'px';
            panel.style.top = clamp(top, view.top + 8, view.bottom - height - 8) + 'px';
            panel.dataset.side = top < rect.top ? 'above' : 'below';
        }

        // Above the image, at its left edge, in the room left for it under
        // the source; under the image when that is out of view, else at the
        // top of the view
        function placeImageBar(panel) {
            hideTip();
            const box = scroller.getBoundingClientRect();
            const view = popover.viewport();
            const top0 = Math.max(box.top, view.top);
            const bottom = Math.min(box.bottom, view.bottom);
            const rect = image.wrap.getBoundingClientRect();
            const visible = rect.bottom > top0 && rect.top < bottom;
            panel.style.visibility = visible ? '' : 'hidden';
            if (!visible) return;
            const width = panel.offsetWidth;
            const height = panel.offsetHeight;
            let top = rect.top - height - 8;
            if (top < top0 + 4) top = rect.bottom + 8 + height <= bottom ? rect.bottom + 8 : top0 + 8;
            panel.style.left = clamp(rect.left, 8, document.documentElement.clientWidth - width - 8) + 'px';
            panel.style.top = clamp(top, view.top + 8, view.bottom - height - 8) + 'px';
            panel.dataset.side = top < rect.top ? 'above' : 'below';
        }

        // Its alignment, and 50% / 100% when it is that wide
        function paintImageBar() {
            imageBar.querySelectorAll('[data-image][aria-pressed]').forEach((el) => {
                const name = el.dataset.image;
                const on = name === '50' ? image.width === '50%' : name === '100' ? image.full : image.align === name;
                el.setAttribute('aria-pressed', String(on));
            });
        }

        // The alignment of the caret's column (none shows as left), or of
        // the selected cells' columns when they share one; no deleting the
        // header row or the only column (or all of them). With several
        // rows or columns selected the delete buttons say how many.
        function paintTableBar() {
            tableBar.querySelectorAll('[data-table][aria-pressed]').forEach((el) => {
                const align = el.dataset.table;
                el.setAttribute('aria-pressed', String(table.align === align || (!table.align && align === 'left')));
            });
            const can = (name, on, label, why) => {
                const el = tableBar.querySelector(`[data-table="${name}"]`);
                el.setAttribute('aria-disabled', String(!on));
                el.setAttribute('aria-label', on ? label : `${label}（${why}）`);
            };
            const range = table.range;
            const rows = range ? range.rows : 1;
            const columns = range ? range.columns : 1;
            can('delete-row', (range ? range.top : table.row) !== 0, rows > 1 ? `删除 ${rows} 行` : '删除行', '表头不能删除');
            can('delete-column', columns < table.cols, columns > 1 ? `删除 ${columns} 列` : '删除列', columns > 1 ? '不能删除所有列' : '只剩这一列');
        }

        function closedToolbar() {
            table = null;
            image = null;
            hideTip();
        }

        const BARS = [toolbar, tableBar, imageBar];

        // Show, move or hide the toolbars: the formatting one while text is
        // selected, else the table one while a table cell is being edited,
        // else the image one while an image block is (not while a corner
        // handle is dragged)
        function refresh() {
            refreshLink();
            const state = dragging ? null : live.selectionState();
            const key = state && `${state.start}:${state.end}`;
            if (dismissed && dismissed !== key) dismissed = null;
            const text = !!state && !state.collapsed && !PLAIN_KINDS.has(state.kind) && !dismissed;
            const cell = text ? null : live.tableState();
            const pic = text || cell || dragging || resizing ? null : live.imageState();
            const panel = text ? toolbar : cell ? tableBar : pic ? imageBar : null;
            const anchor = text ? state.el : cell ? cell.el : pic ? pic.el : null;
            const open = popover.current();
            if (open && BARS.includes(open.panel)) {
                if (open.panel === panel && open.anchor === anchor) {
                    if (cell) {
                        table = cell;
                        paintTableBar();
                    }
                    if (pic) {
                        image = pic;
                        paintImageBar();
                    }
                    popover.update();
                    return;
                }
                popover.close(false);
            }
            // Never push another open panel aside (a menu, the link dialog)
            if (!panel || popover.current()) return;
            table = cell;
            image = pic;
            if (cell) paintTableBar();
            if (pic) paintImageBar();
            popover.open(panel, anchor, { place: cell ? placeTableBar : pic ? placeImageBar : placeToolbar, onClose: closedToolbar });
        }

        toolbar.addEventListener('mousedown', (e) => e.preventDefault());
        tableBar.addEventListener('mousedown', (e) => e.preventDefault());
        tableBar.addEventListener('click', (e) => {
            const button = e.target.closest('[data-table]');
            if (button && button.getAttribute('aria-disabled') !== 'true') live.tableCommand(button.dataset.table);
        });
        imageBar.addEventListener('mousedown', (e) => e.preventDefault());
        imageBar.addEventListener('click', (e) => {
            const button = e.target.closest('[data-image]');
            if (!button || !image) return;
            const name = button.dataset.image;
            if (name === 'replace') replaceImage(image, button);
            else if (name === '50' || name === '100') live.imageCommand('width', Number(name));
            else live.imageCommand(name);
        });

        // --- The selected image's corner handles: drag to change its width
        // (a percentage of the text's width, in steps of 5, 10–100). The
        // image shows the width as it goes; letting go writes it (one undo
        // step), Esc puts it back.

        function endResize(commit) {
            const r = resizing;
            if (!r) return;
            resizing = null;
            r.wrap.classList.remove('is-resizing');
            // (the width written, if any, shows once the source has it)
            r.wrap.style.width = r.width;
            r.wrap.classList.toggle('has-width', !!r.width);
            if (commit && r.percent !== null) live.imageCommand('width', r.percent);
            requestAnimationFrame(refresh);
        }

        scroller.addEventListener('pointerdown', (e) => {
            const handle = e.target.closest('.lv-img-handle');
            if (!handle || e.button !== 0) return;
            const state = live.imageState();
            const wrap = handle.parentElement;
            if (!state || state.wrap !== wrap) return;
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);
            const left = handle.dataset.corner.endsWith('w');
            resizing = {
                wrap,
                id: e.pointerId,
                x: e.clientX,
                start: wrap.getBoundingClientRect().width,
                column: wrap.parentElement.clientWidth,
                // The corner follows the pointer: a centred image grows on both sides
                factor: (left ? -1 : 1) * (state.align === 'center' ? 2 : 1),
                width: wrap.style.width,
                percent: null
            };
            wrap.querySelector('.lv-img-size').textContent = Math.round(resizing.start / resizing.column * 100) + '%';
            wrap.classList.add('is-resizing');
            refresh();
        });

        // (The handles keep focus in the source)
        scroller.addEventListener('mousedown', (e) => {
            if (e.target.closest('.lv-img-handle')) e.preventDefault();
        });

        scroller.addEventListener('pointermove', (e) => {
            const r = resizing;
            if (!r || e.pointerId !== r.id) return;
            const width = r.start + r.factor * (e.clientX - r.x);
            r.percent = clamp(Math.round(width / r.column * 20) * 5, 10, 100);
            r.wrap.style.width = r.percent + '%';
            r.wrap.classList.add('has-width');
            r.wrap.querySelector('.lv-img-size').textContent = r.percent + '%';
        });

        scroller.addEventListener('pointerup', (e) => {
            if (resizing && e.pointerId === resizing.id) endResize(true);
        });

        scroller.addEventListener('pointercancel', (e) => {
            if (resizing && e.pointerId === resizing.id) endResize(false);
        });

        window.addEventListener('keydown', (e) => {
            if (!resizing || e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            endResize(false);
        }, true);

        // No toolbar while a selection is being dragged out
        scroller.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'mouse' || e.button !== 0 || linkBubble.contains(e.target)) return;
            dragging = true;
            refresh();
        });

        document.addEventListener('pointerup', () => {
            if (!dragging) return;
            dragging = false;
            requestAnimationFrame(refresh);
        }, true);

        // --- Tooltips: the button's name and shortcut ---------------------

        function showTip(button, bar) {
            tip.textContent = button.getAttribute('aria-label');
            if (button.dataset.keys) {
                const keys = document.createElement('span');
                keys.textContent = button.dataset.keys;
                tip.appendChild(keys);
            }
            tip.hidden = false;
            const b = button.getBoundingClientRect();
            const box = bar.getBoundingClientRect();
            // On the side away from the text
            const top = bar.dataset.side === 'below' ? box.bottom + 6 : box.top - tip.offsetHeight - 6;
            tip.style.left = clamp(b.left + b.width / 2 - tip.offsetWidth / 2, 8, document.documentElement.clientWidth - tip.offsetWidth - 8) + 'px';
            tip.style.top = Math.max(8, top) + 'px';
        }

        function hideTip() {
            tip.hidden = true;
        }

        [toolbar, tableBar, imageBar, linkBubble].forEach((bar) => {
            bar.addEventListener('pointerover', (e) => {
                const button = e.target.closest('.tb');
                if (button && e.pointerType === 'mouse') showTip(button, bar);
            });
            bar.addEventListener('pointerleave', hideTip);
            bar.addEventListener('click', hideTip);
        });

        // ====================================================================
        // Link bubble
        // ====================================================================
        // Under a link the mouse rests on (in the rendered text) or the link
        // the caret is in (in the source being edited): its address, and
        // buttons to open it, edit it, copy the address and take the link
        // off. The link is looked up again when a button is used, so the
        // text may change while the bubble shows.

        const linkAddress = linkBubble.querySelector('.link-bubble-url');
        const linkButton = (name) => linkBubble.querySelector(`[data-link="${name}"]`);
        let linkShown = null;   // { a: the anchor under the mouse } or { caret: true }
        let linkPending = null; // the anchor the mouse is waiting on
        let linkTimer = 0;
        let lingerTimer = 0;

        // Under the link (above it when there is no room below), lined up
        // with its start, or with its last line's start when it wraps
        function placeLink(rects) {
            const box = scroller.getBoundingClientRect();
            const first = rects[0];
            const last = rects[rects.length - 1];
            const lastLine = rects.filter((r) => r.bottom > last.top + 2);
            const width = linkBubble.offsetWidth;
            const height = linkBubble.offsetHeight;
            let top = last.bottom + 6;
            if (top + height > box.bottom - 8 && first.top - height - 6 >= box.top + 8) top = first.top - height - 6;
            const left = clamp(Math.min(...lastLine.map((r) => r.left)), box.left + 8, box.left + scroller.clientWidth - width - 8);
            linkBubble.style.left = Math.round(left - box.left + scroller.scrollLeft) + 'px';
            linkBubble.style.top = Math.round(top - box.top + scroller.scrollTop) + 'px';
            linkBubble.dataset.side = top < first.top ? 'above' : 'below';
        }

        // link: where it is in the source (null when it can't be found
        // there: then it can only be opened and copied). href: the address
        // it opens; one that could run script (javascript:) isn't opened.
        function showLink(shown, link, address, href, rects) {
            linkShown = shown;
            linkAddress.textContent = address;
            linkAddress.title = address;
            linkButton('open').setAttribute('aria-label', address.startsWith('#') ? '跳到文中位置' : '在新标签页打开');
            linkButton('open').setAttribute('aria-disabled', String(!MDE.markdown.safeUrl(href)));
            linkButton('edit').setAttribute('aria-disabled', String(!link));
            linkButton('unlink').setAttribute('aria-disabled', String(!link || MDE.links.unlink(link) === null));
            linkBubble.hidden = false;
            placeLink(rects);
        }

        // The caret's link opens what the rendered link would: its href as
        // the browser reads the attribute ("&amp;" is "&")
        const caretHref = (link) => MDE.markdown.attrValue(link.href);

        function hideLink() {
            clearTimeout(lingerTimer);
            if (!linkShown) return;
            linkShown = null;
            linkBubble.hidden = true;
            hideTip();
        }

        // The caret's link, unless the mouse is on one
        function refreshLink() {
            if (linkShown && linkShown.a) {
                if (linkShown.a.isConnected) return;
                hideLink();
            }
            const link = dragging ? null : live.caretLink();
            if (link && link.rects.length) showLink({ caret: true }, link, link.url, caretHref(link), link.rects);
            else hideLink();
        }

        function hoverLink(a) {
            linkPending = null;
            const open = popover.current();
            const busy = open && open.panel !== toolbar && open.panel !== tableBar;
            const rects = a.isConnected ? Array.from(a.getClientRects()) : [];
            if (busy || !rects.length || document.body.classList.contains('is-dragging-block')) return;
            const link = live.linkOf(a);
            showLink({ a }, link, link ? link.url : a.getAttribute('href'), a.getAttribute('href'), rects);
        }

        // The mouse left the link and the bubble: back to the caret's link
        function linger() {
            clearTimeout(lingerTimer);
            lingerTimer = setTimeout(() => {
                hideLink();
                refreshLink();
            }, LINK_LINGER);
        }

        // The mouse on a link of the rendered text: its bubble after a
        // moment, at once when another link's bubble is showing
        scroller.addEventListener('pointerover', (e) => {
            if (e.pointerType !== 'mouse') return;
            if (linkBubble.contains(e.target)) {
                clearTimeout(lingerTimer);
                return;
            }
            const a = e.target.closest('a[href]');
            if (!a || a.closest('.toc') || e.buttons) return;
            clearTimeout(lingerTimer);
            if ((linkShown && linkShown.a === a) || linkPending === a) return;
            clearTimeout(linkTimer);
            linkPending = a;
            linkTimer = setTimeout(() => hoverLink(a), linkShown && linkShown.a ? 0 : LINK_DELAY);
        });

        scroller.addEventListener('pointerout', (e) => {
            if (e.pointerType !== 'mouse') return;
            const from = e.target.closest('a[href]') || (linkBubble.contains(e.target) ? linkBubble : null);
            const to = e.relatedTarget;
            if (!from || (to && (from.contains(to) || linkBubble.contains(to) || (linkShown && linkShown.a && linkShown.a.contains(to))))) return;
            if (from === linkPending) {
                clearTimeout(linkTimer);
                linkPending = null;
            }
            if (linkShown && linkShown.a) linger();
        });

        // A press in the text (it may start editing the link's block)
        scroller.addEventListener('pointerdown', (e) => {
            if (linkBubble.contains(e.target)) return;
            clearTimeout(linkTimer);
            linkPending = null;
            if (linkShown && linkShown.a) hideLink();
        }, true);

        window.addEventListener('resize', () => {
            if (linkShown && linkShown.a) hideLink();
            else if (linkShown) refreshLink();
        });

        linkBubble.addEventListener('mousedown', (e) => e.preventDefault());

        linkBubble.addEventListener('click', (e) => {
            const button = e.target.closest('[data-link]');
            if (!button || button.getAttribute('aria-disabled') === 'true' || !linkShown) return;
            const a = linkShown.a;
            if (a && !a.isConnected) {
                hideLink();
                return;
            }
            const link = a ? live.linkOf(a) : live.caretLink();
            if (!a && !link) {
                hideLink();
                return;
            }
            const action = button.dataset.link;
            if (action === 'open') {
                const href = a ? a.getAttribute('href') : caretHref(link);
                if (href !== null) links.open(href);
            } else if (action === 'copy') {
                links.copy(link ? link.url : a.getAttribute('href'));
            } else if (link && action === 'edit') {
                hideLink();
                links.edit(link, {
                    anchor: button,
                    rect: a ? () => (a.isConnected ? a.getBoundingClientRect() : null) : () => live.selectionRect(),
                    editing: !!live.activeElement()
                });
            } else if (link && action === 'unlink') {
                hideLink();
                links.unlink(link, { editing: !!live.activeElement() });
            }
        });

        // ====================================================================
        // Code language menu
        // ====================================================================
        // Opened from the language chip of the code block being edited (or
        // a click on the language of a rendered one): a search field over
        // the languages. Typing filters them, the arrow keys choose, Enter
        // takes the choice; a language that isn't listed can be used as
        // typed.

        const langSearch = langMenu.querySelector('input');
        const langList = langMenu.querySelector('[role="listbox"]');
        let langChip = null;
        let langShown = [];     // the options shown: { el, name }
        let langIndex = 0;

        function langOption(name, current, tag) {
            const el = document.createElement('div');
            el.className = 'menu-item lang-item' + (current ? ' is-current' : '');
            el.id = `lang-${langShown.length}`;
            el.setAttribute('role', 'option');
            el.setAttribute('aria-selected', 'false');
            el.textContent = name || '纯文本';
            if (tag) {
                const span = document.createElement('span');
                span.className = 'lang-tag';
                span.textContent = tag;
                el.appendChild(span);
            }
            if (current) {
                el.insertAdjacentHTML('beforeend', '<svg class="menu-tick" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>');
            }
            langShown.push({ el, name });
            return el;
        }

        // The languages that match the query, the best first (one of its
        // words is the query, else its name starts with it, else another
        // word does, else one holds it): "js" finds javascript before json.
        // The block's own language comes first when it isn't listed.
        function fillLanguages(query) {
            const q = normalize(query);
            const lang = langChip.dataset.lang || '';
            const own = lang.toLowerCase();
            const known = LANGUAGES.find((entry) => entry.words.includes(own) || entry.name === own);
            const entries = known || !lang ? LANGUAGES : [{ name: lang, words: [own] }].concat(LANGUAGES);
            const scored = [];
            entries.forEach((entry) => {
                const words = entry.words.map(normalize);
                const score = !q ? 0
                    : words.includes(q) ? 0
                    : words[0].startsWith(q) ? 1
                    : words.some((word) => word.startsWith(q)) ? 2
                    : words.some((word) => word.includes(q)) ? 3
                    : 4;
                if (score < 4) scored.push({ entry, score, exact: words.includes(q) });
            });
            scored.sort((a, b) => a.score - b.score);
            langShown = [];
            // html runs in a frame (html-frames.js): 可渲染
            const items = scored.map(({ entry }) => langOption(entry.name, entry === known || (!known && entry.name === lang), entry.name === 'html' ? '可渲染' : ''));
            // Any other name, as typed (an info string's first word)
            const typed = query.trim();
            if (typed && !scored.some((item) => item.exact) && /^[^\s`]+$/.test(typed)) items.push(langOption(typed, false, '使用这个名称'));
            langList.replaceChildren(...items);
            if (!items.length) {
                const empty = document.createElement('div');
                empty.className = 'lang-empty';
                empty.textContent = '没有这种语言';
                langList.appendChild(empty);
            }
            const current = q ? 0 : Math.max(0, langShown.findIndex((option) => option.el.classList.contains('is-current')));
            selectLanguage(current);
            popover.update();
        }

        function selectLanguage(i) {
            if (!langShown.length) {
                langSearch.removeAttribute('aria-activedescendant');
                return;
            }
            langIndex = (i + langShown.length) % langShown.length;
            const option = langShown[langIndex].el;
            langShown.forEach(({ el }) => el.setAttribute('aria-selected', String(el === option)));
            langSearch.setAttribute('aria-activedescendant', option.id);
            if (option.offsetTop < langList.scrollTop) langList.scrollTop = option.offsetTop - 2;
            else if (option.offsetTop + option.offsetHeight > langList.scrollTop + langList.clientHeight) {
                langList.scrollTop = option.offsetTop + option.offsetHeight - langList.clientHeight + 2;
            }
        }

        function openLanguages(chip) {
            langChip = chip;
            langSearch.value = '';
            popover.open(langMenu, chip, {
                onOpen: () => {
                    langList.scrollTop = 0;
                    fillLanguages('');
                    langSearch.focus();
                },
                onClose: () => {
                    langChip = null;
                }
            });
        }

        function chooseLanguage(option) {
            if (!option) return;
            popover.close(false);
            live.setCodeLanguage(option.name);
        }

        langMenu.addEventListener('mousedown', (e) => {
            if (e.target !== langSearch) e.preventDefault();
        });

        langSearch.addEventListener('input', () => fillLanguages(langSearch.value));

        langSearch.addEventListener('keydown', (e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === 'ArrowDown') selectLanguage(langIndex + 1);
            else if (e.key === 'ArrowUp') selectLanguage(langIndex - 1);
            else if (e.key === 'Enter') chooseLanguage(langShown[langIndex]);
            else if (e.key === 'Tab') popover.close(true);
            else return;
            e.preventDefault();
        });

        let langPointer = '';
        langList.addEventListener('pointermove', (e) => {
            const at = `${e.screenX},${e.screenY}`;
            if (at === langPointer) return;
            langPointer = at;
            const index = langShown.findIndex(({ el }) => el === e.target.closest('[role="option"]'));
            if (index !== -1 && index !== langIndex) selectLanguage(index);
        });

        langList.addEventListener('click', (e) => {
            const el = e.target.closest('[role="option"]');
            chooseLanguage(langShown.find((option) => option.el === el));
        });

        // The chip: a click, or ↓ / ↑ on it
        scroller.addEventListener('click', (e) => {
            const chip = e.target.closest('.lv-lang');
            if (chip) {
                if (isOpen(langMenu)) popover.close(true);
                else openLanguages(chip);
                return;
            }
            // The language of a rendered code block: live.js has just
            // started editing it
            if (e.target.closest('.code-lang') && !e.defaultPrevented) {
                const el = live.activeElement();
                const active = el && el.querySelector('.lv-lang');
                if (active) openLanguages(active);
            }
        });

        scroller.addEventListener('keydown', (e) => {
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.classList.contains('lv-lang') && !isOpen(langMenu)) {
                e.preventDefault();
                openLanguages(e.target);
            }
        });

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

        // Focus left the text (Tab, a click elsewhere): close them
        scroller.addEventListener('focusout', () => {
            requestAnimationFrame(() => {
                const open = popover.current();
                if (open && [slashMenu, toolbar, tableBar, imageBar].includes(open.panel) && !open.anchor.contains(document.activeElement)) {
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
