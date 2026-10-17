// Persistent settings and autosave, backed by localStorage.
// Storage can be unavailable (private mode, blocked site data), so every
// access is guarded and callers always get a usable fallback.
(function (MDE) {
    const PREFIX = 'mde:';

    MDE.store = {
        get(key, fallback) {
            try {
                const raw = localStorage.getItem(PREFIX + key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch (e) {
                return fallback;
            }
        },

        set(key, value) {
            try {
                localStorage.setItem(PREFIX + key, JSON.stringify(value));
                return true;
            } catch (e) {
                return false;
            }
        }
    };
})(window.MDE = window.MDE || {});
