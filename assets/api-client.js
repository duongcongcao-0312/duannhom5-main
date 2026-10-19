window.booknestApiUrl = function (path) {
    const base = String(window.BOOKNEST_API_BASE_URL || '').replace(/\/+$/, '');
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};
