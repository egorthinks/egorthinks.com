// Same rule as egorthinks.com/theme-toggle.js: a stored choice wins, then the system.
// Loaded as a blocking external script in <head>, so the right palette paints first
// and the CSP still needs no 'unsafe-inline'.
(function () {
    var root = document.documentElement;
    var stored = null;
    try {
        stored = localStorage.getItem('theme');
    } catch (e) {}
    var dark = stored ? stored === 'dark' : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', dark);

    document.addEventListener('DOMContentLoaded', function () {
        var button = document.getElementById('theme-toggle');
        if (!button) return;
        button.addEventListener('click', function () {
            var isDark = root.classList.toggle('dark');
            try {
                localStorage.setItem('theme', isDark ? 'dark' : 'light');
            } catch (e) {}
        });
    });
})();
