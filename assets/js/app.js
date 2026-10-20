// Wires the editor, preview, toolbar, menus and settings together.
(function (MDE) {
    const { store, popover } = MDE;
    const $ = (id) => document.getElementById(id);

    const app = $('app');
    const textarea = $('editor');
    const preview = $('preview');
    const previewScroll = $('previewScroll');
    const liveDoc = $('live');
    const liveScroll = $('liveScroll');
    const panes = $('panes');
    const splitter = $('splitter');
    const toolbar = $('toolbar');
    const fileInput = $('fileInput');
    const headingButton = $('headingButton');
    const headingLabel = $('headingLabel');
    const headingMenu = $('headingMenu');
    const moreButton = $('moreButton');
    const moreMenu = $('moreMenu');
    const inlineToolbar = $('inlineToolbar');
    const saveStatus = $('saveStatus');

    const DEFAULT_NAME = 'document.md';
    const FONT_MIN = 10;
    const FONT_MAX = 24;
    const FONT_STEP = 2;
    const VIEWS = ['live', 'edit', 'split', 'preview'];
    const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const state = {
        view: VIEWS.includes(store.get('view')) ? store.get('view') : 'live',
        sync: store.get('sync', true) !== false,
        focusMode: store.get('focusMode', false) === true,
        typewriter: store.get('typewriter', false) === true,
        fontSize: clamp(Number(store.get('fontSize', 14)) || 14, FONT_MIN, FONT_MAX),
        split: clamp(Number(store.get('split', 50)) || 50, 20, 80),
        fileName: DEFAULT_NAME,
        headingLines: [],
        previewDirty: true,
        ready: false
    };

    let previewTimer = 0;
    let statsTimer = 0;
    let saveTimer = 0;
    let syncSource = null;
    let syncTimer = 0;
    let tocFrame = 0;

    const editor = MDE.createEditor({
        textarea,
        backdrop: $('editorBackdrop'),
        container: $('codeEditor'),
        onChange: handleChange,
        onCaret: handleCaret
    });
    const commands = MDE.createCommands(editor);

    // Copy buttons and links first; other clicks on the document are edits
    liveDoc.addEventListener('click', (e) => handleDocumentClick(e, liveDoc, liveScroll, true));
    const live = MDE.createLive({
        root: liveDoc,
        scroller: liveScroll,
        editor,
        onCaret: handleLiveCaret,
        onRender: () => {
            scheduleActiveHeading();
            liveBlocks.refresh();
        },
        onSlash: (query, el) => liveTools.slash(query, el),
        onSelection: () => {
            liveTools.selection();
            liveBlocks.refresh();
        },
        onKey: (key) => liveTools.key(key)
    });
    // The slash menu and the toolbar over selected text
    const liveTools = MDE.createLiveTools({
        live,
        scroller: liveScroll,
        slashMenu: $('slashMenu'),
        toolbar: inlineToolbar,
        tableBar: $('tableToolbar'),
        tip: $('floatTip')
    });
    // The handle beside each block and its menu
    const liveBlocks = MDE.createLiveBlocks({
        live,
        root: liveDoc,
        scroller: liveScroll,
        handle: $('blockHandle'),
        dropLine: $('dropLine'),
        menu: $('blockMenu'),
        copy: copyText,
        toast: showToast
    });

    // ========================================================================
    // Document state
    // ========================================================================

    const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;

    // Each CJK character counts as one 字, plus Latin words and numbers
    function countWords(text) {
        const cjk = (text.match(CJK) || []).length;
        const words = (text.replace(CJK, ' ').match(/[A-Za-z0-9\u00C0-\u024F]+(?:['’-][A-Za-z0-9\u00C0-\u024F]+)*/g) || []).length;
        return cjk + words;
    }

    function handleChange() {
        updateHistoryButtons();
        scheduleStats();
        schedulePreview();
        live.update();
        if (state.ready) scheduleSave();
    }

    function updateStats() {
        clearTimeout(statsTimer);
        const value = editor.getValue();
        const words = countWords(value);
        const lines = value.split('\n').length;
        const minutes = words ? Math.max(1, Math.round(words / 300)) : 0;

        $('statusWords').textContent = `${words} 字 · ${lines} 行`;
        $('statusReading').textContent = `约 ${minutes} 分钟读完`;
    }

    function scheduleStats() {
        clearTimeout(statsTimer);
        statsTimer = setTimeout(updateStats, editor.getValue().length > 30000 ? 300 : 60);
    }

    function handleCaret({ line, col }) {
        $('statusCaret').textContent = `第 ${line + 1} 行，第 ${col + 1} 列`;
        updateFormatState();
    }

    // Live mode also names the kind of block the caret is in
    function handleLiveCaret(info) {
        const chip = $('statusBlock');
        chip.textContent = info.label;
        chip.hidden = !info.label;
        handleCaret(info);
    }

    // The editing surface of the current view
    function focusEditor() {
        if (state.view === 'live') live.focus();
        else editor.focus();
    }

    // Inline formats with a toggle button (in the toolbar or the selection toolbar)
    const FORMATS = { bold: 'bold', italic: 'italic', strike: 'strike', highlight: 'highlight', 'inline-code': 'code', 'inline-math': 'math' };
    const formatButtons = Array.from(document.querySelectorAll('[data-command][aria-pressed]')).filter((el) => el.dataset.command in FORMATS);

    // Reflect the caret's context in the toolbars (paragraph style, B/I/S/H…)
    function updateFormatState() {
        const level = commands.headingLevel();
        const label = level ? `标题 ${level}` : '正文';
        headingLabel.textContent = label;
        headingButton.setAttribute('aria-label', `段落样式：${label}`);
        headingMenu.querySelectorAll('[data-level]').forEach((item) => {
            item.setAttribute('aria-checked', String(Number(item.dataset.level) === level));
        });
        const on = {};
        formatButtons.forEach((button) => {
            const name = FORMATS[button.dataset.command];
            if (!(name in on)) on[name] = commands.isActive(name);
            button.setAttribute('aria-pressed', String(on[name]));
        });
    }

    const undoControls = document.querySelectorAll('[data-command="undo"]');
    const redoControls = document.querySelectorAll('[data-command="redo"]');

    function updateHistoryButtons() {
        undoControls.forEach((el) => el.setAttribute('aria-disabled', String(!editor.canUndo())));
        redoControls.forEach((el) => el.setAttribute('aria-disabled', String(!editor.canRedo())));
    }

    // ========================================================================
    // Preview
    // ========================================================================

    function schedulePreview() {
        if (state.view === 'edit' || state.view === 'live') {
            state.previewDirty = true;
            return;
        }
        clearTimeout(previewTimer);
        previewTimer = setTimeout(renderPreview, editor.getValue().length > 30000 ? 250 : 16);
    }

    function renderPreview() {
        clearTimeout(previewTimer);
        state.previewDirty = false;
        state.headingLines = MDE.markdown.renderInto(preview, editor.getValue());
        updateActiveHeading();
        syncScroll('editor');
    }

    // Distance of an element from the top of a scroller's content
    function contentTop(el, scroller = previewScroll) {
        return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    }

    // Highlight the TOC entry of the section currently at the top of the
    // preview (or of the live document)
    function updateActiveHeading() {
        const container = state.view === 'live' ? liveDoc : preview;
        const scroller = state.view === 'live' ? liveScroll : previewScroll;
        const links = container.querySelectorAll('.toc a');
        if (!links.length) return;
        const headings = container.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]');
        if (!headings.length) return;

        const atBottom = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 2;
        let active = headings[0];
        if (atBottom) {
            active = headings[headings.length - 1];
        } else {
            const line = scroller.scrollTop + 48;
            for (const heading of headings) {
                if (contentTop(heading, scroller) <= line) active = heading;
                else break;
            }
        }
        links.forEach((link) => link.classList.toggle('is-active', link.getAttribute('href') === '#' + active.id));
    }

    function scheduleActiveHeading() {
        if (tocFrame) return;
        tocFrame = requestAnimationFrame(() => {
            tocFrame = 0;
            updateActiveHeading();
        });
    }

    // Copy buttons and links in the preview and the live document. In live
    // mode a plain click on a link edits it; Ctrl/⌘-click (or any click in
    // the table of contents) follows it.
    function handleDocumentClick(e, container, scroller, isLive) {
        const copyButton = e.target.closest('.code-copy');
        if (copyButton) {
            e.preventDefault();
            copyCode(copyButton);
            return;
        }

        const link = e.target.closest('a[href]');
        if (!link) return;
        if (isLive && !link.closest('.toc') && !(e.ctrlKey || e.metaKey)) return;
        const href = link.getAttribute('href');
        e.preventDefault();
        if (href.startsWith('#')) {
            let id = href.slice(1);
            try { id = decodeURIComponent(id); } catch (err) { /* keep raw id */ }
            const target = container.querySelector('#' + CSS.escape(id));
            if (target) scroller.scrollTo({ top: contentTop(target, scroller) - 16, behavior: 'smooth' });
        } else {
            // Keep the editor open; external links go to a new tab
            window.open(link.href, '_blank', 'noopener');
        }
    }

    preview.addEventListener('click', (e) => handleDocumentClick(e, preview, previewScroll, false));

    async function copyCode(button) {
        const block = button.closest('.code-block');
        const input = block.querySelector('textarea');
        const code = input ? input.value : block.querySelector('code').textContent;
        const copied = await copyText(code);
        const label = button.querySelector('span');
        label.textContent = copied ? '已复制' : '复制失败';
        button.classList.toggle('is-copied', copied);
        setTimeout(() => {
            label.textContent = '复制';
            button.classList.remove('is-copied');
        }, 1600);
    }

    // Plain text, and optionally HTML for places that take formatted text
    async function copyText(text, html) {
        try {
            if (html && window.ClipboardItem && navigator.clipboard.write) {
                await navigator.clipboard.write([new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([text], { type: 'text/plain' })
                })]);
            } else {
                await navigator.clipboard.writeText(text);
            }
            return true;
        } catch (err) {
            return legacyCopy(text);
        }
    }

    // A short confirmation at the bottom of the window, gone after 1.6 s
    let toastTimer = 0;

    function showToast(message, ok = true) {
        const toast = $('toast');
        $('toastText').textContent = message;
        toast.classList.toggle('is-error', !ok);
        toast.classList.add('is-shown');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('is-shown'), 1600);
    }

    function legacyCopy(text) {
        const helper = document.createElement('textarea');
        helper.value = text;
        helper.setAttribute('readonly', '');
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
        helper.remove();
        return ok;
    }

    // ========================================================================
    // Synchronised scrolling
    // Headings are used as anchor points between the two panes; positions in
    // between are interpolated, so long code blocks or formulas don't drift.
    // ========================================================================

    function scrollAnchors() {
        const editorMax = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
        const previewMax = Math.max(0, previewScroll.scrollHeight - previewScroll.clientHeight);
        const anchors = [[0, 0]];
        const headings = preview.querySelectorAll(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6');
        const count = Math.min(headings.length, state.headingLines.length);

        for (let i = 0; i < count; i++) {
            const editorY = editor.lineTop(state.headingLines[i]);
            const previewY = contentTop(headings[i]) - 16;
            const last = anchors[anchors.length - 1];
            if (editorY > last[0] && previewY > last[1] && editorY < editorMax && previewY < previewMax) {
                anchors.push([editorY, previewY]);
            }
        }
        const last = anchors[anchors.length - 1];
        anchors.push([Math.max(editorMax, last[0] + 1), Math.max(previewMax, last[1] + 1)]);
        return anchors;
    }

    function syncScroll(source) {
        if (!state.sync || state.view !== 'split') return;
        if (syncSource && syncSource !== source) return;

        // Ignore the scroll event our own update triggers on the other pane
        syncSource = source;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => { syncSource = null; }, 80);

        const from = source === 'editor' ? 0 : 1;
        const to = 1 - from;
        const fromEl = source === 'editor' ? textarea : previewScroll;
        const toEl = source === 'editor' ? previewScroll : textarea;
        const anchors = scrollAnchors();
        const y = fromEl.scrollTop;

        for (let i = 1; i < anchors.length; i++) {
            const a = anchors[i - 1];
            const b = anchors[i];
            if (y <= b[from] || i === anchors.length - 1) {
                const span = b[from] - a[from];
                const t = span > 0 ? clamp((y - a[from]) / span, 0, 1) : 0;
                toEl.scrollTop = a[to] + t * (b[to] - a[to]);
                break;
            }
        }
    }

    textarea.addEventListener('scroll', () => syncScroll('editor'), { passive: true });
    previewScroll.addEventListener('scroll', () => {
        syncScroll('preview');
        scheduleActiveHeading();
    }, { passive: true });
    liveScroll.addEventListener('scroll', scheduleActiveHeading, { passive: true });

    // ========================================================================
    // Settings: view mode, sync, focus and typewriter, theme, font size, split
    // ========================================================================

    function setChecked(selector, value) {
        document.querySelectorAll(selector).forEach((el) => {
            const role = el.getAttribute('role') || '';
            el.setAttribute(role.startsWith('menuitem') ? 'aria-checked' : 'aria-pressed', String(value));
        });
    }

    function setView(mode) {
        if (!VIEWS.includes(mode)) return;
        const previous = state.ready ? state.view : null;
        state.view = mode;
        app.dataset.view = mode;
        store.set('view', mode);
        document.querySelectorAll('[data-command="view"]').forEach((el) => {
            const role = el.getAttribute('role') || '';
            el.setAttribute(role === 'menuitemradio' ? 'aria-checked' : 'aria-pressed', String(el.dataset.mode === mode));
        });

        // Live mode edits through the (hidden) source editor
        if (mode === 'live') {
            editor.setDetached(true);
            live.show({ focus: previous !== null && previous !== 'live' });
            scheduleActiveHeading();
            return;
        }
        if (previous === 'live') live.hide();
        editor.setDetached(false);
        if (previous === 'live' && mode !== 'preview') editor.revealCaret();

        if (mode !== 'edit' && state.previewDirty) renderPreview();
        else syncScroll('editor');
    }

    function setSync(on) {
        state.sync = on;
        store.set('sync', on);
        setChecked('[data-command="toggle-sync"]', on);
        if (on) syncScroll('editor');
    }

    function setFocusMode(on) {
        state.focusMode = on;
        store.set('focusMode', on);
        setChecked('[data-command="toggle-focus"]', on);
        live.setFocusMode(on);
    }

    function setTypewriter(on) {
        state.typewriter = on;
        store.set('typewriter', on);
        setChecked('[data-command="toggle-typewriter"]', on);
        live.setTypewriter(on);
    }

    const currentTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

    function setTheme(theme, persist = true) {
        document.documentElement.dataset.theme = theme;
        if (persist) store.set('theme', theme);
        setChecked('[data-command="toggle-theme"]', theme === 'dark');
    }

    // Follow the system theme until the user picks one
    if (window.matchMedia) {
        const query = window.matchMedia('(prefers-color-scheme: dark)');
        const follow = (e) => {
            if (store.get('theme', null) === null) setTheme(e.matches ? 'dark' : 'light', false);
        };
        if (query.addEventListener) query.addEventListener('change', follow);
    }

    function setFontSize(size) {
        state.fontSize = clamp(size, FONT_MIN, FONT_MAX);
        document.documentElement.style.setProperty('--font-size', state.fontSize + 'px');
        $('fontSizeDisplay').textContent = `${state.fontSize} px`;
        document.querySelectorAll('[data-command="font-dec"]').forEach((el) => {
            el.setAttribute('aria-disabled', String(state.fontSize <= FONT_MIN));
        });
        document.querySelectorAll('[data-command="font-inc"]').forEach((el) => {
            el.setAttribute('aria-disabled', String(state.fontSize >= FONT_MAX));
        });
        store.set('fontSize', state.fontSize);
    }

    function setSplit(percent, persist = true) {
        state.split = clamp(percent, 20, 80);
        panes.style.setProperty('--split', state.split + '%');
        splitter.setAttribute('aria-valuenow', String(Math.round(state.split)));
        if (persist) store.set('split', Math.round(state.split * 10) / 10);
    }

    // Splitter: drag, double-click to reset, arrow keys to nudge
    splitter.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        splitter.setPointerCapture(e.pointerId);
        document.body.classList.add('is-resizing');
        const rect = panes.getBoundingClientRect();

        const move = (ev) => setSplit(((ev.clientX - rect.left) / rect.width) * 100, false);
        const end = () => {
            document.body.classList.remove('is-resizing');
            splitter.removeEventListener('pointermove', move);
            splitter.removeEventListener('pointerup', end);
            splitter.removeEventListener('pointercancel', end);
            setSplit(state.split);
        };
        splitter.addEventListener('pointermove', move);
        splitter.addEventListener('pointerup', end);
        splitter.addEventListener('pointercancel', end);
    });

    splitter.addEventListener('dblclick', () => setSplit(50));

    splitter.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 10 : 2;
        const keys = {
            ArrowLeft: state.split - step,
            ArrowRight: state.split + step,
            Home: 20,
            End: 80,
            Enter: 50
        };
        if (e.key in keys) {
            e.preventDefault();
            setSplit(keys[e.key]);
        }
    });

    // ========================================================================
    // Files and autosave
    // ========================================================================

    const SAVE_LABELS = { saved: '已自动保存', pending: '正在保存…', error: '无法自动保存' };

    // The save indicator is icon-only until hovered, so its name carries the details
    function updateSaveButton() {
        $('saveButton').setAttribute('aria-label', `${state.fileName}，${SAVE_LABELS[saveStatus.dataset.state]}`);
    }

    function setFileName(name) {
        state.fileName = name || DEFAULT_NAME;
        const label = $('fileName');
        label.textContent = state.fileName;
        label.title = state.fileName;
        updateSaveButton();
    }

    function setSaveState(status) {
        if (saveStatus.dataset.state === status) return;
        saveStatus.dataset.state = status;
        $('saveLabel').textContent = SAVE_LABELS[status];
        $('saveAlert').textContent = status === 'error' ? SAVE_LABELS.error : '';
        updateSaveButton();
    }

    function scheduleSave() {
        setSaveState('pending');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, 600);
    }

    function saveNow() {
        clearTimeout(saveTimer);
        const ok = store.set('doc', { name: state.fileName, content: editor.getValue(), savedAt: Date.now() });
        setSaveState(ok ? 'saved' : 'error');
    }

    window.addEventListener('pagehide', () => {
        if (saveStatus.dataset.state === 'pending') saveNow();
    });

    function newDocument() {
        if (editor.getValue() && !confirm('确定要新建文档吗？当前内容将会丢失。')) return;
        setFileName(DEFAULT_NAME);
        live.stopEditing();
        editor.setValue('');
        focusEditor();
    }

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            setFileName(file.name);
            live.stopEditing();
            editor.setValue(String(reader.result));
            previewScroll.scrollTop = 0;
            liveScroll.scrollTop = 0;
            focusEditor();
        };
        reader.readAsText(file);
        fileInput.value = '';
    });

    function exportDocument() {
        const name = state.fileName.replace(/\.(md|markdown|mdown|txt)$/i, '') + '.md';
        const blob = new Blob([editor.getValue()], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    // ========================================================================
    // Link dialog
    // ========================================================================

    const linkDialog = $('linkDialog');
    const linkText = $('linkText');
    const linkUrl = $('linkUrl');
    const linkAsImage = $('linkAsImage');
    let linkRange = null;

    function updateLinkLabels() {
        const image = linkAsImage.checked;
        $('linkDialogTitle').textContent = image ? '插入图片' : '插入链接';
        $('linkTextLabel').textContent = image ? '图片描述' : '显示文字';
        $('linkUrlLabel').textContent = image ? '图片地址' : '链接地址';
    }

    // Opened from the toolbar, the dialog sits under its button; from the
    // selection toolbar or Ctrl+K in live mode, at the selection
    function openLinkDialog(image, el) {
        const { start, end, value } = editor.getSelection();
        const selected = value.slice(start, end);
        const isUrl = /^(https?:\/\/|www\.)\S+$/.test(selected.trim());
        linkRange = { start, end };
        linkText.value = isUrl ? '' : selected.replace(/\s*\n\s*/g, ' ');
        linkUrl.value = isUrl ? selected.trim() : 'https://';
        linkUrl.removeAttribute('aria-invalid');
        linkAsImage.checked = image;
        updateLinkLabels();

        const button = $(image ? 'imageButton' : 'linkButton');
        const fromToolbar = el === button;
        const atSelection = !fromToolbar && state.view === 'live' && !!live.selectionRect();
        popover.open(linkDialog, el instanceof Element && inlineToolbar.contains(el) ? el : button, {
            rect: atSelection ? () => live.selectionRect() : null,
            returnFocus: fromToolbar ? null : focusEditor,
            onOpen: () => {
                linkUrl.focus();
                linkUrl.setSelectionRange(linkUrl.value.length, linkUrl.value.length);
            }
        });
    }

    linkAsImage.addEventListener('change', updateLinkLabels);
    linkUrl.addEventListener('input', () => linkUrl.removeAttribute('aria-invalid'));

    linkDialog.addEventListener('submit', (e) => {
        e.preventDefault();
        const url = linkUrl.value.trim();
        if (!url || /^https?:\/\/$/i.test(url)) {
            linkUrl.setAttribute('aria-invalid', 'true');
            linkUrl.focus();
            return;
        }
        popover.close(false);
        commands.insertLink({ text: linkText.value.trim(), url, image: linkAsImage.checked, ...linkRange });
    });

    linkDialog.querySelector('[data-dismiss]').addEventListener('click', () => {
        popover.close(false);
        focusEditor();
    });

    // ========================================================================
    // Table picker
    // ========================================================================

    const tableGrid = $('tableGrid');
    const GRID_ROWS = 6;
    const GRID_COLS = 8;
    const table = { rows: 3, cols: 4, align: 'left' };

    for (let r = 1; r <= GRID_ROWS; r++) {
        for (let c = 1; c <= GRID_COLS; c++) {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'table-cell';
            cell.tabIndex = -1;
            cell.dataset.row = r;
            cell.dataset.col = c;
            cell.setAttribute('aria-label', `${r} 行 ${c} 列`);
            tableGrid.appendChild(cell);
        }
    }

    const cellAt = (r, c) => tableGrid.children[(r - 1) * GRID_COLS + (c - 1)];

    function paintTable(rows, cols) {
        table.rows = rows;
        table.cols = cols;
        $('tableSize').textContent = `${rows} 行 × ${cols} 列`;
        for (const cell of tableGrid.children) {
            const r = Number(cell.dataset.row);
            const c = Number(cell.dataset.col);
            cell.classList.toggle('is-on', r <= rows && c <= cols);
            cell.tabIndex = r === rows && c === cols ? 0 : -1;
        }
    }

    function pickCell(e) {
        const cell = e.target.closest('.table-cell');
        if (cell) paintTable(Number(cell.dataset.row), Number(cell.dataset.col));
        return cell;
    }

    tableGrid.addEventListener('pointerover', pickCell);
    tableGrid.addEventListener('focusin', pickCell);
    tableGrid.addEventListener('click', (e) => {
        if (!pickCell(e)) return;
        popover.close(false);
        commands.insertTable(table.rows, table.cols, table.align);
    });

    tableGrid.addEventListener('keydown', (e) => {
        const moves = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
        const move = moves[e.key];
        if (!move) return;
        e.preventDefault();
        const rows = clamp(table.rows + move[0], 1, GRID_ROWS);
        const cols = clamp(table.cols + move[1], 1, GRID_COLS);
        paintTable(rows, cols);
        cellAt(rows, cols).focus();
    });

    $('tableAlign').addEventListener('click', (e) => {
        const button = e.target.closest('[data-align]');
        if (!button) return;
        table.align = button.dataset.align;
        $('tableAlign').querySelectorAll('[data-align]').forEach((el) => {
            el.setAttribute('aria-pressed', String(el === button));
        });
    });

    function openTablePicker() {
        paintTable(table.rows, table.cols);
        popover.open($('tablePicker'), $('tableButton'), {
            onOpen: () => cellAt(table.rows, table.cols).focus()
        });
    }

    // ========================================================================
    // Commands (toolbar, menus, shortcuts)
    // ========================================================================

    const actions = {
        new: newDocument,
        import: () => fileInput.click(),
        export: exportDocument,
        save: saveNow,
        undo: () => editor.undo(),
        redo: () => editor.redo(),
        bold: () => commands.toggleInline('bold'),
        italic: () => commands.toggleInline('italic'),
        strike: () => commands.toggleInline('strike'),
        highlight: () => commands.toggleInline('highlight'),
        'inline-code': () => commands.toggleInline('code'),
        'inline-math': () => commands.toggleInline('math'),
        'clear-format': () => commands.clearInline(),
        heading: (el) => commands.setHeading(Number(el.dataset.level)),
        link: (el) => openLinkDialog(false, el),
        image: (el) => openLinkDialog(true, el),
        table: openTablePicker,
        code: () => commands.codeBlock(),
        math: () => commands.mathBlock(),
        quote: () => commands.toggleQuote(),
        ul: () => commands.toggleList('ul'),
        ol: () => commands.toggleList('ol'),
        task: () => commands.toggleList('task'),
        toc: () => commands.insertToc(),
        hr: () => commands.insertRule(),
        view: (el) => setView(el.dataset.mode),
        'toggle-sync': () => setSync(!state.sync),
        'toggle-focus': () => setFocusMode(!state.focusMode),
        'toggle-typewriter': () => setTypewriter(!state.typewriter),
        'toggle-theme': () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'),
        'font-inc': () => setFontSize(state.fontSize + FONT_STEP),
        'font-dec': () => setFontSize(state.fontSize - FONT_STEP)
    };

    // Commands that edit the document (in live mode they act where the caret is)
    const EDIT_COMMANDS = new Set([
        'undo', 'redo', 'bold', 'italic', 'strike', 'highlight', 'inline-code', 'inline-math', 'clear-format',
        'heading', 'link', 'image', 'table', 'code', 'math', 'quote', 'ul', 'ol', 'task', 'toc', 'hr'
    ]);

    function run(name, el) {
        const action = actions[name];
        if (!action) return;
        // In a live-mode table cell a command can be refused (headings,
        // quotes) or done by live.js itself (lists)
        if (state.view === 'live' && EDIT_COMMANDS.has(name) && !live.beforeCommand(name)) return;
        action(el || {});
    }

    document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-command]');
        if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;

        const open = popover.current();
        const fromMenu = open && el.closest('[role="menu"]');
        if (fromMenu) popover.close(false);
        run(el.dataset.command, el);

        // Commands that don't move focus hand it back to the menu button
        if (fromMenu && (!document.activeElement || document.activeElement === document.body)) {
            open.anchor.focus();
        }
    });

    // Keep the editor focused (and its selection visible) when using the toolbar
    // (the selection toolbar does the same in live-tools.js)
    toolbar.addEventListener('mousedown', (e) => {
        if (e.target.closest('.tb')) e.preventDefault();
    });

    function handleShortcut(e) {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing) return;
        const key = e.key.toLowerCase();
        let name = null;
        let el = null;
        if (key === 'z') name = e.shiftKey ? 'redo' : 'undo';
        else if (key === 'y' && !e.shiftKey) name = 'redo';
        else if (key === 'b' && !e.shiftKey) name = 'bold';
        else if (key === 'i' && !e.shiftKey) name = 'italic';
        else if (key === 'k' && !e.shiftKey) name = 'link';
        else if (/^[0-6]$/.test(key) && !e.shiftKey) {
            // Ctrl+0 body text, Ctrl+1…6 headings
            name = 'heading';
            el = { dataset: { level: key } };
        }
        if (name) {
            e.preventDefault();
            run(name, el);
        }
    }

    textarea.addEventListener('keydown', handleShortcut);
    liveDoc.addEventListener('keydown', (e) => {
        // The code-language field is an ordinary text field
        if (!e.target.classList.contains('lv-lang')) handleShortcut(e);
    });

    // Toolbar: one tab stop, arrow keys move between the visible buttons
    const toolbarButtons = Array.from(toolbar.querySelectorAll(':scope > button'));
    const visibleToolbarButtons = () => toolbarButtons.filter((el) => !el.hidden);

    function setToolbarTabStop(button) {
        toolbarButtons.forEach((el) => { el.tabIndex = el === button ? 0 : -1; });
    }

    toolbar.addEventListener('focusin', (e) => {
        if (toolbarButtons.includes(e.target)) setToolbarTabStop(e.target);
    });

    toolbar.addEventListener('keydown', (e) => {
        const buttons = visibleToolbarButtons();
        const index = buttons.indexOf(e.target);
        if (index === -1) return;
        let next = -1;
        if (e.key === 'ArrowRight') next = (index + 1) % buttons.length;
        else if (e.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = buttons.length - 1;
        if (next === -1) return;
        e.preventDefault();
        buttons[next].focus();
    });

    // Menu buttons: the logo (file menu), paragraph style and more tools
    document.querySelectorAll('[data-menu]').forEach((button) => {
        const panel = $(button.dataset.menu);
        const options = {
            focusChecked: true,
            onOpen: button === headingButton ? updateFormatState : null
        };

        button.addEventListener('click', () => popover.toggle(panel, button, options));
        button.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            popover.open(panel, button, { ...options, focus: e.key === 'ArrowUp' ? 'last' : 'first' });
        });
    });

    // ========================================================================
    // Toolbar overflow
    // When the top bar runs out of room, the trailing groups of tools
    // (marked data-group) move into the "more" menu, last group first. If
    // that is still not enough, the toolbar moves to a row of its own.
    // ========================================================================

    const header = $('appHeader');
    const OVERFLOW_GROUPS = ['insert', 'list', 'block'];

    function setOverflow(count) {
        const moved = OVERFLOW_GROUPS.slice(OVERFLOW_GROUPS.length - count);
        toolbar.querySelectorAll('[data-group]').forEach((el) => { el.hidden = moved.includes(el.dataset.group); });
        moreMenu.querySelectorAll('[data-group]').forEach((el) => { el.hidden = !moved.includes(el.dataset.group); });
        moreButton.hidden = count === 0;
        $('moreSep').hidden = count === 0;
    }

    const toolbarOverflows = () => toolbar.scrollWidth > toolbar.clientWidth + 1;

    function collapseToFit() {
        let count = 0;
        setOverflow(0);
        while (count < OVERFLOW_GROUPS.length && toolbarOverflows()) {
            setOverflow(++count);
        }
    }

    function fitToolbar() {
        header.classList.remove('is-stacked');
        collapseToFit();
        if (toolbarOverflows()) {
            // On its own row; if even that is too narrow, the toolbar scrolls
            header.classList.add('is-stacked');
            collapseToFit();
        }

        const open = popover.current();
        if (open && open.panel === moreMenu && moreButton.hidden) popover.close(false);
        const visible = visibleToolbarButtons();
        if (!visible.some((el) => el.tabIndex === 0)) setToolbarTabStop(visible[0]);
    }

    // The header itself isn't observed: stacking changes its height
    window.addEventListener('resize', fitToolbar);
    if ('ResizeObserver' in window) new ResizeObserver(fitToolbar).observe($('headerActions'));

    if (IS_MAC) {
        document.querySelectorAll('.menu-kbd').forEach((el) => { el.textContent = el.textContent.replace('Ctrl+', '⌘'); });
        document.querySelectorAll('.kbd').forEach((el) => { if (el.textContent === 'Ctrl') el.textContent = '⌘'; });
        document.querySelectorAll('[data-keys]').forEach((el) => { el.dataset.keys = el.dataset.keys.replace('Ctrl ', '⌘'); });
        document.querySelectorAll('[aria-keyshortcuts]').forEach((el) => {
            el.setAttribute('aria-keyshortcuts', el.getAttribute('aria-keyshortcuts').replace('Control+', 'Meta+'));
        });
        toolbarButtons.forEach((el) => { el.title = el.title.replace('Ctrl+', '⌘'); });
    }

    // ========================================================================
    // Init
    // ========================================================================

    setToolbarTabStop(toolbarButtons[0]);
    fitToolbar();
    setTheme(currentTheme(), false);
    setSync(state.sync);
    setFocusMode(state.focusMode);
    setTypewriter(state.typewriter);
    setFontSize(state.fontSize);
    setSplit(state.split, false);

    const saved = store.get('doc', null);
    if (saved && typeof saved.content === 'string') {
        setFileName(saved.name);
        editor.setValue(saved.content);
    } else {
        editor.setValue(MDE.sampleDocument);
    }

    setView(state.view);
    state.ready = true;

    // highlight.js and KaTeX load on first use; render again once they arrive
    MDE.loader.onLoad(() => {
        state.previewDirty = true;
        if (state.view === 'split' || state.view === 'preview') renderPreview();
        live.refreshLibraries();
    });

    // Web fonts change text metrics once they arrive
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            editor.refreshLayout();
            fitToolbar();
            syncScroll('editor');
        });
    }
})(window.MDE = window.MDE || {});
