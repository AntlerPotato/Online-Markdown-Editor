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
    const docTitle = $('docTitle');
    const headerBar = $('headerBar');
    const headerTools = $('headerTools');
    const sidebar = $('sidebar');
    const settingsPanel = $('settingsPanel');
    const settingsButton = $('settingsButton');
    const widthGuides = $('widthGuides');
    const paletteButton = $('paletteButton');
    const viewToggle = $('viewToggle');
    const phoneMenu = $('phoneMenu');
    const quickBar = $('quickBar');
    const quickSlashButton = quickBar.querySelector('[data-command="slash"]');

    // Narrow windows (no outline), phones (as in layout.css) and touch screens
    const NARROW = window.matchMedia('(max-width: 860px)');
    const PHONE = window.matchMedia('(max-width: 640px)');
    const COARSE = window.matchMedia('(pointer: coarse)');

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
        sidebar: store.get('sidebar', true) !== false,
        fileName: DEFAULT_NAME,
        caret: { line: 0, col: 0 },
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
    let slashShown = false;     // the slash menu is open (the quick bar's "/" shows it)

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
            annotate.redraw();
        },
        onSlash: (query, el) => liveTools.slash(query, el),
        onSelection: () => {
            liveTools.selection();
            liveBlocks.refresh();
            annotate.redraw();
        },
        onKey: (key) => liveTools.key(key),
        toast: showToast
    });
    // The slash menu, the toolbars, the link bubble and the code language menu
    const liveTools = MDE.createLiveTools({
        live,
        scroller: liveScroll,
        slashMenu: $('slashMenu'),
        toolbar: inlineToolbar,
        tableBar: $('tableToolbar'),
        imageBar: $('imageToolbar'),
        tip: $('floatTip'),
        linkBubble: $('linkBubble'),
        langMenu: $('langMenu'),
        links: {
            open: (href) => followLink(href, liveDoc, liveScroll),
            edit: (link, { anchor, rect, editing }) => openLinkDialog(false, anchor, { link, rect, editing }),
            copy: (url) => copyText(url).then((ok) => showToast(ok ? '已复制链接' : '复制失败', ok)),
            unlink: (link, { editing }) => {
                unlinkLink(link);
                // Focus on the view (so Ctrl+Z works), no block opened
                if (!editing) live.stopEditing(true);
            }
        },
        replaceImage: (image, button) => openLinkDialog(true, button, null, image),
        onSlashMenu: (open) => {
            slashShown = open;
            updateQuickBar();
            // (the handle of its line is a "+" while it is open)
            liveBlocks.refresh();
        }
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
    // Annotations: the panel beside the document, the dialog that makes
    // one, and their marks in the live view and the preview
    const annotate = MDE.createAnnotate({
        editor,
        live,
        liveDoc,
        liveScroll,
        preview,
        previewScroll,
        textarea,
        backdrop: $('editorBackdrop'),
        panel: $('annotations'),
        dialog: $('annotateDialog'),
        tabButton: $('annotationsButton'),
        view: () => state.view,
        fileName: () => state.fileName,
        phone: () => PHONE.matches,
        narrow: () => NARROW.matches,
        sidebar: () => outlineShown(),
        focusText: () => focusEditor(),
        copyText,
        toast: showToast,
        onLayout: () => relayout()
    });
    // HTML blocks: links clicked in a frame open in a new tab; 编辑源码; the
    // mouse going into a frame (the block handle goes beside its block)
    MDE.htmlFrames.configure({
        onOpen: (href) => window.open(href, '_blank', 'noopener'),
        onEdit: (frame) => live.editFrame(frame),
        onPointer: (frame, point, time) => liveBlocks.pointAt(frame, point, time)
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

    function handleChange(change) {
        updateHistoryButtons();
        scheduleStats();
        schedulePreview();
        scheduleOutline();
        live.update(change);
        annotate.changed(change);
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
        $('phoneStats').textContent = `${words} 字 · ${lines} 行 · 约 ${minutes} 分钟读完`;
    }

    function scheduleStats() {
        clearTimeout(statsTimer);
        statsTimer = setTimeout(updateStats, editor.getValue().length > 30000 ? 300 : 60);
    }

    function handleCaret({ line, col }) {
        state.caret = { line, col };
        showCaret();
        showSelection();
        updateFormatState();
        markOutline();
        annotate.caret();
    }

    // Live mode names the line only (the column is one of the source)
    function showCaret() {
        const { line, col } = state.caret;
        $('statusCaret').textContent = state.view === 'live' ? `第 ${line + 1} 行` : `第 ${line + 1} 行，第 ${col + 1} 列`;
    }

    // While text is selected, the status bar counts it (in place of the
    // kind of block)
    function showSelection() {
        const chip = $('statusSelection');
        const { start, end, value } = editor.getSelection();
        const editing = state.view === 'edit' || state.view === 'split' || (state.view === 'live' && !!live.activeElement());
        const words = editing && end > start ? countWords(value.slice(start, end)) : 0;
        if (words) chip.textContent = `已选 ${words} 字`;
        chip.hidden = !words;
    }

    // Live mode also names the kind of block the caret is in
    function handleLiveCaret(info) {
        const chip = $('statusBlock');
        chip.textContent = info.label;
        chip.hidden = !info.label;
        handleCaret(info);
        updateQuickBar();
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
        annotate.previewRendered();
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
            markOutline();
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
        e.preventDefault();
        followLink(link.getAttribute('href'), container, scroller);
    }

    // An in-page link (#id) scrolls to its target; others open in a new
    // tab, keeping the editor open. An address that could run script
    // (javascript:) isn't opened: rendered links never have one
    // (markdown.js), but the caret's link is read from the source. A heading
    // named like one of the editor's elements has "-1" on its id (#toast is
    // #toast-1).
    function followLink(href, container, scroller) {
        if (href.startsWith('#')) {
            let id = href.slice(1);
            try { id = decodeURIComponent(id); } catch (err) { /* keep raw id */ }
            const target = container.querySelector('#' + CSS.escape(id))
                || (MDE.markdown.isAppId(id) && container.querySelector('#' + CSS.escape(id + '-1')));
            if (target) scroller.scrollTo({ top: contentTop(target, scroller) - 16, behavior: 'smooth' });
        } else if (MDE.markdown.safeUrl(href)) {
            window.open(href, '_blank', 'noopener');
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
        // Above the quick bar and the on-screen keyboard when they show
        const below = window.innerHeight - popover.viewport().bottom;
        toast.style.bottom = (below > 0 ? below + 12 : 64) + 'px';
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
        viewToggle.setAttribute('aria-label', mode === 'live' ? '切换到源码模式' : '切换到实时模式');
        updateQuickBar();
        // On phones the toolbar shows in some views only
        fitToolbar();
        showCaret();
        showSelection();
        placeGuides();
        annotate.redraw();

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
        markOutline();
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
        document.querySelectorAll('.font-size-value').forEach((el) => { el.textContent = `${state.fontSize} px`; });
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
    // Under the file name on phones
    const PHONE_SAVE_LABELS = { saved: '已保存在本机浏览器', pending: '正在保存…', error: '无法保存在本机浏览器' };

    // The save indicator is an icon (unless saving failed), so its name
    // and tooltip carry the details
    function updateSaveButton() {
        const label = `${SAVE_LABELS[saveStatus.dataset.state]}：${state.fileName}`;
        $('saveButton').setAttribute('aria-label', label);
        $('saveButton').title = label;
    }

    function setFileName(name) {
        state.fileName = name || DEFAULT_NAME;
        $('docName').textContent = state.fileName;
        docTitle.title = state.fileName;
        updateSaveButton();
    }

    function setSaveState(status) {
        if (saveStatus.dataset.state === status) return;
        saveStatus.dataset.state = status;
        docTitle.dataset.state = status;
        $('saveLabel').textContent = SAVE_LABELS[status];
        $('docSaveLabel').textContent = PHONE_SAVE_LABELS[status];
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
        // (the annotations moved with the text)
        annotate.save();
        setSaveState(ok ? 'saved' : 'error');
    }

    window.addEventListener('pagehide', () => {
        if (saveStatus.dataset.state === 'pending') saveNow();
    });

    function newDocument() {
        if (editor.getValue() && !confirm('确定要新建文档吗？当前内容将会丢失。')) return;
        // Its annotations go to the panel's history
        annotate.archiveAll();
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
            annotate.archiveAll();
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
    let linkEdit = null;      // the link being edited (null: a new one is inserted)
    let imageEdit = null;     // the image being replaced (live mode's image toolbar)
    let linkDone = null;      // where focus goes once the dialog is done

    function updateLinkLabels() {
        const image = linkAsImage.checked;
        $('linkDialogTitle').textContent = linkEdit ? '编辑链接' : imageEdit ? '替换图片' : image ? '插入图片' : '插入链接';
        $('linkTextLabel').textContent = image ? '图片描述' : '显示文字';
        $('linkUrlLabel').textContent = image ? '图片地址' : '链接地址';
        $('linkSubmit').textContent = linkEdit || imageEdit ? '保存' : '插入';
        $('linkImageOption').hidden = !!(linkEdit || imageEdit);
    }

    // Reference definitions ([label]: url) of a text, read only once a
    // reference link is looked up
    function refsOf(value) {
        let defined = null;
        return (label) => {
            if (!defined) defined = marked.lexer(value).links || {};
            const link = defined[label.replace(/\s+/g, ' ').toLowerCase()];
            return link ? link.href : undefined;
        };
    }

    // Opened from the toolbar, the dialog sits under its button; from the
    // selection toolbar or Ctrl+K in live mode, at the selection. With the
    // caret (or the selection) in a link, it edits that link. The link
    // bubble opens it for its link: edit = { link, rect, editing (a block
    // of live mode was being edited) }. The image toolbar's 替换图片 opens
    // it over the image: replace = its { src, alt }.
    function openLinkDialog(image, el, edit = null, replace = null) {
        const { start, end, value } = editor.getSelection();
        const selected = value.slice(start, end);
        const isUrl = /^(https?:\/\/|www\.)\S+$/.test(selected.trim());
        linkRange = { start, end };
        imageEdit = replace;
        linkEdit = edit ? edit.link : image ? null : MDE.links.at(value, start, end, refsOf(value));
        linkText.value = replace ? replace.alt : linkEdit ? linkEdit.text.replace(/\s*\n\s*/g, ' ') : isUrl ? '' : selected.replace(/\s*\n\s*/g, ' ');
        linkUrl.value = replace ? replace.src : linkEdit ? linkEdit.url : isUrl ? selected.trim() : 'https://';
        linkUrl.removeAttribute('aria-invalid');
        linkAsImage.checked = image;
        updateLinkLabels();

        const button = $(image ? 'imageButton' : 'linkButton');
        const fromToolbar = el === button;
        const atSelection = !fromToolbar && state.view === 'live' && !!live.selectionRect();
        // From the bubble of a link nobody was editing: no block opens
        linkDone = edit && !edit.editing ? () => live.stopEditing(true) : focusEditor;
        const anchor = edit || replace || (el instanceof Element && (inlineToolbar.contains(el) || quickBar.contains(el))) ? el : toolbarAnchor(button);
        popover.open(linkDialog, anchor, {
            rect: replace ? imageTop : edit ? edit.rect : atSelection ? () => live.selectionRect() : null,
            returnFocus: fromToolbar ? null : linkDone,
            onOpen: () => {
                linkUrl.focus();
                linkUrl.setSelectionRange(linkUrl.value.length, linkUrl.value.length);
            }
        });
    }

    // An image being replaced: the dialog goes over its top
    function imageTop() {
        const r = live.imageRect();
        return r && { top: r.top, bottom: r.top, left: r.left, right: r.left, width: 0, height: 0 };
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
        if (imageEdit) {
            live.imageCommand('replace', { src: url, alt: linkText.value.trim() });
            linkDone();
        } else if (linkEdit) {
            editLink(linkEdit, linkText.value.trim(), url);
            linkDone();
        } else {
            commands.insertLink({ text: linkText.value.trim(), url, image: linkAsImage.checked, ...linkRange });
        }
    });

    linkDialog.querySelector('[data-dismiss]').addEventListener('click', () => {
        popover.close(false);
        linkDone();
    });

    // The caret goes with the text: after an edited link when it was in it
    function moveAround(link, length, inside) {
        const { start, end } = editor.getSelection();
        const move = (pos) => (pos <= link.from ? pos : pos >= link.to ? pos + length - (link.to - link.from) : inside(pos));
        return [move(start), move(end)];
    }

    function editLink(link, text, url) {
        const next = MDE.links.rewrite(link, text, url);
        if (next === null) return;
        editor.replaceRange(link.from, link.to, next, ...moveAround(link, next.length, () => link.from + next.length));
    }

    // Take a link off, leaving its text
    function unlinkLink(link) {
        const text = MDE.links.unlink(link);
        if (text === null) return;
        const inside = (pos) => clamp(pos - 1, link.from, link.from + text.length);
        editor.replaceRange(link.from, link.to, text, ...moveAround(link, text.length, inside));
    }

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
        popover.open($('tablePicker'), toolbarAnchor($('tableButton')), {
            onOpen: () => cellAt(table.rows, table.cols).focus()
        });
    }

    // ========================================================================
    // Outline
    // Headings of the document beside it; the section being edited (or, with
    // nothing being edited, the one at the top of the view) is marked.
    // ========================================================================

    const TOP_HEADINGS = ':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6';
    const outline = MDE.createOutline({ nav: $('outline'), empty: $('outlineEmpty'), onPick: goToHeading });
    let outlineText = null;     // the text the outline was made from
    let outlineTimer = 0;

    const outlineShown = () => state.sidebar && !NARROW.matches;

    function scheduleOutline() {
        if (!outlineShown()) return;
        clearTimeout(outlineTimer);
        outlineTimer = setTimeout(updateOutline, editor.getValue().length > 30000 ? 400 : 150);
    }

    function updateOutline() {
        clearTimeout(outlineTimer);
        if (!outlineShown()) return;
        const value = editor.getValue();
        if (value !== outlineText) {
            outlineText = value;
            // (live mode has the document in blocks already)
            const found = state.view === 'live' ? live.headings() : null;
            outline.render(found ? MDE.outline.headingsOf(value, found) : MDE.outline.headingsOf(value));
        }
        markOutline();
    }

    function markOutline() {
        if (!outlineShown() || outlineText === null) return;
        const byView = state.view === 'preview' || (state.view === 'live' && !live.activeElement());
        outline.mark(byView ? headingAtTop() : outline.indexAt(editor.getSelection().end));
    }

    // The last heading above the top of the view (the first one at the top
    // of the document, the last one at its end)
    function headingAtTop() {
        const inLive = state.view === 'live';
        const scroller = inLive ? liveScroll : previewScroll;
        const headings = (inLive ? liveDoc : preview).querySelectorAll(inLive ? ':scope > .lv-k-heading' : TOP_HEADINGS);
        if (!headings.length) return -1;
        if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 2) return headings.length - 1;
        const line = scroller.getBoundingClientRect().top + 48;
        let lo = 0;
        let hi = headings.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (headings[mid].getBoundingClientRect().top <= line) lo = mid + 1;
            else hi = mid;
        }
        return Math.max(0, lo - 1);
    }

    // To a heading: in live mode and the source editor, the caret goes to
    // the end of its line, with the heading near the top; the preview
    // scrolls to it
    function goToHeading(item, index) {
        if (state.view === 'preview') {
            const heading = preview.querySelectorAll(TOP_HEADINGS)[index];
            if (heading) previewScroll.scrollTo({ top: contentTop(heading) - 16, behavior: 'smooth' });
            return;
        }
        editor.select(item.end, item.end);
        if (state.view === 'live') {
            live.focus();
            const el = live.activeElement();
            if (el) liveScroll.scrollTop += el.getBoundingClientRect().top - liveScroll.getBoundingClientRect().top - 24;
        } else {
            editor.focus();
            const line = editor.getValue().slice(0, item.start).split('\n').length - 1;
            textarea.scrollTop = Math.max(0, editor.lineTop(line) - 16);
        }
        outline.mark(index);
    }

    function setSidebar(on, persist = true) {
        state.sidebar = on;
        if (persist) store.set('sidebar', on);
        sidebar.hidden = !on;
        setChecked('[data-command="toggle-sidebar"]', on);
        // (at start-up the document isn't there yet: made once it is)
        if (on && state.ready) updateOutline();
        annotate.fit();
        relayout();
    }

    // The document moved or changed size (the outline, the page width, a
    // font arrived): the things placed on it follow
    let relayoutFrame = 0;

    function relayout() {
        if (relayoutFrame) return;
        relayoutFrame = requestAnimationFrame(() => {
            relayoutFrame = 0;
            if (state.view === 'live') {
                liveBlocks.refresh();
                liveTools.selection();
            }
            popover.update();
            placeSettings();
            placeGuides();
        });
    }

    // ========================================================================
    // Typography settings
    // Page width, fonts and line spacing of the document (typography.js
    // keeps them). The panel isn't modal: it stays open while the page is
    // edited, and the page's edges get handles to drag.
    // ========================================================================

    const typography = MDE.typography;
    const widthRange = $('widthRange');
    const fontLists = { en: $('fontsEn'), zh: $('fontsZh'), mono: $('fontsMono') };

    function settingButton(className, kind, value, label) {
        const button = document.createElement('button');
        button.type = 'button';
        if (className) button.className = className;
        button.dataset.setting = kind;
        button.dataset.value = String(value);
        button.setAttribute('aria-pressed', 'false');
        button.textContent = label;
        return button;
    }

    $('widthPresets').replaceChildren(...typography.WIDTHS.map((w) => settingButton('', 'width', w.value, w.label)));
    $('lineHeights').replaceChildren(...typography.LINE_HEIGHTS.map((h) => settingButton('', 'lh', h.value, h.label)));
    Object.keys(fontLists).forEach((kind) => {
        fontLists[kind].replaceChildren(...typography.FONTS[kind].map((font) => {
            const button = settingButton('font-chip', kind, font.key, font.name);
            // Shown in its own font (once that has been downloaded)
            button.style.fontFamily = `${font.family}, ${font.generic}`;
            const note = document.createElement('small');
            note.textContent = font.note || '';
            note.hidden = !font.note;
            button.appendChild(note);
            return button;
        }));
    });

    function showSettings() {
        const s = typography.get();
        settingsPanel.querySelectorAll('[data-setting]').forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.value === String(s[button.dataset.setting])));
        });
        $('settingsWidthValue').textContent = typography.widthLabel(s.width);
        $('settingsLhValue').textContent = String(s.lh);
        widthRange.value = String(s.width === 'full' ? typography.WIDTH_MAX : s.width);
        $('widthLabel').textContent = typography.widthLabel(s.width);
    }

    // A font is downloaded once chosen; its button says so meanwhile
    function chooseFont(button, kind, key) {
        const font = typography.FONTS[kind].find((f) => f.key === key);
        const note = button.querySelector('small');
        typography.set({ [kind]: key });
        if (!font.css) return;
        let done = false;
        setTimeout(() => {
            if (done) return;
            note.textContent = '下载中…';
            note.hidden = false;
        }, 150);
        typography.load(kind, key).then(() => {
            done = true;
            note.textContent = font.note || '';
            note.hidden = !font.note;
        });
    }

    settingsPanel.addEventListener('click', (e) => {
        const button = e.target.closest('[data-setting]');
        if (!button) return;
        const kind = button.dataset.setting;
        const value = button.dataset.value;
        if (kind === 'width') typography.set({ width: value === 'full' ? 'full' : Number(value) });
        else if (kind === 'lh') typography.set({ lh: Number(value) });
        else chooseFont(button, kind, value);
        showSettings();
        relayout();
    });

    widthRange.addEventListener('input', () => {
        typography.set({ width: Number(widthRange.value) }, false);
        showSettings();
        relayout();
    });

    widthRange.addEventListener('change', () => {
        typography.set({ width: Number(widthRange.value) });
    });

    function resetTypography() {
        typography.reset();
        showSettings();
        relayout();
    }

    function setSettingsOpen(open) {
        if (settingsPanel.hidden === !open) return;
        settingsPanel.hidden = !open;
        settingsButton.setAttribute('aria-expanded', String(open));
        placeSettings();
        placeGuides();
        if (open) {
            showSettings();
            // Into the panel: the first setting's current choice
            const first = Array.from(settingsPanel.querySelectorAll('[aria-pressed="true"]')).find((el) => el.offsetParent !== null);
            if (first) first.focus({ preventScroll: true });
        } else if (settingsPanel.contains(document.activeElement)) {
            (PHONE.matches ? $('phoneMoreButton') : settingsButton).focus();
        }
    }

    settingsButton.addEventListener('click', () => setSettingsOpen(settingsPanel.hidden));

    settingsPanel.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.preventDefault();
        setSettingsOpen(false);
    });

    // With the annotations panel open, the settings go left of it when
    // both fit (10px apart, as wide as ever); otherwise they cover it
    const SETTINGS_WIDTH = 356;    // (layout.css)
    const SETTINGS_GAP = 10;
    function placeSettings() {
        let right = '';
        if (!settingsPanel.hidden && annotate.isOpen() && !PHONE.matches) {
            const card = settingsPanel.parentElement;
            const left = card.getBoundingClientRect().left + card.clientLeft;
            const panel = $('annotations').getBoundingClientRect();
            if (panel.left - left >= SETTINGS_WIDTH + SETTINGS_GAP * 2) right = Math.round(left + card.clientWidth - panel.left + SETTINGS_GAP) + 'px';
        }
        settingsPanel.classList.toggle('is-beside', right !== '');
        settingsPanel.style.right = right;
    }

    // The page's edges and its width, while the settings are open (in live
    // mode and the preview, when there is room beside the page). The guides
    // stand for the live page's width: the preview's page is a little
    // narrower (less padding), so its guides stand a little outside it.
    function placeGuides() {
        const show = !settingsPanel.hidden && !NARROW.matches && (state.view === 'live' || state.view === 'preview');
        widthGuides.hidden = !show;
        if (!show) return;
        const page = (state.view === 'live' ? liveDoc : preview).getBoundingClientRect();
        const box = panes.getBoundingClientRect();
        const outside = state.view === 'preview' && typography.get().width !== 'full' ? typography.PREVIEW_PADDING_LESS / 2 : 0;
        widthGuides.style.left = (page.left - box.left - outside) + 'px';
        widthGuides.style.width = (page.width + outside * 2) + 'px';
    }

    // Dragging an edge: the page stays in the middle, so its width is twice
    // the distance from the middle (in steps of the slider)
    widthGuides.addEventListener('pointerdown', (e) => {
        const edge = e.target.closest('.width-edge');
        if (!edge || e.button !== 0) return;
        e.preventDefault();
        edge.setPointerCapture(e.pointerId);
        document.body.classList.add('is-resizing-width');
        const guides = widthGuides.getBoundingClientRect();
        const middle = guides.left + guides.width / 2;
        const { WIDTH_MIN, WIDTH_MAX, WIDTH_STEP } = typography;
        let width = null;
        let frame = 0;

        const move = (ev) => {
            width = clamp(Math.round((Math.abs(ev.clientX - middle) * 2) / WIDTH_STEP) * WIDTH_STEP, WIDTH_MIN, WIDTH_MAX);
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                typography.set({ width }, false);
                showSettings();
                placeGuides();
            });
        };
        const end = () => {
            cancelAnimationFrame(frame);
            document.body.classList.remove('is-resizing-width');
            edge.removeEventListener('pointermove', move);
            edge.removeEventListener('pointerup', end);
            edge.removeEventListener('pointercancel', end);
            if (width !== null) typography.set({ width });
            showSettings();
            relayout();
        };
        edge.addEventListener('pointermove', move);
        edge.addEventListener('pointerup', end);
        edge.addEventListener('pointercancel', end);
    });

    window.addEventListener('resize', () => {
        annotate.fit();
        placeSettings();
        placeGuides();
    });

    // ========================================================================
    // Command palette
    // ========================================================================

    const iconOf = (selector) => document.querySelector(selector + ' svg');
    const MOD = IS_MAC ? '⌘' : 'Ctrl';
    const notPreview = () => state.view !== 'preview';
    const hasSelection = () => {
        const { start, end, value } = editor.getSelection();
        return !!value.slice(start, end).trim();
    };
    const HEADINGS = [1, 2, 3, 4, 5, 6].map((level) => ({
        id: 'h' + level,
        label: `标题 ${level}`,
        group: '段落',
        words: `heading h${level} title biaoti bt${level === 1 ? ' yiji' : level === 2 ? ' erji' : ''}`,
        icon: 'H' + level,
        keys: [MOD, String(level)],
        edit: true,
        when: notPreview,
        run: () => run('heading', { dataset: { level: String(level) } })
    }));

    // edit: works on the document (focus goes back to the text first)
    const COMMANDS = [
        { id: 'bold', label: '加粗', group: '格式', words: 'bold strong jiacu jc cuti', icon: iconOf('#toolbar [data-command="bold"]'), keys: [MOD, 'B'] },
        { id: 'italic', label: '斜体', group: '格式', words: 'italic em xieti xt', icon: iconOf('#toolbar [data-command="italic"]'), keys: [MOD, 'I'] },
        { id: 'strike', label: '删除线', group: '格式', words: 'strikethrough del shanchuxian scx', icon: iconOf('#toolbar [data-command="strike"]') },
        { id: 'highlight', label: '高亮', group: '格式', words: 'highlight mark gaoliang gl', icon: iconOf('#toolbar [data-command="highlight"]') },
        { id: 'inline-code', label: '行内代码', group: '格式', words: 'inline code hangneidaima hndm', icon: iconOf('#inlineToolbar [data-command="inline-code"]') },
        { id: 'inline-math', label: '行内公式', group: '格式', words: 'inline math latex hangneigongshi hngs', icon: iconOf('#inlineToolbar [data-command="inline-math"]') },
        { id: 'link', label: '链接', group: '格式', words: 'link url lianjie lj', icon: iconOf('#linkButton'), keys: [MOD, 'K'] },
        { id: 'clear-format', label: '清除格式', group: '格式', words: 'clear format qingchugeshi qcgs', icon: iconOf('#inlineToolbar [data-command="clear-format"]') },
        { id: 'p', label: '正文', group: '段落', words: 'paragraph body text zhengwen zw', icon: iconOf('#slash-p'), keys: [MOD, '0'], run: () => run('heading', { dataset: { level: '0' } }) },
        ...HEADINGS,
        { id: 'quote', label: '引用', group: '段落', words: 'quote blockquote yinyong yy', icon: iconOf('#toolbar [data-command="quote"]') },
        { id: 'ul', label: '无序列表', group: '段落', words: 'bullet list ul wuxuliebiao wxlb liebiao', icon: iconOf('#toolbar [data-command="ul"]') },
        { id: 'ol', label: '有序列表', group: '段落', words: 'ordered numbered list ol youxuliebiao yxlb liebiao', icon: iconOf('#toolbar [data-command="ol"]') },
        { id: 'task', label: '任务列表', group: '段落', words: 'task todo checkbox renwuliebiao rwlb', icon: iconOf('#toolbar [data-command="task"]') },
        { id: 'image', label: '图片', group: '插入', words: 'image picture img tupian tp', icon: iconOf('#imageButton') },
        { id: 'table', label: '表格', group: '插入', words: 'table biaoge bg', icon: iconOf('#tableButton') },
        { id: 'code', label: '代码块', group: '插入', words: 'code block fence daimakuai dmk', icon: iconOf('#toolbar [data-command="code"]') },
        { id: 'math', label: '公式块', group: '插入', words: 'math formula equation latex gongshikuai gsk gongshi', icon: iconOf('#toolbar [data-command="math"]') },
        { id: 'toc', label: '目录', group: '插入', words: 'toc contents mulu ml', icon: iconOf('#toolbar [data-command="toc"]') },
        { id: 'hr', label: '分隔线', group: '插入', words: 'hr rule divider line fengexian fgx', icon: iconOf('#toolbar [data-command="hr"]') },
        { id: 'undo', label: '撤销', group: '编辑', words: 'undo chexiao cx', icon: iconOf('#toolbar [data-command="undo"]'), keys: [MOD, 'Z'], disabled: () => !editor.canUndo() },
        { id: 'redo', label: '重做', group: '编辑', words: 'redo chongzuo cz', icon: iconOf('#toolbar [data-command="redo"]'), keys: [MOD, 'Y'], disabled: () => !editor.canRedo() },
        { id: 'annotate', label: '添加标注', group: '编辑', words: 'annotate annotation comment note tianjiabiaozhu tjbz biaozhu bz pizhu', icon: iconOf('#inlineToolbar [data-command="annotate"]'), keys: [MOD, IS_MAC ? '⌥' : 'Alt', 'M'], disabled: () => !hasSelection() }
    ].map((c) => ({ edit: true, when: notPreview, run: () => run(c.id), ...c })).concat([
        ...[['live', '实时', 'live shishi ss'], ['edit', '源码', 'source code markdown yuanma ym'], ['split', '分栏', 'split side fenlan fl'], ['preview', '预览', 'preview read yulan yl']].map(([mode, label, words]) => ({
            id: 'view-' + mode,
            label,
            group: '视图',
            words: 'view shitu ' + words,
            icon: iconOf(`.header-actions [data-mode="${mode}"]`),
            radio: true,
            checked: () => state.view === mode,
            run: () => setView(mode)
        })),
        { id: 'sidebar', label: '大纲', group: '视图', words: 'outline sidebar headings dagang dg cebianlan', icon: iconOf('#sidebarToggle'), checked: () => state.sidebar, when: () => !NARROW.matches, run: () => setSidebar(!state.sidebar) },
        { id: 'annotations', label: '标注面板', group: '视图', words: 'annotations comments panel biaozhumianban bzmb biaozhu bz', icon: iconOf('#annotationsButton'), checked: () => annotate.isOpen(), run: () => annotate.toggle() },
        { id: 'theme', label: '深色模式', group: '视图', words: 'dark theme night shensemoshi ssms zhuti', icon: iconOf('.theme-toggle'), checked: () => currentTheme() === 'dark', run: () => run('toggle-theme') },
        { id: 'typewriter', label: '打字机', group: '视图', words: 'typewriter dazijimoshi dzj', icon: iconOf('#phoneMenu [data-command="toggle-typewriter"]'), checked: () => state.typewriter, when: () => state.view === 'live', run: () => run('toggle-typewriter') },
        { id: 'focus', label: '专注', group: '视图', words: 'focus zhuanzhu zz', icon: iconOf('#phoneMenu [data-command="toggle-focus"]'), checked: () => state.focusMode, when: () => state.view === 'live', run: () => run('toggle-focus') },
        { id: 'sync', label: '同步滚动', group: '视图', words: 'sync scroll tongbugundong tbgd', icon: iconOf('#phoneMenu [data-command="toggle-sync"]'), checked: () => state.sync, when: () => state.view === 'split', run: () => run('toggle-sync') },
        { id: 'settings', label: '排版设置', group: '视图', words: 'typography settings font width line spacing paibanshezhi pbsz ziti kuandu hangju', icon: iconOf('#settingsButton'), run: () => setSettingsOpen(true) },
        { id: 'font-inc', label: '放大字号', group: '视图', words: 'font size bigger larger zoom in fangdazihao fdzh zihao', icon: '+', disabled: () => state.fontSize >= FONT_MAX, run: () => run('font-inc') },
        { id: 'font-dec', label: '缩小字号', group: '视图', words: 'font size smaller zoom out suoxiaozihao sxzh zihao', icon: '−', disabled: () => state.fontSize <= FONT_MIN, run: () => run('font-dec') },
        { id: 'new', label: '新建文档', group: '文件', words: 'new document file xinjian xj', icon: iconOf('#fileMenu [data-command="new"]'), run: () => run('new') },
        { id: 'import', label: '导入 Markdown 文件', group: '文件', words: 'import open file daoru dr', icon: iconOf('#fileMenu [data-command="import"]'), run: () => run('import') },
        { id: 'export', label: '导出 Markdown 文件', group: '文件', words: 'export download save file daochu dc', icon: iconOf('#fileMenu [data-command="export"]'), run: () => run('export') },
        { id: 'copy-annotations', label: '复制全部标注', group: '文件', words: 'copy annotations clipboard ai fuzhiquanbubiaozhu fzqbbz fuzhi biaozhu bz', icon: iconOf('#annotationsCopy'), disabled: () => !annotate.copyCount(), run: () => annotate.copyAll() }
    ]);

    // Where focus was when the palette opened: the block being edited, the
    // source editor, or an element
    let paletteFrom = null;

    function focusBack(intoText) {
        const from = paletteFrom;
        paletteFrom = null;
        if (from === 'live') live.focus();
        else if (from === 'editor') editor.focus();
        else if (intoText) focusEditor();
        else if (from && from.isConnected && from.offsetParent !== null) from.focus();
    }

    const palette = MDE.createPalette({
        panel: $('commandPalette'),
        input: $('paletteSearch'),
        list: $('paletteList'),
        button: paletteButton,
        commands: COMMANDS,
        // Under the top bar's first row, in the middle of the window
        place(panel) {
            const view = popover.viewport();
            const top = Math.max(view.top + 8, headerBar.getBoundingClientRect().bottom + 6);
            palette.fit(view.bottom - top - 16 - (panel.offsetHeight - $('paletteList').offsetHeight));
            panel.style.left = Math.max(8, (document.documentElement.clientWidth - panel.offsetWidth) / 2) + 'px';
            panel.style.top = top + 'px';
        },
        returnFocus: () => focusBack(false),
        onRun(command) {
            focusBack(!!command.edit);
            command.run();
        }
    });

    function openPalette() {
        if (palette.isOpen()) {
            popover.close(true);
            return;
        }
        const el = document.activeElement;
        paletteFrom = state.view === 'live' && live.activeElement() && liveDoc.contains(el) ? 'live'
            : el === textarea ? 'editor'
            : el && el !== document.body ? el : null;
        // A selection made a moment ago is only read on the next frame
        if (paletteFrom === 'live') live.captureSelection();
        palette.open();
    }

    paletteButton.addEventListener('click', openPalette);

    // Ctrl+Shift+P (⌘⇧P) anywhere, before the text editors see it
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.isComposing || e.key.toLowerCase() !== 'p') return;
        e.preventDefault();
        e.stopPropagation();
        openPalette();
    }, true);

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
        'view-toggle': () => setView(state.view === 'live' ? 'edit' : 'live'),
        slash: quickSlash,
        'hide-keyboard': () => live.stopEditing(true),
        'toggle-sidebar': () => setSidebar(!state.sidebar),
        annotate: (el) => annotate.start(el),
        'toggle-annotations': () => annotate.toggle(),
        'toggle-settings': () => setSettingsOpen(settingsPanel.hidden),
        'open-settings': () => setSettingsOpen(true),
        'reset-typography': resetTypography,
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
        // Switches and steps (data-keep-open) leave their menu open
        const fromMenu = open && el.closest('[role="menu"]') && !el.hasAttribute('data-keep-open');
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
        // Ctrl+Alt+M (⌘⌥M): annotate the selection. On a Mac ⌥ changes
        // the character, so there the key's place counts.
        if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && !e.isComposing && (e.key.toLowerCase() === 'm' || (IS_MAC && e.code === 'KeyM'))) {
            e.preventDefault();
            run('annotate');
            return;
        }
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
    liveScroll.addEventListener('keydown', (e) => {
        // With no block being edited (focus on the view, e.g. after Esc)
        // only undo and redo
        if (e.target !== liveScroll || /^[zy]$/i.test(e.key)) handleShortcut(e);
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

    // Menu buttons: the logo (file menu), paragraph style, more tools, and
    // "more" on phones
    document.querySelectorAll('[data-menu]').forEach((button) => {
        const panel = $(button.dataset.menu);
        const options = {
            focusChecked: true,
            onOpen: button === headingButton ? updateFormatState : panel === phoneMenu ? fillPhoneMenu : null
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
    // When the toolbar's row runs out of room, the trailing groups of tools
    // (marked data-group) move into the "more" menu, last group first; on a
    // phone that can leave only undo, redo, paragraph style, bold and
    // italic. If that is still not enough, the toolbar scrolls.
    // ========================================================================

    const OVERFLOW_GROUPS = ['format', 'media', 'insert', 'list', 'block'];

    // A dialog opened from a toolbar button that is in the "more" menu
    // hangs under "⋯"
    const toolbarAnchor = (button) => (button.hidden ? moreButton : button);

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
        collapseToFit();
        const open = popover.current();
        if (open && open.panel === moreMenu && moreButton.hidden) popover.close(false);
        const visible = visibleToolbarButtons();
        if (!visible.some((el) => el.tabIndex === 0)) setToolbarTabStop(visible[0]);
    }

    window.addEventListener('resize', fitToolbar);
    if ('ResizeObserver' in window) new ResizeObserver(fitToolbar).observe(headerTools);

    // ========================================================================
    // Phones: "more", the quick bar and the on-screen keyboard
    // ========================================================================

    // The settings that apply to the current view
    function fillPhoneMenu() {
        phoneMenu.querySelectorAll('[data-views]').forEach((el) => {
            el.hidden = !el.dataset.views.split(' ').includes(state.view);
        });
        popover.update();
    }

    // The quick bar shows while a block of live mode is edited on a
    // phone's touch screen; its "/" is pressed while the slash menu is open
    function updateQuickBar() {
        const show = state.view === 'live' && PHONE.matches && COARSE.matches && !!live.activeElement();
        if (quickBar.hidden === show) {
            quickBar.hidden = !show;
            popover.update();
        }
        const pressed = String(show && slashShown);
        if (quickSlashButton.getAttribute('aria-pressed') !== pressed) quickSlashButton.setAttribute('aria-pressed', pressed);
    }

    // A press on "/" while the slash menu is open closes the menu (as any
    // press outside it does, in popover.js); its click must not open the
    // menu again. Window capture runs before popover.js closes it.
    let slashWasOpen = false;
    window.addEventListener('pointerdown', (e) => {
        slashWasOpen = slashShown && quickSlashButton.contains(e.target);
    }, true);

    // "/": the slash menu on an empty line, a new one under the block
    // being edited unless it is empty
    function quickSlash() {
        if (slashWasOpen) return;
        const el = live.activeElement();
        const info = el && live.blockInfo(el);
        if (!info) return;
        if (!info.gap && info.source) live.insertBelow(el);
        live.startSlash();
    }

    // Keep the text focused (and the keyboard up) while using the bar
    quickBar.addEventListener('mousedown', (e) => e.preventDefault());

    // The window keeps its height when the on-screen keyboard comes up
    // (Safari, and Chrome by default), so on phones the app is fitted to
    // the part above the keyboard, and the quick bar sits on it. Not while
    // zoomed in: then the visible part is smaller for another reason.
    function fitViewport() {
        const view = window.visualViewport;
        const covered = PHONE.matches && !!view && Math.abs(view.scale - 1) < 0.01 && view.height < window.innerHeight - 1;
        app.style.height = covered ? view.height + 'px' : '';
        app.style.top = covered ? view.offsetTop + 'px' : '';
        popover.update();
    }

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', fitViewport);
        window.visualViewport.addEventListener('scroll', fitViewport);
    }

    [PHONE, COARSE].forEach((query) => {
        if (query.addEventListener) {
            query.addEventListener('change', () => {
                fitViewport();
                updateQuickBar();
            });
        }
    });

    // Wide enough again for the outline (and the page's width handles)
    if (NARROW.addEventListener) {
        NARROW.addEventListener('change', () => {
            updateOutline();
            annotate.fit();
            placeSettings();
            placeGuides();
        });
    }

    if (IS_MAC) {
        document.querySelectorAll('.menu-kbd').forEach((el) => { el.textContent = el.textContent.replace('Ctrl+', '⌘'); });
        document.querySelectorAll('.kbd').forEach((el) => { el.textContent = el.textContent.replace(/^Ctrl(?= |$)/, '⌘'); });
        document.querySelectorAll('[data-keys]').forEach((el) => { el.dataset.keys = el.dataset.keys.replace('Ctrl ', '⌘').replace('Alt ', '⌥'); });
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
    setSidebar(state.sidebar, false);

    const saved = store.get('doc', null);
    if (saved && typeof saved.content === 'string') {
        setFileName(saved.name);
        editor.setValue(saved.content);
    } else {
        editor.setValue(MDE.sampleDocument);
    }

    setView(state.view);
    state.ready = true;
    updateOutline();
    annotate.load(editor.getValue());

    // highlight.js and KaTeX load on first use; render again once they arrive
    MDE.loader.onLoad(() => {
        state.previewDirty = true;
        if (state.view === 'split' || state.view === 'preview') renderPreview();
        live.refreshLibraries();
        annotate.redraw();
    });

    // Web fonts change text metrics once they arrive (and later, when a
    // font chosen in the typography settings does)
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            editor.refreshLayout();
            fitToolbar();
            syncScroll('editor');
        });
        if (document.fonts.addEventListener) {
            document.fonts.addEventListener('loadingdone', () => {
                editor.refreshLayout();
                relayout();
            });
        }
    }
})(window.MDE = window.MDE || {});
