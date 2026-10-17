// Dropdown menus and anchored popovers. Only one is open at a time; it is
// positioned under its anchor, closes on outside click or Escape, and
// menus get arrow-key navigation.
(function (MDE) {
    let current = null;

    // Items inside a hidden group (e.g. in the "more" menu) are skipped
    const menuItems = (panel) => Array.from(panel.querySelectorAll('[role^="menuitem"]')).filter((el) => !el.closest('[hidden]'));
    const isMenu = (panel) => panel.getAttribute('role') === 'menu';

    function place(panel, anchor) {
        const rect = anchor.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight;
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;

        let left = Math.min(rect.left, viewportWidth - width - 8);
        let top = rect.bottom + 8;
        if (top + height > viewportHeight - 8 && rect.top - height - 8 >= 8) {
            top = rect.top - height - 8;
        }
        panel.style.left = Math.max(8, left) + 'px';
        panel.style.top = Math.max(8, top) + 'px';
    }

    function open(panel, anchor, options = {}) {
        if (current && current.panel === panel) return;
        close(false);

        current = { panel, anchor, options };
        panel.hidden = false;
        place(panel, anchor);
        anchor.setAttribute('aria-expanded', 'true');
        if (options.onOpen) options.onOpen(panel);

        if (isMenu(panel) && options.focus !== false) {
            const items = menuItems(panel);
            const checked = options.focusChecked && items.find((el) => el.getAttribute('aria-checked') === 'true');
            const target = options.focus === 'last' ? items[items.length - 1] : (checked || items[0]);
            if (target) target.focus();
        }
    }

    function close(restoreFocus = true) {
        if (!current) return;
        const { panel, anchor, options } = current;
        current = null;
        panel.hidden = true;
        anchor.setAttribute('aria-expanded', 'false');
        if (options.onClose) options.onClose();
        if (restoreFocus) anchor.focus();
    }

    function toggle(panel, anchor, options) {
        if (current && current.panel === panel) close();
        else open(panel, anchor, options);
    }

    // Outside click closes (capture, so it runs before other handlers)
    document.addEventListener('pointerdown', (e) => {
        if (!current) return;
        if (current.panel.contains(e.target) || current.anchor.contains(e.target)) return;
        close(false);
    }, true);

    document.addEventListener('keydown', (e) => {
        if (!current) return;
        const { panel, anchor } = current;
        const inPanel = panel.contains(e.target);
        if (!inPanel && e.target !== anchor) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close(true);
            return;
        }
        if (!isMenu(panel) || !inPanel) return;

        const items = menuItems(panel);
        const index = items.indexOf(document.activeElement);
        let next = null;
        switch (e.key) {
            case 'ArrowDown': next = items[(index + 1) % items.length]; break;
            case 'ArrowUp': next = items[(index - 1 + items.length) % items.length]; break;
            case 'Home': next = items[0]; break;
            case 'End': next = items[items.length - 1]; break;
            case 'Tab': close(false); return;
            default: return;
        }
        e.preventDefault();
        if (next) next.focus();
    });

    window.addEventListener('resize', () => {
        if (current) place(current.panel, current.anchor);
    });

    window.addEventListener('scroll', (e) => {
        if (current && !current.panel.contains(e.target)) place(current.panel, current.anchor);
    }, true);

    MDE.popover = {
        open,
        close,
        toggle,
        current: () => current
    };
})(window.MDE = window.MDE || {});
