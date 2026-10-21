// Annotations in the page: made from the selection toolbar's "标注" (or
// Ctrl+Alt+M, or the command palette) in a small dialog, marked in the
// live view and the preview (a tint under the text and a number before
// it), listed in the panel beside the document and copied out together
// as text for an AI. They are kept in this browser (mde:annotations),
// never in the .md file. annotations.js has the parts that need no page.
(function (MDE) {
    const { store, popover } = MDE;
    const A = MDE.annotations;

    const HISTORY_LIMIT = 100;
    const PHRASES = ['看不懂，换个说法', '删掉', '写详细一点', '待定'];
    const PANEL_WIDTH = 372;
    const SIDEBAR_WIDTH = 240;
    const MIN_PANES = 600;      // less room than this beside the panel: it covers the document instead
    const VISIBLE_CACHE = 600;
    const MARKS = typeof Highlight === 'function' && !!(window.CSS && CSS.highlights);
    const MATHML = 'http://www.w3.org/1998/Math/MathML';
    const KEYS = /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? '⌘⌥M' : 'Ctrl+Alt+M';
    // Rendered parts whose text is not the document's (labels, line
    // numbers, KaTeX's drawing of a formula: its TeX is in the MathML; an
    // HTML block's frame, whose text can't be reached)
    const SKIP = '.code-block-head, .line-numbers, .katex-html, .toc, .ann-mark, .lv-raw, .lv-media, .html-block, script, style';

    const STATUS = { new: '未复制', gone: '原文已删除', same: '已复制 · 原文未改动', changed: '已复制 · 原文已改动' };
    const ICON = {
        quote: '<svg class="ann-quote-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h4v4c0 3-1.5 5-4 6"/><path d="M14 7h4v4c0 3-1.5 5-4 6"/></svg>',
        check: '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
        edit: '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
        trash: '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
        restore: '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
        plus: '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
        close: '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
    };

    const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const pad = (n) => String(n).padStart(2, '0');
    const when = (time) => {
        const d = new Date(time);
        return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    // What a stored entry must have; anything else is dropped
    function clean(x) {
        if (!x || typeof x !== 'object' || typeof x.note !== 'string' || typeof x.quote !== 'string') return null;
        const num = (v) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
        const item = {
            id: typeof x.id === 'string' && x.id ? x.id : newId(),
            from: num(x.from),
            to: num(x.to),
            quote: x.quote,
            before: typeof x.before === 'string' ? x.before : '',
            note: x.note,
            copied: typeof x.copied === 'string' ? x.copied : null,
            created: num(x.created)
        };
        if (item.to < item.from) item.to = item.from;
        if (typeof x.removed === 'number') {
            item.removed = x.removed;
            item.where = typeof x.where === 'string' ? x.where : '';
        }
        return item;
    }

    // view() → the view mode; fileName(); phone() and narrow(): the
    // window is a phone's / narrower than the outline needs; sidebar():
    // the outline shows; focusText(): back to the text being edited;
    // copyText(text) → Promise<ok>; toast(message, ok); onLayout(): the
    // document's width changed. tabButton: the panel's button in the top
    // bar (the dialog's anchor when it isn't opened from a button).
    MDE.createAnnotate = function (options) {
        const {
            editor, live, liveDoc, liveScroll, preview, previewScroll, textarea, backdrop,
            panel, dialog, tabButton, view, fileName, phone, narrow, sidebar, focusText, copyText, toast, onLayout
        } = options;
        const q = (selector) => panel.querySelector(selector);
        const list = q('.ann-list');
        const empty = q('.ann-empty');
        const counts = q('.ann-counts');
        const copyButton = q('[data-ann="copy"]');
        const copyLabel = copyButton.querySelector('span');
        const currentFoot = q('.ann-foot-current');
        const historyFoot = q('.ann-foot-history');
        const closeButton = q('[data-ann="close"]');
        const input = dialog.querySelector('input');
        const phrasesBox = dialog.querySelector('.ann-phrases');
        const placeholder = input.placeholder;

        let items = [];         // { id, from, to, quote, before, note, copied, created }
        let history = [];       // the same, with removed (time) and where (its section and line)
        let phrases = [];       // the user's own phrases
        let open = false;
        let tab = 'current';
        let current = null;     // id of the annotation marked as current
        let lastText = null;    // the document the passages were last placed in
        let editing = null;     // the dialog: { mode: 'new', from, to, start, end } or { mode: 'edit', id }
        let listTimer = 0;
        let drawFrame = 0;

        // --- Keeping them -------------------------------------------------------

        function save() {
            const plain = ({ typing, ...item }) => item;
            store.set('annotations', { items: items.map(plain), history: history.map(plain) });
        }

        function load(text) {
            const saved = store.get('annotations', null) || {};
            items = (Array.isArray(saved.items) ? saved.items : []).map(clean).filter((x) => x && !('removed' in x));
            history = (Array.isArray(saved.history) ? saved.history : []).map(clean).filter((x) => x && 'removed' in x).slice(0, HISTORY_LIMIT);
            items.forEach((item) => A.relocate(item, text));
            phrases = (store.get('phrases', []) || []).filter((p) => typeof p === 'string' && p.trim() && !PHRASES.includes(p));
            lastText = text;
            fillPhrases();
            setOpen(store.get('annotationPanel', false) === true && !phone(), false);
            refresh();
        }

        // In document order; those whose text is gone come without a number
        function ordered() {
            let n = 0;
            return items.slice()
                .sort((x, y) => x.from - y.from || x.to - y.to || x.created - y.created)
                .map((item) => ({ item, n: item.from < item.to ? ++n : null }));
        }

        function statusOf(item, text) {
            if (item.copied === null) return item.from < item.to ? 'new' : 'gone';
            return text.slice(item.from, item.to) === item.copied ? 'same' : 'changed';
        }

        let headingsText = null;
        let headingsList = [];
        function headings(text) {
            if (text !== headingsText) {
                headingsText = text;
                headingsList = MDE.outline.headingsOf(text);
            }
            return headingsList;
        }

        // "一、本次改进 › 细节 · 第 6 行"
        function whereOf(text, pos, line = A.linesOf(text, [pos])[0]) {
            return A.sectionOf(headings(text), pos).concat(`第 ${line} 行`).join(' › ').replace(/ › (第 \d+ 行)$/, ' · $1');
        }

        // --- The document changed --------------------------------------------------

        // change: { start, end, length } when the editor knows it
        function changed(change) {
            const text = editor.getValue();
            if (lastText === null || text === lastText) return;
            if (items.length) {
                const fits = change && lastText.length - (change.end - change.start) + change.length === text.length;
                A.follow(items, fits ? change : A.diff(lastText, text), text);
                if (open) scheduleList(text.length);
                scheduleDraw();
            }
            lastText = text;
        }

        // A new or imported document: its annotations go to the history
        function archiveAll() {
            const text = editor.getValue();
            const lines = A.linesOf(text, items.map((item) => item.from));
            items.forEach((item, i) => remember(item, text, lines[i]));
            items = [];
            current = null;
            save();
            refresh();
        }

        function remember(item, text, line) {
            history.unshift({ ...item, removed: Date.now(), where: whereOf(text, item.from, line) });
            if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
        }

        // --- Making and changing one ------------------------------------------------

        // A box at the end of the source editor's selection: the line it is on
        function sourceRect(pos) {
            const line = editor.getValue().slice(0, pos).split('\n').length - 1;
            const row = backdrop.children[Math.min(line, backdrop.children.length - 1)];
            const box = textarea.getBoundingClientRect();
            const r = row ? row.getBoundingClientRect() : box;
            const top = Math.min(Math.max(r.top, box.top), box.bottom - 24);
            const bottom = Math.min(Math.max(r.bottom, box.top + 24), box.bottom);
            return { top, bottom, left: box.left + 48, right: box.right, width: 0, height: bottom - top };
        }

        function activeRect() {
            const block = live.activeElement();
            return block ? block.getBoundingClientRect() : liveScroll.getBoundingClientRect();
        }

        // A new annotation on the selection (from the toolbar's button,
        // the shortcut or the command palette): false when nothing is
        // selected
        function start(anchor) {
            const mode = view();
            if (mode === 'preview') return false;
            if (mode === 'live') live.captureSelection();
            const sel = editor.getSelection();
            const [from, to] = A.trimSelection(sel.value, sel.start, sel.end);
            if (from === to) {
                toast('先选中要标注的文字', false);
                return false;
            }
            editing = { mode: 'new', from, to, start: sel.start, end: sel.end };
            const n = ordered().filter((o) => o.n !== null && o.item.from <= from).length + 1;
            const rect = mode === 'live' ? () => live.selectionRect() || activeRect() : () => sourceRect(to);
            // (not the text itself: a click there must close the dialog)
            showDialog(anchor && anchor.isConnected && anchor.offsetParent !== null ? anchor : tabButton, rect, {
                n, title: '新标注', submit: '添加', where: whereOf(sel.value, from), note: ''
            });
            return true;
        }

        function edit(id) {
            const item = items.find((x) => x.id === id);
            const row = list.querySelector(`[data-id="${id}"]`);
            if (!item || !row) return;
            const o = ordered().find((x) => x.item === item);
            editing = { mode: 'edit', id };
            const button = row.querySelector('[data-ann="edit"]');
            showDialog(button, null, {
                n: o.n, title: '编辑标注', submit: '保存', where: whereOf(editor.getValue(), item.from), note: item.note,
                place: (box) => placeBeside(box, list.querySelector(`[data-id="${id}"]`) || row)
            });
        }

        // Left of the panel, level with the entry (over the document);
        // under the entry when there is no room there
        function placeBeside(box, row) {
            const r = row.getBoundingClientRect();
            const view = popover.viewport();
            const width = box.offsetWidth;
            const height = box.offsetHeight;
            let left = panel.getBoundingClientRect().left - width - 12;
            let top = r.top;
            if (left < 8) {
                left = Math.max(8, Math.min(r.left, document.documentElement.clientWidth - width - 8));
                top = r.bottom + 8;
            }
            box.style.left = left + 'px';
            box.style.top = Math.max(view.top + 8, Math.min(top, view.bottom - height - 8)) + 'px';
        }

        function showDialog(anchor, rect, { n, title, submit, where, note, place }) {
            const num = dialog.querySelector('.ann-num');
            num.dataset.n = n === null ? '–' : String(n);
            dialog.querySelector('.popover-title').textContent = title;
            dialog.querySelector('.ann-where').textContent = where;
            dialog.querySelector('[type="submit"]').textContent = submit;
            input.value = note;
            input.placeholder = placeholder;
            input.removeAttribute('aria-invalid');
            popover.open(dialog, anchor, {
                rect,
                place,
                returnFocus: () => finish(false),
                // Closed by a click elsewhere: nothing to go back to (after
                // returnFocus, which runs next when it was Esc or 取消)
                onClose: () => queueMicrotask(() => { editing = null; }),
                onOpen: () => {
                    input.focus();
                    input.setSelectionRange(input.value.length, input.value.length);
                }
            });
        }

        // The dialog is done: focus goes back to the text (a new
        // annotation's selection as it was; once made, the caret at its
        // end, so its mark shows) or to the panel
        function finish(made, id) {
            const was = editing;
            editing = null;
            if (!was) return;
            if (was.mode === 'new') {
                if (made) editor.select(was.to, was.to);
                else editor.select(was.start, was.end);
                focusText();
            } else {
                const button = list.querySelector(`[data-id="${id || was.id}"] [data-ann="edit"]`);
                if (button) button.focus();
            }
        }

        function commit(note) {
            note = note.trim();
            if (!note || !editing) return;
            const was = editing;
            let id = was.id;
            if (was.mode === 'new') {
                const text = editor.getValue();
                const item = { id: newId(), ...A.anchor(text, was.from, was.to), note, copied: null, created: Date.now() };
                items.push(item);
                id = item.id;
                current = id;
            } else {
                const item = items.find((x) => x.id === was.id);
                if (item) item.note = note;
            }
            save();
            popover.close(false);
            finish(true, id);
            refresh();
        }

        function remove(id) {
            const item = items.find((x) => x.id === id);
            if (!item) return;
            const text = editor.getValue();
            remember(item, text, A.linesOf(text, [item.from])[0]);
            items = items.filter((x) => x !== item);
            if (current === id) current = null;
            save();
            refresh();
        }

        function restore(id) {
            const item = history.find((x) => x.id === id);
            if (!item) return;
            history = history.filter((x) => x !== item);
            delete item.removed;
            delete item.where;
            A.relocate(item, editor.getValue());
            items.push(item);
            save();
            refresh();
        }

        function purge(id) {
            history = history.filter((x) => x.id !== id);
            save();
            refresh();
        }

        // --- The dialog's phrases ------------------------------------------------

        function phraseButton(text) {
            const button = el('button', 'ann-chip', text);
            button.type = 'button';
            button.dataset.phrase = text;
            return button;
        }

        // The four fixed phrases, the user's own (each with ×), and "+ 常用语"
        function fillPhrases() {
            const chips = PHRASES.map(phraseButton);
            phrases.forEach((text) => {
                const wrap = el('span', 'ann-chip-wrap');
                const remove = el('button', 'ann-chip-x');
                remove.type = 'button';
                remove.dataset.removePhrase = text;
                remove.setAttribute('aria-label', `删除常用语：${text}`);
                remove.title = '删除这个常用语';
                remove.innerHTML = ICON.close;
                wrap.append(phraseButton(text), remove);
                chips.push(wrap);
            });
            const add = el('button', 'ann-chip is-add');
            add.type = 'button';
            add.dataset.addPhrase = '';
            add.title = '把输入框里的这句话存成常用语';
            add.innerHTML = ICON.plus + '常用语';
            chips.push(add);
            phrasesBox.replaceChildren(...chips);
        }

        phrasesBox.addEventListener('click', (e) => {
            const target = e.target.closest('button');
            if (!target) return;
            if ('phrase' in target.dataset) {
                commit(target.dataset.phrase);
            } else if ('removePhrase' in target.dataset) {
                phrases = phrases.filter((p) => p !== target.dataset.removePhrase);
                store.set('phrases', phrases);
                fillPhrases();
                input.focus();
            } else if ('addPhrase' in target.dataset) {
                const text = input.value.trim();
                if (!text) {
                    input.placeholder = '先在这里写一句，再点「+ 常用语」存起来';
                    input.focus();
                    return;
                }
                if (!PHRASES.includes(text) && !phrases.includes(text)) {
                    phrases.push(text);
                    store.set('phrases', phrases);
                    fillPhrases();
                }
                input.focus();
            }
        });

        input.addEventListener('input', () => {
            input.removeAttribute('aria-invalid');
            input.placeholder = placeholder;
        });

        dialog.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!input.value.trim()) {
                input.setAttribute('aria-invalid', 'true');
                input.focus();
                return;
            }
            commit(input.value);
        });

        dialog.querySelector('[data-dismiss]').addEventListener('click', () => popover.close(true));

        // --- Copying them all -----------------------------------------------------

        function copyable() {
            return ordered().filter((o) => o.n !== null);
        }

        async function copyAll() {
            const text = editor.getValue();
            const shown = copyable();
            if (!shown.length) return;
            const lines = A.linesOf(text, shown.map((o) => o.item.from));
            const hs = headings(text);
            const entries = shown.map((o, i) => ({
                n: o.n,
                path: A.sectionOf(hs, o.item.from),
                line: lines[i],
                quote: text.slice(o.item.from, o.item.to),
                note: o.item.note
            }));
            const ok = await copyText(A.format(fileName(), entries));
            if (!ok) {
                toast('复制失败', false);
                return;
            }
            shown.forEach((o) => { o.item.copied = text.slice(o.item.from, o.item.to); });
            save();
            refresh();
            toast(`已复制 ${shown.length} 条标注`);
        }

        // --- The panel ---------------------------------------------------------------

        // Beside the document when there is room for both, over it otherwise
        // (narrow windows and phones always)
        function fit() {
            const body = panel.parentElement;
            const room = body.clientWidth - (sidebar() ? SIDEBAR_WIDTH : 0) - PANEL_WIDTH;
            panel.classList.toggle('is-overlay', narrow() || room < MIN_PANES);
        }

        function setOpen(on, persist = true) {
            open = on;
            panel.hidden = !on;
            if (persist && !phone()) store.set('annotationPanel', on);
            document.querySelectorAll('[data-command="toggle-annotations"]').forEach((button) => {
                const role = button.getAttribute('role') || '';
                button.setAttribute(role.startsWith('menuitem') ? 'aria-checked' : 'aria-pressed', String(on));
            });
            if (on) {
                fit();
                renderList();
                // Over the document, the panel takes focus (it comes back on closing)
                if (persist && panel.classList.contains('is-overlay')) closeButton.focus({ preventScroll: true });
            } else if (panel.contains(document.activeElement)) {
                const back = Array.from(document.querySelectorAll('[data-command="toggle-annotations"], #phoneMoreButton')).find((x) => x.offsetParent !== null && !x.closest('[role="menu"]'));
                if (back) back.focus();
            }
            onLayout();
        }

        function setTab(name) {
            tab = name;
            panel.querySelectorAll('[data-ann-tab]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.annTab === name)));
            renderList();
        }

        function miniButton(action, label, icon) {
            const button = el('button', 'ann-mini');
            button.type = 'button';
            button.dataset.ann = action;
            button.setAttribute('aria-label', label);
            button.title = label.replace(/ \d+$/, '');
            button.innerHTML = icon;
            return button;
        }

        function entry({ id, n, where, quote, note, status, label, history: old }) {
            const row = el('li', 'ann-item');
            row.dataset.id = id;
            const num = el('span', n === null ? 'ann-num is-muted' : 'ann-num');
            num.dataset.n = n === null ? '–' : String(n);
            num.setAttribute('aria-hidden', 'true');
            const body = el('div', 'ann-body');
            const go = el('button', 'ann-go');
            go.type = 'button';
            go.dataset.ann = old ? 'none' : 'go';
            if (old) go.tabIndex = -1;
            const quoteBox = el('span', 'ann-quote');
            quoteBox.innerHTML = ICON.quote;
            quoteBox.appendChild(el('span', 'ann-quote-text', quote || '（空）'));
            go.append(el('span', 'ann-where', where), quoteBox, el('span', 'ann-text', note));
            go.setAttribute('aria-label', `${n === null ? '' : `标注 ${n}，`}${where}。原文：${quote}。修改：${note}`);
            const foot = el('div', 'ann-foot-row');
            const tag = el('span', 'ann-status');
            tag.dataset.status = status;
            if (status === 'changed') tag.innerHTML = ICON.check;
            tag.appendChild(document.createTextNode(label));
            foot.appendChild(tag);
            if (old) {
                foot.append(miniButton('restore', `恢复这条标注`, ICON.restore), miniButton('purge', '彻底删除这条标注', ICON.trash));
            } else {
                const name = n === null ? '这条标注' : `标注 ${n}`;
                foot.append(miniButton('edit', `编辑${name}`, ICON.edit), miniButton('delete', `删除${name}`, ICON.trash));
            }
            body.append(go, foot);
            row.append(num, body);
            if (id === current && !old) row.classList.add('is-current');
            return row;
        }

        function renderList() {
            clearTimeout(listTimer);
            listTimer = 0;
            if (!open) return;
            const text = editor.getValue();
            // Keep focus on the same button of the same entry
            const focused = list.contains(document.activeElement) ? document.activeElement : null;
            const keep = focused && { id: focused.closest('[data-id]').dataset.id, ann: focused.dataset.ann };
            const scroll = list.scrollTop;
            let rows = [];
            if (tab === 'current') {
                const shown = ordered();
                const lines = A.linesOf(text, shown.map((o) => o.item.from));
                rows = shown.map((o, i) => {
                    const status = statusOf(o.item, text);
                    return entry({
                        id: o.item.id,
                        n: o.n,
                        where: whereOf(text, o.item.from, lines[i]),
                        quote: A.plain(o.item.from < o.item.to ? text.slice(o.item.from, o.item.to) : o.item.quote),
                        note: o.item.note,
                        status,
                        label: STATUS[status]
                    });
                });
                empty.textContent = `还没有标注。选中文字，点工具条上的「标注」${phone() ? '' : `（或按 ${KEYS}）`}，写下要怎么改。`;
            } else {
                rows = history.map((item) => entry({
                    id: item.id,
                    n: null,
                    where: item.where,
                    quote: A.plain(item.quote),
                    note: item.note,
                    status: 'removed',
                    label: `删除于 ${when(item.removed)}`,
                    history: true
                }));
                empty.textContent = '删掉的标注会留在这里，可以恢复。';
            }
            list.replaceChildren(...rows);
            list.hidden = !rows.length;
            empty.hidden = rows.length > 0;
            currentFoot.hidden = tab !== 'current';
            historyFoot.hidden = tab !== 'history';
            historyFoot.querySelector('[data-ann="clear"]').disabled = !history.length;
            list.scrollTop = scroll;
            if (keep) {
                const target = list.querySelector(`[data-id="${keep.id}"] [data-ann="${keep.ann}"]`);
                if (target) target.focus({ preventScroll: true });
            }
        }

        // Typing moves the line numbers: the list follows once typing pauses
        function scheduleList(size) {
            clearTimeout(listTimer);
            listTimer = setTimeout(refresh, size > 30000 ? 400 : 150);
        }

        // Counts on the tab, in the panel's head and on its buttons
        function refresh() {
            const copied = items.filter((x) => x.copied !== null).length;
            counts.textContent = `未复制 ${items.length - copied} · 已复制 ${copied}`;
            panel.querySelector('[data-ann-tab="current"] span').textContent = String(items.length);
            panel.querySelector('[data-ann-tab="history"] span').textContent = String(history.length);
            const ready = copyable().length;
            copyLabel.textContent = `复制全部标注（${ready}）`;
            copyButton.disabled = !ready;
            document.querySelectorAll('[data-ann-count]').forEach((badge) => {
                badge.textContent = items.length ? String(items.length) : '';
                badge.hidden = !items.length;
            });
            document.querySelectorAll('[data-command="toggle-annotations"][aria-pressed]').forEach((button) => {
                button.setAttribute('aria-label', `标注面板，${items.length} 条`);
            });
            renderList();
            scheduleDraw();
        }

        // To an annotation's text: selected in the text being edited, or
        // scrolled to in the preview. On a phone the panel (over all of the
        // document) closes first.
        function goTo(id) {
            const item = items.find((x) => x.id === id);
            if (!item) return;
            setCurrent(id, false);
            if (phone()) setOpen(false);
            const mode = view();
            if (mode === 'preview') {
                const mark = drawnPreview && drawnPreview.ranges.find((r) => r.id === id);
                if (mark) {
                    const r = (mark.range || mark.badge).getBoundingClientRect();
                    const box = previewScroll.getBoundingClientRect();
                    previewScroll.scrollTo({ top: previewScroll.scrollTop + r.top - box.top - box.height * 0.3, behavior: 'smooth' });
                }
                return;
            }
            editor.select(item.from, item.to);
            if (mode === 'live') {
                live.focus();
            } else {
                editor.focus();
                const line = editor.getValue().slice(0, item.from).split('\n').length - 1;
                textarea.scrollTop = Math.max(0, editor.lineTop(line) - textarea.clientHeight * 0.3);
            }
        }

        panel.addEventListener('click', (e) => {
            const tabButton = e.target.closest('[data-ann-tab]');
            if (tabButton) {
                setTab(tabButton.dataset.annTab);
                return;
            }
            const button = e.target.closest('[data-ann]');
            if (!button || button.disabled) return;
            const row = button.closest('[data-id]');
            const id = row && row.dataset.id;
            switch (button.dataset.ann) {
                case 'close': setOpen(false); break;
                case 'copy': copyAll(); break;
                case 'clear':
                    if (history.length && confirm(`清空历史里的 ${history.length} 条标注？清空后不能恢复。`)) {
                        history = [];
                        save();
                        refresh();
                    }
                    break;
                case 'go': goTo(id); break;
                case 'edit': edit(id); break;
                case 'delete': {
                    const next = row.nextElementSibling || row.previousElementSibling;
                    remove(id);
                    const target = next && list.querySelector(`[data-id="${next.dataset.id}"] [data-ann="delete"]`);
                    (target || copyButton).focus();
                    break;
                }
                case 'restore': restore(id); break;
                case 'purge': purge(id); break;
                default: break;
            }
        });

        panel.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            e.preventDefault();
            setOpen(false);
        });

        // --- The current annotation --------------------------------------------------

        function setCurrent(id, reveal) {
            if (current === id) return;
            current = id;
            list.querySelectorAll('.ann-item').forEach((row) => row.classList.toggle('is-current', row.dataset.id === id));
            const row = id && list.querySelector(`[data-id="${id}"]`);
            if (row && reveal && !list.hidden) {
                const top = row.offsetTop - list.offsetTop;
                if (top < list.scrollTop) list.scrollTop = top - 6;
                else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight + 6;
            }
            scheduleDraw();
        }

        // The caret moved: the annotation it is in becomes the current one
        function caret() {
            if (!items.length) return;
            const mode = view();
            if (mode === 'preview' || (mode === 'live' && !live.activeElement())) return;
            const { start, end } = editor.getSelection();
            let hit = null;
            items.forEach((item) => {
                if (item.from < item.to && item.from <= start && end <= item.to && (!hit || item.to - item.from < hit.to - hit.from)) hit = item;
            });
            setCurrent(hit ? hit.id : null, true);
        }

        // --- Marks in the document ---------------------------------------------------
        // The text is tinted with the CSS Custom Highlight API (the DOM is
        // left alone); a number goes before each passage, in the rendered
        // blocks and the preview (not in the source being edited).

        const marks = MARKS ? new Highlight() : null;
        const marksCurrent = MARKS ? new Highlight() : null;
        if (MARKS) {
            marksCurrent.priority = 1;
            CSS.highlights.set('mde-ann', marks);
            CSS.highlights.set('mde-ann-current', marksCurrent);
        }

        let drawn = new Map();      // rendered element → { key, source, ranges: [{ id, range }], badges, nodes }
        let drawnPreview = null;    // the same, for the preview
        let previewStale = true;    // the preview was rendered again since it was marked
        let editingRanges = [];     // [{ id, range }] in the source being edited

        const visibleCache = new Map();
        function visibleOf(source, kind) {
            const key = kind + '\u0000' + source;
            let vis = visibleCache.get(key);
            if (!vis) {
                if (visibleCache.size >= VISIBLE_CACHE) visibleCache.clear();
                vis = A.visible(source, kind);
                visibleCache.set(key, vis);
            }
            return vis;
        }

        // The text that shows in a rendered element, white space left
        // out, and the text node and offset of each character
        function textIndex(root) {
            const chars = [];
            const nodes = [];
            const offsets = [];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
                    if (node.namespaceURI === MATHML) return /^(math|semantics|annotation)$/.test(node.localName) ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_REJECT;
                    return node.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
                }
            });
            let node;
            while ((node = walker.nextNode())) {
                const data = node.data;
                for (let i = 0; i < data.length; i++) {
                    if (data[i].trim()) {
                        chars.push(data[i]);
                        nodes.push(node);
                        offsets.push(i);
                    }
                }
            }
            return { text: chars.join(''), nodes, offsets };
        }

        function rangeAt(index, want) {
            const at = A.nth(index.text, want.text, want.count);
            if (at === -1) return null;
            const last = at + want.text.length - 1;
            const range = document.createRange();
            range.setStart(index.nodes[at], index.offsets[at]);
            range.setEnd(index.nodes[last], index.offsets[last] + 1);
            return range;
        }

        // The number before a passage (its text comes from CSS, so the
        // rendered text stays the document's)
        function newBadge(n) {
            const badge = el('span', 'ann-num ann-mark');
            badge.dataset.n = String(n);
            badge.setAttribute('aria-hidden', 'true');
            return badge;
        }

        function addBadge(range, n) {
            const badge = newBadge(n);
            const at = range.cloneRange();
            at.collapse(true);
            at.insertNode(badge);
            range.setStartAfter(badge);
            return badge;
        }

        // A passage that starts in an HTML block: the text in the frame
        // can't be tinted, so its number goes on the frame's top left
        function frameMark(entry, frame, id, n) {
            const box = frame && frame.querySelector('.html-marks');
            if (!box) return;
            const badge = newBadge(n);
            box.appendChild(badge);
            entry.ranges.push({ id, range: null, n, badge });
            entry.badges.push(badge);
        }

        function unmark(entry) {
            entry.badges.forEach((badge) => {
                const parent = badge.parentNode;
                if (!parent) return;
                badge.remove();
                parent.normalize();
            });
        }

        const stillThere = (entry, root) => entry.nodes.every((node) => node.isConnected && root.contains(node));

        // Badges go in once every range of the element is known (they
        // split text nodes); the nodes are kept to tell when the element
        // was rendered again
        function finishEntry(entry) {
            entry.ranges.forEach((mark) => {
                if (mark.n && mark.range) {
                    mark.badge = addBadge(mark.range, mark.n);
                    entry.badges.push(mark.badge);
                }
            });
            entry.ranges.forEach(({ range }) => {
                if (range) entry.nodes.push(range.startContainer, range.endContainer);
            });
            entry.badges.forEach((badge) => entry.nodes.push(badge));
            return entry;
        }

        // A rendered block of the live view: each passage in it found by
        // its text (in a table, cell by cell; the open cell of the table
        // being edited is source, marked with the rest of the source)
        function markBlock(b, pieces, key) {
            const entry = { key, source: b.source, ranges: [], badges: [], nodes: [] };
            const frame = b.mode === 'rendered' && b.el.querySelector(':scope > .html-block');
            if (frame) {
                pieces.forEach((p) => {
                    if (p.first) frameMark(entry, frame, p.id, p.n);
                });
                return finishEntry(entry);
            }
            const indexes = new Map();
            const indexOf = (root) => {
                if (!indexes.has(root)) indexes.set(root, textIndex(root));
                return indexes.get(root);
            };
            pieces.forEach((p) => {
                const from = p.from - b.start;
                const to = p.to - b.start;
                let first = p.first;
                if (b.kind === 'table') {
                    const table = b.el.querySelector('table');
                    MDE.table.parse(b.source).rows.forEach((row, r) => row.cells.forEach((cell, c) => {
                        const a = Math.max(from, cell.from);
                        const z = Math.min(to, cell.to);
                        if (a >= z || (b.cell && b.cell.r === r && b.cell.c === c)) return;
                        const td = table && table.rows[r] && table.rows[r].cells[c];
                        const want = td && A.needle(visibleOf(cell.text, 'paragraph'), a - cell.from, z - cell.from);
                        const range = want && rangeAt(indexOf(td), want);
                        if (!range) return;
                        entry.ranges.push({ id: p.id, range, n: first ? p.n : 0 });
                        first = false;
                    }));
                    return;
                }
                const want = A.needle(visibleOf(b.source, b.kind), from, to);
                const range = want && rangeAt(indexOf(b.el), want);
                if (range) entry.ranges.push({ id: p.id, range, n: first ? p.n : 0 });
            });
            return finishEntry(entry);
        }

        // The preview: the whole document's visible text, each passage
        // found as the same occurrence of its text there (HTML blocks are
        // left out: their frames are listed instead)
        let docVisText = null;
        let docVis = null;
        function documentVisible(text) {
            if (text !== docVisText) {
                docVisText = text;
                const chars = [];
                const pos = [];
                const frames = [];
                MDE.blocksOf(text).forEach((b) => {
                    if (b.html) {
                        frames.push(b);
                        return;
                    }
                    const vis = visibleOf(text.slice(b.start, b.end), b.kind);
                    chars.push(vis.text);
                    vis.pos.forEach((p) => pos.push(b.start + p));
                });
                docVis = { text: chars.join(''), pos, frames };
            }
            return docVis;
        }

        function markPreview(shown, key, text) {
            const entry = { key, source: '', ranges: [], badges: [], nodes: [] };
            const vis = documentVisible(text);
            const index = textIndex(preview);
            const frames = preview.querySelectorAll(':scope > .html-block');
            shown.forEach((o) => {
                let n = o.n;
                const k = vis.frames.findIndex((b) => b.start <= o.item.from && o.item.from < b.end);
                if (k !== -1) {
                    frameMark(entry, frames[k], o.item.id, n);
                    n = 0;
                }
                const want = A.needle(vis, o.item.from, o.item.to);
                const range = want && rangeAt(index, want);
                if (range) entry.ranges.push({ id: o.item.id, range, n });
            });
            return finishEntry(entry);
        }

        function scheduleDraw() {
            if (drawFrame || (!items.length && !drawn.size && !drawnPreview && !editingRanges.length)) return;
            drawFrame = requestAnimationFrame(draw);
        }

        function draw() {
            drawFrame = 0;
            const mode = view();
            const text = editor.getValue();
            const shown = ordered().filter((o) => o.n !== null);
            editingRanges = [];

            if (mode === 'live') {
                // The pieces of each passage, block by block
                const wanted = new Map();
                shown.forEach((o) => {
                    live.blocksIn(o.item.from, o.item.to).forEach((b) => {
                        const from = Math.max(o.item.from, b.start);
                        const to = Math.min(o.item.to, b.end);
                        if (b.mode === 'source') {
                            const range = live.textRange(from, to);
                            if (range) editingRanges.push({ id: o.item.id, range });
                            return;
                        }
                        if (b.mode !== 'rendered' && b.mode !== 'table') return;
                        if (b.mode === 'table' && b.cell) {
                            const range = live.textRange(from, to);
                            if (range) editingRanges.push({ id: o.item.id, range });
                        }
                        let w = wanted.get(b.el);
                        if (!w) wanted.set(b.el, w = { b, pieces: [] });
                        w.pieces.push({ id: o.item.id, n: o.n, from, to, first: o.item.from >= b.start });
                    });
                });
                const next = new Map();
                wanted.forEach(({ b, pieces }, element) => {
                    const key = (b.cell ? `${b.cell.r},${b.cell.c}|` : '') + pieces.map((p) => `${p.id}:${p.n}:${p.from - b.start}:${p.to - b.start}:${p.first ? 1 : 0}`).join(';');
                    const old = drawn.get(element);
                    if (old && old.key === key && old.source === b.source && stillThere(old, element)) {
                        next.set(element, old);
                        return;
                    }
                    if (old) unmark(old);
                    next.set(element, markBlock(b, pieces, key));
                });
                drawn.forEach((old, element) => {
                    if (!next.has(element)) unmark(old);
                });
                drawn = next;
            }

            if (mode === 'preview' || mode === 'split') {
                const key = shown.map((o) => `${o.item.id}:${o.n}`).join(';');
                if (previewStale || !drawnPreview || drawnPreview.key !== key || !stillThere(drawnPreview, preview)) {
                    if (drawnPreview) unmark(drawnPreview);
                    drawnPreview = shown.length ? markPreview(shown, key, text) : null;
                    previewStale = false;
                }
            }

            const entries = Array.from(drawn.values()).concat(drawnPreview ? [drawnPreview] : []);
            entries.forEach((entry) => entry.ranges.forEach(({ id, badge }) => {
                if (badge) badge.classList.toggle('is-current', id === current);
            }));
            if (!MARKS) return;
            marks.clear();
            marksCurrent.clear();
            const add = ({ id, range }) => {
                if (range) (id === current ? marksCurrent : marks).add(range);
            };
            if (mode === 'live') {
                drawn.forEach((entry) => entry.ranges.forEach(add));
                editingRanges.forEach(add);
            }
            if ((mode === 'preview' || mode === 'split') && drawnPreview) drawnPreview.ranges.forEach(add);
        }

        // A click on a number in the document opens the panel at its
        // annotation; in the preview a click on a marked passage marks it
        function pick(e, entries) {
            const badge = e.target.closest('.ann-mark');
            let id = null;
            if (badge) {
                const owner = entries().flatMap((entry) => entry.ranges).find((mark) => mark.badge === badge);
                id = owner ? owner.id : null;
                if (id && !open) setOpen(true);
            } else if (document.caretRangeFromPoint || document.caretPositionFromPoint) {
                const p = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) : null;
                const r = p ? null : document.caretRangeFromPoint(e.clientX, e.clientY);
                const node = p ? p.offsetNode : r && r.startContainer;
                const offset = p ? p.offset : r && r.startOffset;
                const hit = node && entries().flatMap((entry) => entry.ranges).find(({ range }) => range && range.isPointInRange(node, offset));
                id = hit ? hit.id : null;
            }
            if (id) setCurrent(id, true);
        }

        preview.addEventListener('click', (e) => pick(e, () => (drawnPreview ? [drawnPreview] : [])));
        liveDoc.addEventListener('click', (e) => {
            if (e.target.closest('.ann-mark')) pick(e, () => Array.from(drawn.values()));
        });

        return {
            load,
            save,
            changed,
            archiveAll,
            start,
            caret,
            copyAll,
            redraw: scheduleDraw,
            // The preview was rendered again (its marks were lost)
            previewRendered() {
                previewStale = true;
                scheduleDraw();
            },
            fit,
            toggle: () => setOpen(!open),
            setOpen,
            isOpen: () => open,
            count: () => items.length,
            copyCount: () => copyable().length
        };
    };
})(window.MDE = window.MDE || {});
