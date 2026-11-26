window.booknestApiUrl = function (path) {
    const base = String(window.BOOKNEST_API_BASE_URL || '').replace(/\/+$/, '');
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};

function isLocalDemoEnvironment() {
    if (typeof window === 'undefined' || !window.location) return false;
    const protocol = String(window.location.protocol || '').toLowerCase();
    return protocol === 'file:';
}

const AUTH_TOKEN_KEY = 'booknest-auth-token';
const ADMIN_AUTH_TOKEN_KEY = 'booknest-admin-token';
const AUTH_TOKEN_EXPIRY_KEY = 'booknest-auth-token-expires-at';
window.booknestAuth = {
    getToken() {
        let token = sessionStorage.getItem(AUTH_TOKEN_KEY);
        const expiresAt = Number(sessionStorage.getItem(AUTH_TOKEN_EXPIRY_KEY));
        if (token && Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() >= expiresAt) {
            this.clearToken();
            window.dispatchEvent(new Event('booknest:auth-expired'));
            return null;
        }

        if (!token) {
            token = localStorage.getItem(AUTH_TOKEN_KEY) || localStorage.getItem(ADMIN_AUTH_TOKEN_KEY);
            if (token) this.setToken(token);
        }
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(ADMIN_AUTH_TOKEN_KEY);
        return token || null;
    },
    setToken(token, expiresAt) {
        if (typeof token !== 'string' || !token) {
            throw new TypeError('An authentication token is required.');
        }
        sessionStorage.setItem(AUTH_TOKEN_KEY, token);
        if (Number.isFinite(expiresAt) && expiresAt > 0) {
            sessionStorage.setItem(AUTH_TOKEN_EXPIRY_KEY, String(expiresAt));
        } else {
            sessionStorage.removeItem(AUTH_TOKEN_EXPIRY_KEY);
        }
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(ADMIN_AUTH_TOKEN_KEY);
    },
    clearToken() {
        sessionStorage.removeItem(AUTH_TOKEN_KEY);
        sessionStorage.removeItem(AUTH_TOKEN_EXPIRY_KEY);
        sessionStorage.removeItem(ADMIN_AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(ADMIN_AUTH_TOKEN_KEY);
    }
};

const API_REQUEST_TIMEOUT_MS = 15000;
const SAFE_RETRY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const API_RETRY_DELAYS_MS = [500, 1000];
let csrfTokenPromise = null;

async function getCsrfToken() {
    if (!csrfTokenPromise) {
        csrfTokenPromise = fetch(window.booknestApiUrl('/api/auth/csrf-token'), {
            method: 'GET',
            credentials: 'include',
            headers: { Accept: 'application/json' }
        }).then(async (response) => {
            if (!response.ok) throw new Error('Không thể lấy mã bảo vệ CSRF.');
            const data = await response.json();
            if (typeof data.csrfToken !== 'string' || !data.csrfToken) {
                throw new Error('Máy chủ không trả về mã bảo vệ CSRF.');
            }
            return data.csrfToken;
        }).finally(() => {
            csrfTokenPromise = null;
        });
    }
    return csrfTokenPromise;
}

function showApiConnectionNotice(message) {
    if (typeof window.booknestToast === 'function') {
        window.booknestToast(message, 'error', {
            title: 'Kết nối máy chủ',
            duration: 0,
        });
        return;
    }
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
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    const sendsCookies = !SAFE_RETRY_METHODS.has(method);
    if (sendsCookies && !headers.has('X-CSRF-Token')) {
        headers.set('X-CSRF-Token', await getCsrfToken());
    }
    const maxAttempts = SAFE_RETRY_METHODS.has(method) && !isLocalDemoEnvironment()
        ? API_RETRY_DELAYS_MS.length + 1
        : 1;
    let response;
    let lastError;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const controller = new AbortController();
        let timedOut = false;
        const timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, API_REQUEST_TIMEOUT_MS);

        try {
            response = await fetch(window.booknestApiUrl(path), {
                ...options,
                headers,
                ...(sendsCookies ? { credentials: 'include' } : {}),
                signal: controller.signal
            });
        } catch (error) {
            lastError = error;
            if (attempt + 1 >= maxAttempts) {
                const message = timedOut
                    ? 'Máy chủ BookNest không phản hồi sau 15 giây. Hãy kiểm tra kết nối mạng và thử lại thao tác.'
                    : 'Không thể kết nối tới máy chủ BookNest. Hãy kiểm tra kết nối mạng hoặc thử lại sau.';
                if (!isLocalDemoEnvironment()) {
                    showApiConnectionNotice(message);
                }
                throw new Error(message, { cause: error });
            }
        } finally {
            clearTimeout(timeoutId);
        }

        if (response && response.status < 500) break;
        if (attempt + 1 < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, API_RETRY_DELAYS_MS[attempt]));
        }
    }

    if (!response) throw lastError;

    if (response.status >= 500 && !isLocalDemoEnvironment()) {
        showApiConnectionNotice(
            `Máy chủ BookNest đang tạm thời không khả dụng (HTTP ${response.status}). Hãy thử lại sau ít phút.`
        );
    }

    if (response.status === 401) {
        const authorization = new Headers(options.headers || {}).get('Authorization');
        if (authorization) {
            const token = window.booknestAuth.getToken();
            if (token && authorization === `Bearer ${token}`) {
                window.booknestAuth.clearToken();
                window.dispatchEvent(new Event('booknest:auth-expired'));
            }
        }
    }

    return response;
};
