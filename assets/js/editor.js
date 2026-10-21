// Source editor: a plain <textarea> layered over a highlighted backdrop
// (line numbers, syntax colours, current line), with its own undo history.
// The editor also holds the document for live mode: while live mode is on
// it is "detached" (hidden, never focused) and keeps the text and selection
// in plain variables, since rewriting a large textarea on every keystroke
// is slow; the textarea catches up when it is shown again.
(function (MDE) {
    const IS_IOS = /iP(hone|ad|od)/.test(navigator.platform)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const HISTORY_LIMIT = 300;
    const GROUP_WINDOW = 1000; // ms: consecutive typing within this window is one undo step

    MDE.createEditor = function ({ textarea, backdrop, container, onChange, onCaret }) {
        let renderedLines = [];
        let currentLineEl = null;
        let caretFrame = 0;
        let scrollFrame = 0;
        let scrollbarWidth = -1;
        let gutterDigits = 0;
        let pendingSelection = null;
        let detached = false;
        let detachedValue = '';
        let detachedSelection = { start: 0, end: 0 };
        let backdropStale = false;
        const history = { stack: [], index: -1, lastKind: null, lastTime: 0 };

        const currentValue = () => (detached ? detachedValue : textarea.value);
        const selection = () => (detached
            ? { start: detachedSelection.start, end: detachedSelection.end }
            : { start: textarea.selectionStart, end: textarea.selectionEnd });

        function select(start, end) {
            if (detached) detachedSelection = { start, end };
            else textarea.setSelectionRange(start, end);
        }

        if (IS_IOS) container.classList.add('is-ios');

        // --- Backdrop -------------------------------------------------------

        const lineHtml = (html) => `<div class="ln">${html || '\u200b'}</div>`;

        // Re-highlight, touching only the lines that changed. A hidden
        // (detached) editor catches up when it is shown again.
        function render() {
            if (detached) {
                backdropStale = true;
                return;
            }
            const next = MDE.syntax.highlight(textarea.value);
            const prev = renderedLines;
            const max = Math.min(prev.length, next.length);

            let start = 0;
            while (start < max && prev[start] === next[start]) start++;
            let endPrev = prev.length;
            let endNext = next.length;
            while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
                endPrev--;
                endNext--;
            }

            const children = backdrop.children;
            for (let i = endPrev - 1; i >= start; i--) children[i].remove();
            if (endNext > start) {
                const html = next.slice(start, endNext).map(lineHtml).join('');
                const ref = children[start];
                if (ref) ref.insertAdjacentHTML('beforebegin', html);
                else backdrop.insertAdjacentHTML('beforeend', html);
            }

            renderedLines = next;
            // Only touch the custom property when it changes: setting it restyles every line
            const digits = Math.max(2, String(next.length).length);
            if (digits !== gutterDigits) {
                gutterDigits = digits;
                container.style.setProperty('--digits', String(digits));
            }
            updateCaret();
            scheduleScrollSync();
        }

        // Deferred to the next frame so typing never forces a synchronous layout
        function scheduleScrollSync() {
            if (scrollFrame) return;
            scrollFrame = requestAnimationFrame(() => {
                scrollFrame = 0;
                backdrop.scrollTop = textarea.scrollTop;
            });
        }

        // Keep the backdrop's text width equal to the textarea's. The textarea's
        // content box shrinks when its scrollbar appears, which the
        // ResizeObserver below reports, so this never runs while typing.
        function measureScrollbar() {
            const width = textarea.offsetWidth - textarea.clientWidth;
            if (width !== scrollbarWidth) {
                scrollbarWidth = width;
                container.style.setProperty('--scrollbar', width + 'px');
            }
        }

        // --- Caret ----------------------------------------------------------

        function caretPosition() {
            const value = textarea.value;
            const pos = textarea.selectionDirection === 'backward' ? textarea.selectionStart : textarea.selectionEnd;
            let line = 0;
            for (let i = value.indexOf('\n'); i !== -1 && i < pos; i = value.indexOf('\n', i + 1)) line++;
            const col = pos === 0 ? 0 : pos - (value.lastIndexOf('\n', pos - 1) + 1);
            return { line, col, pos };
        }

        function updateCaret() {
            const info = caretPosition();
            const el = backdrop.children[info.line] || null;
            if (el !== currentLineEl) {
                if (currentLineEl) currentLineEl.classList.remove('is-current');
                if (el) el.classList.add('is-current');
                currentLineEl = el;
            }
            if (onCaret) onCaret(info);
        }

        function scheduleCaret() {
            if (caretFrame) return;
            caretFrame = requestAnimationFrame(() => {
                caretFrame = 0;
                updateCaret();
            });
        }

        function ensureCaretVisible() {
            const el = backdrop.children[caretPosition().line];
            if (!el) return;
            const top = el.offsetTop;
            const bottom = top + el.offsetHeight;
            if (top < textarea.scrollTop) {
                textarea.scrollTop = Math.max(0, top - 24);
            } else if (bottom > textarea.scrollTop + textarea.clientHeight) {
                textarea.scrollTop = bottom - textarea.clientHeight + 24;
            }
        }

        // --- History --------------------------------------------------------

        const snapshot = () => ({ value: currentValue(), ...selection() });

        function record(kind, selectionBefore) {
            const now = Date.now();
            const state = snapshot();
            if (history.index < history.stack.length - 1) history.stack.length = history.index + 1;

            const top = history.stack[history.index];
            if (top && top.value === state.value) {
                top.start = state.start;
                top.end = state.end;
                return;
            }

            const grouped = (kind === 'insert' || kind === 'delete')
                && kind === history.lastKind
                && now - history.lastTime < GROUP_WINDOW
                && history.index > 0;

            if (grouped) {
                history.stack[history.index] = state;
            } else {
                // Undo should put the caret back where this edit started
                if (top && selectionBefore) {
                    top.start = selectionBefore.start;
                    top.end = selectionBefore.end;
                }
                history.stack.push(state);
                history.index = history.stack.length - 1;
                if (history.stack.length > HISTORY_LIMIT) {
                    history.stack.shift();
                    history.index--;
                }
            }
            history.lastKind = kind;
            history.lastTime = now;
        }

        function applyState(state) {
            if (detached) detachedValue = state.value;
            else textarea.value = state.value;
            if (!detached) textarea.focus({ preventScroll: true });
            select(state.start, state.end);
            history.lastKind = null;
            render();
            if (!detached) ensureCaretVisible();
            if (onChange) onChange();
        }

        function undo() {
            if (history.index > 0) {
                history.index--;
                applyState(history.stack[history.index]);
            }
        }

        function redo() {
            if (history.index < history.stack.length - 1) {
                history.index++;
                applyState(history.stack[history.index]);
            }
        }

        // --- Events ---------------------------------------------------------

        textarea.addEventListener('beforeinput', (e) => {
            if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
                e.preventDefault();
                if (e.inputType === 'historyUndo') undo();
                else redo();
                return;
            }
            pendingSelection = { start: textarea.selectionStart, end: textarea.selectionEnd };
        });

        textarea.addEventListener('input', (e) => {
            const type = e.inputType || '';
            const kind = type === 'insertLineBreak' || type === 'insertParagraph' ? 'break'
                : type.startsWith('delete') ? 'delete'
                : type.startsWith('insertFrom') ? 'paste'
                : 'insert';
            render();
            record(kind, pendingSelection);
            pendingSelection = null;
            if (onChange) onChange();
        });

        textarea.addEventListener('scroll', () => {
            backdrop.scrollTop = textarea.scrollTop;
        }, { passive: true });

        ['keyup', 'mouseup', 'focus', 'select'].forEach((type) => textarea.addEventListener(type, scheduleCaret));
        document.addEventListener('selectionchange', () => {
            if (document.activeElement === textarea) scheduleCaret();
        });

        if ('ResizeObserver' in window) {
            new ResizeObserver(() => {
                measureScrollbar();
                backdrop.scrollTop = textarea.scrollTop;
            }).observe(textarea);
        }

        // --- Public API -----------------------------------------------------

        return {
            textarea,

            getValue: currentValue,

            getSelection: () => ({ ...selection(), value: currentValue() }),

            // Move the selection without recording an undo step (live mode)
            select,

            focus: () => textarea.focus({ preventScroll: true }),

            setValue(value) {
                if (detached) detachedValue = value;
                else textarea.value = value;
                select(0, 0);
                textarea.scrollTop = 0;
                history.stack = [snapshot()];
                history.index = 0;
                history.lastKind = null;
                render();
                if (onChange) onChange();
            },

            // Replace [start, end) with text as one undoable step. `kind` groups
            // typing like the textarea does ('insert', 'delete'); null leaves
            // the change to be recorded together with the next one.
            replaceRange(start, end, text, selStart, selEnd, kind = 'command') {
                const before = selection();
                if (selStart === undefined) selStart = start + text.length;
                if (selEnd === undefined) selEnd = selStart;
                if (detached) {
                    detachedValue = detachedValue.slice(0, start) + text + detachedValue.slice(end);
                } else {
                    textarea.focus({ preventScroll: true });
                    textarea.setRangeText(text, start, end, 'end');
                }
                select(selStart, selEnd);
                render();
                if (kind) record(kind, before);
                if (!detached) ensureCaretVisible();
                // (what changed, for whoever follows passages of the text)
                if (onChange) onChange({ start, end, length: text.length });
            },

            undo,
            redo,
            canUndo: () => history.index > 0,
            canRedo: () => history.index < history.stack.length - 1,

            // Offset of a source line from the top of the scrollable text
            lineTop(line) {
                const el = backdrop.children[Math.min(line, backdrop.children.length - 1)];
                return el ? el.offsetTop - backdrop.firstElementChild.offsetTop : 0;
            },

            refreshLayout() {
                measureScrollbar();
                backdrop.scrollTop = textarea.scrollTop;
            },

            // Live mode hides the textarea and edits through replaceRange/select
            setDetached(flag) {
                if (flag === detached) return;
                if (flag) {
                    detachedValue = textarea.value;
                    detachedSelection = { start: textarea.selectionStart, end: textarea.selectionEnd };
                    detached = true;
                    return;
                }
                detached = false;
                if (textarea.value !== detachedValue) textarea.value = detachedValue;
                textarea.setSelectionRange(detachedSelection.start, detachedSelection.end);
                if (backdropStale) {
                    backdropStale = false;
                    render();
                } else {
                    updateCaret();
                }
            },

            revealCaret: () => ensureCaretVisible()
        };
    };
})(window.MDE = window.MDE || {});
