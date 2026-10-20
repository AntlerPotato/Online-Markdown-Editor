// Typography of the document: page width, Latin, Chinese and code fonts,
// and line spacing. Loaded in <head>, so the saved settings apply before
// the first paint. A web font is only downloaded once it is chosen: its
// stylesheet is added then (the defaults come with the page).
(function (MDE) {
    const { store } = MDE;
    const root = document.documentElement;

    const GOOGLE = 'https://fonts.googleapis.com/css2?display=swap&family=';
    // The Simplified Chinese web font package of LXGW WenKai
    const WENKAI = 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/';

    const WIDTH_MIN = 560;
    const WIDTH_MAX = 1200;
    const WIDTH_STEP = 20;
    // The live page is 760px wide by default; the preview's box has 40px
    // less padding, so their text is as wide
    const PREVIEW_PADDING_LESS = 40;

    const WIDTHS = [
        { value: 640, label: '窄' },
        { value: 760, label: '适中' },
        { value: 960, label: '宽' },
        { value: 'full', label: '铺满' }
    ];

    // family: the names in font-family (generic: the family to fall back
    // on, for the font's own button); css: the stylesheets that declare it
    const FONTS = {
        en: [
            { key: 'outfit', name: 'Outfit', family: "'Outfit'", generic: 'sans-serif' },
            { key: 'inter', name: 'Inter', family: "'Inter'", generic: 'sans-serif', css: [GOOGLE + 'Inter:wght@400;500;600;700'] },
            { key: 'roboto', name: 'Roboto', family: "'Roboto'", generic: 'sans-serif', css: [GOOGLE + 'Roboto:ital,wght@0,400;0,500;0,700;1,400'] },
            { key: 'lora', name: 'Lora', family: "'Lora'", generic: 'serif', css: [GOOGLE + 'Lora:ital,wght@0,400;0,600;1,400'] },
            { key: 'merri', name: 'Merriweather', family: "'Merriweather'", generic: 'serif', css: [GOOGLE + 'Merriweather:ital,wght@0,400;0,700;1,400'] }
        ],
        zh: [
            { key: 'sys', name: '系统字体', note: '不下载', family: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC'", generic: 'sans-serif' },
            { key: 'noto', name: '思源黑体', family: "'Noto Sans SC'", generic: 'sans-serif' },
            { key: 'serif', name: '思源宋体', family: "'Noto Serif SC', 'Songti SC', 'SimSun'", generic: 'serif', css: [GOOGLE + 'Noto+Serif+SC:wght@400;600'] },
            { key: 'kai', name: '霞鹜文楷', family: "'LXGW WenKai', 'Kaiti SC', 'KaiTi'", generic: 'serif', css: [WENKAI + 'lxgwwenkai-regular.css', WENKAI + 'lxgwwenkai-bold.css'] },
            { key: 'xw', name: '站酷小薇', family: "'ZCOOL XiaoWei'", generic: 'serif', css: [GOOGLE + 'ZCOOL+XiaoWei'] }
        ],
        mono: [
            { key: 'jb', name: 'JetBrains Mono', family: "'JetBrains Mono'", generic: 'monospace' },
            { key: 'fira', name: 'Fira Code', family: "'Fira Code'", generic: 'monospace', css: [GOOGLE + 'Fira+Code:wght@400;500;600'] },
            { key: 'scp', name: 'Source Code Pro', family: "'Source Code Pro'", generic: 'monospace', css: [GOOGLE + 'Source+Code+Pro:ital,wght@0,400;0,500;0,600;1,400'] }
        ]
    };

    const LINE_HEIGHTS = [
        { value: 1.6, label: '紧凑' },
        { value: 1.85, label: '标准' },
        { value: 2.1, label: '宽松' }
    ];

    const DEFAULTS = { width: 760, en: 'outfit', zh: 'noto', mono: 'jb', lh: 1.85 };

    // After the chosen font: the system's Chinese fonts, then the generic family
    const DOC_TAIL = "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif";
    const MONO_TAIL = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', monospace";

    const fontOf = (kind, key) => FONTS[kind].find((font) => font.key === key);
    const loading = new Map();  // stylesheet url → promise, once added

    function valid(saved) {
        const s = { ...DEFAULTS };
        if (!saved || typeof saved !== 'object') return s;
        const width = Number(saved.width);
        if (saved.width === 'full') s.width = 'full';
        else if (width >= WIDTH_MIN && width <= WIDTH_MAX) s.width = Math.round(width / WIDTH_STEP) * WIDTH_STEP;
        ['en', 'zh', 'mono'].forEach((kind) => {
            if (fontOf(kind, saved[kind])) s[kind] = saved[kind];
        });
        if (LINE_HEIGHTS.some((item) => item.value === saved.lh)) s.lh = saved.lh;
        return s;
    }

    let current = valid(store.get('typography', null));

    // The stylesheets of a font, added once; resolves when the font itself
    // has arrived (or failed: the next font in the list is used then)
    function load(kind, key) {
        const font = fontOf(kind, key);
        if (!font || !font.css) return Promise.resolve();
        const sheets = font.css.map((url) => {
            if (!loading.has(url)) {
                loading.set(url, new Promise((resolve) => {
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = url;
                    link.onload = resolve;
                    link.onerror = resolve;
                    document.head.appendChild(link);
                }));
            }
            return loading.get(url);
        });
        const sample = kind === 'zh' ? '中文字体' : 'Aa';
        return Promise.all(sheets).then(() => (document.fonts ? document.fonts.load(`1em ${font.family.split(',')[0]}`, sample).catch(() => {}) : null));
    }

    const widthLabel = (width) => (width === 'full' ? '铺满' : `${width} px`);

    function apply() {
        const s = current;
        const style = root.style;
        style.setProperty('--font-doc', `${fontOf('en', s.en).family}, ${fontOf('zh', s.zh).family}, ${DOC_TAIL}`);
        style.setProperty('--font-code', `${fontOf('mono', s.mono).family}, ${MONO_TAIL}`);
        style.setProperty('--doc-width', s.width === 'full' ? 'none' : s.width + 'px');
        style.setProperty('--preview-width', s.width === 'full' ? 'none' : (s.width - PREVIEW_PADDING_LESS) + 'px');
        style.setProperty('--doc-line-height', String(s.lh));
        ['en', 'zh', 'mono'].forEach((kind) => load(kind, s[kind]));
    }

    apply();

    MDE.typography = {
        WIDTH_MIN,
        WIDTH_MAX,
        WIDTH_STEP,
        PREVIEW_PADDING_LESS,
        WIDTHS,
        FONTS,
        LINE_HEIGHTS,
        DEFAULTS,
        widthLabel,
        get: () => ({ ...current }),
        // Change some settings; persist: false while dragging
        set(changes, persist = true) {
            current = valid({ ...current, ...changes });
            apply();
            if (persist) store.set('typography', current);
            return { ...current };
        },
        reset() {
            current = { ...DEFAULTS };
            apply();
            store.set('typography', current);
            return { ...current };
        },
        load
    };
})(window.MDE = window.MDE || {});
