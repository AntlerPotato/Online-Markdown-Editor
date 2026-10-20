// The outline beside the document: its headings as a list, the one whose
// section holds the caret (or is at the top of the view) marked; a click
// goes to that heading (onPick, in app.js).
(function (MDE) {
    const unescape = (text) => text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');

    // The text a heading shows, without its Markdown: formulas keep their
    // TeX, images their description
    function plain(tokens) {
        return tokens.map((token) => {
            if (token.type === 'image') return token.text;
            if (token.type === 'br') return ' ';
            if (token.type === 'html') return '';
            if (token.tokens) return plain(token.tokens);
            return token.text || '';
        }).join('');
    }

    function label(token) {
        const text = unescape(plain(token.tokens || []));
        return text.replace(/(\$\$?)([^$\n]+?)\1/g, '$2').replace(/==([^=\n]+)==/g, '$1').replace(/\s+/g, ' ').trim();
    }

    // { level, text, start, end (of its first line) } of every heading
    function headingsOf(text) {
        return MDE.headingsOf(text).map((h) => ({ level: h.level, text: label(h.token), start: h.start, end: h.end }));
    }

    MDE.createOutline = function ({ nav, empty, onPick }) {
        let items = [];
        let buttons = [];
        let current = -1;
        let shape = '';      // levels and texts the buttons were made for
        let revealFrame = 0;

        function render(list) {
            items = list;
            const next = JSON.stringify(list.map((h) => [h.level, h.text]));
            if (next === shape) return;
            shape = next;
            const top = Math.min(...list.map((h) => h.level));
            buttons = list.map((h, i) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'outline-item';
                button.dataset.index = i;
                // Three steps of indent at most: deeper headings line up with the third
                button.style.setProperty('--level', String(Math.min(h.level - top, 3)));
                const text = document.createElement('span');
                text.className = 'outline-label';
                text.textContent = h.text || '（空标题）';
                button.title = h.text;
                button.appendChild(text);
                return button;
            });
            nav.replaceChildren(...buttons);
            nav.hidden = !list.length;
            empty.hidden = list.length > 0;
            const was = current;
            current = -1;
            mark(was);
        }

        // Mark heading index (-1: none) and keep it in sight in the list (on
        // the next frame: reading the layout now would hold up typing)
        function mark(index) {
            index = Math.min(index, buttons.length - 1);
            if (index === current) return;
            if (buttons[current]) buttons[current].removeAttribute('aria-current');
            current = index;
            const button = buttons[index];
            if (!button) return;
            button.setAttribute('aria-current', 'location');
            cancelAnimationFrame(revealFrame);
            revealFrame = requestAnimationFrame(() => {
                if (!button.isConnected || nav.hidden) return;
                const top = button.offsetTop;
                if (top < nav.scrollTop) nav.scrollTop = top - 6;
                else if (top + button.offsetHeight > nav.scrollTop + nav.clientHeight) nav.scrollTop = top + button.offsetHeight - nav.clientHeight + 6;
            });
        }

        // The heading whose section holds document position pos (-1: before the first)
        function indexAt(pos) {
            let lo = 0;
            let hi = items.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (items[mid].start <= pos) lo = mid + 1;
                else hi = mid;
            }
            return lo - 1;
        }

        nav.addEventListener('click', (e) => {
            const button = e.target.closest('.outline-item');
            if (!button) return;
            const index = Number(button.dataset.index);
            if (items[index]) onPick(items[index], index);
        });

        return {
            render,
            mark,
            indexAt,
            count: () => items.length
        };
    };

    MDE.outline = { headingsOf };
})(window.MDE = window.MDE || {});
