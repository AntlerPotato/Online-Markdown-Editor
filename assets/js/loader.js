// Loads highlight.js and KaTeX the first time a document needs them, so a
// document without code or formulas never downloads either. Listeners are
// told when one arrives, to render again with it.
(function (MDE) {
    // Each file with its hash (integrity): the browser refuses any other
    // content. ready() looks for the library's function, not just the name:
    // an element with id="katex" in the document is window.katex too.
    const LIBS = {
        hljs: {
            styles: [],
            scripts: [['https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js', 'sha384-F/bZzf7p3Joyp5psL90p/p89AZJsndkSoGwRpXcZhleCWhd8SnRuoYo4d0yirjJp']],
            ready: () => !!window.hljs && typeof window.hljs.highlight === 'function'
        },
        katex: {
            styles: [['https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css', 'sha384-n8MVd4RsNIU0tAv4ct0nTaAbDJwPJzDEaqSD1odI+WdtXRGWt2kTvGFasHpSy3SV']],
            scripts: [['https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js', 'sha384-XjKyOOlGwcjNTAIQHIpgOno0Hl1YQqzUOEleOLALmuqehneUG+vnGctmUb0ZY0l8']],
            ready: () => !!window.katex && typeof window.katex.renderToString === 'function'
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
                ...lib.styles.map(([href, integrity]) => addTag('link', { rel: 'stylesheet', href, integrity, crossOrigin: 'anonymous' })),
                ...lib.scripts.map(([src, integrity]) => addTag('script', { src, integrity, crossOrigin: 'anonymous', async: true }))
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
        ready: (name) => LIBS[name].ready(),
        // Fire and forget: renderers ask for a library and carry on without it
        request(name) {
            load(name).catch(() => { /* already reported */ });
        },
        onLoad(fn) {
            listeners.push(fn);
        }
    };
})(window.MDE = window.MDE || {});
