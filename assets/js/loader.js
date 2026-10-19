// Loads highlight.js and KaTeX the first time a document needs them, so a
// document without code or formulas never downloads either. Listeners are
// told when one arrives, to render again with it.
(function (MDE) {
    const LIBS = {
        hljs: {
            styles: [],
            scripts: ['https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js'],
            ready: () => !!window.hljs
        },
        katex: {
            styles: ['https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css'],
            scripts: ['https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js'],
            ready: () => !!window.katex
        }
    };
    const RETRY_AFTER = 30000; // ms before a failed library may be requested again

    const loading = Object.create(null);
    const listeners = [];

    function addTag(tag, attributes) {
        return new Promise((resolve, reject) => {
            const el = document.createElement(tag);
            Object.assign(el, attributes);
            el.onload = () => resolve();
            el.onerror = () => {
                el.remove();
                reject(new Error(`Could not load ${attributes.src || attributes.href}`));
            };
            document.head.appendChild(el);
        });
    }

    function load(name) {
        const lib = LIBS[name];
        if (lib.ready()) return Promise.resolve();
        if (!loading[name]) {
            loading[name] = Promise.all([
                ...lib.styles.map((href) => addTag('link', { rel: 'stylesheet', href })),
                ...lib.scripts.map((src) => addTag('script', { src, async: true }))
            ]).then(() => {
                listeners.forEach((fn) => fn(name));
            }, (err) => {
                // Offline or blocked: keep showing plain code / TeX, try again later
                console.warn(err.message);
                setTimeout(() => { delete loading[name]; }, RETRY_AFTER);
                throw err;
            });
        }
        return loading[name];
    }

    MDE.loader = {
        load,
        // Fire and forget: renderers ask for a library and carry on without it
        request(name) {
            load(name).catch(() => { /* already reported */ });
        },
        onLoad(fn) {
            listeners.push(fn);
        }
    };
})(window.MDE = window.MDE || {});
