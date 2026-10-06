// BookNest Admin Panel Client Script
(function () {
    const TOKEN_KEY = 'booknest-admin-token';
    const AUTH_HEADER_KEY = 'Authorization';

    let currentAdmin = null;
    let allOrders = [];
    let allBooks = [];
    let allServices = [];
    let allUsers = [];

    // Helper: Toast Notifications
    function showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Helper: Format Currency VND
    function formatCurrency(amount) {
        return new Intl.NumberFormat('vi-VN').format(amount || 0) + ' đ';
    }

    // Helper: Escape HTML
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
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
    // Helper: Authenticated fetch
    async function apiFetch(url, options = {}) {
        const token = localStorage.getItem(TOKEN_KEY) || localStorage.getItem('booknest-auth-token');
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        if (token && token !== 'admin-session') {
            headers[AUTH_HEADER_KEY] = `Bearer ${token}`;
        }
        const response = await fetch(url, { ...options, headers, credentials: 'include' });
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
                if (user && (user.role === 'admin' || user.email === 'admin@booknest.vn')) {
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
        showLoginOverlay();
    }

    adminLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        adminLoginError.hidden = true;
        const formData = new FormData(adminLoginForm);
        const email = formData.get('email');
        const password = formData.get('password');

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (!res.ok) {
                adminLoginError.textContent = data.error || 'Đăng nhập không thành công.';
                adminLoginError.hidden = false;
                return;
            }

            const user = data.user;
            const isAdmin = user && (user.role === 'admin' || user.email === 'admin@booknest.vn');
            if (!isAdmin) {
                adminLoginError.textContent = 'Tài khoản này không có quyền quản trị viên.';
                adminLoginError.hidden = false;
                return;
            }

            const token = data.token || 'admin-session';
            localStorage.setItem(TOKEN_KEY, token);
            localStorage.setItem('booknest-auth-token', token);
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



    document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
        try {
            await apiFetch('/api/auth/logout', { method: 'POST' });
        } catch {}
        localStorage.removeItem(TOKEN_KEY);
        currentAdmin = null;
        showLoginOverlay();
        showToast('Đã đăng xuất.');
    });

    // Navigation & Views
    let activeView = 'dashboard';
    const navTabs = document.querySelectorAll('.nav-tab');
    const views = {
        dashboard: document.getElementById('viewDashboard'),
        orders: document.getElementById('viewOrders'),
        books: document.getElementById('viewBooks'),
        services: document.getElementById('viewServices'),
        users: document.getElementById('viewUsers')
    };

    navTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const targetView = tab.dataset.view;
            if (targetView && views[targetView]) {
                activeView = targetView;
                navTabs.forEach((t) => t.classList.toggle('active', t === tab));
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
        loadDashboard();
        showToast('Đã làm mới dữ liệu!');
    });

    function loadCurrentView() {
        if (activeView === 'dashboard') loadDashboard();
        else if (activeView === 'orders') loadOrders();
        else if (activeView === 'books') loadBooks();
        else if (activeView === 'services') loadServices();
        else if (activeView === 'users') loadUsers();
    }

    // --- VIEW: DASHBOARD ---
    async function loadDashboard() {
        try {
            const res = await apiFetch('/api/admin/stats');
            if (res.ok) {
                const stats = await res.json();
                document.getElementById('statRevenue').textContent = formatCurrency(stats.totalRevenue);
                document.getElementById('statOrders').textContent = stats.totalOrders;
                document.getElementById('statActiveOrders').textContent = `${stats.activeOrders || 0} đơn đang hoạt động`;
                document.getElementById('statBooks').textContent = stats.totalBooks;
                document.getElementById('statUsers').textContent = stats.totalUsers;
                document.getElementById('statServices').textContent = `${stats.totalServices || 0} yêu cầu dịch vụ`;

                renderRecentOrders(stats.recentOrders || []);
            }
        } catch (e) {
            console.error('Lỗi tải thống kê:', e);
        }
    }

    function renderRecentOrders(orders) {
        const tbody = document.getElementById('recentOrdersBody');
        if (!tbody) return;
        if (!orders.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">Chưa có đơn hàng nào được ghi nhận.</td></tr>';
            return;
        }

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
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">Đang tải đơn hàng...</td></tr>';
        try {
            const res = await apiFetch('/api/admin/orders');
            if (res.ok) {
                allOrders = await res.json();
                renderFilteredOrders();
            } else {
                tbody.innerHTML = '<tr><td colspan="9" class="text-center">Không thể tải đơn hàng.</td></tr>';
            }
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center">Lỗi kết nối máy chủ.</td></tr>';
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

        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center">Không tìm thấy đơn hàng phù hợp.</td></tr>';
            return;
        }

        tbody.innerHTML = filtered.map((order) => {
            const date = new Date(order.createdAt).toLocaleString('vi-VN');
            const itemsSummary = (order.items || [])
                .map((i) => `${escapeHtml(i.title)} (x${i.quantity})`)
                .join('<br>');

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
                            <option value="received" ${order.status === 'received' ? 'selected' : ''}>Mới nhận</option>
                            <option value="processing" ${order.status === 'processing' ? 'selected' : ''}>Đang xử lý</option>
                            <option value="shipping" ${order.status === 'shipping' ? 'selected' : ''}>Đang giao</option>
                            <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>Hoàn tất</option>
                            <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Đã huỷ</option>
                        </select>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach event listeners for status changes
        tbody.querySelectorAll('.order-status-select').forEach((select) => {
            select.addEventListener('change', async (e) => {
                const orderId = e.target.dataset.id;
                const newStatus = e.target.value;
                try {
                    const res = await apiFetch(`/api/admin/orders/${orderId}`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                            status: newStatus,
                            paymentStatus: newStatus === 'completed' ? 'paid' : undefined
                        })
                    });
                    if (res.ok) {
                        showToast(`Đã cập nhật trạng thái đơn sang "${newStatus}"`);
                        const order = allOrders.find((o) => o.orderId === orderId);
                        if (order) order.status = newStatus;
                        renderFilteredOrders();
                    } else {
                        showToast('Không thể cập nhật trạng thái đơn.', 'error');
                    }
                } catch (err) {
                    showToast('Lỗi mạng khi cập nhật.', 'error');
                }
            });
        });
    }

    document.getElementById('orderStatusFilter')?.addEventListener('change', renderFilteredOrders);
    document.getElementById('orderSearchInput')?.addEventListener('input', renderFilteredOrders);

    // --- VIEW: BOOKS ---
    const bookModal = document.getElementById('bookModal');
    const bookForm = document.getElementById('bookForm');

    async function loadBooks() {
        const tbody = document.getElementById('booksTableBody');
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">Đang tải danh mục sách...</td></tr>';
        try {
            const res = await apiFetch('/api/books');
            if (res.ok) {
                allBooks = await res.json();
                renderFilteredBooks();
            } else {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center">Không thể tải sách.</td></tr>';
            }
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center">Lỗi kết nối máy chủ.</td></tr>';
        }
    }

    function renderFilteredBooks() {
        const tbody = document.getElementById('booksTableBody');
        const catFilter = document.getElementById('bookCategoryFilter').value;
        const searchQuery = document.getElementById('bookSearchInput').value.trim().toLowerCase();

        const filtered = allBooks.filter((book) => {
            const matchCategory = catFilter === 'all' || book.category === catFilter;
            const matchSearch = !searchQuery ||
                (book.title && book.title.toLowerCase().includes(searchQuery)) ||
                (book.author && book.author.toLowerCase().includes(searchQuery));
            return matchCategory && matchSearch;
        });

        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center">Không tìm thấy sách nào.</td></tr>';
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
                            ${book.id ? `<button class="btn-sm btn-delete delete-book-btn" data-id="${escapeHtml(id)}" type="button">Xóa</button>` : ''}
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
                bookForm.elements['category'].value = book.category;
                bookForm.elements['price'].value = book.price;
                bookForm.elements['stock'].value = book.stock !== undefined ? book.stock : 12;
                bookForm.elements['cover'].value = book.cover || '';
                bookForm.elements['description'].value = book.description || '';
                bookModal.showModal();
            });
        });

        // Delete book handler
        tbody.querySelectorAll('.delete-book-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                if (!confirm('Bạn có chắc muốn xoá cuốn sách này khỏi kho?')) return;
                try {
                    const res = await apiFetch(`/api/admin/books/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    if (res.ok) {
                        showToast('Đã xoá sách thành công.');
                        loadBooks();
                    } else {
                        showToast('Không thể xoá sách.', 'error');
                    }
                } catch {
                    showToast('Lỗi mạng.', 'error');
                }
            });
        });
    }

    document.getElementById('bookCategoryFilter')?.addEventListener('change', renderFilteredBooks);
    document.getElementById('bookSearchInput')?.addEventListener('input', renderFilteredBooks);

    document.getElementById('openAddBookBtn')?.addEventListener('click', () => {
        document.getElementById('bookModalTitle').textContent = 'Thêm sách mới vào kho';
        bookForm.reset();
        document.getElementById('bookIdInput').value = '';
        bookModal.showModal();
    });

    document.getElementById('closeBookModal')?.addEventListener('click', () => bookModal.close());
    document.getElementById('cancelBookModal')?.addEventListener('click', () => bookModal.close());

    bookForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = new FormData(bookForm);
        const bookId = data.get('id');
        const payload = {
            title: data.get('title'),
            author: data.get('author'),
            category: data.get('category'),
            price: Number(data.get('price')),
            stock: Number(data.get('stock')),
            cover: data.get('cover'),
            description: data.get('description')
        };

        try {
            let res;
            if (bookId) {
                res = await apiFetch(`/api/admin/books/${encodeURIComponent(bookId)}`, {
                    method: 'PUT',
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

    // --- VIEW: SERVICES ---
    async function loadServices() {
        const tbody = document.getElementById('servicesTableBody');
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">Đang tải yêu cầu dịch vụ...</td></tr>';
        try {
            const res = await apiFetch('/api/admin/services');
            if (res.ok) {
                allServices = await res.json();
                renderServices();
            } else {
                tbody.innerHTML = '<tr><td colspan="9" class="text-center">Không thể tải danh sách dịch vụ.</td></tr>';
            }
        } catch {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center">Lỗi kết nối máy chủ.</td></tr>';
        }
    }

    function renderServices() {
        const tbody = document.getElementById('servicesTableBody');
        if (!allServices.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center">Chưa có yêu cầu dịch vụ nào.</td></tr>';
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
                const id = e.target.dataset.id;
                const status = e.target.value;
                try {
                    const res = await apiFetch(`/api/admin/services/${id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ status })
                    });
                    if (res.ok) {
                        showToast('Đã cập nhật trạng thái yêu cầu dịch vụ.');
                        const s = allServices.find((x) => x.id === id);
                        if (s) s.status = status;
                        renderServices();
                    }
                } catch {
                    showToast('Lỗi cập nhật.', 'error');
                }
            });
        });
    }

    // --- VIEW: USERS ---
    async function loadUsers() {
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Đang tải danh sách người dùng...</td></tr>';
        try {
            const res = await apiFetch('/api/admin/users');
            if (res.ok) {
                allUsers = await res.json();
                renderUsers();
            } else {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center">Không thể tải danh sách người dùng.</td></tr>';
            }
        } catch {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">Lỗi kết nối máy chủ.</td></tr>';
        }
    }

    function renderUsers() {
        const tbody = document.getElementById('usersTableBody');
        if (!allUsers.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">Chưa có người dùng nào.</td></tr>';
            return;
        }

        tbody.innerHTML = allUsers.map((u) => {
            const date = u.createdAt ? new Date(u.createdAt).toLocaleDateString('vi-VN') : 'Mặc định';
            return `
                <tr>
                    <td><code>${escapeHtml(u.id ? u.id.slice(0, 8) : '')}</code></td>
                    <td><b>${escapeHtml(u.name)}</b></td>
                    <td>${escapeHtml(u.email)}</td>
                    <td><span class="status-badge ${u.role === 'admin' ? 'status-completed' : 'status-processing'}">${escapeHtml(u.role)}</span></td>
                    <td>${escapeHtml(u.studentType === 'student' ? 'Học sinh' : u.studentType === 'university' ? 'Sinh viên' : 'Độc giả')}</td>
                    <td><code>${escapeHtml(u.studentId || '-')}</code></td>
                    <td><small>${date}</small></td>
                </tr>
            `;
        }).join('');
    }

    // Initialize on page load
    checkAuth();
})();

