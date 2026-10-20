// Command palette (Ctrl+Shift+P, or the search button in the top bar):
// every command of the editor in one list, found by its Chinese or
// English name or by pinyin. ↑ ↓ choose, Enter runs, Esc closes. The
// commands come from app.js; the palette is a popover, so it closes as
// the others do.
(function (MDE) {
    const { popover } = MDE;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const normalize = (text) => text.toLowerCase().replace(/\s+/g, '');

    // commands: [{ id, label, group, words, icon (an element to copy, or
    // text), keys ([…] shown as keys), when() (shown at all), disabled(),
    // checked() (a switch or a choice: true / false; undefined: neither),
    // radio (a choice: a tick instead of a switch) }]. place(panel): where
    // it opens. onRun(command) runs the chosen one (the palette has closed).
    MDE.createPalette = function ({ panel, input, list, button, commands, place, onRun, returnFocus }) {
        let shown = [];     // { command, el }
        let index = 0;
        let pointer = '';

        const terms = new Map(commands.map((c) => [c, [c.label].concat((c.words || '').split(' ')).map(normalize).filter(Boolean)]));

        function option(command) {
            const el = document.createElement('div');
            el.className = 'menu-item palette-item';
            el.id = 'cmd-' + command.id;
            el.setAttribute('role', 'option');
            el.setAttribute('aria-selected', 'false');
            const icon = document.createElement('span');
            icon.className = 'palette-icon';
            icon.setAttribute('aria-hidden', 'true');
            if (command.icon instanceof Element) icon.appendChild(command.icon.cloneNode(true));
            else icon.textContent = command.icon || '';
            const label = document.createElement('span');
            label.textContent = command.label;
            el.append(icon, label);
            const checked = command.checked ? command.checked() : undefined;
            if (checked !== undefined) {
                el.setAttribute('aria-checked', String(checked));
                el.insertAdjacentHTML('beforeend', command.radio
                    ? '<svg class="menu-tick" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>'
                    : '<span class="switch" aria-hidden="true"></span>');
            }
            if (command.keys) {
                const keys = document.createElement('span');
                keys.className = 'menu-keys';
                keys.setAttribute('aria-hidden', 'true');
                command.keys.forEach((key) => {
                    const kbd = document.createElement('kbd');
                    kbd.className = 'kbd';
                    kbd.textContent = key;
                    keys.appendChild(kbd);
                });
                el.appendChild(keys);
            }
            if (command.disabled && command.disabled()) el.setAttribute('aria-disabled', 'true');
            shown.push({ command, el });
            return el;
        }

        // With no query, every command of the view, by group; otherwise
        // the ones that match, best first (the name starts with the query,
        // else another word does, else one holds it, else the group's name
        // does)
        function fill(query) {
            const q = normalize(query);
            const available = commands.filter((c) => !c.when || c.when());
            shown = [];
            const items = [];
            if (!q) {
                const groups = [];
                available.forEach((c) => {
                    let group = groups.find((g) => g.name === c.group);
                    if (!group) groups.push(group = { name: c.group, commands: [] });
                    group.commands.push(c);
                });
                groups.forEach((g, k) => {
                    const box = document.createElement('div');
                    box.className = 'slash-group';
                    box.setAttribute('role', 'group');
                    const title = document.createElement('div');
                    title.className = 'slash-group-label';
                    title.id = `cmd-group-${k}`;
                    title.textContent = g.name;
                    box.setAttribute('aria-labelledby', title.id);
                    box.appendChild(title);
                    g.commands.forEach((c) => box.appendChild(option(c)));
                    items.push(box);
                });
            } else {
                const scored = [];
                available.forEach((c, order) => {
                    const words = terms.get(c);
                    const score = words[0].startsWith(q) ? 0
                        : words.some((word) => word.startsWith(q)) ? 1
                        : words.some((word) => word.includes(q)) ? 2
                        : normalize(c.group).startsWith(q) ? 3
                        : 4;
                    if (score < 4) scored.push({ c, score, order });
                });
                scored.sort((a, b) => a.score - b.score || a.order - b.order);
                scored.forEach(({ c }) => items.push(option(c)));
            }
            list.replaceChildren(...items);
            if (!shown.length) {
                const none = document.createElement('div');
                none.className = 'palette-empty';
                none.textContent = '没有这个命令';
                list.appendChild(none);
            }
            list.scrollTop = 0;
            select(0);
        }

        function select(i) {
            if (!shown.length) {
                input.removeAttribute('aria-activedescendant');
                return;
            }
            index = (i + shown.length) % shown.length;
            const current = shown[index].el;
            shown.forEach(({ el }) => el.setAttribute('aria-selected', String(el === current)));
            input.setAttribute('aria-activedescendant', current.id);
            // Keep it in view; the first option brings its group's name along
            const top = index === 0 ? 0 : current.offsetTop - 4;
            const bottom = current.offsetTop + current.offsetHeight + 4;
            if (top < list.scrollTop) list.scrollTop = top;
            else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
        }

        function run(item) {
            if (!item || item.el.getAttribute('aria-disabled') === 'true') return;
            popover.close(false);
            onRun(item.command);
        }

        function open() {
            input.value = '';
            popover.open(panel, button, {
                place,
                returnFocus,
                onOpen: () => {
                    fill('');
                    input.focus();
                }
            });
        }

        const isOpen = () => {
            const current = popover.current();
            return !!current && current.panel === panel;
        };

        input.addEventListener('input', () => fill(input.value));

        input.addEventListener('keydown', (e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === 'ArrowDown') select(index + 1);
            else if (e.key === 'ArrowUp') select(index - 1);
            else if (e.key === 'PageDown') select(Math.min(index + 8, shown.length - 1));
            else if (e.key === 'PageUp') select(Math.max(index - 8, 0));
            else if (e.key === 'Enter') run(shown[index]);
            else if (e.key === 'Tab') popover.close(true);
            else return;
            e.preventDefault();
        });

        // The pointer chooses, but only when it really moves (not when the
        // list scrolls under it)
        list.addEventListener('pointermove', (e) => {
            const at = `${e.screenX},${e.screenY}`;
            if (at === pointer) return;
            pointer = at;
            const i = shown.findIndex(({ el }) => el === e.target.closest('[role="option"]'));
            if (i !== -1 && i !== index) select(i);
        });

        list.addEventListener('click', (e) => {
            const el = e.target.closest('[role="option"]');
            run(shown.find((item) => item.el === el));
        });

        // Keep the focus in the search field
        panel.addEventListener('mousedown', (e) => {
            if (e.target !== input) e.preventDefault();
        });

        return {
            open,
            isOpen,
            // Fit the list to the room there is
            fit(maxHeight) {
                list.style.maxHeight = clamp(maxHeight, 160, 420) + 'px';
            }
        };
    };
})(window.MDE = window.MDE || {});
