window.booknestApiUrl = function (path) {
    const base = String(window.BOOKNEST_API_BASE_URL || '').replace(/\/+$/, '');
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};

const API_REQUEST_TIMEOUT_MS = 15000;

function showApiConnectionNotice(message) {
    if (!document.body) return;

    let notice = document.getElementById('apiConnectionNotice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'apiConnectionNotice';
        notice.className = 'api-connection-notice';
        notice.setAttribute('role', 'alert');
        notice.setAttribute('aria-live', 'assertive');

        const text = document.createElement('span');
        text.className = 'api-connection-notice-message';

        const dismissButton = document.createElement('button');
        dismissButton.type = 'button';
        dismissButton.className = 'api-connection-notice-dismiss';
        dismissButton.setAttribute('aria-label', 'Đóng thông báo');
        dismissButton.textContent = '×';
        dismissButton.addEventListener('click', () => notice.remove());

        notice.append(text, dismissButton);
        document.body.appendChild(notice);
    }

    notice.querySelector('.api-connection-notice-message').textContent = message;
}

window.booknestApiFetch = async function (path, options = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, API_REQUEST_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(window.booknestApiUrl(path), {
            ...options,
            signal: controller.signal
        });
    } catch (error) {
        const message = timedOut
            ? 'Máy chủ BookNest không phản hồi sau 15 giây. Hãy kiểm tra kết nối mạng và thử lại thao tác.'
            : 'Không thể kết nối tới máy chủ BookNest. Hãy kiểm tra kết nối mạng hoặc thử lại sau.';
        showApiConnectionNotice(message);
        throw new Error(message, { cause: error });
    } finally {
        clearTimeout(timeoutId);
    }

    if (response.status >= 500) {
        showApiConnectionNotice(
            `Máy chủ BookNest đang tạm thời không khả dụng (HTTP ${response.status}). Hãy thử lại sau ít phút.`
        );
    }

    return response;
};
