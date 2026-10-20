// Floating tools of live mode: the slash menu (type "/" on an empty line to
// insert a block, keep typing to filter it), the formatting toolbar over
// selected text, the toolbar of the table being edited, the bubble of a
// link and the language menu of a code block. The menus and toolbars are
// popovers, so only one of them is open at a time; focus stays in the
// text, and live.js hands them their keys. The link bubble is not a
// popover: it scrolls with the text and leaves the others alone.
(function (MDE) {
    const { popover } = MDE;

    // Kinds of block shown as code-like source, where formatting makes no sense
    const PLAIN_KINDS = new Set(['code', 'html', 'def', 'hr']);
    const COARSE = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };
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
    // from app.js; editing: a block was being edited). onSlashMenu(open):
    // the slash menu opened or closed (the quick bar's "/" shows it).
    MDE.createLiveTools = function ({ live, scroller, slashMenu, toolbar, tableBar, tip, linkBubble, langMenu, links, onSlashMenu }) {
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
            const view = popover.viewport();
            const below = view.bottom - r.bottom - 16;
            const above = r.top - view.top - 16;
            list.style.maxHeight = clamp(Math.max(below, above) - foot.offsetHeight - 2, 120, 520) + 'px';
            const height = panel.offsetHeight;
            const top = height <= below || below >= above ? r.bottom + 8 : r.top - height - 8;
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
        // Selection toolbar and table toolbar
        // ====================================================================

        let dismissed = null;   // the selection ("start:end") whose toolbar was closed with Esc
        let dragging = false;
        let table = null;       // live.tableState() while the table toolbar is open

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

        // The alignment of the caret's column (none shows as left)
        function paintTableBar() {
            tableBar.querySelectorAll('[data-table][aria-pressed]').forEach((el) => {
                const align = el.dataset.table;
                el.setAttribute('aria-pressed', String(table.align === align || (!table.align && align === 'left')));
            });
        }

        function closedToolbar() {
            table = null;
            hideTip();
        }

        // Show, move or hide the toolbars: the formatting one while text is
        // selected, else the table one while a table cell is being edited
        function refresh() {
            refreshLink();
            const state = dragging ? null : live.selectionState();
            const key = state && `${state.start}:${state.end}`;
            if (dismissed && dismissed !== key) dismissed = null;
            const text = !!state && !state.collapsed && !PLAIN_KINDS.has(state.kind) && !dismissed;
            const cell = text ? null : live.tableState();
            const panel = text ? toolbar : cell ? tableBar : null;
            const anchor = text ? state.el : cell ? cell.el : null;
            const open = popover.current();
            if (open && (open.panel === toolbar || open.panel === tableBar)) {
                if (open.panel === panel && open.anchor === anchor) {
                    if (cell) {
                        table = cell;
                        paintTableBar();
                    }
                    popover.update();
                    return;
                }
                popover.close(false);
            }
            // Never push another open panel aside (a menu, the link dialog)
            if (!panel || popover.current()) return;
            table = cell;
            if (cell) paintTableBar();
            popover.open(panel, anchor, { place: cell ? placeTableBar : placeToolbar, onClose: closedToolbar });
        }

        toolbar.addEventListener('mousedown', (e) => e.preventDefault());
        tableBar.addEventListener('mousedown', (e) => e.preventDefault());
        tableBar.addEventListener('click', (e) => {
            const button = e.target.closest('[data-table]');
            if (button) live.tableCommand(button.dataset.table);
        });

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

        [toolbar, tableBar, linkBubble].forEach((bar) => {
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
        // there: then it can only be opened and copied)
        function showLink(shown, link, address, rects) {
            linkShown = shown;
            linkAddress.textContent = address;
            linkAddress.title = address;
            linkButton('open').setAttribute('aria-label', address.startsWith('#') ? '跳到文中位置' : '在新标签页打开');
            linkButton('edit').setAttribute('aria-disabled', String(!link));
            linkButton('unlink').setAttribute('aria-disabled', String(!link || MDE.links.unlink(link) === null));
            linkBubble.hidden = false;
            placeLink(rects);
        }

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
            if (link && link.rects.length) showLink({ caret: true }, link, link.url, link.rects);
            else hideLink();
        }

        function hoverLink(a) {
            linkPending = null;
            const open = popover.current();
            const busy = open && open.panel !== toolbar && open.panel !== tableBar;
            const rects = a.isConnected ? Array.from(a.getClientRects()) : [];
            if (busy || !rects.length || document.body.classList.contains('is-dragging-block')) return;
            const link = live.linkOf(a);
            showLink({ a }, link, link ? link.url : a.getAttribute('href'), rects);
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
                const href = a ? a.getAttribute('href') : link.href;
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
            } else if (current) {
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
            const items = scored.map(({ entry }) => langOption(entry.name, entry === known || (!known && entry.name === lang)));
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
                if (open && [slashMenu, toolbar, tableBar].includes(open.panel) && !open.anchor.contains(document.activeElement)) {
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
