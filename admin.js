// BookNest Admin Panel Client Script
(function () {
    const AUTH_HEADER_KEY = 'Authorization';

    let currentAdmin = null;
    let allOrders = [];
    let allBooks = [];
    let allCoupons = [];
    let allServices = [];
    let allUsers = [];
    let allStaff = [];
    let staffRolePermissions = {};

    // Helper: Toast Notifications
    function showToast(message, type = 'success') {
        window.booknestToast?.(message, type);
    }

    function setTableState(tbody, colspan, state, message, action) {
        tbody.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
        tbody.dataset.state = state;
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = colspan;
        cell.className = `text-center admin-table-state admin-table-state--${state}`;
        cell.setAttribute('role', state === 'error' ? 'alert' : 'status');
        cell.setAttribute('aria-live', state === 'error' ? 'assertive' : 'polite');
        cell.dataset.state = state;
        cell.textContent = message;
        if (action) {
            const button = document.createElement('button');
            button.className = 'btn-link admin-table-state-action';
            button.type = 'button';
            button.textContent = action.label;
            button.addEventListener('click', action.run);
            cell.append(' ');
            cell.appendChild(button);
        }
        row.appendChild(cell);
        tbody.replaceChildren(row);
    }

    function markTableLoaded(tbody) {
        tbody.setAttribute('aria-busy', 'false');
        delete tbody.dataset.state;
    }

    function adminLoadError(resource, error) {
        const status = Number(error?.status);
        if (error?.name === 'AbortError' || status === 408 || status === 504) {
            return `Tải ${resource} quá thời gian. Vui lòng thử lại.`;
        }
        if (status === 401 || status === 403) {
            return `Phiên đăng nhập hết hạn hoặc bạn không có quyền xem ${resource}.`;
        }
        if (status >= 500) {
            return `Máy chủ chưa thể tải ${resource}. Vui lòng thử lại.`;
        }
        if (!status || error instanceof TypeError) {
            return `Không thể kết nối để tải ${resource}. Kiểm tra mạng và thử lại.`;
        }
        return `Không thể tải ${resource}. Vui lòng thử lại.`;
    }

    function responseError(response) {
        const error = new Error('Admin request failed');
        error.status = response.status;
        return error;
    }

    async function runWithBusyControl(control, busyLabel, action) {
        if (control?.dataset.busy === 'true') return undefined;
        if (!control) return action();

        control.dataset.busy = 'true';
        control.setAttribute('aria-busy', 'true');
        const controls = control instanceof HTMLFormElement
            ? Array.from(control.querySelectorAll('button[type="submit"], input[type="submit"]'))
            : [control];
        const previous = controls.map((element) => ({
            element,
            disabled: element.disabled,
            text: element instanceof HTMLSelectElement ? null : element.textContent
        }));
        controls.forEach((element, index) => {
            element.disabled = true;
            if (index === 0 && busyLabel && !(element instanceof HTMLSelectElement)) {
                element.textContent = busyLabel;
            }
        });

        try {
            return await action();
        } finally {
            previous.forEach(({ element, disabled, text }) => {
                element.disabled = disabled;
                if (text !== null) element.textContent = text;
            });
            control.dataset.busy = 'false';
            control.setAttribute('aria-busy', 'false');
        }
    }

    // Helper: Format Currency VND
    function formatCurrency(amount) {
        return new Intl.NumberFormat('vi-VN').format(amount || 0) + ' đ';
    }

    // Helper: Escape HTML
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;'
        })[character]);
    }

    // Helper: Category Labels
    const categoryLabels = {
        'van-hoc': 'Văn học',
        'ky-nang': 'Kỹ năng sống',
        'kinh-te': 'Kinh tế & Đầu tư',
        'khoa-hoc': 'Khoa học & Vũ trụ',
        'lich-su': 'Lịch sử & Văn hóa',
        'thieu-nhi': 'Thiếu nhi',
        'trinh-tham': 'Trinh thám',
        'tam-ly': 'Tâm lý học',
        'cong-nghe': 'Công nghệ & AI',
        'ngoai-ngu': 'Ngoại ngữ'
    };

    const serviceLabels = {
        'rent': 'Thuê sách',
        'buyback': 'Thu mua sách',
        'exchange': 'Trao đổi sách'
    };

    // Helper: Authenticated fetch
    async function apiFetch(url, options = {}) {
        const token = window.booknestAuth.getToken();
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        if (token) {
            headers[AUTH_HEADER_KEY] = `Bearer ${token}`;
        }
        const response = await window.booknestApiFetch(url, { ...options, headers });
        if (response.status === 401 || response.status === 403) {
            if (url.startsWith('/api/admin/')) {
                showLoginOverlay();
            }
        }
        return response;
    }

    // Auth & Login
    const loginOverlay = document.getElementById('loginOverlay');
    const adminLoginForm = document.getElementById('adminLoginForm');
    const adminLoginError = document.getElementById('adminLoginError');

    function showLoginOverlay() {
        loginOverlay.classList.remove('hidden');
    }

    function hideLoginOverlay() {
        loginOverlay.classList.add('hidden');
    }

    async function checkAuth() {
        try {
            const res = await apiFetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json();
                const user = data.user;
                if (user && user.role === 'admin') {
                    currentAdmin = user;
                    document.getElementById('adminUserName').textContent = currentAdmin.name || 'Quản trị viên';
                    hideLoginOverlay();
                    loadCurrentView();
                    return;
                }
            }
        } catch (e) {
            console.error('Lỗi kiểm tra phiên đăng nhập:', e);
        }
        if (currentAdmin) return;
        showLoginOverlay();
    }

    adminLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await runWithBusyControl(adminLoginForm, 'Đang đăng nhập...', async () => {
            adminLoginError.hidden = true;
            const formData = new FormData(adminLoginForm);
            const email = formData.get('email');
            const password = formData.get('password');

            try {
                const res = await window.booknestApiFetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await res.json();
                if (!res.ok) {
                    adminLoginError.textContent = data.error || 'Đăng nhập không thành công.';
                    adminLoginError.hidden = false;
                    return;
                }

                const user = data.user;
                const isAdmin = user && user.role === 'admin';
                if (!isAdmin) {
                    adminLoginError.textContent = 'Tài khoản này không có quyền quản trị viên.';
                    adminLoginError.hidden = false;
                    return;
                }

                window.booknestAuth.setToken(data.token, data.expiresAt);
                currentAdmin = user;
                document.getElementById('adminUserName').textContent = currentAdmin.name || 'Quản trị viên';
                hideLoginOverlay();
                showToast('Đăng nhập quản trị thành công!');
                loadCurrentView();
            } catch (err) {
                adminLoginError.textContent = 'Không thể kết nối đến máy chủ.';
                adminLoginError.hidden = false;
            }
        });
    });



    async function performAdminLogout(endpoint, message, button) {
        await runWithBusyControl(button, 'Đang đăng xuất...', async () => {
            let serverRevoked = false;
            let failure;
            try {
                const response = await apiFetch(endpoint, { method: 'POST' });
                if (!response.ok) throw responseError(response);
                serverRevoked = true;
            } catch (error) {
                failure = error;
                console.error('Không thể thu hồi phiên đăng nhập trên máy chủ:', error);
            }
            window.booknestAuth.clearToken();
            currentAdmin = null;
            showLoginOverlay();
            showToast(serverRevoked
                ? message
                : `Đã đăng xuất trên thiết bị này nhưng chưa thể xác nhận thu hồi phiên máy chủ. ${adminLoadError('phiên đăng nhập', failure)}`,
            serverRevoked ? 'success' : 'warning');
        });
    }

    document.getElementById('adminLogoutBtn').addEventListener('click', (event) =>
        performAdminLogout('/api/auth/logout', 'Đã đăng xuất.', event.currentTarget));
    document.getElementById('adminLogoutAllBtn')?.addEventListener('click', (event) =>
        performAdminLogout('/api/auth/logout-all', 'Đã đăng xuất khỏi tất cả thiết bị.', event.currentTarget));

    // Navigation & Views
    let activeView = 'dashboard';
    const navTabs = document.querySelectorAll('.nav-tab');
    const views = {
        dashboard: document.getElementById('viewDashboard'),
        orders: document.getElementById('viewOrders'),
        books: document.getElementById('viewBooks'),
        categories: document.getElementById('viewCategories'),
        authors: document.getElementById('viewAuthors'),
        publishers: document.getElementById('viewPublishers'),
        coupons: document.getElementById('viewCoupons'),
        services: document.getElementById('viewServices'),
        users: document.getElementById('viewUsers')
    };

    navTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const targetView = tab.dataset.view;
            if (targetView && views[targetView]) {
                activeView = targetView;
                navTabs.forEach((t) => {
                    const selected = t === tab;
                    t.classList.toggle('active', selected);
                    if (selected) t.setAttribute('aria-current', 'page');
                    else t.removeAttribute('aria-current');
                });
                Object.entries(views).forEach(([key, viewEl]) => {
                    viewEl.classList.toggle('active', key === targetView);
                });
                loadCurrentView();
            }
        });
    });

    document.getElementById('gotoOrdersBtn')?.addEventListener('click', () => {
        const ordersTab = document.querySelector('.nav-tab[data-view="orders"]');
        if (ordersTab) ordersTab.click();
    });

    document.getElementById('refreshStatsBtn')?.addEventListener('click', () => {
        const button = document.getElementById('refreshStatsBtn');
        return runWithBusyControl(button, 'Đang làm mới...', async () => {
            if (await loadDashboard()) showToast('Đã làm mới dữ liệu!');
        });
    });

    document.getElementById('refreshMonitoringBtn')?.addEventListener('click', (event) =>
        runWithBusyControl(event.currentTarget, 'Đang tải...', () => loadMonitoringSummary()));

    function loadCurrentView() {
        if (activeView === 'dashboard') loadDashboard();
        else if (activeView === 'orders') loadOrders();
        else if (activeView === 'books') loadBooks();
        else if (activeView === 'categories') loadCategories();
        else if (activeView === 'authors') loadAuthors();
        else if (activeView === 'publishers') loadPublishers();
        else if (activeView === 'coupons') loadCoupons();
        else if (activeView === 'services') loadServices();
        else if (activeView === 'users') loadUsers();
    }

    // --- VIEW: DASHBOARD ---
    async function loadDashboard() {
        const recentOrdersBody = document.getElementById('recentOrdersBody');
        setTableState(recentOrdersBody, 6, 'loading', 'Đang tải dữ liệu...');
        const monitoringLoad = loadMonitoringSummary();
        try {
            const res = await apiFetch('/api/admin/stats');
            if (!res.ok) throw responseError(res);
            const stats = await res.json();
            document.getElementById('statRevenue').textContent = formatCurrency(stats.totalRevenue);
            document.getElementById('statOrders').textContent = stats.totalOrders;
            document.getElementById('statActiveOrders').textContent = `${stats.activeOrders || 0} đơn đang hoạt động`;
            document.getElementById('statBooks').textContent = stats.totalBooks;
            document.getElementById('statUsers').textContent = stats.totalUsers;
            document.getElementById('statServices').textContent = `${stats.totalServices || 0} yêu cầu dịch vụ`;
            renderRecentOrders(stats.recentOrders || []);
            await monitoringLoad;
            return true;
        } catch (error) {
            setTableState(recentOrdersBody, 6, 'error', adminLoadError('thống kê', error), {
                label: 'Thử lại',
                run: () => loadDashboard()
            });
            showToast(adminLoadError('thống kê', error), 'error');
            await monitoringLoad;
            return false;
        }
    }

    async function loadMonitoringSummary() {
        const setStatus = (id, value, status) => {
            const element = document.getElementById(id);
            if (!element) return;
            element.textContent = value;
            element.dataset.status = status;
        };
        try {
            const response = await apiFetch('/api/admin/monitoring');
            if (!response.ok) throw new Error('Không tải được chỉ số vận hành.');
            const monitoring = await response.json();
            const requests = monitoring.requests;
            const database = monitoring.database;
            const payments = requests.payments;
            const backup = monitoring.backup;
            const databaseHealthy = database.status === 'healthy';
            const paymentsHealthy = payments.webhookFailuresLast5m === 0 &&
                payments.webhookConflictsLast5m === 0 &&
                payments.orderConflictsLast5m === 0;
            const backupStatus = backup.status === 'succeeded'
                ? 'Sao lưu thành công'
                : backup.status === 'failed'
                    ? 'Sao lưu lỗi'
                    : 'Chưa có báo cáo';
            const backupTimestamp = backup.lastAttemptAt
                ? new Date(backup.lastAttemptAt).toLocaleString('vi-VN')
                : 'Chưa ghi nhận lần chạy';
            const connectionCounts = database.connections
                ? `${database.connections.total} kết nối (${database.connections.idle} rảnh, ${database.connections.waiting} chờ)`
                : `Kho ${database.storage === 'file' ? 'file' : 'dữ liệu'}`;

            setStatus('monitoringApiStatus', `${requests.serverErrorsLast5m} lỗi 5xx`, requests.serverErrorsLast5m ? 'unavailable' : 'healthy');
            document.getElementById('monitoringApiMetrics').textContent =
                `${requests.requestsLast5m} yêu cầu API / 5 phút · lỗi ${requests.errorRatePct}% · p95 ${requests.p95LatencyMs} ms`;
            setStatus('monitoringDatabaseStatus', databaseHealthy ? 'Hoạt động' : 'Không khả dụng', databaseHealthy ? 'healthy' : 'unavailable');
            document.getElementById('monitoringDatabaseConnections').textContent = connectionCounts;
            setStatus('monitoringPaymentStatus', paymentsHealthy ? 'Ổn định' : 'Cần kiểm tra', paymentsHealthy ? 'healthy' : 'unavailable');
            document.getElementById('monitoringPaymentMetrics').textContent =
                `${payments.webhookRequestsLast5m} webhook / 5 phút · ${payments.webhookFailuresLast5m} lỗi · ${payments.webhookConflictsLast5m} xung đột · ${payments.duplicatesSinceStart} bản lặp`;
            setStatus('monitoringBackupStatus', backupStatus, backup.status);
            document.getElementById('monitoringBackupMetrics').textContent = backupTimestamp;
            document.getElementById('monitoringUpdatedAt').textContent =
                `Cập nhật ${new Date(monitoring.generatedAt).toLocaleTimeString('vi-VN')} · uptime ${monitoring.uptimeSeconds} giây`;
        } catch (error) {
            setStatus('monitoringApiStatus', 'Không tải được chỉ số', 'unavailable');
            document.getElementById('monitoringApiMetrics').textContent =
                'Kiểm tra quyền quản trị và kết nối máy chủ.';
            document.getElementById('monitoringUpdatedAt').textContent = 'Chỉ số vận hành hiện không khả dụng.';
        }
    }

    function renderRecentOrders(orders) {
        const tbody = document.getElementById('recentOrdersBody');
        if (!tbody) return;
        if (!orders.length) {
            setTableState(tbody, 6, 'empty', 'Chưa có đơn hàng nào được ghi nhận.');
            return;
        }

        markTableLoaded(tbody);
        tbody.innerHTML = orders.map((order) => {
            const date = new Date(order.createdAt).toLocaleDateString('vi-VN', {
                hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit'
            });
            return `
                <tr>
                    <td><code>${escapeHtml(order.orderId ? order.orderId.slice(0, 8) + '...' : '')}</code></td>
                    <td><b>${escapeHtml(order.customerName)}</b></td>
                    <td>${date}</td>
                    <td><strong>${formatCurrency(order.total)}</strong></td>
                    <td><span class="payment-badge ${order.paymentMethod === 'transfer' ? 'payment-paid' : 'payment-pending'}">${order.paymentMethod === 'transfer' ? 'Chuyển khoản' : 'COD'}</span></td>
                    <td><span class="status-badge status-${escapeHtml(order.status)}">${escapeHtml(order.status)}</span></td>
                </tr>
            `;
        }).join('');
    }

    // --- VIEW: ORDERS ---
    async function loadOrders() {
        const tbody = document.getElementById('ordersTableBody');
        setTableState(tbody, 9, 'loading', 'Đang tải đơn hàng...');
        try {
            const res = await apiFetch('/api/admin/orders');
            if (!res.ok) throw responseError(res);
            allOrders = await res.json();
            renderFilteredOrders();
        } catch (error) {
            setTableState(tbody, 9, 'error', adminLoadError('đơn hàng', error), {
                label: 'Thử lại',
                run: () => loadOrders()
            });
        }
    }

    function renderFilteredOrders() {
        const tbody = document.getElementById('ordersTableBody');
        const statusFilter = document.getElementById('orderStatusFilter').value;
        const searchQuery = document.getElementById('orderSearchInput').value.trim().toLowerCase();

        const filtered = allOrders.filter((order) => {
            const matchStatus = statusFilter === 'all' || order.status === statusFilter;
            const matchSearch = !searchQuery ||
                (order.orderId && order.orderId.toLowerCase().includes(searchQuery)) ||
                (order.customerName && order.customerName.toLowerCase().includes(searchQuery)) ||
                (order.phone && order.phone.includes(searchQuery));
            return matchStatus && matchSearch;
        });

        markTableLoaded(tbody);
        if (!filtered.length) {
            const hasFilters = statusFilter !== 'all' || Boolean(searchQuery);
            setTableState(
                tbody,
                9,
                'empty',
                hasFilters ? 'Không tìm thấy đơn hàng phù hợp.' : 'Chưa có đơn hàng nào.',
                hasFilters ? {
                    label: 'Xóa bộ lọc',
                    run: () => {
                        document.getElementById('orderStatusFilter').value = 'all';
                        document.getElementById('orderSearchInput').value = '';
                        renderFilteredOrders();
                    }
                } : null
            );
            return;
        }

        const orderStatusLabels = {
            received: 'Mới nhận',
            processing: 'Đang xử lý',
            shipping: 'Đang giao',
            completed: 'Hoàn tất',
            cancelled: 'Đã huỷ'
        };
        const orderStatusTransitions = {
            received: ['processing', 'cancelled'],
            processing: ['shipping', 'cancelled'],
            shipping: ['completed', 'cancelled'],
            completed: [],
            cancelled: []
        };
        tbody.innerHTML = filtered.map((order) => {
            const date = new Date(order.createdAt).toLocaleString('vi-VN');
            const itemsSummary = (order.items || [])
                .map((i) => `${escapeHtml(i.title)} (x${i.quantity})`)
                .join('<br>');
            const availableStatuses = [order.status, ...(orderStatusTransitions[order.status] || [])];

            return `
                <tr data-order-id="${escapeHtml(order.orderId)}">
                    <td><small title="${escapeHtml(order.orderId)}"><code>${escapeHtml(order.orderId.slice(0, 8))}...</code></small></td>
                    <td><small>${date}</small></td>
                    <td><b>${escapeHtml(order.customerName)}</b></td>
                    <td>
                        <div>📞 ${escapeHtml(order.phone)}</div>
                        <small style="color: var(--text-muted);">${escapeHtml(order.address)}</small>
                    </td>
                    <td><small>${itemsSummary}</small></td>
                    <td>
                        <span class="payment-badge ${order.paymentStatus === 'paid' ? 'payment-paid' : 'payment-pending'}">
                            ${order.paymentMethod === 'transfer' ? 'Chuyển khoản QR' : 'COD'}
                        </span>
                    </td>
                    <td><strong>${formatCurrency(order.total)}</strong></td>
                    <td><span class="status-badge status-${escapeHtml(order.status)}">${escapeHtml(order.status)}</span></td>
                    <td>
                        <select class="form-select order-status-select" data-id="${escapeHtml(order.orderId)}">
                            ${availableStatuses.map((status) => `<option value="${status}" ${order.status === status ? 'selected' : ''}>${orderStatusLabels[status]}</option>`).join('')}
                        </select>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach event listeners for status changes
        tbody.querySelectorAll('.order-status-select').forEach((select) => {
            select.addEventListener('change', async (e) => {
                if (select.dataset.busy === 'true') return;
                const orderId = e.target.dataset.id;
                const newStatus = e.target.value;
                const order = allOrders.find((entry) => entry.orderId === orderId);
                if (!order) return;
                await runWithBusyControl(select, null, async () => {
                    try {
                        const payload = { status: newStatus };
                        if (newStatus === 'completed' && order.paymentStatus === 'paid') {
                            payload.paymentStatus = 'paid';
                        }
                        const res = await apiFetch(`/api/admin/orders/${encodeURIComponent(orderId)}`, {
                            method: 'PATCH',
                            body: JSON.stringify(payload)
                        });
                        if (!res.ok) throw responseError(res);
                        order.status = newStatus;
                        showToast(`Đã cập nhật trạng thái đơn sang "${newStatus}"`);
                    } catch (error) {
                        showToast(adminLoadError('trạng thái đơn hàng', error), 'error');
                    }
                });
                renderFilteredOrders();
            });
        });
    }

    document.getElementById('orderStatusFilter')?.addEventListener('change', renderFilteredOrders);
    document.getElementById('orderSearchInput')?.addEventListener('input', renderFilteredOrders);

    // --- VIEW: BOOKS ---
    const bookModal = document.getElementById('bookModal');
    const bookForm = document.getElementById('bookForm');
    const bookImageUpload = document.getElementById('bookImageUpload');
    const bookImageUploadStatus = document.getElementById('bookImageUploadStatus');
    const uploadedBookImageVariants = new Map();
    const bookImagesField = bookForm?.elements?.images;

    async function loadBooks() {
        const tbody = document.getElementById('booksTableBody');
        setTableState(tbody, 8, 'loading', 'Đang tải danh mục sách...');
        try {
            const categoryRes = await apiFetch('/api/admin/categories');
            if (categoryRes.ok) {
                syncCategoryControls(await categoryRes.json());
            }
            const authorRes = await apiFetch('/api/admin/authors');
            if (authorRes.ok) {
                syncAuthorControls(await authorRes.json());
            }
            const publisherRes = await apiFetch('/api/admin/publishers');
            if (publisherRes.ok) {
                syncPublisherControls(await publisherRes.json());
            }
            const res = await apiFetch('/api/admin/books');
            if (!res.ok) throw responseError(res);
            allBooks = await res.json();
            renderFilteredBooks();
        } catch (error) {
            setTableState(tbody, 8, 'error', adminLoadError('sách', error), {
                label: 'Thử lại',
                run: () => loadBooks()
            });
        }
    }

    function renderFilteredBooks() {
        const tbody = document.getElementById('booksTableBody');
        const catFilter = document.getElementById('bookCategoryFilter').value;
        const searchQuery = document.getElementById('bookSearchInput').value.trim().toLowerCase();
        const searchNorm = searchQuery.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd');

        const filtered = allBooks.filter((book) => {
            const matchCategory = catFilter === 'all' || book.category === catFilter;
            const bookText = `${book.title || ''} ${book.author || ''}`.toLowerCase();
            const bookNorm = bookText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd');
            const matchSearch = !searchQuery ||
                bookText.includes(searchQuery) ||
                bookNorm.includes(searchNorm);
            return matchCategory && matchSearch;
        });

        const sortMode = document.getElementById('bookSortFilter')?.value || 'default';
        if (sortMode === 'title-asc') filtered.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'vi'));
        if (sortMode === 'title-desc') filtered.sort((a, b) => (b.title || '').localeCompare(a.title || '', 'vi'));
        if (sortMode === 'price-asc') filtered.sort((a, b) => (a.price || 0) - (b.price || 0));
        if (sortMode === 'price-desc') filtered.sort((a, b) => (b.price || 0) - (a.price || 0));
        if (sortMode === 'stock-asc') filtered.sort((a, b) => ((a.stock !== undefined ? a.stock : 12) - (b.stock !== undefined ? b.stock : 12)));
        if (sortMode === 'stock-desc') filtered.sort((a, b) => ((b.stock !== undefined ? b.stock : 12) - (a.stock !== undefined ? a.stock : 12)));

        markTableLoaded(tbody);
        if (!filtered.length) {
            const hasFilters = catFilter !== 'all' || Boolean(searchQuery) || sortMode !== 'default';
            setTableState(tbody, 8, 'empty',
                hasFilters ? 'Không tìm thấy sách phù hợp với bộ lọc.' : 'Chưa có sách nào.',
                hasFilters ? {
                    label: 'Xóa bộ lọc',
                    run: () => {
                        document.getElementById('bookCategoryFilter').value = 'all';
                        document.getElementById('bookSearchInput').value = '';
                        document.getElementById('bookSortFilter').value = 'default';
                        renderFilteredBooks();
                    }
                } : null
            );
            return;
        }

        tbody.innerHTML = filtered.map((book) => {
            const defaultCover = 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=100&q=80';
            const coverSrc = book.cover || defaultCover;
            const catName = categoryLabels[book.category] || book.category;
            const id = book.id || book.title;

            return `
                <tr>
                    <td>
                        <img src="${escapeHtml(coverSrc)}" alt="${escapeHtml(book.title)}" style="width: 44px; height: 60px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border);">
                    </td>
                    <td><b>${escapeHtml(book.title)}</b></td>
                    <td>${escapeHtml(book.author)}</td>
                    <td><span class="payment-badge" style="background: #eef2ff; color: #4338ca;">${escapeHtml(catName)}</span></td>
                    <td><strong>${formatCurrency(book.price)}</strong></td>
                    <td><span>${book.stock !== undefined ? book.stock : 12} quyển</span></td>
                    <td><small style="color: var(--text-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 250px;">${escapeHtml(book.description || 'Không có mô tả')}</small></td>
                    <td>
                        <div style="display: flex; gap: 0.4rem;">
                            <button class="btn-sm btn-edit edit-book-btn" data-id="${escapeHtml(id)}" type="button">Sửa</button>
                            ${book.isCustom ? `<button class="btn-sm btn-delete delete-book-btn" data-id="${escapeHtml(id)}" type="button">Xóa</button>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Edit book handler
        tbody.querySelectorAll('.edit-book-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const book = allBooks.find((b) => (b.id === id || b.title === id));
                if (!book) return;
                document.getElementById('bookModalTitle').textContent = 'Chỉnh sửa thông tin sách';
                document.getElementById('bookIdInput').value = book.id || book.title;
                bookForm.elements['title'].value = book.title;
                bookForm.elements['author'].value = book.author;
                bookForm.elements['authorIds'].value = JSON.stringify(book.authorIds || []);
                bookForm.elements['publisher'].value = book.publisher || '';
                bookForm.elements['publisherId'].value = book.publisherId || '';
                bookForm.elements['category'].value = book.category;
                bookForm.elements['price'].value = book.price;
                bookForm.elements['stock'].value = book.stock !== undefined ? book.stock : 12;
                bookForm.elements['cover'].value = book.cover || '';
                bookForm.elements['isbn'].value = book.isbn || '';
                bookForm.elements['images'].value = (Array.isArray(book.images) ? book.images : [])
                    .map((image) => typeof image === 'string'
                        ? image
                        : `${image.url}${image.alt ? ` | ${image.alt}` : ''}`)
                    .filter(Boolean)
                    .join('\n');
                uploadedBookImageVariants.clear();
                (Array.isArray(book.images) ? book.images : []).forEach((image) => {
                    if (typeof image !== 'string' && image.variants) {
                        uploadedBookImageVariants.set(image.url, image.variants);
                    }
                });
                bookForm.elements['description'].value = book.description || '';
                void loadBookHistory(book.id || book.title);
                bookModal.showModal();
            });
        });

        // Delete book handler
        tbody.querySelectorAll('.delete-book-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                if (!confirm('Bạn có chắc muốn xoá cuốn sách này khỏi kho?')) return;
                await runWithBusyControl(btn, 'Đang xóa...', async () => {
                    try {
                        const res = await apiFetch(`/api/admin/books/${encodeURIComponent(id)}`, { method: 'DELETE' });
                        if (!res.ok) throw responseError(res);
                        showToast('Đã xoá sách thành công.');
                        await loadBooks();
                    } catch (error) {
                        showToast(adminLoadError('sách', error), 'error');
                    }
                });
            });
        });
    }

    document.getElementById('bookCategoryFilter')?.addEventListener('change', renderFilteredBooks);
    document.getElementById('bookSortFilter')?.addEventListener('change', renderFilteredBooks);
    document.getElementById('bookSearchInput')?.addEventListener('input', renderFilteredBooks);

    async function loadBookHistory(bookId) {
        const panel = document.getElementById('bookHistoryPanel');
        const list = document.getElementById('bookHistoryList');
        if (!panel || !list || !bookId) return;
        panel.hidden = false;
        list.setAttribute('aria-busy', 'true');
        list.innerHTML = '<li role="status" aria-live="polite">Đang tải lịch sử...</li>';
        try {
            const response = await apiFetch(`/api/admin/books/${encodeURIComponent(bookId)}/history`);
            if (!response.ok) throw responseError(response);
            const history = await response.json();
            list.setAttribute('aria-busy', 'false');
            list.innerHTML = history.length
                ? history.map((entry) => {
                    const changes = Object.entries(entry.changes || {})
                        .map(([field, change]) => `${escapeHtml(field)}: ${escapeHtml(change.before)} → ${escapeHtml(change.after)}`)
                        .join('; ');
                    return `<li><time>${escapeHtml(new Date(entry.createdAt).toLocaleString('vi-VN'))}</time> · ${escapeHtml(entry.actorRole || 'staff')} · ${changes}</li>`;
                }).join('')
                : '<li role="status">Chưa có thay đổi giá hoặc trạng thái.</li>';
        } catch (error) {
            list.setAttribute('aria-busy', 'false');
            list.replaceChildren();
            const item = document.createElement('li');
            item.setAttribute('role', 'alert');
            item.textContent = adminLoadError('lịch sử sách', error);
            const retry = document.createElement('button');
            retry.className = 'btn-link';
            retry.type = 'button';
            retry.textContent = 'Thử lại';
            retry.addEventListener('click', () => loadBookHistory(bookId));
            item.append(' ', retry);
            list.appendChild(item);
        }
    }

    async function loadReviewQueue() {
        const tbody = document.getElementById('reviewQueueBody');
        if (!tbody) return;
        setTableState(tbody, 6, 'loading', 'Đang tải đánh giá...');
        try {
            const response = await apiFetch('/api/admin/reviews?limit=100');
            if (!response.ok) throw responseError(response);
            const reviews = await response.json();
            markTableLoaded(tbody);
            tbody.innerHTML = reviews.length
                ? reviews.filter((review) => review.status === 'pending' || Number(review.reportCount) > 0).map((review) => `<tr>
                    <td>${escapeHtml(review.bookTitle)}</td>
                    <td>${escapeHtml(review.userName)}</td>
                    <td>${escapeHtml(review.rating)} / 5</td>
                    <td>${escapeHtml(review.content)}</td>
                    <td>${escapeHtml(review.status)}${Number(review.reportCount) ? ` · ${escapeHtml(review.reportCount)} báo cáo` : ''}</td>
                    <td>${review.status === 'visible'
                        ? `<button class="btn-sm btn-delete" data-review-id="${escapeHtml(review.id)}" data-review-status="hidden" type="button">Ẩn</button>`
                        : `<button class="btn-sm btn-edit" data-review-id="${escapeHtml(review.id)}" data-review-status="visible" type="button">Duyệt</button> <button class="btn-sm btn-delete" data-review-id="${escapeHtml(review.id)}" data-review-status="rejected" type="button">Từ chối</button>`}</td>
                </tr>`).join('')
                : '';
            if (!reviews.length || !tbody.children.length) {
                setTableState(tbody, 6, 'empty', 'Không có đánh giá chờ duyệt.');
            }
        } catch (error) {
            setTableState(tbody, 6, 'error', adminLoadError('đánh giá', error), {
                label: 'Thử lại',
                run: () => loadReviewQueue()
            });
        }
    }

    document.getElementById('loadReviewQueue')?.addEventListener('click', (event) =>
        runWithBusyControl(event.currentTarget, 'Đang tải...', () => loadReviewQueue()));
    document.getElementById('reviewQueueBody')?.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-review-id]');
        if (!button) return;
        await runWithBusyControl(button, 'Đang cập nhật...', async () => {
            try {
                const response = await apiFetch(`/api/admin/reviews/${encodeURIComponent(button.dataset.reviewId)}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: button.dataset.reviewStatus })
                });
                if (!response.ok) throw responseError(response);
                showToast('Đã cập nhật trạng thái đánh giá.');
                await loadReviewQueue();
            } catch (error) {
                showToast(adminLoadError('đánh giá', error), 'error');
            }
        });
    });

    document.getElementById('openAddBookBtn')?.addEventListener('click', () => {
        document.getElementById('bookModalTitle').textContent = 'Thêm sách mới vào kho';
        bookForm.reset();
        uploadedBookImageVariants.clear();
        if (bookImageUploadStatus) bookImageUploadStatus.textContent = '';
        document.getElementById('bookIdInput').value = '';
        document.getElementById('bookHistoryPanel').hidden = true;
        bookModal.showModal();
    });

    document.getElementById('closeBookModal')?.addEventListener('click', () => bookModal.close());
    document.getElementById('cancelBookModal')?.addEventListener('click', () => bookModal.close());

    bookImageUpload?.addEventListener('change', async () => {
        const files = Array.from(bookImageUpload.files || []);
        const existingCount = String(bookImagesField?.value || '')
            .split(/\r?\n/)
            .filter((line) => line.trim()).length;
        const availableSlots = Math.max(0, 8 - existingCount);
        if (files.length > availableSlots) {
            showToast(`Chỉ còn ${availableSlots} vị trí ảnh.`, 'error');
        }
        const selectedFiles = files.slice(0, availableSlots);
        bookImageUpload.disabled = true;
        bookImageUpload.setAttribute('aria-busy', 'true');
        if (bookImageUploadStatus) {
            bookImageUploadStatus.setAttribute('role', 'status');
            bookImageUploadStatus.setAttribute('aria-live', 'polite');
            bookImageUploadStatus.setAttribute('aria-busy', 'true');
        }
        if (bookImageUploadStatus) bookImageUploadStatus.textContent = 'Đang tối ưu ảnh...';
        try {
            for (const file of selectedFiles) {
                const response = await apiFetch('/api/admin/uploads/book-cover', {
                    method: 'POST',
                    headers: {
                        'Content-Type': file.type,
                        'X-File-Name': file.name,
                    },
                    body: file,
                });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.error || `Không thể tải ảnh ${file.name}.`);
                }
                const currentLines = String(bookImagesField?.value || '').trim();
                if (bookImagesField) {
                    bookImagesField.value = `${currentLines ? `${currentLines}\n` : ''}${result.url}`;
                }
                uploadedBookImageVariants.set(result.url, result.variants);
            }
            if (bookImageUploadStatus) {
                bookImageUploadStatus.textContent = selectedFiles.length
                    ? `Đã tối ưu ${selectedFiles.length} ảnh. Kiểm tra mô tả ảnh trước khi lưu.`
                    : '';
            }
        } catch (error) {
            if (bookImageUploadStatus) {
                bookImageUploadStatus.textContent = error.message || 'Không thể tải ảnh.';
            }
            showToast(error.message || 'Không thể tải ảnh.', 'error');
        } finally {
            bookImageUpload.disabled = false;
            bookImageUpload.setAttribute('aria-busy', 'false');
            bookImageUploadStatus?.setAttribute('aria-busy', 'false');
            bookImageUpload.value = '';
        }
    });

    bookForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await runWithBusyControl(bookForm, 'Đang lưu...', async () => {
        const data = new FormData(bookForm);
        const bookId = data.get('id');
        const currentBook = bookId
            ? allBooks.find((book) => book.id === bookId)
            : null;
        const payload = {
            title: data.get('title'),
            author: data.get('author'),
            publisher: data.get('publisher'),
            publisherId: data.get('publisherId') || (() => {
                const name = String(data.get('publisher') || '').trim();
                return allPublishers.find((publisher) =>
                    (publisher.displayName || publisher.name).toLowerCase() === name.toLowerCase()
                )?.slug || '';
            })(),
            authorIds: (() => {
                try {
                    const ids = JSON.parse(data.get('authorIds') || '[]');
                    if (Array.isArray(ids)) return ids;
                } catch {}
                const names = String(data.get('author') || '').split(/\s*[,;&]\s*|\svà\s/i)
                    .map((name) => name.trim()).filter(Boolean);
                return names.map((name) =>
                    allAuthors.find((author) =>
                        (author.displayName || author.name).toLowerCase() === name.toLowerCase()
                    )?.slug
                ).filter(Boolean);
            })(),
            category: data.get('category'),
            price: Number(data.get('price')),
            stock: Number(data.get('stock')),
            cover: data.get('cover'),
            isbn: data.get('isbn'),
            images: String(data.get('images') || '')
                .split(/\r?\n/)
                .map((line) => {
                    const [url, ...altParts] = line.split('|');
                    const normalizedUrl = url.trim();
                    const existingImage = currentBook?.images?.find((image) =>
                        (typeof image === 'string' ? image : image.url) === normalizedUrl
                    );
                    return {
                        url: normalizedUrl,
                        alt: altParts.join('|').trim() || existingImage?.alt || '',
                        ...((uploadedBookImageVariants.get(normalizedUrl) || existingImage?.variants)
                            ? { variants: uploadedBookImageVariants.get(normalizedUrl) || existingImage.variants }
                            : {}),
                    };
                })
                .filter((image) => image.url),
            description: data.get('description')
        };

        try {
            let res;
            if (bookId) {
                res = await apiFetch(`/api/admin/books/${encodeURIComponent(bookId)}`, {
                    method: 'PUT',
                    headers: { 'If-Match': currentBook?.updatedAt || '' },
                    body: JSON.stringify(payload)
                });
            } else {
                res = await apiFetch('/api/admin/books', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
            }

            if (res.ok) {
                showToast(bookId ? 'Đã cập nhật sách!' : 'Đã thêm sách mới vào kho!');
                bookModal.close();
                loadBooks();
            } else {
                const err = await res.json();
                showToast(err.error || 'Thao tác không thành công.', 'error');
            }
        } catch {
            showToast('Lỗi kết nối máy chủ.', 'error');
        }
        });
    });

    // --- VIEW: COUPONS ---
    let allCategories = [];

    function syncCategoryControls(categories) {
        allCategories = categories;
        const activeCategories = categories.filter((category) => category.status !== 'inactive');
        const options = activeCategories.map((category) =>
            `<option value="${escapeHtml(category.slug)}">${escapeHtml(category.label || category.name)}</option>`
        ).join('');
        const filter = document.getElementById('bookCategoryFilter');
        if (filter) {
            filter.innerHTML = '<option value="all">Tất cả thể loại</option>' + options;
        }
        const formSelect = bookForm?.elements?.category;
        if (formSelect) formSelect.innerHTML = options;
        const labels = Object.fromEntries(categories.map((category) =>
            [category.slug, category.label || category.name]
        ));
        categoryLabels && Object.assign(categoryLabels, labels);
    }

    async function loadCategories() {
        const tbody = document.getElementById('categoriesTableBody');
        setTableState(tbody, 5, 'loading', 'Đang tải danh mục...');
        try {
            const res = await apiFetch('/api/admin/categories');
            if (!res.ok) throw responseError(res);
            const categories = await res.json();
            markTableLoaded(tbody);
            if (!categories.length) {
                setTableState(tbody, 5, 'empty', 'Chưa có danh mục nào. Dùng nút "Thêm danh mục" để tạo mới.');
                syncCategoryControls(categories);
                return;
            }
            syncCategoryControls(categories);
            tbody.innerHTML = categories.map((category) => `
                <tr>
                    <td><b>${escapeHtml(category.label || category.name)}</b></td>
                    <td><code>${escapeHtml(category.slug)}</code></td>
                    <td><span class="payment-badge">${category.status === 'inactive' ? 'Ngừng sử dụng' : 'Đang sử dụng'}</span></td>
                    <td>${escapeHtml(category.description || '—')}</td>
                    <td>
                        <button class="btn-sm btn-edit edit-category-btn" data-slug="${escapeHtml(category.slug)}" type="button">Sửa</button>
                        <button class="btn-sm btn-delete delete-category-btn" data-slug="${escapeHtml(category.slug)}" type="button">Xóa</button>
                    </td>
                </tr>
            `).join('');

            tbody.querySelectorAll('.edit-category-btn').forEach((button) => {
                button.addEventListener('click', () => openCategoryModal(
                    categories.find((category) => category.slug === button.dataset.slug)
                ));
            });
            tbody.querySelectorAll('.delete-category-btn').forEach((button) => {
                button.addEventListener('click', async () => {
                    if (!confirm('Xóa danh mục này? Danh mục có sách liên kết sẽ không thể xóa.')) return;
                    await runWithBusyControl(button, 'Đang xóa...', async () => {
                        try {
                            const res = await apiFetch(`/api/admin/categories/${encodeURIComponent(button.dataset.slug)}`, { method: 'DELETE' });
                            const result = await res.json().catch(() => ({}));
                            if (!res.ok) {
                                const error = new Error(result.error || adminLoadError('danh mục', responseError(res)));
                                error.status = res.status;
                                throw error;
                            }
                            showToast('Đã xóa danh mục.');
                            await loadCategories();
                        } catch (error) {
                            showToast(error.status ? error.message : adminLoadError('danh mục', error), 'error');
                        }
                    });
                });
            });
        } catch (error) {
            setTableState(tbody, 5, 'error', adminLoadError('danh mục', error), {
                label: 'Thử lại',
                run: () => loadCategories()
            });
        }
    }

    const categoryModal = document.getElementById('categoryModal');
    const categoryForm = document.getElementById('categoryForm');

    function openCategoryModal(category = null) {
        categoryForm.reset();
        document.getElementById('categoryModalTitle').textContent = category ? 'Cập nhật danh mục' : 'Thêm danh mục';
        categoryForm.elements.slug.value = category?.slug || '';
        categoryForm.elements.categorySlug.value = category?.slug || '';
        categoryForm.elements.name.value = category?.name || '';
        categoryForm.elements.status.value = category?.status || 'active';
        categoryForm.elements.description.value = category?.description || '';
        categoryModal.showModal();
    }

    document.getElementById('openAddCategoryBtn')?.addEventListener('click', () => openCategoryModal());
    document.getElementById('closeCategoryModal')?.addEventListener('click', () => categoryModal.close());
    document.getElementById('cancelCategoryModal')?.addEventListener('click', () => categoryModal.close());
    categoryForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        await runWithBusyControl(categoryForm, 'Đang lưu...', async () => {
            const data = new FormData(categoryForm);
            const slug = data.get('slug');
            const payload = {
                name: data.get('name'),
                slug: data.get('categorySlug'),
                status: data.get('status'),
                description: data.get('description')
            };
            try {
                const res = await apiFetch(
                    slug ? `/api/admin/categories/${encodeURIComponent(slug)}` : '/api/admin/categories',
                    { method: slug ? 'PUT' : 'POST', body: JSON.stringify(payload) }
                );
                const result = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const error = new Error(result.error || adminLoadError('danh mục', responseError(res)));
                    error.status = res.status;
                    throw error;
                }
                showToast(slug ? 'Đã cập nhật danh mục.' : 'Đã tạo danh mục.');
                categoryModal.close();
                await loadCategories();
            } catch (error) {
                showToast(error.status ? error.message : adminLoadError('danh mục', error), 'error');
            }
        });
    });

    let allAuthors = [];

    function syncAuthorControls(authors) {
        allAuthors = authors;
        const datalist = document.getElementById('authorSuggestions');
        if (datalist) {
            datalist.innerHTML = authors
                .filter((author) => author.status !== 'inactive')
                .map((author) => `<option value="${escapeHtml(author.displayName || author.name)}"></option>`)
                .join('');
        }
    }

    function escapeSearchText(value) {
        return String(value || '').normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .toLowerCase();
    }

    async function loadAuthors() {
        const tbody = document.getElementById('authorsTableBody');
        setTableState(tbody, 5, 'loading', 'Đang tải tác giả...');
        try {
            const res = await apiFetch('/api/admin/authors');
            if (!res.ok) throw responseError(res);
            allAuthors = await res.json();
            renderFilteredAuthors();
        } catch (error) {
            setTableState(tbody, 5, 'error', adminLoadError('tác giả', error), {
                label: 'Thử lại',
                run: () => loadAuthors()
            });
        }
    }

    function renderFilteredAuthors() {
        const tbody = document.getElementById('authorsTableBody');
        const query = escapeSearchText(document.getElementById('authorSearchInput')?.value);
        const filtered = allAuthors.filter((author) =>
            !query ||
            escapeSearchText(author.name).includes(query) ||
            escapeSearchText(author.displayName).includes(query) ||
            escapeSearchText(author.slug).includes(query)
        );
        markTableLoaded(tbody);
        if (!filtered.length) {
            const hasQuery = Boolean(query);
            setTableState(tbody, 5, 'empty',
                hasQuery ? 'Không tìm thấy tác giả phù hợp.' : 'Chưa có tác giả nào. Dùng nút "Thêm tác giả" để tạo mới.',
                hasQuery ? {
                    label: 'Xóa tìm kiếm',
                    run: () => {
                        document.getElementById('authorSearchInput').value = '';
                        renderFilteredAuthors();
                    }
                } : null
            );
            return;
        }
        tbody.innerHTML = filtered.map((author) => `
            <tr>
                <td><b>${escapeHtml(author.displayName || author.name)}</b></td>
                <td><code>${escapeHtml(author.slug)}</code></td>
                <td><span class="payment-badge">${author.status === 'inactive' ? 'Ngừng sử dụng' : 'Đang sử dụng'}</span></td>
                <td>${escapeHtml(author.bio || '—')}</td>
                <td>
                    <button class="btn-sm btn-edit edit-author-btn" data-slug="${escapeHtml(author.slug)}" type="button">Sửa</button>
                    <button class="btn-sm btn-delete delete-author-btn" data-slug="${escapeHtml(author.slug)}" type="button">Xóa</button>
                </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.edit-author-btn').forEach((button) => {
            button.addEventListener('click', () => openAuthorModal(
                allAuthors.find((author) => author.slug === button.dataset.slug)
            ));
        });
        tbody.querySelectorAll('.delete-author-btn').forEach((button) => {
            button.addEventListener('click', async () => {
                if (!confirm('Xóa tác giả này? Tác giả đang liên kết với sách sẽ không thể xóa.')) return;
                await runWithBusyControl(button, 'Đang xóa...', async () => {
                    try {
                        const res = await apiFetch(`/api/admin/authors/${encodeURIComponent(button.dataset.slug)}`, { method: 'DELETE' });
                        const result = await res.json().catch(() => ({}));
                        if (!res.ok) {
                            const error = new Error(result.error || adminLoadError('tác giả', responseError(res)));
                            error.status = res.status;
                            throw error;
                        }
                        showToast('Đã xóa tác giả.');
                        await loadAuthors();
                    } catch (error) {
                        showToast(error.status ? error.message : adminLoadError('tác giả', error), 'error');
                    }
                });
            });
        });
    }

    const authorModal = document.getElementById('authorModal');
    const authorForm = document.getElementById('authorForm');

    function openAuthorModal(author = null) {
        authorForm.reset();
        document.getElementById('authorModalTitle').textContent = author ? 'Cập nhật tác giả' : 'Thêm tác giả';
        authorForm.elements.slug.value = author?.slug || '';
        authorForm.elements.name.value = author?.name || '';
        authorForm.elements.displayName.value = author?.displayName || author?.name || '';
        authorForm.elements.authorSlug.value = author?.slug || '';
        authorForm.elements.status.value = author?.status || 'active';
        authorForm.elements.bio.value = author?.bio || '';
        authorModal.showModal();
    }

    document.getElementById('openAddAuthorBtn')?.addEventListener('click', () => openAuthorModal());
    document.getElementById('closeAuthorModal')?.addEventListener('click', () => authorModal.close());
    document.getElementById('cancelAuthorModal')?.addEventListener('click', () => authorModal.close());
    document.getElementById('authorSearchInput')?.addEventListener('input', renderFilteredAuthors);
    authorForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        await runWithBusyControl(authorForm, 'Đang lưu...', async () => {
        const data = new FormData(authorForm);
        const slug = data.get('slug');
        const payload = {
            name: data.get('name'),
            displayName: data.get('displayName') || data.get('name'),
            slug: data.get('authorSlug'),
            status: data.get('status'),
            bio: data.get('bio')
        };
        try {
            const res = await apiFetch(
                slug ? `/api/admin/authors/${encodeURIComponent(slug)}` : '/api/admin/authors',
                { method: slug ? 'PUT' : 'POST', body: JSON.stringify(payload) }
            );
            const result = await res.json().catch(() => ({}));
            if (!res.ok) {
                const error = new Error(result.error || adminLoadError('tác giả', responseError(res)));
                error.status = res.status;
                throw error;
            }
            showToast(slug ? 'Đã cập nhật tác giả.' : 'Đã tạo tác giả.');
            authorModal.close();
            await loadAuthors();
            await loadBooks();
        } catch (error) {
            showToast(error.status ? error.message : adminLoadError('tác giả', error), 'error');
        }
        });
    });

    let allPublishers = [];

    function syncPublisherControls(publishers) {
        allPublishers = publishers;
        const datalist = document.getElementById('publisherSuggestions');
        if (datalist) {
            datalist.innerHTML = publishers
                .filter((publisher) => publisher.status !== 'inactive')
                .map((publisher) => `<option value="${escapeHtml(publisher.displayName || publisher.name)}"></option>`)
                .join('');
        }
    }

    async function loadPublishers() {
        const tbody = document.getElementById('publishersTableBody');
        setTableState(tbody, 5, 'loading', 'Đang tải nhà xuất bản...');
        try {
            const res = await apiFetch('/api/admin/publishers');
            if (!res.ok) throw responseError(res);
            allPublishers = await res.json();
            syncPublisherControls(allPublishers);
            renderFilteredPublishers();
        } catch (error) {
            setTableState(tbody, 5, 'error', adminLoadError('nhà xuất bản', error), {
                label: 'Thử lại',
                run: () => loadPublishers()
            });
        }
    }

    function renderFilteredPublishers() {
        const tbody = document.getElementById('publishersTableBody');
        const query = escapeSearchText(document.getElementById('publisherSearchInput')?.value);
        const filtered = allPublishers.filter((publisher) =>
            !query ||
            escapeSearchText(publisher.name).includes(query) ||
            escapeSearchText(publisher.displayName).includes(query) ||
            escapeSearchText(publisher.slug).includes(query)
        );
        markTableLoaded(tbody);
        if (!filtered.length) {
            const hasQuery = Boolean(query);
            setTableState(tbody, 5, 'empty',
                hasQuery ? 'Không tìm thấy nhà xuất bản phù hợp.' : 'Chưa có nhà xuất bản nào. Dùng nút "Thêm nhà xuất bản" để tạo mới.',
                hasQuery ? {
                    label: 'Xóa tìm kiếm',
                    run: () => {
                        document.getElementById('publisherSearchInput').value = '';
                        renderFilteredPublishers();
                    }
                } : null
            );
            return;
        }
        tbody.innerHTML = filtered.map((publisher) => `
            <tr>
                <td><b>${escapeHtml(publisher.displayName || publisher.name)}</b></td>
                <td><code>${escapeHtml(publisher.slug)}</code></td>
                <td><span class="payment-badge">${publisher.status === 'inactive' ? 'Ngừng sử dụng' : 'Đang sử dụng'}</span></td>
                <td>${escapeHtml(publisher.address || '—')}</td>
                <td>
                    <button class="btn-sm btn-edit edit-publisher-btn" data-slug="${escapeHtml(publisher.slug)}" type="button">Sửa</button>
                    <button class="btn-sm btn-delete delete-publisher-btn" data-slug="${escapeHtml(publisher.slug)}" type="button">Xóa</button>
                </td>
            </tr>
        `).join('');
        tbody.querySelectorAll('.edit-publisher-btn').forEach((button) => {
            button.addEventListener('click', () => openPublisherModal(
                allPublishers.find((publisher) => publisher.slug === button.dataset.slug)
            ));
        });
        tbody.querySelectorAll('.delete-publisher-btn').forEach((button) => {
            button.addEventListener('click', async () => {
                if (!confirm('Xóa nhà xuất bản này? Nhà xuất bản đang được sách tham chiếu sẽ không thể xóa.')) return;
                await runWithBusyControl(button, 'Đang xóa...', async () => {
                    try {
                        const res = await apiFetch(`/api/admin/publishers/${encodeURIComponent(button.dataset.slug)}`, { method: 'DELETE' });
                        const result = await res.json().catch(() => ({}));
                        if (!res.ok) {
                            const error = new Error(result.error || adminLoadError('nhà xuất bản', responseError(res)));
                            error.status = res.status;
                            throw error;
                        }
                        showToast('Đã xóa nhà xuất bản.');
                        await loadPublishers();
                    } catch (error) {
                        showToast(error.status ? error.message : adminLoadError('nhà xuất bản', error), 'error');
                    }
                });
            });
        });
    }

    const publisherModal = document.getElementById('publisherModal');
    const publisherForm = document.getElementById('publisherForm');
    function openPublisherModal(publisher = null) {
        publisherForm.reset();
        document.getElementById('publisherModalTitle').textContent = publisher ? 'Cập nhật nhà xuất bản' : 'Thêm nhà xuất bản';
        publisherForm.elements.slug.value = publisher?.slug || '';
        publisherForm.elements.name.value = publisher?.name || '';
        publisherForm.elements.displayName.value = publisher?.displayName || publisher?.name || '';
        publisherForm.elements.publisherSlug.value = publisher?.slug || '';
        publisherForm.elements.status.value = publisher?.status || 'active';
        publisherForm.elements.address.value = publisher?.address || '';
        publisherForm.elements.website.value = publisher?.website || '';
        publisherModal.showModal();
    }
    document.getElementById('openAddPublisherBtn')?.addEventListener('click', () => openPublisherModal());
    document.getElementById('closePublisherModal')?.addEventListener('click', () => publisherModal.close());
    document.getElementById('cancelPublisherModal')?.addEventListener('click', () => publisherModal.close());
    document.getElementById('publisherSearchInput')?.addEventListener('input', renderFilteredPublishers);
    publisherForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        await runWithBusyControl(publisherForm, 'Đang lưu...', async () => {
        const data = new FormData(publisherForm);
        const slug = data.get('slug');
        const payload = {
            name: data.get('name'),
            displayName: data.get('displayName') || data.get('name'),
            slug: data.get('publisherSlug'),
            status: data.get('status'),
            address: data.get('address'),
            website: data.get('website')
        };
        try {
            const res = await apiFetch(
                slug ? `/api/admin/publishers/${encodeURIComponent(slug)}` : '/api/admin/publishers',
                { method: slug ? 'PUT' : 'POST', body: JSON.stringify(payload) }
            );
            const result = await res.json().catch(() => ({}));
            if (!res.ok) {
                const error = new Error(result.error || adminLoadError('nhà xuất bản', responseError(res)));
                error.status = res.status;
                throw error;
            }
            showToast(slug ? 'Đã cập nhật nhà xuất bản.' : 'Đã tạo nhà xuất bản.');
            publisherModal.close();
            await loadPublishers();
            await loadBooks();
        } catch (error) {
            showToast(error.status ? error.message : adminLoadError('nhà xuất bản', error), 'error');
        }
        });
    });

    const couponModal = document.getElementById('couponModal');
    const couponForm = document.getElementById('couponForm');

    async function loadCoupons() {
        const tbody = document.getElementById('couponsTableBody');
        setTableState(tbody, 7, 'loading', 'Đang tải coupon...');
        try {
            const res = await apiFetch('/api/admin/coupons');
            if (!res.ok) throw responseError(res);
            allCoupons = await res.json();
            renderCoupons();
        } catch (error) {
            setTableState(tbody, 7, 'error', adminLoadError('coupon', error), {
                label: 'Thử lại',
                run: () => loadCoupons()
            });
        }
    }

    function renderCoupons() {
        const tbody = document.getElementById('couponsTableBody');
        markTableLoaded(tbody);
        if (!allCoupons.length) {
            setTableState(tbody, 7, 'empty', 'Chưa có coupon nào. Dùng nút "Tạo coupon" để bắt đầu.');
            return;
        }
        tbody.innerHTML = allCoupons.map((coupon) => {
            const dateRange = [
                coupon.startsAt ? new Date(coupon.startsAt).toLocaleString('vi-VN') : '',
                coupon.expiresAt ? new Date(coupon.expiresAt).toLocaleString('vi-VN') : ''
            ].filter(Boolean).join(' – ') || 'Không giới hạn';
            const useLimit = coupon.maxUses === null
                ? `${coupon.usedCount} / Không giới hạn`
                : `${coupon.usedCount} / ${coupon.maxUses}`;
            return `
                <tr>
                    <td><strong>${escapeHtml(coupon.code)}</strong><br><small>${escapeHtml(coupon.label)}</small></td>
                    <td>${Number(coupon.rate * 100).toLocaleString('vi-VN')}%</td>
                    <td>${formatCurrency(coupon.minSubtotal)}</td>
                    <td>${useLimit}</td>
                    <td><small>${escapeHtml(dateRange)}</small></td>
                    <td><span class="status-badge ${coupon.enabled ? 'status-completed' : 'status-cancelled'}">${coupon.enabled ? 'Đang bật' : 'Đang tắt'}</span></td>
                    <td>
                        <div style="display: flex; gap: 0.4rem;">
                            <button class="btn-sm btn-edit edit-coupon-btn" data-code="${escapeHtml(coupon.code)}" type="button">Sửa</button>
                            <button class="btn-sm btn-delete toggle-coupon-btn" data-code="${escapeHtml(coupon.code)}" type="button">${coupon.enabled ? 'Tắt' : 'Bật'}</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.edit-coupon-btn').forEach((button) => {
            button.addEventListener('click', () => {
                const coupon = allCoupons.find((entry) => entry.code === button.dataset.code);
                if (!coupon) return;
                document.getElementById('couponModalTitle').textContent = `Sửa coupon ${coupon.code}`;
                couponForm.elements.code.value = coupon.code;
                couponForm.elements.code.disabled = true;
                couponForm.elements.label.value = coupon.label;
                couponForm.elements.rate.value = coupon.rate * 100;
                couponForm.elements.minSubtotal.value = coupon.minSubtotal;
                couponForm.elements.maxUses.value = coupon.maxUses ?? '';
                couponForm.elements.startsAt.value = coupon.startsAt
                    ? new Date(new Date(coupon.startsAt).getTime() - new Date(coupon.startsAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
                    : '';
                couponForm.elements.expiresAt.value = coupon.expiresAt
                    ? new Date(new Date(coupon.expiresAt).getTime() - new Date(coupon.expiresAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
                    : '';
                couponForm.elements.enabled.checked = coupon.enabled;
                couponModal.showModal();
            });
        });

        tbody.querySelectorAll('.toggle-coupon-btn').forEach((button) => {
            button.addEventListener('click', async () => {
                const coupon = allCoupons.find((entry) => entry.code === button.dataset.code);
                if (!coupon) return;
                await runWithBusyControl(button, 'Đang cập nhật...', async () => {
                    try {
                        const res = await apiFetch(`/api/admin/coupons/${encodeURIComponent(coupon.code)}`, {
                            method: 'PATCH',
                            headers: { 'If-Match': coupon.updatedAt || '' },
                            body: JSON.stringify({ enabled: !coupon.enabled })
                        });
                        const result = await res.json();
                        if (!res.ok) {
                            const error = new Error(result.error || adminLoadError('coupon', responseError(res)));
                            error.status = res.status;
                            throw error;
                        }
                        showToast(result.enabled ? 'Đã bật coupon.' : 'Đã tắt coupon.');
                        await loadCoupons();
                    } catch (error) {
                        showToast(error.status ? error.message : adminLoadError('coupon', error), 'error');
                    }
                });
            });
        });
    }

    document.getElementById('openAddCouponBtn')?.addEventListener('click', () => {
        couponForm.reset();
        couponForm.elements.code.disabled = false;
        couponForm.elements.maxUses.value = '';
        couponForm.elements.enabled.checked = true;
        document.getElementById('couponModalTitle').textContent = 'Tạo coupon mới';
        couponModal.showModal();
    });
    document.getElementById('closeCouponModal')?.addEventListener('click', () => couponModal.close());
    document.getElementById('cancelCouponModal')?.addEventListener('click', () => couponModal.close());

    couponForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        await runWithBusyControl(couponForm, 'Đang lưu...', async () => {
        const formData = new FormData(couponForm);
        const code = String(couponForm.elements.code.value || '').trim().toUpperCase();
        const existing = allCoupons.find((coupon) => coupon.code === code);
        const payload = {
            label: formData.get('label'),
            rate: Number(formData.get('rate')) / 100,
            minSubtotal: Number(formData.get('minSubtotal')),
            maxUses: Number(formData.get('maxUses')) || 0,
            startsAt: formData.get('startsAt') ? new Date(formData.get('startsAt')).toISOString() : '',
            expiresAt: formData.get('expiresAt') ? new Date(formData.get('expiresAt')).toISOString() : '',
            enabled: couponForm.elements.enabled.checked
        };
        try {
            const res = await apiFetch(
                existing
                    ? `/api/admin/coupons/${encodeURIComponent(code)}`
                    : '/api/admin/coupons',
                {
                    method: existing ? 'PUT' : 'POST',
                    headers: existing ? { 'If-Match': existing.updatedAt || '' } : {},
                    body: JSON.stringify(existing ? payload : { ...payload, code })
                }
            );
            const result = await res.json();
            if (!res.ok) {
                const error = new Error(result.error || adminLoadError('coupon', responseError(res)));
                error.status = res.status;
                throw error;
            }
            showToast(existing ? 'Đã cập nhật coupon.' : 'Đã tạo coupon.');
            couponModal.close();
            await loadCoupons();
        } catch (error) {
            showToast(error.status ? error.message : adminLoadError('coupon', error), 'error');
        }
        });
    });

    // --- VIEW: SERVICES ---
    async function loadServices() {
        const tbody = document.getElementById('servicesTableBody');
        setTableState(tbody, 9, 'loading', 'Đang tải yêu cầu dịch vụ...');
        try {
            const res = await apiFetch('/api/admin/services');
            if (!res.ok) throw responseError(res);
            allServices = await res.json();
            renderServices();
        } catch (error) {
            setTableState(tbody, 9, 'error', adminLoadError('yêu cầu dịch vụ', error), {
                label: 'Thử lại',
                run: () => loadServices()
            });
        }
    }

    function renderServices() {
        const tbody = document.getElementById('servicesTableBody');
        markTableLoaded(tbody);
        if (!allServices.length) {
            setTableState(tbody, 9, 'empty', 'Chưa có yêu cầu dịch vụ nào.');
            return;
        }

        tbody.innerHTML = allServices.map((req) => {
            const date = new Date(req.createdAt).toLocaleString('vi-VN');
            const svcName = serviceLabels[req.service] || req.service;
            return `
                <tr>
                    <td><code>${escapeHtml(req.id ? req.id.slice(0, 8) : '')}</code></td>
                    <td><small>${date}</small></td>
                    <td><span class="payment-badge" style="background: #fef3c7; color: #92400e;">${escapeHtml(svcName)}</span></td>
                    <td>
                        <b>${escapeHtml(req.bookTitle)}</b><br>
                        <small style="color: var(--text-muted);">Tình trạng: ${escapeHtml(req.condition)}</small>
                    </td>
                    <td><b>${escapeHtml(req.name)}</b></td>
                    <td>📞 ${escapeHtml(req.phone)}</td>
                    <td><small>${escapeHtml(req.note || 'Không có ghi chú')}</small></td>
                    <td><span class="status-badge status-${escapeHtml(req.status)}">${escapeHtml(req.status)}</span></td>
                    <td>
                        <select class="form-select service-status-select" data-id="${escapeHtml(req.id)}">
                            <option value="pending" ${req.status === 'pending' ? 'selected' : ''}>Đang chờ</option>
                            <option value="contacted" ${req.status === 'contacted' ? 'selected' : ''}>Đã liên hệ</option>
                            <option value="completed" ${req.status === 'completed' ? 'selected' : ''}>Hoàn tất</option>
                            <option value="cancelled" ${req.status === 'cancelled' ? 'selected' : ''}>Đã hủy</option>
                        </select>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.service-status-select').forEach((sel) => {
            sel.addEventListener('change', async (e) => {
                if (sel.dataset.busy === 'true') return;
                const id = e.target.dataset.id;
                const status = e.target.value;
                await runWithBusyControl(sel, null, async () => {
                    try {
                        const res = await apiFetch(`/api/admin/services/${encodeURIComponent(id)}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status })
                        });
                        if (!res.ok) throw responseError(res);
                        const service = allServices.find((entry) => entry.id === id);
                        if (service) service.status = status;
                        showToast('Đã cập nhật trạng thái yêu cầu dịch vụ.');
                    } catch (error) {
                        showToast(adminLoadError('trạng thái yêu cầu dịch vụ', error), 'error');
                    }
                });
                renderServices();
            });
        });
    }

    // --- VIEW: USERS ---
    async function loadUsers() {
        const usersBody = document.getElementById('usersTableBody');
        const staffBody = document.getElementById('staffTableBody');
        setTableState(usersBody, 8, 'loading', 'Đang tải danh sách người dùng...');
        setTableState(staffBody, 5, 'loading', 'Đang tải nhân viên...');
        try {
            const [usersResult, staffResult] = await Promise.allSettled([
                apiFetch('/api/admin/users'),
                apiFetch('/api/admin/staff')
            ]);
            if (usersResult.status === 'fulfilled' && usersResult.value.ok) {
                allUsers = await usersResult.value.json();
                renderUsers();
            } else {
                const error = usersResult.status === 'rejected'
                    ? usersResult.reason
                    : responseError(usersResult.value);
                setTableState(usersBody, 8, 'error', adminLoadError('người dùng', error), {
                    label: 'Thử lại',
                    run: () => loadUsers()
                });
            }
            if (staffResult.status === 'fulfilled' && staffResult.value.ok) {
                const data = await staffResult.value.json();
                allStaff = Array.isArray(data.staff) ? data.staff : [];
                staffRolePermissions = data.rolePermissions || {};
                renderStaff();
            } else {
                const error = staffResult.status === 'rejected'
                    ? staffResult.reason
                    : responseError(staffResult.value);
                setTableState(staffBody, 5, 'error', adminLoadError('nhân viên', error), {
                    label: 'Thử lại',
                    run: () => loadUsers()
                });
            }
        } catch (error) {
            setTableState(usersBody, 8, 'error', adminLoadError('người dùng', error), {
                label: 'Thử lại',
                run: () => loadUsers()
            });
            setTableState(staffBody, 5, 'error', adminLoadError('nhân viên', error), {
                label: 'Thử lại',
                run: () => loadUsers()
            });
        }
    }

    const permissionLabels = {
        'read:dashboard': 'Xem thống kê',
        'read:orders': 'Xem đơn hàng',
        'write:orders': 'Cập nhật đơn hàng',
        'read:services': 'Xem yêu cầu dịch vụ',
        'write:services': 'Cập nhật yêu cầu dịch vụ',
        'read:customers': 'Xem khách hàng',
        'write:customers': 'Quản lý khách hàng',
        'customer:view': 'Xem hồ sơ khách hàng',
        'customer:create': 'Tạo hồ sơ khách hàng',
        'customer:update': 'Cập nhật hồ sơ khách hàng',
        'customer:delete': 'Xóa hồ sơ khách hàng',
        'customer:interaction:view': 'Xem lịch sử chăm sóc',
        'customer:interaction:create': 'Ghi nhận chăm sóc',
        'customer:interaction:update': 'Cập nhật lịch sử chăm sóc',
        'customer:interaction:delete': 'Xóa lịch sử chăm sóc'
    };

    function renderStaff() {
        const tbody = document.getElementById('staffTableBody');
        markTableLoaded(tbody);
        if (!allStaff.length) {
            setTableState(tbody, 5, 'empty', 'Chưa có tài khoản nhân viên. Dùng biểu mẫu tạo nhân viên để bắt đầu.');
            return;
        }

        tbody.innerHTML = allStaff.map((staff) => {
            const active = staff.isActive !== false;
            const permissions = staffRolePermissions[staff.role] || [];
            const permissionMarkup = permissions.length
                ? permissions.map((permission) => `<span class="status-badge">${escapeHtml(permissionLabels[permission] || permission)}</span>`).join(' ')
                : 'Không có quyền nào.';
            return `
                <tr>
                    <td><b>${escapeHtml(staff.name)}</b><br><small>${escapeHtml(staff.email)}</small></td>
                    <td>
                        <select class="form-select staff-role-select" data-id="${escapeHtml(staff.id)}" aria-label="Vai trò nhân viên">
                            <option value="sales" ${staff.role === 'sales' ? 'selected' : ''}>Sales</option>
                            <option value="support" ${staff.role === 'support' ? 'selected' : ''}>Support</option>
                        </select>
                    </td>
                    <td>${permissionMarkup}</td>
                    <td><span class="status-badge ${active ? 'status-completed' : 'status-cancelled'}">${active ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}</span></td>
                    <td>
                        <div class="staff-actions">
                            <button class="btn-secondary staff-edit-button" data-id="${escapeHtml(staff.id)}" type="button">Sửa thông tin</button>
                            <button class="${active ? 'btn-danger' : 'btn-secondary'} staff-active-toggle" data-id="${escapeHtml(staff.id)}" data-active="${active}" type="button">${active ? 'Vô hiệu hóa' : 'Kích hoạt'}</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.staff-role-select').forEach((select) => {
            select.addEventListener('change', async (event) => {
                const staff = allStaff.find((entry) => entry.id === event.target.dataset.id);
                if (!staff || staff.role === event.target.value) return;
                await updateStaff(staff.id, { role: event.target.value }, 'Đã cập nhật vai trò nhân viên.', event.currentTarget);
            });
        });

        tbody.querySelectorAll('.staff-active-toggle').forEach((button) => {
            button.addEventListener('click', async () => {
                const active = button.dataset.active === 'true';
                const message = active
                    ? 'Vô hiệu hóa tài khoản này? Nhân viên sẽ bị đăng xuất và không thể đăng nhập.'
                    : 'Kích hoạt lại tài khoản nhân viên này?';
                if (!window.confirm(message)) return;
                await updateStaff(button.dataset.id, { isActive: !active }, active
                    ? 'Đã vô hiệu hóa và thu hồi phiên đăng nhập của nhân viên.'
                    : 'Đã kích hoạt tài khoản nhân viên.', button);
            });
        });

        tbody.querySelectorAll('.staff-edit-button').forEach((button) => {
            button.addEventListener('click', () => {
                const staff = allStaff.find((entry) => entry.id === button.dataset.id);
                if (!staff) return;
                const form = document.getElementById('staffEditForm');
                form.querySelector('[name="id"]').value = staff.id;
                form.elements.name.value = staff.name || '';
                form.elements.email.value = staff.email || '';
                document.getElementById('staffEditDialog').showModal();
            });
        });
    }

    async function updateStaff(id, changes, successMessage, control) {
        return runWithBusyControl(control, 'Đang cập nhật...', async () => {
            try {
                const response = await apiFetch(`/api/admin/staff/${encodeURIComponent(id)}`, {
                    method: 'PATCH',
                    body: JSON.stringify(changes)
                });
                if (!response.ok) {
                    const result = await response.json();
                    showToast(result.error || adminLoadError('nhân viên', responseError(response)), 'error');
                    await loadUsers();
                    return false;
                }
                showToast(successMessage);
                await loadUsers();
                return true;
            } catch (error) {
                showToast(adminLoadError('nhân viên', error), 'error');
                await loadUsers();
                return false;
            }
        });
    }

    const staffEditDialog = document.getElementById('staffEditDialog');
    const staffEditForm = document.getElementById('staffEditForm');
    document.getElementById('closeStaffEditDialog').addEventListener('click', () => staffEditDialog.close());
    document.getElementById('cancelStaffEditDialog').addEventListener('click', () => staffEditDialog.close());
    staffEditForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        await runWithBusyControl(staffEditForm, 'Đang lưu...', async () => {
            const formData = new FormData(staffEditForm);
            const id = formData.get('id');
            const saved = await updateStaff(id, {
                name: formData.get('name'),
                email: formData.get('email')
            }, 'Đã cập nhật thông tin nhân viên.');
            if (saved) staffEditDialog.close();
        });
    });

    document.getElementById('staffForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        await runWithBusyControl(form, 'Đang tạo...', async () => {
            const formData = new FormData(form);
            const staff = Object.fromEntries(formData.entries());
            try {
                const response = await apiFetch('/api/admin/staff', {
                    method: 'POST',
                    body: JSON.stringify(staff)
                });
                if (!response.ok) {
                    const result = await response.json();
                    showToast(result.error || adminLoadError('tài khoản nhân viên', responseError(response)), 'error');
                    return;
                }
                form.reset();
                showToast('Đã tạo tài khoản nhân viên.');
                await loadUsers();
            } catch (error) {
                showToast(adminLoadError('tài khoản nhân viên', error), 'error');
            }
        });
    });

    function renderUsers() {
        const tbody = document.getElementById('usersTableBody');
        markTableLoaded(tbody);
        if (!allUsers.length) {
            setTableState(tbody, 8, 'empty', 'Chưa có người dùng nào.');
            return;
        }

        tbody.innerHTML = allUsers.map((u) => {
            const date = u.createdAt ? new Date(u.createdAt).toLocaleDateString('vi-VN') : 'Mặc định';
            const verificationStatus = u.studentVerification?.status || 'pending';
            const verificationLabels = { pending: 'Chờ duyệt', verified: 'Đã duyệt', revoked: 'Đã thu hồi' };
            const verificationControl = u.role === 'user'
                ? `<select class="form-select student-verification-select" data-id="${escapeHtml(u.id)}">
                    ${Object.entries(verificationLabels).map(([status, label]) =>
                        `<option value="${status}" ${verificationStatus === status ? 'selected' : ''}>${label}</option>`).join('')}
                   </select>`
                : '<span>-</span>';
            return `
                <tr>
                    <td><code>${escapeHtml(u.id ? u.id.slice(0, 8) : '')}</code></td>
                    <td><b>${escapeHtml(u.name)}</b></td>
                    <td>${escapeHtml(u.email)}</td>
                    <td><span class="status-badge ${u.role === 'admin' ? 'status-completed' : 'status-processing'}">${escapeHtml(u.role)}</span></td>
                    <td>${escapeHtml(u.studentType === 'student' ? 'Học sinh' : u.studentType === 'university' ? 'Sinh viên' : 'Độc giả')}</td>
                    <td><code>${escapeHtml(u.studentId || '-')}</code></td>
                    <td>${verificationControl}</td>
                    <td><small>${date}</small></td>
                </tr>
            `;
        }).join('');
        tbody.querySelectorAll('.student-verification-select').forEach((select) => {
            select.addEventListener('change', async (event) => {
                const control = event.currentTarget;
                const user = allUsers.find((entry) => entry.id === control.dataset.id);
                if (!user || control.dataset.busy === 'true') return;
                const previousStatus = user.studentVerification?.status || 'pending';
                await runWithBusyControl(control, null, async () => {
                    try {
                        const response = await apiFetch(`/api/admin/users/${encodeURIComponent(control.dataset.id)}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ studentVerificationStatus: control.value })
                        });
                        if (!response.ok) throw responseError(response);
                        user.studentVerification = {
                            ...user.studentVerification,
                            status: control.value
                        };
                        showToast('Đã cập nhật trạng thái xác minh sinh viên.');
                    } catch (error) {
                        control.value = previousStatus;
                        showToast(adminLoadError('trạng thái xác minh sinh viên', error), 'error');
                    }
                });
            });
        });
    }

    // Initialize on page load
    checkAuth();
})();
