const books = globalThis.BOOKNEST_BOOKS;

let categories = [
	{ value: 'van-hoc', label: 'Văn học' },
	{ value: 'ky-nang', label: 'Kỹ năng sống' },
	{ value: 'kinh-te', label: 'Kinh tế' },
	{ value: 'khoa-hoc', label: 'Khoa học' },
	{ value: 'lich-su', label: 'Lịch sử' },
	{ value: 'thieu-nhi', label: 'Thiếu nhi' },
	{ value: 'trinh-tham', label: 'Trinh thám' },
	{ value: 'tam-ly', label: 'Tâm lý' },
	{ value: 'cong-nghe', label: 'Công nghệ' },
	{ value: 'ngoai-ngu', label: 'Ngoại ngữ' }
];

const CART_STORAGE_KEY = 'booknest-cart';
const FAVORITES_STORAGE_KEY = 'booknest-favorites';
const COUPON_STORAGE_KEY = 'booknest-coupon';
const DEFAULT_BOOK_STOCK = 12;
let cartStorageError = '';
let cartStorageWritable = true;
const USERS_STORAGE_KEY = 'booknest-users';
const CURRENT_USER_STORAGE_KEY = 'booknest-current-user';
const SERVICE_REQUESTS_STORAGE_KEY = 'booknest-service-requests';
const CUSTOMER_INFO_STORAGE_KEY = 'booknest-customer-info';
const LAST_ORDER_ID_STORAGE_KEY = 'booknest-last-order-id';
let lastCreatedOrderId = '';
let lastCreatedOrderAccessCode = '';
let checkoutAccessCodeKey = '';
let checkoutAccessCode = '';
let paymentConfig = null;
let paymentConfigPromise = null;
let activeTransferOrder = null;
const firebaseConfig = window.BOOKNEST_FIREBASE_CONFIG;
const firebaseAuth = (() => {
	const requiredFields = ['apiKey', 'authDomain', 'projectId', 'appId'];
	if (!window.firebase || !firebaseConfig || requiredFields.some((field) => !firebaseConfig[field])) return null;
	try {
		if (!window.firebase.apps.length) window.firebase.initializeApp(firebaseConfig);
		return window.firebase.auth();
	} catch (error) {
		return null;
	}
})();
function generateOrderAccessCode() {
	if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
		throw new Error('Trình duyệt không thể tạo mã truy cập đơn hàng an toàn.');
	}
	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getCheckoutOrderAccessCode(idempotencyKey) {
	if (checkoutAccessCodeKey !== idempotencyKey) {
		checkoutAccessCodeKey = idempotencyKey;
		checkoutAccessCode = generateOrderAccessCode();
	}
	return checkoutAccessCode;
}
const serviceDetails = {
	rent: {
		title: 'Thuê sách theo nhu cầu',
		intro: 'Để lại thông tin, BookNest sẽ liên hệ xác nhận thời gian thuê và phí mượn.'
	},
	sell: {
		title: 'Gửi sách để BookNest thu mua',
		intro: 'BookNest sẽ đánh giá tình trạng sách và phản hồi mức giá dự kiến trong 1-2 ngày.'
	},
	exchange: {
		title: 'Đăng sách muốn trao đổi',
		intro: 'Chúng mình sẽ ghép bạn với những độc giả đang tìm cuốn sách này.'
	}
};

function loadCart() {
	let savedCart;
	try {
		const serializedCart = localStorage.getItem(CART_STORAGE_KEY);
		savedCart = serializedCart ? JSON.parse(serializedCart) : [];
	} catch (error) {
		cartStorageError = 'Không thể đọc giỏ hàng đã lưu trên thiết bị này.';
		cartStorageWritable = false;
		return [];
	}
	if (!Array.isArray(savedCart)) {
		cartStorageError = 'Dữ liệu giỏ hàng đã lưu không đúng định dạng.';
		cartStorageWritable = false;
		return [];
	}
	return savedCart.map((title) => books.find((book) => book.title === title)).filter(Boolean);
}

function loadCoupon() {
	try {
		return localStorage.getItem(COUPON_STORAGE_KEY) || '';
	} catch (error) {
		return '';
	}
}

function getBookStock(book) {
	return Number.isInteger(book.stock) && book.stock >= 0 ? book.stock : DEFAULT_BOOK_STOCK;
}

function loadCurrentUser() {
	try {
		return JSON.parse(sessionStorage.getItem(CURRENT_USER_STORAGE_KEY) || 'null');
	} catch (error) {
		return null;
	}
}

function loadCustomerInfo() {
	try {
		const saved = JSON.parse(sessionStorage.getItem(CUSTOMER_INFO_STORAGE_KEY) || '{}');
		return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
	} catch (error) {
		return {};
	}
}

function saveCustomerInfo(info) {
	try {
		sessionStorage.setItem(CUSTOMER_INFO_STORAGE_KEY, JSON.stringify(info));
	} catch (error) {
		throw new Error('Không thể lưu thông tin khách hàng trên thiết bị này.');
	}
}

const ACCOUNT_PROFILE_FIELDS = ['customerName', 'name', 'phone', 'address'];

function requestProfilePassword(message) {
	return new Promise((resolve) => {
		const dialog = document.createElement('dialog');
		dialog.className = 'account-dialog';
		dialog.setAttribute('aria-label', 'Xác nhận thay đổi thông tin cá nhân');
		const form = document.createElement('form');
		form.method = 'dialog';
		const text = document.createElement('p');
		text.textContent = message;
		const label = document.createElement('label');
		label.textContent = 'Mật khẩu hiện tại';
		const input = document.createElement('input');
		input.type = 'password';
		input.name = 'currentPassword';
		input.autocomplete = 'current-password';
		input.required = true;
		label.append(input);
		const confirmButton = document.createElement('button');
		confirmButton.type = 'submit';
		confirmButton.value = 'confirm';
		confirmButton.textContent = 'Xác nhận';
		const cancelButton = document.createElement('button');
		cancelButton.type = 'button';
		cancelButton.textContent = 'Bỏ qua';
		cancelButton.addEventListener('click', () => dialog.close(''));
		form.append(text, label, confirmButton, cancelButton);
		dialog.append(form);
		dialog.addEventListener('close', () => {
			const password = dialog.returnValue === 'confirm' ? input.value : '';
			dialog.remove();
			resolve(password);
		});
		document.body.append(dialog);
		dialog.showModal();
	});
}

async function saveCustomerInfoToAccount(info) {
	const token = window.booknestAuth.getToken();
	if (!token) return;
	const payload = {};
	for (const field of ACCOUNT_PROFILE_FIELDS) {
		if (typeof info?.[field] === 'string' && info[field].trim()) payload[field] = info[field].trim();
	}
	if (!Object.keys(payload).length) return;
	const send = (body) => window.booknestApiFetch('/api/auth/customer-info', {
		method: 'PATCH',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`
		},
		body: JSON.stringify(body)
	});
	let response = await send(payload);
	let result = await response.json().catch(() => ({}));
	if (response.status === 428 && result.code === 'REAUTH_REQUIRED') {
		const currentPassword = await requestProfilePassword(
			`${result.error} Đơn hàng hiện tại vẫn dùng số điện thoại bạn vừa nhập.`
		);
		if (!currentPassword) return;
		response = await send({ ...payload, currentPassword });
		result = await response.json().catch(() => ({}));
	}
	if (!response.ok) throw new Error(result.error || 'Không thể lưu thông tin vào tài khoản.');
	if (Array.isArray(result.changedFields) && result.changedFields.length) {
		window.booknestToast?.('Đã cập nhật thông tin cá nhân trong tài khoản.', 'success');
	}
}

function applyAccountCustomerInfo(user) {
	if (!user || !user.customerInfo) return;
	saveCustomerInfo({ ...loadCustomerInfo(), ...user.customerInfo });
}

async function hydrateAuthenticatedUser() {
	const token = window.booknestAuth.getToken();
	if (!token) return;
	try {
		const response = await window.booknestApiFetch('/api/auth/me', {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (response.status === 401) {
			window.booknestAuth.clearToken();
			sessionStorage.removeItem(CURRENT_USER_STORAGE_KEY);
			state.user = null;
			state.favorites = loadFavorites();
			renderAccount();
			renderBooks();
			if (typeof showToast === 'function') {
				showToast('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'warning');
			}
			return;
		}
		if (!response.ok) throw new Error('Không thể tải hồ sơ tài khoản.');
		const data = await response.json();
		if (!data.user) throw new Error('Máy chủ trả về hồ sơ tài khoản không hợp lệ.');
		state.user = data.user;
		applyAccountCustomerInfo(data.user);
		sessionStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(data.user));
		renderAccount();
		fillSavedCustomerInfo();
		void syncFavoritesFromServer().catch((error) =>
			showToast(error.message || 'Không thể đồng bộ sách yêu thích.', 'error')
		);
	} catch (error) {
		console.error('Không thể đồng bộ hồ sơ khách hàng:', error);
	}
}

window.addEventListener('booknest:auth-expired', () => {
	sessionStorage.removeItem(CURRENT_USER_STORAGE_KEY);
	state.user = null;
	state.favorites = loadFavorites();
	renderAccount();
	renderCart();
	renderBooks();
});

function fillSavedCustomerInfo() {
	const saved = loadCustomerInfo();
	const paymentForm = document.querySelector('#paymentForm');
	const serviceForm = document.querySelector('#serviceForm');
	if (paymentForm) {
		['customerName', 'phone', 'address'].forEach((field) => {
			if (saved[field]) paymentForm.elements[field].value = saved[field];
		});
	}
	if (serviceForm) {
		['name', 'phone'].forEach((field) => {
			if (saved[field]) serviceForm.elements[field].value = saved[field];
		});
	}
}

function loadFavorites() {
	try {
		const saved = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || '[]');
		return Array.isArray(saved) ? saved.filter((title) => books.some((book) => book.title === title)) : [];
	} catch (error) {
		return [];
	}
}

const state = { cart: loadCart(), user: loadCurrentUser(), favorites: loadFavorites(), coupon: loadCoupon() };

async function syncFavoritesFromServer() {
	const token = window.booknestAuth?.getToken?.();
	if (!token || typeof window.booknestApiFetch !== 'function') return;
	const response = await window.booknestApiFetch('/api/favorites', {
		headers: { Authorization: `Bearer ${token}` }
	});
	const result = await response.json();
	if (!response.ok || !Array.isArray(result.bookIds)) {
		throw new Error(result.error || 'Không thể đồng bộ sách yêu thích.');
	}
	state.favorites = result.bookIds
		.map((id) => books.find((book) => book.id === id)?.title)
		.filter(Boolean);
	localStorage.removeItem(FAVORITES_STORAGE_KEY);
	renderBooks();
}
let currentCatalogPage = 1;
const catalogPageSize = 12;

async function toggleFavorite(title) {
	const book = books.find((entry) => entry.title === title);
	const token = window.booknestAuth?.getToken?.();
	if (state.user && token && book?.id) {
		try {
			const removing = state.favorites.includes(title);
			const response = await window.booknestApiFetch('/api/favorites', {
				method: removing ? 'DELETE' : 'POST',
				headers: { Authorization: `Bearer ${token}` },
				body: JSON.stringify({ bookId: book.id })
			});
			const result = await response.json();
			if (!response.ok || !Array.isArray(result.bookIds)) {
				throw new Error(result.error || 'Không thể cập nhật sách yêu thích.');
			}
			state.favorites = result.bookIds
				.map((id) => books.find((entry) => entry.id === id)?.title)
				.filter(Boolean);
			renderBooks();
		} catch (error) {
			showToast(error.message || 'Không thể cập nhật sách yêu thích.', 'error');
		}
		return;
	}
	if (state.favorites.includes(title)) state.favorites = state.favorites.filter((item) => item !== title);
	else state.favorites.push(title);
	localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(state.favorites));
	renderBooks();
}
let cartQuoteVersion = 0;
let cartReturnFocus = null;
const bookGrid = document.querySelector('#bookGrid');
const searchInput = document.querySelector('#searchInput');
const categoryFilter = document.querySelector('#categoryFilter');
const priceFilter = document.querySelector('#priceFilter');
const tagFilter = document.querySelector('#tagFilter');
const sortFilter = document.querySelector('#sortFilter');
const favoritesFilter = document.querySelector('#favoritesFilter');
const resetFiltersBtn = document.querySelector('#resetFiltersBtn');
const catalogStatus = document.querySelector('#catalogStatus');
let showFavoritesOnly = false;
const hasCatalogShell = Boolean(bookGrid && searchInput && categoryFilter);

function setCatalogState(stateName, message, canRetry = false) {
	if (!catalogStatus) return;
	catalogStatus.replaceChildren();
	catalogStatus.dataset.state = stateName;
	catalogStatus.hidden = !message;
	catalogStatus.setAttribute('role', stateName === 'error' ? 'alert' : 'status');
	catalogStatus.setAttribute('aria-live', stateName === 'error' ? 'assertive' : 'polite');
	if (message) {
		const text = document.createElement('span');
		text.textContent = message;
		catalogStatus.appendChild(text);
	}
	if (canRetry) {
		const retryButton = document.createElement('button');
		retryButton.className = 'secondary-button catalog-retry';
		retryButton.type = 'button';
		retryButton.textContent = 'Thử lại';
		retryButton.addEventListener('click', () => { void hydrateCatalog(); });
		catalogStatus.appendChild(retryButton);
	}
}

function catalogErrorMessage(error) {
	const status = Number(error?.status || error?.response?.status);
	const message = String(error?.message || '');
	if (error?.name === 'AbortError' || status === 408 || status === 504 || /timeout|quá thời gian|không phản hồi/i.test(message)) {
		return 'Tải danh mục sách quá thời gian. Vui lòng thử lại.';
	}
	if (status === 401 || status === 403) {
		return 'Phiên đăng nhập hết hạn hoặc bạn không có quyền xem danh mục sách.';
	}
	if (status >= 500) return 'Máy chủ chưa thể tải danh mục sách. Vui lòng thử lại.';
	if (error instanceof TypeError || /kết nối|network|failed to fetch/i.test(message)) {
		return 'Không thể kết nối để tải danh mục sách. Kiểm tra mạng và thử lại.';
	}
	return 'Không thể tải danh mục sách. Vui lòng thử lại.';
}

async function hydrateCatalog() {
	if (!window.BOOKNEST_API_BASE_URL) {
		setCatalogState('static', 'Đang xem danh mục sách mẫu.');
		return;
	}
	setCatalogState('loading', 'Đang tải danh mục sách...');
	try {
		if (typeof window.booknestApiFetch !== 'function') throw new Error('API client chưa được khởi tạo.');
		const response = await window.booknestApiFetch('/api/books?page=1&limit=100&sort=popularity&order=desc');
		if (!response.ok) {
			const error = new Error('Không thể tải danh mục sách.');
			error.status = response.status;
			throw error;
		}
		const remoteBooks = await response.json();
		if (!Array.isArray(remoteBooks)) throw new Error('Danh mục sách trả về không hợp lệ.');
		const pagination = JSON.parse(response.headers.get('x-pagination') || '{}');
		const allRemoteBooks = [...remoteBooks];
		for (let page = 2; page <= Number(pagination.totalPages || 1); page += 1) {
			const pageResponse = await window.booknestApiFetch(`/api/books?page=${page}&limit=100&sort=popularity&order=desc`);
			if (!pageResponse.ok) {
				const error = new Error('Không thể tải đầy đủ danh mục sách.');
				error.status = pageResponse.status;
				throw error;
			}
			const pageBooks = await pageResponse.json();
			if (!Array.isArray(pageBooks)) throw new Error('Trang danh mục sách không hợp lệ.');
			allRemoteBooks.push(...pageBooks);
		}
		const categoryResponse = await window.booknestApiFetch('/api/categories');
		if (categoryResponse.ok) {
			const remoteCategories = await categoryResponse.json();
			if (Array.isArray(remoteCategories)) {
				categories = remoteCategories
					.filter((category) => category.status !== 'inactive')
					.map((category) => ({
						value: category.slug || category.value,
						label: category.label || category.name
					}))
					.filter((category) => category.value && category.label);
			}
		}
		const savedCartTitles = state.cart.map((book) => book.title);
		const validRemoteBooks = allRemoteBooks.filter((book) =>
			book && typeof book.title === 'string' && typeof book.author === 'string' &&
			Number.isFinite(Number(book.price))
		);
		books.splice(0, books.length, ...validRemoteBooks);
		state.cart = savedCartTitles
			.map((title) => books.find((book) => book.title === title))
			.filter(Boolean);
		if (window.booknestAuth?.getToken?.()) {
			try {
				await syncFavoritesFromServer();
			} catch (error) {
				showToast(error.message || 'Không thể đồng bộ sách yêu thích.', 'error');
			}
		}
		if (hasCatalogShell) {
			renderCategories();
			renderBooks();
		}
		renderCart();
		setCatalogState(
			validRemoteBooks.length ? 'ready' : 'empty',
			validRemoteBooks.length ? '' : 'Chưa có sách nào trong danh mục.'
		);
	} catch (error) {
		console.error('Không thể đồng bộ danh mục sách:', error);
		setCatalogState(
			'error',
			`${catalogErrorMessage(error)} Đang hiển thị danh mục sách mẫu.`,
			true
		);
	}
}

function removeVietnameseAccents(str) {
	return String(str || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/đ/g, 'd')
		.replace(/Đ/g, 'd');
}

const tagLabels = {
	bestseller: 'Bán chạy',
	featured: 'Nổi bật',
	sale: 'Ưu đãi',
	new: 'Mới'
};

function getBookTag(book) {
	return book.tag || 'featured';
}

function renderCategories() {
	if (!categoryFilter) return;
	categoryFilter.innerHTML = '<option value="all">Tất cả thể loại</option>' + categories.map((category) => `<option value="${escapeHtml(category.value)}">${escapeHtml(category.label)}</option>`).join('');
	const categoryList = document.querySelector('.category-list');
	if (categoryList) {
		categoryList.innerHTML = categories.map((category) => {
			const count = books.filter((book) => book.category === category.value).length;
			return `<button data-category="${escapeHtml(category.value)}" type="button"><span>${escapeHtml(category.label)}<small>${count} tựa sách</small></span><span>→</span></button>`;
		}).join('');
	}
	document.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => {
		if (!categoryFilter) return;
		categoryFilter.value = button.dataset.category;
		renderBooks();
		const booksSection = document.querySelector('#books');
		if (booksSection) booksSection.scrollIntoView({ behavior: 'smooth' });
	}));
}

function roundMoney(value) {
	const numericValue = Number(value);
	return Number.isFinite(numericValue) ? Math.round(numericValue) : 0;
}

function formatPrice(price) { return `${roundMoney(price).toLocaleString('vi-VN')} đ`; }

function getAiAnswer(question) {
	const normalized = question.toLowerCase();
	if (/(thuê|muon|mượn)/.test(normalized)) return 'Bạn có thể thuê sách theo tuần hoặc tháng. Hãy mở mục “Dịch vụ” ở cuối trang và chọn “Đăng ký thuê” để gửi tên sách và thông tin liên hệ.';
	if (/(thu mua|bán sách|ban sach)/.test(normalized)) return 'BookNest nhận thu mua sách đã qua sử dụng. Chọn “Bán sách cho BookNest” trong mục “Dịch vụ”; đội ngũ sẽ xem tình trạng và phản hồi mức giá dự kiến.';
	if (/(trao đổi|trao doi|đổi sách|doi sach)/.test(normalized)) return 'Bạn có thể đăng sách muốn trao đổi tại mục “Trao đổi sách”. Hãy ghi tên sách và cuốn bạn đang tìm để BookNest hỗ trợ ghép cặp.';
	if (/(học sinh|sinh viên|sinh vien|ưu đãi|giam|giảm)/.test(normalized)) return 'Tài khoản thông thường được giảm 5%. Học sinh và sinh viên được giảm 10% sau khi chọn đúng loại tài khoản và nhập mã học sinh/sinh viên.';
	if (/(hội viên|hoi vien|thẻ|the thanh vien|đăng ký|dang ky)/.test(normalized)) return 'Bạn mở nút “Đăng nhập” ở đầu trang, chọn “Đăng ký” để tạo tài khoản và nhận ưu đãi.';
	const category = categories.find((item) => normalized.includes(item.label.toLowerCase()) || normalized.includes(item.value));
	if (category) {
		const recommendations = books.filter((book) => book.category === category.value).slice(0, 3);
		return `Một vài gợi ý thuộc ${category.label}: ${recommendations.map((book) => `“${book.title}”`).join(', ')}. Bạn có thể xem thêm tại bộ sưu tập sách.`;
	}
	if (/(gợi ý|goi y|sách|sach|đọc gì|doc gi)/.test(normalized)) return 'Bạn có thể thử “Nhà giả kim”, “Mắt biếc” hoặc “Đi tìm lẽ sống”. Hãy cho mình biết thể loại bạn yêu thích để nhận gợi ý sát hơn nhé.';
	if (/(thanh toán|thanh toan|cod|chuyển khoản|chuyen khoan)/.test(normalized)) return 'BookNest hỗ trợ chuyển khoản qua mã QR và thanh toán khi nhận hàng (COD). Bạn chọn phương thức ở bước thanh toán trong giỏ hàng.';
	return 'Mình có thể hỗ trợ về gợi ý sách, thuê sách, thu mua, trao đổi, tài khoản và ưu đãi học sinh/sinh viên. Bạn thử hỏi cụ thể hơn nhé!';
}

function getBookImage(book) {
	if (Array.isArray(book.images) && book.images[0]?.url) return book.images[0].url;
	if (book.image) return book.image;
	if (book.cover && !/^cover-[1-5]$/.test(book.cover)) return book.cover;
	return `https://covers.openlibrary.org/b/title/${encodeURIComponent(book.title)}-L.jpg?default=false`;
}

function getResponsiveBookImage(book, size) {
	const uploadedVariants = book.images?.[0]?.variants;
	const uploadedVariant = size === 'S' ? uploadedVariants?.small : uploadedVariants?.medium;
	if (uploadedVariant) return uploadedVariant;
	const image = getBookImage(book);
	if (!image.startsWith('https://covers.openlibrary.org/')) return '';
	return image.replace(/-L\.jpg(?=\?|$)/i, `-${size}.jpg`);
}

function getBookPictureSources(book) {
	const small = getResponsiveBookImage(book, 'S');
	const medium = getResponsiveBookImage(book, 'M');
	if (small && medium && small !== medium) {
		return `<source media="(max-width: 500px)" srcset="${escapeHtml(small)}"><source media="(max-width: 1000px)" srcset="${escapeHtml(medium)}">`;
	}
	return medium
		? `<source media="(max-width: 800px)" srcset="${escapeHtml(medium)}">`
		: '';
}

function getBookCoverStyle(book) {
	return /^cover-[1-5]$/.test(book.cover || '') ? book.cover : 'cover-1';
}

function getBookDetailsUrl(book) {
	const params = new URLSearchParams({
		title: book.title,
		author: book.author,
		price: String(book.price),
		category: book.category,
		image: getBookImage(book)
	});
	return `book.html?${params.toString()}`;
}

function createFallbackCover(title, author) {
	const safeTitle = String(title).replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);
	const safeAuthor = String(author).replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);
	const wrapText = (text, limit) => text.split(' ').reduce((lines, word) => {
		const current = lines[lines.length - 1];
		if (current && `${current} ${word}`.length <= limit) lines[lines.length - 1] = `${current} ${word}`;
		else lines.push(word);
		return lines;
	}, []);
	const titleLines = wrapText(safeTitle, 20).map((line, index) => `<tspan x="70" dy="${index ? 54 : 0}">${line}</tspan>`).join('');
	const authorLines = wrapText(safeAuthor, 28).map((line, index) => `<tspan x="70" dy="${index ? 30 : 0}">${line}</tspan>`).join('');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><rect width="600" height="800" fill="#315c70"/><rect x="36" y="36" width="528" height="728" fill="none" stroke="#fffdf8" stroke-width="3"/><text x="70" y="250" fill="#fffdf8" font-family="Georgia,serif" font-size="42" font-weight="700">${titleLines}</text><text x="70" y="670" fill="#f7f3eb" font-family="Arial,sans-serif" font-size="22">${authorLines}</text></svg>`;
	return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function clearPaymentQr() {
	const paymentQr = document.querySelector('#paymentQr');
	const fallback = document.querySelector('#paymentQrFallback');
	const status = document.querySelector('#paymentQrStatus');
	window.BookNestVietQr.showPaymentQrWaiting(
		paymentQr,
		fallback,
		status,
		'QR chỉ được tạo sau khi đơn chuyển khoản được lưu thành công.'
	);
}

function updatePaymentBankDetails() {
	const bankDetails = document.querySelector('#paymentBankDetails');
	if (bankDetails) {
		bankDetails.querySelector('[data-payment-bank="name"]').textContent = paymentConfig.bankName;
		bankDetails.querySelector('[data-payment-bank="number"]').textContent = paymentConfig.accountNumber;
		bankDetails.querySelector('[data-payment-bank="holder"]').textContent = paymentConfig.accountName;
	}
}

function updatePaymentQr(order) {
	const paymentQr = document.querySelector('#paymentQr');
	if (!paymentQr || !paymentConfig) throw new Error('Chưa có cấu hình để tạo mã QR thanh toán.');
	const fallback = document.querySelector('#paymentQrFallback');
	const status = document.querySelector('#paymentQrStatus');
	window.BookNestVietQr.showPaymentQrWaiting(paymentQr, fallback, status, 'Đang tải mã QR thanh toán…');
	const imageUrl = window.BookNestVietQr.buildPaymentQrUrl(paymentConfig, order);
	const fallbackImageUrl = window.BookNestVietQr.buildPaymentQrUrl(paymentConfig, order, 'svg');
	window.BookNestVietQr.bindPaymentQrFallback(paymentQr, fallback, status, order, fallbackImageUrl);
	if (fallback) fallback.hidden = true;
	if (status) status.hidden = false;
	paymentQr.hidden = false;
	paymentQr.style.visibility = 'hidden';
	paymentQr.src = imageUrl;
}

async function loadPaymentConfig() {
	if (paymentConfig) return paymentConfig;
	if (!paymentConfigPromise) {
		paymentConfigPromise = window.booknestApiFetch('/api/payments/config')
			.then(async (response) => {
				const result = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(result.error || 'Thông tin tài khoản thanh toán chưa khả dụng.');
				}
				const normalizedConfig = window.BookNestVietQr.normalizePaymentConfig(result);
				paymentConfig = {
					...normalizedConfig,
					bankName: String(result.bankName || result.bankCode).trim()
				};
				updatePaymentBankDetails();
				return paymentConfig;
			})
			.catch((error) => {
				paymentConfigPromise = null;
				throw error;
			});
	}
	return paymentConfigPromise;
}

function escapeHtml(value) {
	return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function showPaymentError(message) {
	const error = document.querySelector('#paymentError');
	error.textContent = message;
	error.hidden = !message;
}

function resetPaymentConfirmation() {
	activeTransferOrder = null;
	clearPaymentQr();
	const confirmation = document.querySelector('#paymentConfirmation');
	if (confirmation) {
		confirmation.textContent = '';
		confirmation.hidden = true;
	}
	const form = document.querySelector('#paymentForm');
	form?.reset();
	const paymentMethods = form?.querySelector('.payment-methods');
	const shippingFields = form?.querySelector('.shipping-fields');
	if (paymentMethods) paymentMethods.hidden = false;
	if (shippingFields) shippingFields.hidden = false;
	const submitButton = form?.querySelector('[type="submit"]');
	if (submitButton) {
		submitButton.hidden = false;
		submitButton.disabled = false;
	}
	showPaymentError('');
	fillSavedCustomerInfo();
}

function renderBooks() {
	if (!bookGrid || !searchInput || !categoryFilter) return;
	const query = searchInput.value.trim().toLowerCase();
	const queryNorm = removeVietnameseAccents(query).toLowerCase();
	const category = categoryFilter.value;
	const priceRange = priceFilter?.value || 'all';
	const selectedTag = tagFilter?.value || 'all';

	let visibleBooks = books.filter((book) => {
		const titleAuthor = `${book.title} ${book.author}`;
		const searchableText = `${book.title} ${book.author} ${book.category} ${book.label || ''} ${book.isbn || ''}`;
		const searchableNorm = removeVietnameseAccents(searchableText).toLowerCase();
		const matchesQuery = !query ||
			titleAuthor.toLowerCase().includes(query) ||
			searchableNorm.includes(queryNorm);
		const matchesFavorite = !showFavoritesOnly || state.favorites.includes(book.title);
		const matchesCategory = category === 'all' || book.category === category;
		const matchesPrice = priceRange === 'all' ||
			(priceRange === 'under-100k' && book.price < 100000) ||
			(priceRange === '100k-200k' && book.price >= 100000 && book.price <= 200000) ||
			(priceRange === 'above-200k' && book.price > 200000);
		const bookTag = getBookTag(book);
		const matchesTag = selectedTag === 'all' || bookTag === selectedTag;

		return matchesQuery && matchesFavorite && matchesCategory && matchesPrice && matchesTag;
	});

	if (sortFilter?.value === 'price-asc') visibleBooks.sort((a, b) => a.price - b.price);
	if (sortFilter?.value === 'price-desc') visibleBooks.sort((a, b) => b.price - a.price);
	if (sortFilter?.value === 'title') visibleBooks.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
	if (sortFilter?.value === 'title-desc') visibleBooks.sort((a, b) => b.title.localeCompare(a.title, 'vi'));
	if (sortFilter?.value === 'newest') visibleBooks.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
	if (sortFilter?.value === 'popular') visibleBooks.sort((a, b) => Number(b.popularity || b.soldCount || 0) - Number(a.popularity || a.soldCount || 0));

	const totalVisible = visibleBooks.length;
	const hasActiveFilters = Boolean(
		query ||
		category !== 'all' ||
		priceRange !== 'all' ||
		selectedTag !== 'all' ||
		showFavoritesOnly ||
		(sortFilter?.value && sortFilter.value !== 'featured')
	);
	const totalPages = Math.max(1, Math.ceil(totalVisible / catalogPageSize));
	currentCatalogPage = Math.min(currentCatalogPage, totalPages);
	const visiblePage = visibleBooks.slice((currentCatalogPage - 1) * catalogPageSize, currentCatalogPage * catalogPageSize);
	bookGrid.innerHTML = visiblePage.map((book) => {
		const tag = getBookTag(book);
		const tagLabel = tagLabels[tag] || tag;
		const pictureSources = getBookPictureSources(book);
		return `
		<article class="book-card">
			<div class="cover ${getBookCoverStyle(book)} has-image">
				<span class="book-tag tag-${escapeHtml(tag)}">${escapeHtml(tagLabel)}</span>
				${pictureSources ? '<picture>' : ''}${pictureSources}<img class="cover-image" width="400" height="600" data-book-title="${escapeHtml(book.title)}" data-book-author="${escapeHtml(book.author)}" src="${escapeHtml(getBookImage(book))}" alt="Bìa sách ${escapeHtml(book.title)} - ${escapeHtml(book.author)}" loading="lazy" decoding="async">${pictureSources ? '</picture>' : ''}
				<span class="cover-label">${escapeHtml(book.label || book.title).replace('\n', '<br>')}</span>
			</div>
			<div class="book-info">
				<h3>${escapeHtml(book.title)}</h3><p class="author">${escapeHtml(book.author)}</p><p class="stock-status ${getBookStock(book) < 4 ? 'stock-low' : ''}">${getBookStock(book) ? `Còn ${getBookStock(book)} cuốn` : 'Tạm hết hàng'}</p>
				<div class="book-bottom"><span class="price">${formatPrice(book.price)}</span><a class="details-link" href="${getBookDetailsUrl(book)}">Chi tiết</a><button class="favorite-button ${state.favorites.includes(book.title) ? 'active' : ''}" data-favorite-title="${escapeHtml(book.title)}" type="button" aria-label="${state.favorites.includes(book.title) ? 'Bỏ yêu thích' : 'Thêm yêu thích'}">${state.favorites.includes(book.title) ? '♥' : '♡'}</button><button class="add-button" data-title="${escapeHtml(book.title)}" type="button" ${getBookStock(book) === 0 ? 'disabled' : ''}>${getBookStock(book) === 0 ? 'Hết hàng' : 'Thêm vào giỏ'}</button></div>
			</div>
		</article>`;
	}).join('');
	removeFailedImages(bookGrid);
	const emptyState = document.querySelector('#emptyState');
	const emptyStateMessage = document.querySelector('#emptyStateMessage');
	const emptyStateResetBtn = document.querySelector('#emptyStateResetBtn');
	const bookCount = document.querySelector('#bookCount');
	if (emptyState) emptyState.hidden = visibleBooks.length > 0;
	if (emptyStateMessage) {
		emptyStateMessage.textContent = showFavoritesOnly
			? 'Bạn chưa có sách nào trong danh sách yêu thích.'
			: 'Không tìm thấy cuốn sách phù hợp.';
	}
	if (emptyStateResetBtn) {
		emptyStateResetBtn.hidden = !hasActiveFilters;
		emptyStateResetBtn.textContent = showFavoritesOnly ? 'Bỏ lọc yêu thích' : 'Đặt lại bộ lọc';
	}
	if (bookCount) bookCount.textContent = totalVisible;
	const pagination = document.querySelector('#catalogPagination');
	const pageStatus = document.querySelector('#booksPageStatus');
	const previousPage = document.querySelector('#previousBooksPage');
	const nextPage = document.querySelector('#nextBooksPage');
	if (pagination) pagination.hidden = totalVisible <= catalogPageSize;
	if (pageStatus) pageStatus.textContent = `Trang ${currentCatalogPage} / ${totalPages}`;
	if (previousPage) previousPage.disabled = currentCatalogPage <= 1;
	if (nextPage) nextPage.disabled = currentCatalogPage >= totalPages;

	document.querySelectorAll('.season-card, .category-list button').forEach((btn) => {
		const isMatch = btn.dataset.category && btn.dataset.category === category;
		btn.classList.toggle('active', Boolean(isMatch));
		btn.setAttribute('aria-pressed', String(Boolean(isMatch)));
	});

	if (resetFiltersBtn) {
		resetFiltersBtn.hidden = !hasActiveFilters;
	}
}

function resetFilters() {
	currentCatalogPage = 1;
	if (searchInput) searchInput.value = '';
	if (categoryFilter) categoryFilter.value = 'all';
	if (priceFilter) priceFilter.value = 'all';
	if (tagFilter) tagFilter.value = 'all';
	if (sortFilter) sortFilter.value = 'featured';
	showFavoritesOnly = false;
	if (favoritesFilter) {
		favoritesFilter.setAttribute('aria-pressed', 'false');
		favoritesFilter.textContent = '♡ Yêu thích';
	}
	renderBooks();
}

function addToCart(title) {
	const book = books.find((item) => item.title === title);
	if (!book) return;
	const quantityInCart = state.cart.filter((item) => item.title === title).length;
	if (quantityInCart >= getBookStock(book)) return;
	state.cart.push(book);
	renderCart();
}

function getCartGroups() {
	return [...state.cart.reduce((groups, book) => {
		const existing = groups.get(book.title);
		if (existing) existing.quantity += 1;
		else groups.set(book.title, { book, quantity: 1 });
		return groups;
	}, new Map()).values()];
}

function changeCartQuantity(title, change) {
	const firstIndex = state.cart.findIndex((book) => book.title === title);
	if (firstIndex < 0 || !Number.isInteger(change) || !change) return;
	if (change > 0) {
		const book = state.cart[firstIndex];
		if (state.cart.filter((item) => item.title === title).length < getBookStock(book)) state.cart.push(book);
	} else {
		state.cart.splice(firstIndex, Math.min(Math.abs(change), state.cart.filter((book) => book.title === title).length));
	}
	renderCart();
}

function removeFailedImages(container) {
	container.querySelectorAll('img').forEach((image) => image.addEventListener('error', () => {
		if (!image.dataset.fallback) {
			image.dataset.fallback = 'true';
			image.closest('picture')?.querySelectorAll('source').forEach((source) => source.remove());
			image.src = createFallbackCover(image.dataset.bookTitle, image.dataset.bookAuthor);
			return;
		}
		image.parentElement.classList.remove('has-image');
		image.remove();
	}));
}

function renderCart() {
	if (cartStorageWritable) {
		try {
			localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart.map((book) => book.title)));
		} catch (error) {
			cartStorageError = 'Không thể lưu giỏ hàng trên thiết bị này.';
			cartStorageWritable = false;
		}
	}
	const storageStatus = document.querySelector('#cartStorageStatus');
	if (storageStatus) {
		storageStatus.dataset.state = cartStorageError ? 'error' : 'ready';
		storageStatus.textContent = cartStorageError;
		storageStatus.hidden = !cartStorageError;
	}
	const cartCount = document.querySelector('#cartCount');
	const quickCartSummary = document.querySelector('#quickCartSummary');
	const cartItems = document.querySelector('#cartItems');
	if (!cartItems) return;
	const cartGroups = getCartGroups();
	if (cartCount) cartCount.textContent = state.cart.length;
	if (quickCartSummary) quickCartSummary.textContent = state.cart.length ? `${state.cart.length} cuốn sách trong giỏ hàng` : 'Chưa có sách được chọn';
	setCartQuoteStatus(
		state.cart.length ? 'loading' : 'empty',
		state.cart.length ? 'Đang tính và xác minh giá...' : 'Giỏ hàng đang trống.'
	);
	cartItems.innerHTML = cartGroups.length ? cartGroups.map(({ book, quantity }) => {
		const pictureSources = getBookPictureSources(book);
		return `<div class="cart-item"><div class="mini-cover ${getBookCoverStyle(book)}">${pictureSources ? '<picture>' : ''}${pictureSources}<img data-book-title="${escapeHtml(book.title)}" data-book-author="${escapeHtml(book.author)}" src="${escapeHtml(getBookImage(book))}" alt="Bìa sách ${escapeHtml(book.title)} - ${escapeHtml(book.author)}" loading="lazy" decoding="async">${pictureSources ? '</picture>' : ''}</div><div class="cart-item-copy"><p>${escapeHtml(book.title)}</p><strong data-cart-price="${escapeHtml(book.title)}">${formatPrice(roundMoney(book.price) * quantity)}</strong><div class="quantity-control" aria-label="Số lượng ${escapeHtml(book.title)}"><button class="quantity-button" data-cart-title="${escapeHtml(book.title)}" data-cart-change="-1" type="button" aria-label="Giảm số lượng ${escapeHtml(book.title)}">−</button><span>${quantity}</span><button class="quantity-button" data-cart-title="${escapeHtml(book.title)}" data-cart-change="1" type="button" aria-label="Tăng số lượng ${escapeHtml(book.title)}">+</button><button class="remove-button" data-cart-title="${escapeHtml(book.title)}" data-cart-change="-${quantity}" type="button" aria-label="Xóa ${escapeHtml(book.title)} khỏi giỏ hàng">Xóa</button></div></div></div>`;
	}).join('') : '<p class="cart-empty">Giỏ hàng đang trống.</p>';

	removeFailedImages(cartItems);
	const checkoutButton = document.querySelector('#checkoutButton');
	const quoteVersion = ++cartQuoteVersion;
	if (state.cart.length) {
		document.querySelector('#cartSubtotal').textContent = 'Đang tính...';
		document.querySelector('#cartDiscount').textContent = 'Đang tính...';
		document.querySelector('#cartTotal').textContent = 'Đang tính...';
		document.querySelector('#paymentTotal').textContent = 'Đang tính...';
		document.querySelector('#discountLine').hidden = true;
		cartItems.querySelectorAll('[data-cart-price]').forEach((price) => {
			price.textContent = 'Đang tính...';
		});
		if (checkoutButton) checkoutButton.disabled = true;
		loadPaymentConfig().catch((error) => showPaymentError(error.message));
		refreshCartQuote(quoteVersion, cartGroups);
	} else {
		document.querySelector('#cartSubtotal').textContent = formatPrice(0);
		document.querySelector('#cartDiscount').textContent = `-${formatPrice(0)}`;
		document.querySelector('#cartTotal').textContent = formatPrice(0);
		document.querySelector('#paymentTotal').textContent = formatPrice(activeTransferOrder?.total || 0);
		document.querySelector('#discountLine').hidden = true;
		if (checkoutButton) checkoutButton.disabled = true;
		loadPaymentConfig().catch((error) => showPaymentError(error.message));
	}
	const couponInput = document.querySelector('#couponInput');
	if (couponInput && state.coupon) couponInput.value = state.coupon;
}

function setCartQuoteStatus(status, message, canRetry = false) {
	const quoteStatus = document.querySelector('#cartQuoteStatus');
	if (!quoteStatus) return;
	quoteStatus.replaceChildren();
	quoteStatus.dataset.state = status;
	quoteStatus.hidden = !message;
	if (message) quoteStatus.append(document.createTextNode(message));
	if (canRetry) {
		const retryButton = document.createElement('button');
		retryButton.className = 'cart-retry-button';
		retryButton.type = 'button';
		retryButton.textContent = 'Thử lại';
		retryButton.addEventListener('click', renderCart);
		quoteStatus.append(' ', retryButton);
	}
}

async function refreshCartQuote(version, cartGroups) {
	try {
		const headers = { 'Content-Type': 'application/json' };
		const token = window.booknestAuth.getToken();
		if (token) headers.Authorization = `Bearer ${token}`;
		const response = await window.booknestApiFetch('/api/orders/quote', {
			method: 'POST',
			headers,
			body: JSON.stringify({
				couponCode: state.coupon,
				items: cartGroups.map(({ book, quantity }) => ({
					title: book.title,
					quantity
				}))
			})
		});
		const quote = await response.json();
		if (!response.ok) throw new Error(quote.error || 'Không thể tính giá đơn hàng.');
		if (version !== cartQuoteVersion) return;
		document.querySelector('#cartSubtotal').textContent = formatPrice(quote.subtotal);
		document.querySelector('#cartDiscount').textContent = `-${formatPrice(quote.discount)}`;
		document.querySelector('#cartTotal').textContent = formatPrice(quote.total);
		document.querySelector('#paymentTotal').textContent = formatPrice(quote.total);
		document.querySelector('#discountLine').hidden = quote.discount === 0;
		document.querySelector('#discountLine span').textContent = quote.discountRate > 0.05
			? 'Ưu đãi học sinh / sinh viên'
			: quote.discountRate > 0 ? 'Ưu đãi tài khoản' : 'Mã ưu đãi';
		for (const item of quote.items) {
			const price = [...document.querySelectorAll('[data-cart-price]')]
				.find((element) => element.dataset.cartPrice === item.title);
			if (price) price.textContent = formatPrice(item.lineTotal);
		}
		await loadPaymentConfig();
		document.querySelector('#paymentTotal').dataset.amount = String(quote.total);
		const checkoutButton = document.querySelector('#checkoutButton');
		if (checkoutButton) checkoutButton.disabled = false;
		setCartQuoteStatus('ready', 'Giá và tồn kho đã được xác minh.');
	} catch (error) {
		if (version !== cartQuoteVersion) return;
		const message = error instanceof Error ? error.message : 'Không thể tính giá đơn hàng.';
		document.querySelector('#cartSubtotal').textContent = 'Không khả dụng';
		document.querySelector('#cartDiscount').textContent = 'Không khả dụng';
		document.querySelector('#cartTotal').textContent = 'Không khả dụng';
		document.querySelector('#paymentTotal').textContent = 'Không khả dụng';
		document.querySelector('#couponMessage').textContent = `Không thể tính giá: ${message}`;
		setCartQuoteStatus('error', `Không thể tính giá: ${message}`, true);
		console.error('Không thể tải báo giá giỏ hàng:', error);
	}
}

function toggleCart(open) {
	const cartPanel = document.querySelector('#cartPanel');
	const wasOpen = cartPanel.classList.contains('open');
	if (open && !wasOpen) cartReturnFocus = document.activeElement;
	cartPanel.classList.toggle('open', open);
	cartPanel.setAttribute('aria-hidden', String(!open));
	document.querySelector('#overlay').classList.toggle('visible', open);
	if (open) {
		document.querySelector('#closeCart').focus();
	} else if (wasOpen) {
		if (cartReturnFocus?.isConnected) cartReturnFocus.focus();
		cartReturnFocus = null;
	}
	if (open && typeof aiChat !== 'undefined' && aiChat.classList.contains('open')) {
		aiChat.classList.remove('open');
		aiChat.setAttribute('aria-hidden', 'true');
	}
}

document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape' && document.querySelector('#cartPanel')?.classList.contains('open')) {
		toggleCart(false);
	}
});

if (bookGrid) {
	bookGrid.addEventListener('click', (event) => {
		const button = event.target.closest('.add-button');
		if (button) addToCart(button.dataset.title);
		const favoriteButton = event.target.closest('[data-favorite-title]');
		if (favoriteButton) toggleFavorite(favoriteButton.dataset.favoriteTitle);
	});
}
const cartItems = document.querySelector('#cartItems');
if (cartItems) {
	document.querySelector('#cartItems').addEventListener('click', (event) => {
		const button = event.target.closest('[data-cart-change]');
		if (button) changeCartQuantity(button.dataset.cartTitle, Number(button.dataset.cartChange));
	});
}
const mobileNavToggle = document.querySelector('#mobileNavToggle');
const mainNavigation = document.querySelector('#mainNavigation');
if (mobileNavToggle && mainNavigation) {
	const setMobileNavigationOpen = (open, restoreFocus = false) => {
		mobileNavToggle.setAttribute('aria-expanded', String(open));
		mobileNavToggle.setAttribute('aria-label', open ? 'Đóng điều hướng' : 'Mở điều hướng');
		mainNavigation.classList.toggle('is-open', open);
		if (restoreFocus) mobileNavToggle.focus();
	};
	mobileNavToggle.addEventListener('click', () => {
		setMobileNavigationOpen(mobileNavToggle.getAttribute('aria-expanded') !== 'true');
	});
	mainNavigation.addEventListener('click', (event) => {
		if (event.target.closest('a')) setMobileNavigationOpen(false);
	});
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && mobileNavToggle.getAttribute('aria-expanded') === 'true') {
			setMobileNavigationOpen(false, true);
		}
	});
}

if (searchInput) searchInput.addEventListener('input', () => { currentCatalogPage = 1; renderBooks(); });
if (categoryFilter) categoryFilter.addEventListener('change', () => { currentCatalogPage = 1; renderBooks(); });
if (priceFilter) priceFilter.addEventListener('change', () => { currentCatalogPage = 1; renderBooks(); });
if (tagFilter) tagFilter.addEventListener('change', () => { currentCatalogPage = 1; renderBooks(); });
if (sortFilter) sortFilter.addEventListener('change', () => { currentCatalogPage = 1; renderBooks(); });
document.querySelector('#previousBooksPage')?.addEventListener('click', () => {
	if (currentCatalogPage > 1) {
		currentCatalogPage -= 1;
		renderBooks();
		document.querySelector('#books')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
});
document.querySelector('#nextBooksPage')?.addEventListener('click', () => {
	currentCatalogPage += 1;
	renderBooks();
	document.querySelector('#books')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
if (resetFiltersBtn) resetFiltersBtn.addEventListener('click', resetFilters);
document.querySelector('#emptyStateResetBtn')?.addEventListener('click', resetFilters);
if (favoritesFilter) favoritesFilter.addEventListener('click', () => {
	showFavoritesOnly = !showFavoritesOnly;
	favoritesFilter.setAttribute('aria-pressed', String(showFavoritesOnly));
	favoritesFilter.textContent = showFavoritesOnly ? '♥ Đang xem yêu thích' : '♡ Yêu thích';
	renderBooks();
});
document.querySelector('#applyCoupon')?.addEventListener('click', async () => {
	const input = document.querySelector('#couponInput');
	const message = document.querySelector('#couponMessage');
	const code = input.value.trim().toUpperCase();
	if (!code) { message.textContent = 'Vui lòng nhập mã ưu đãi.'; return; }
	try {
		const response = await window.booknestApiFetch(`/api/coupons/${encodeURIComponent(code)}`);
		const result = await response.json();
		if (!response.ok) throw new Error(result.error || 'Mã ưu đãi không hợp lệ.');
		state.coupon = code;
		localStorage.setItem(COUPON_STORAGE_KEY, code);
		const minimumMessage = result.minSubtotal > 0
			? ` Đơn hàng tối thiểu ${formatPrice(result.minSubtotal)}.`
			: '';
		message.textContent = `${result.label}: giảm ${result.rate * 100}%.${minimumMessage}`;
		renderCart();
	} catch (error) {
		state.coupon = '';
		localStorage.removeItem(COUPON_STORAGE_KEY);
		message.textContent = error.message;
	}
});
const cartButton = document.querySelector('#cartButton');
if (cartButton) cartButton.addEventListener('click', () => toggleCart(true));
document.querySelector('#quickCartButton')?.addEventListener('click', () => toggleCart(true));
document.querySelector('#closeCart')?.addEventListener('click', () => toggleCart(false));
document.querySelector('#overlay')?.addEventListener('click', () => toggleCart(false));
document.querySelector('#checkoutButton')?.addEventListener('click', () => {
	resetPaymentConfirmation();
	document.querySelector('#paymentDialog')?.showModal();
});
document.querySelector('#closePayment')?.addEventListener('click', () => document.querySelector('#paymentDialog')?.close());
document.querySelectorAll('input[name="paymentMethod"]').forEach((input) => input.addEventListener('change', () => {
	const transferDetails = document.querySelector('#transferDetails');
	const isTransfer = input.value === 'transfer' && input.checked;
	if (transferDetails) transferDetails.hidden = !isTransfer;
}));
document.querySelector('#paymentForm').addEventListener('submit', async (event) => {
	event.preventDefault();
	try {
		const form = event.currentTarget;
		const idempotencyKey = form.dataset.idempotencyKey || (
			typeof globalThis.crypto?.randomUUID === 'function'
				? globalThis.crypto.randomUUID()
				: `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`
		);
		form.dataset.idempotencyKey = idempotencyKey;
		showPaymentError('');
		if (!form.reportValidity()) return;
		if (!state.cart.length) throw new Error('Giỏ hàng đang trống.');
		const customerName = form.elements.customerName.value.trim();
		const address = form.elements.address.value.trim();
		const phone = form.elements.phone.value.trim();
		if (customerName.length < 2 || address.length < 10 || !/^[0-9 +()-]{8,}$/.test(phone)) {
			throw new Error('Vui lòng kiểm tra họ tên, số điện thoại và địa chỉ nhận hàng.');
		}
		const customerInfo = { ...loadCustomerInfo(), customerName, address, phone };
		saveCustomerInfo(customerInfo);
		const method = form.elements.paymentMethod.value;
		const submitButton = form.querySelector('[type="submit"]');
		const originalButtonText = submitButton.textContent;
		submitButton.disabled = true;
		submitButton.textContent = 'Đang lưu đơn hàng...';
		if (method === 'transfer') {
			window.BookNestVietQr.showPaymentQrWaiting(
				document.querySelector('#paymentQr'),
				document.querySelector('#paymentQrFallback'),
				document.querySelector('#paymentQrStatus'),
				'Đang lưu đơn hàng trước khi tạo mã QR thanh toán…'
			);
		}
		const items = [...state.cart.reduce((quantities, book) => {
			quantities.set(book.title, (quantities.get(book.title) || 0) + 1);
			return quantities;
		}, new Map())].map(([title, quantity]) => ({ title, quantity }));
		const headers = {
			'Content-Type': 'application/json',
			'Idempotency-Key': idempotencyKey
		};
		const token = window.booknestAuth.getToken();
		if (token) headers.Authorization = `Bearer ${token}`;
		const accessCode = token ? '' : getCheckoutOrderAccessCode(idempotencyKey);
		let result;
		try {
			const response = await window.booknestApiFetch('/api/orders', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					customerName,
					address,
					phone,
					paymentMethod: method,
					couponCode: state.coupon,
					...(accessCode ? { accessCode } : {}),
					items
				})
			});
			result = await response.json();
			if (!response.ok) throw new Error(result.error || 'Không thể lưu đơn hàng.');
			if (!result.orderId || !Number.isSafeInteger(result.total) || result.total <= 0) {
				throw new Error('Máy chủ trả về xác nhận đơn hàng không hợp lệ.');
			}
			if (method === 'transfer' &&
				(result.paymentMethod !== 'transfer' || !/^BN[A-F0-9]{12}$/.test(result.paymentCode || ''))) {
				throw new Error('Đơn chuyển khoản thiếu mã thanh toán hợp lệ.');
			}
		lastCreatedOrderId = result.orderId;
		lastCreatedOrderAccessCode = accessCode;
		try {
			sessionStorage.setItem(LAST_ORDER_ID_STORAGE_KEY, result.orderId);
		} catch (storageError) {
			console.warn('Không thể lưu mã đơn để tra cứu nhanh:', storageError);
		}
			try {
				await saveCustomerInfoToAccount(customerInfo);
			} catch (profileError) {
				console.error('Không thể đồng bộ thông tin khách hàng:', profileError);
			}
		} catch (error) {
			throw new Error(error instanceof TypeError
				? 'Không thể kết nối máy chủ. Đơn hàng chưa được lưu; giỏ hàng vẫn được giữ lại.'
				: error.message);
		} finally {
			submitButton.disabled = false;
			submitButton.textContent = originalButtonText;
		}

		if (method === 'transfer') {
			updatePaymentQr(result);
			activeTransferOrder = result;
			const confirmation = document.querySelector('#paymentConfirmation');
			confirmation.textContent = `Đơn hàng ${result.orderId} đã được lưu. Mã chuyển khoản: ${result.paymentCode}.${accessCode ? ` Mã truy cập đơn khách (chỉ hiển thị lần này): ${accessCode}.` : ''} Vui lòng quét QR để thanh toán đúng số tiền.`;
			confirmation.hidden = false;
			form.querySelector('.payment-methods').hidden = true;
			form.querySelector('.shipping-fields').hidden = true;
			form.querySelector('[type="submit"]').hidden = true;
			document.querySelector('#paymentTotal').textContent = formatPrice(result.total);
			document.querySelector('#paymentTotal').dataset.amount = String(result.total);
		}
		const message = method === 'cod'
			? `Đơn hàng COD đã được lưu thành công. Mã đơn hàng: ${result.orderId}. Tổng tiền ${formatPrice(result.total)} sẽ được giao đến địa chỉ bạn đã cung cấp.`
			: `Đơn hàng đã được lưu thành công. Mã đơn hàng: ${result.orderId}. Vui lòng hoàn tất chuyển khoản ${formatPrice(result.total)} để xử lý đơn hàng.`;
		window.booknestToast?.(message, method === 'cod' ? 'success' : 'info', {
			title: method === 'cod' ? 'Đặt hàng thành công!' : 'Đã tạo đơn, đang chờ thanh toán',
			details: [
				{ label: 'Mã đơn', value: result.orderId },
				{ label: 'Tổng tiền', value: formatPrice(result.total) },
				...(accessCode ? [{ label: 'Mã truy cập đơn khách', value: accessCode }] : [])
			],
			duration: method === 'cod' ? 5000 : 6000,
			action: { label: 'Tra cứu đơn', onClick: () => openOrderTracker(result.orderId) }
		});
		state.cart = [];
		document.querySelector('#transferDetails').hidden = false;
		delete form.dataset.idempotencyKey;
		toggleCart(false);
		renderCart();
		if (method === 'cod') {
			form.reset();
			fillSavedCustomerInfo();
			document.querySelector('#paymentDialog').close();
		}
	} catch (error) {
		window.BookNestVietQr.showPaymentQrWaiting(
			document.querySelector('#paymentQr'),
			document.querySelector('#paymentQrFallback'),
			document.querySelector('#paymentQrStatus'),
			'Chưa có mã QR. Mã chỉ xuất hiện sau khi backend xác nhận đơn chuyển khoản.'
		);
		showPaymentError(error instanceof Error ? error.message : 'Không thể xử lý đơn hàng. Vui lòng thử lại.');
	}
});
const serviceDialog = document.querySelector('#serviceDialog');
const serviceForm = document.querySelector('#serviceForm');
const serviceError = document.querySelector('#serviceError');

function showServiceError(message) {
	serviceError.textContent = message;
	serviceError.hidden = !message;
}

document.querySelectorAll('.service-button').forEach((button) => button.addEventListener('click', () => {
	const service = serviceDetails[button.dataset.service];
	if (!service) return;
	document.querySelector('#serviceDialogTitle').textContent = service.title;
	document.querySelector('#serviceDialogIntro').textContent = service.intro;
	document.querySelector('#serviceType').value = button.dataset.service;
	showServiceError('');
	serviceDialog.showModal();
}));
document.querySelector('#closeService').addEventListener('click', () => serviceDialog.close());
serviceForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	try {
		showServiceError('');
		if (!serviceForm.reportValidity()) return;
		const data = new FormData(serviceForm);
		const request = {
			service: data.get('serviceType'),
			bookTitle: String(data.get('bookTitle')).trim(),
			condition: data.get('condition'),
			name: String(data.get('name')).trim(),
			phone: String(data.get('phone')).trim(),
			note: String(data.get('note')).trim(),
			createdAt: new Date().toISOString()
		};
		if (!serviceDetails[request.service] || request.bookTitle.length < 2 || request.name.length < 2) {
			throw new Error('Vui lòng kiểm tra lại thông tin đăng ký.');
		}
		const customerInfo = { ...loadCustomerInfo(), name: request.name, phone: request.phone };
		saveCustomerInfo(customerInfo);
		const savedRequests = JSON.parse(localStorage.getItem(SERVICE_REQUESTS_STORAGE_KEY) || '[]');
		if (!Array.isArray(savedRequests)) throw new Error('Không thể lưu yêu cầu lúc này.');
		savedRequests.push(request);
		localStorage.setItem(SERVICE_REQUESTS_STORAGE_KEY, JSON.stringify(savedRequests));
		const submitButton = serviceForm.querySelector('[type="submit"]');
		submitButton.disabled = true;
		try {
			const response = await window.booknestApiFetch('/api/services', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(request)
			});
			const result = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(result.error || 'Không thể gửi yêu cầu đến máy chủ. Vui lòng thử lại.');
		} finally {
			submitButton.disabled = false;
		}
		try {
			await saveCustomerInfoToAccount(customerInfo);
		} catch (profileError) {
			console.error('Không thể đồng bộ thông tin khách hàng:', profileError);
		}
		window.booknestToast?.(`Đã nhận yêu cầu ${serviceDetails[request.service].title.toLowerCase()} của ${request.name}. BookNest sẽ sớm liên hệ!`);
		serviceForm.reset();
		fillSavedCustomerInfo();
		serviceDialog.close();
	} catch (error) {
		showServiceError(error instanceof Error ? error.message : 'Không thể gửi yêu cầu. Vui lòng thử lại.');
	}
});
const accountDialog = document.querySelector('#accountDialog');
const accountButton = document.querySelector('#accountButton');
const trackOrderDialog = document.querySelector('#trackOrderDialog');
const accountViews = {
	login: document.querySelector('#loginForm'),
	register: document.querySelector('#registerForm'),
	'reset-request': document.querySelector('#passwordResetRequestForm'),
	'reset-confirm': document.querySelector('#passwordResetConfirmForm'),
	'change-password': document.querySelector('#changePasswordForm'),
	social: document.querySelector('#socialAuthForm')
};

function readUsers() {
	try {
		const users = JSON.parse(localStorage.getItem(USERS_STORAGE_KEY) || '[]');
		return Array.isArray(users) ? users : [];
	} catch (error) {
		return [];
	}
}

function setAccountView(view) {
	Object.entries(accountViews).forEach(([name, form]) => {
		if (form) form.hidden = name !== view;
	});
	const isAccountTabView = view === 'login' || view === 'register';
	document.querySelector('.account-tabs').hidden = !isAccountTabView;
	document.querySelectorAll('.account-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.accountView === view));
	if (view === 'social') {
		const prov = document.querySelector('#socialCustomProvider')?.value || 'google.com';
		document.querySelector('#accountTitle').textContent = prov.includes('facebook')
			? 'Đăng nhập Facebook'
			: 'Đăng nhập Google';
	} else if (view === 'change-password') {
		document.querySelector('#accountTitle').textContent = 'Đổi mật khẩu';
	} else if (isAccountTabView) {
		document.querySelector('#accountTitle').textContent = 'Tài khoản BookNest';
	} else {
		document.querySelector('#accountTitle').textContent = 'Khôi phục mật khẩu';
	}
}

function renderAccount() {
	const logoutButton = document.querySelector('#logoutButton');
	const logoutAllButton = document.querySelector('#logoutAllButton');
	const changePasswordNavButton = document.querySelector('#changePasswordNavButton');
	const myOrdersButton = document.querySelector('#myOrdersButton');
	if (state.user) {
		accountButton.textContent = state.user.name;
		if (logoutButton) logoutButton.hidden = false;
		if (logoutAllButton) logoutAllButton.hidden = false;
		if (changePasswordNavButton) changePasswordNavButton.hidden = false;
	} else {
		accountButton.textContent = 'Đăng nhập';
		if (logoutButton) logoutButton.hidden = true;
		if (logoutAllButton) logoutAllButton.hidden = true;
		if (changePasswordNavButton) changePasswordNavButton.hidden = true;
	}
	if (myOrdersButton) myOrdersButton.hidden = !state.user;
}

function showAccountError(id, message) {
	const error = document.querySelector(id);
	error.textContent = message;
	error.hidden = !message;
}

async function saveFederatedAccount(socialUser) {
	const idToken = socialUser.idToken ||
		(typeof socialUser.getIdToken === 'function' ? await socialUser.getIdToken() : '');
	if (!idToken) throw new Error('Không thể xác minh tài khoản social. Vui lòng thử lại.');
	const email = String(socialUser.email || '').trim().toLowerCase();
	const name = String(socialUser.displayName || socialUser.name || (email ? email.split('@')[0] : 'Thành viên BookNest')).trim();
	const provider = socialUser.providerData?.[0]?.providerId || socialUser.authProvider || socialUser.provider || 'google.com';
	const providerId = socialUser.uid || socialUser.providerId || '';
	const isFirebaseSession = Boolean(socialUser.providerData && socialUser.uid);

	const previousUser = state.user?.email === email ? state.user : null;
	let user = {
		id: socialUser.id || providerId,
		name,
		email,
		role: socialUser.role || 'user',
		authProvider: provider,
		providerId,
		isFirebaseSession,
		studentType: previousUser?.studentType || socialUser.studentType || 'other',
		studentId: previousUser?.studentId || socialUser.studentId || '',
		customerInfo: socialUser.customerInfo || {}
	};

	try {
		const response = await window.booknestApiFetch('/api/auth/social', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${idToken}`
			},
			body: JSON.stringify({
				idToken
			})
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(data.error || 'Không thể xác minh tài khoản social.');
		if (data.token) window.booknestAuth.setToken(data.token, data.expiresAt);
		if (data.user) user = { ...user, ...data.user };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Không thể xác minh tài khoản social.';
		showAccountError('#socialCustomError', message);
		return;
	}

	state.user = user;
	applyAccountCustomerInfo(user);
	sessionStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user));
	renderAccount();
	renderCart();
	setAccountView('login');
	if (!new URLSearchParams(window.location.hash.slice(1)).has('resetToken')) {
		accountDialog.close();
	}
}

function getSocialAuthError(error) {
	if (error.code === 'auth/popup-closed-by-user') return 'Cửa sổ đăng nhập đã được đóng.';
	if (error.code === 'auth/unauthorized-domain') return 'Domain này chưa được cho phép trong Firebase Authentication.';
	if (error.code === 'auth/operation-not-allowed') return 'Phương thức đăng nhập này chưa được bật trong Firebase.';
	if (error.code === 'auth/account-exists-with-different-credential') return 'Email này đã được đăng ký bằng một phương thức khác.';
	return 'Không thể đăng nhập lúc này. Vui lòng thử lại.';
}

accountButton.addEventListener('click', () => {
	renderAccount();
	if (state.user) {
		const msg = document.querySelector('#loginMessage');
		msg.textContent = `Bạn đang đăng nhập với tài khoản: ${state.user.name} (${state.user.email})`;
		msg.hidden = false;
	} else {
		document.querySelector('#loginMessage').hidden = true;
	}
	setAccountView('login');
	accountDialog.showModal();
});
document.querySelector('#closeAccount').addEventListener('click', () => accountDialog.close());
document.querySelectorAll('.account-tab').forEach((tab) => tab.addEventListener('click', () => setAccountView(tab.dataset.accountView)));
document.querySelector('#forgotPasswordButton').addEventListener('click', () => {
	const loginEmail = document.querySelector('#loginForm [name="email"]').value.trim();
	const resetEmail = document.querySelector('#passwordResetRequestForm [name="email"]');
	resetEmail.value = loginEmail;
	document.querySelector('#passwordResetRequestError').hidden = true;
	document.querySelector('#passwordResetRequestMessage').hidden = true;
	setAccountView('reset-request');
	resetEmail.focus();
});
document.querySelectorAll('[data-account-back="login"]').forEach((button) => button.addEventListener('click', () => {
	setAccountView('login');
}));
document.querySelector('#passwordResetRequestForm').addEventListener('submit', async (event) => {
	event.preventDefault();
	const form = event.currentTarget;
	if (!form.reportValidity()) return;
	const submitButton = form.querySelector('[type="submit"]');
	const error = document.querySelector('#passwordResetRequestError');
	const message = document.querySelector('#passwordResetRequestMessage');
	error.hidden = true;
	message.hidden = true;
	submitButton.disabled = true;
	try {
		const response = await window.booknestApiFetch('/api/auth/password-reset', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: String(new FormData(form).get('email') || '').trim().toLowerCase() })
		});
		const result = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(result.error || 'Không thể gửi email khôi phục. Vui lòng thử lại.');
		message.textContent = result.message;
		message.hidden = false;
	} catch (errorValue) {
		showAccountError('#passwordResetRequestError', errorValue instanceof Error ? errorValue.message : 'Không thể gửi email khôi phục. Vui lòng thử lại.');
	} finally {
		submitButton.disabled = false;
	}
});
document.querySelector('#passwordResetConfirmForm').addEventListener('submit', async (event) => {
	event.preventDefault();
	const form = event.currentTarget;
	if (!form.reportValidity()) return;
	const formData = new FormData(form);
	const password = String(formData.get('password') || '');
	if (password !== String(formData.get('confirmPassword') || '')) {
		showAccountError('#passwordResetConfirmError', 'Mật khẩu nhập lại không khớp.');
		return;
	}
	if (password.length < 12 || password.length > 128 || !password.trim()) {
		showAccountError('#passwordResetConfirmError', 'Mật khẩu mới phải có từ 12 đến 128 ký tự và không được chỉ chứa khoảng trắng.');
		return;
	}
	const submitButton = form.querySelector('[type="submit"]');
	showAccountError('#passwordResetConfirmError', '');
	submitButton.disabled = true;
	try {
		const response = await window.booknestApiFetch('/api/auth/password-reset/confirm', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				token: String(formData.get('token') || ''),
				password
			})
		});
		const result = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(result.error || 'Không thể cập nhật mật khẩu. Vui lòng thử lại.');
		form.reset();
		const cleanUrl = new URL(window.location.href);
		cleanUrl.hash = '';
		window.history.replaceState(null, '', `${cleanUrl.pathname}${cleanUrl.search}`);
		document.querySelector('#loginMessage').textContent = 'Mật khẩu đã được cập nhật. Bạn có thể đăng nhập bằng mật khẩu mới.';
		document.querySelector('#loginMessage').hidden = false;
		setAccountView('login');
	} catch (errorValue) {
		showAccountError('#passwordResetConfirmError', errorValue instanceof Error ? errorValue.message : 'Không thể cập nhật mật khẩu. Vui lòng thử lại.');
	} finally {
		submitButton.disabled = false;
	}
});
const resetTokenFromUrl = new URLSearchParams(window.location.hash.slice(1)).get('resetToken');
if (resetTokenFromUrl) {
	document.querySelector('#passwordResetConfirmForm [name="token"]').value = resetTokenFromUrl;
	setAccountView('reset-confirm');
	accountDialog.showModal();
}
document.querySelector('#registerForm select[name="studentType"]').addEventListener('change', (event) => {
	document.querySelector('.student-id-field').hidden = event.target.value === 'other';
});
async function signInWithFirebase(provider) {
	if (!firebaseAuth || !window.firebase?.auth) {
		throw new Error('Đăng nhập social chưa được cấu hình.');
	}
	const providerObject = provider === 'facebook.com'
		? new window.firebase.auth.FacebookAuthProvider()
		: new window.firebase.auth.GoogleAuthProvider();
	return firebaseAuth.signInWithPopup(providerObject);
}

function openSocialAuthModal(provider) {
	const isGoogle = provider === 'google' || provider === 'google.com';
	const titleEl = document.querySelector('#socialAuthTitle');
	const descEl = document.querySelector('#socialModalDesc');
	const provText = document.querySelector('#socialCustomProviderText');
	const provInput = document.querySelector('#socialCustomProvider');
	const emailInput = document.querySelector('#socialCustomEmail');
	const submitBtn = document.querySelector('#socialCustomSubmitBtn');
	const errEl = document.querySelector('#socialCustomError');
	const headerMark = document.querySelector('#socialHeaderMark');

	if (headerMark) {
		headerMark.textContent = isGoogle ? 'G' : 'f';
		headerMark.className = isGoogle ? 'social-mark google-mark' : 'social-mark facebook-mark';
	}
	if (titleEl) titleEl.textContent = isGoogle ? 'Đăng nhập nhanh với Google' : 'Đăng nhập nhanh với Facebook';
	if (descEl) {
		descEl.textContent = isGoogle
			? 'Chọn tài khoản Google được đề xuất hoặc nhập email Google của bạn:'
			: 'Chọn tài khoản Facebook được đề xuất hoặc nhập email Facebook của bạn:';
	}
	if (provText) provText.textContent = isGoogle ? '(Google / Gmail)' : '(Facebook)';
	if (provInput) provInput.value = isGoogle ? 'google.com' : 'facebook.com';
	if (emailInput) {
		emailInput.placeholder = isGoogle ? 'tenban@gmail.com' : 'tenban@facebook.com';
		emailInput.value = '';
	}
	if (submitBtn) submitBtn.textContent = isGoogle ? 'Đăng nhập với Google' : 'Đăng nhập với Facebook';
	if (errEl) errEl.hidden = true;

	document.querySelectorAll('.social-quick-card').forEach((card) => {
		const cardProvider = card.dataset.provider || 'google.com';
		const isMatch = isGoogle ? cardProvider.includes('google') : cardProvider.includes('facebook');
		card.style.display = isMatch ? 'flex' : 'none';
	});

	setAccountView('social');
}

document.querySelectorAll('.social-quick-card').forEach((card) => {
	card.addEventListener('click', async () => {
		const provider = card.dataset.provider || 'google.com';
		try {
			await signInWithFirebase(provider);
		} catch (error) {
			showAccountError('#socialCustomError', getSocialAuthError(error));
		}
	});
});

const socialAuthForm = document.querySelector('#socialAuthForm');
if (socialAuthForm) {
	socialAuthForm.addEventListener('submit', async (event) => {
		event.preventDefault();
		const provInput = document.querySelector('#socialCustomProvider');
		const errEl = document.querySelector('#socialCustomError');
		if (errEl) errEl.hidden = true;
		const provider = provInput ? provInput.value : 'google.com';
		try {
			await signInWithFirebase(provider);
		} catch (error) {
			if (errEl) {
				errEl.textContent = getSocialAuthError(error);
				errEl.hidden = false;
			}
		}
	});
}

document.querySelectorAll('[data-social-provider]').forEach((button) => button.addEventListener('click', () => {
	showAccountError('#registerError', '');
	showAccountError('#loginError', '');
	const providerName = button.dataset.socialProvider;
	openSocialAuthModal(providerName);
}));

if (firebaseAuth) {
	firebaseAuth.onAuthStateChanged((firebaseUser) => {
		if (firebaseUser) {
			saveFederatedAccount(firebaseUser);
		} else if (state.user?.isFirebaseSession) {
			state.user = null;
			state.favorites = loadFavorites();
			sessionStorage.removeItem(CURRENT_USER_STORAGE_KEY);
			renderAccount();
			renderCart();
			renderBooks();
		}
	});
}
document.querySelector('#loginForm').addEventListener('submit', async (event) => {
	event.preventDefault();
	showAccountError('#loginError', '');
	if (!event.currentTarget.reportValidity()) return;
	const form = event.currentTarget;
	const formData = new FormData(form);
	const email = String(formData.get('email') || '').trim().toLowerCase();
	const password = String(formData.get('password') || '');

	try {
		const response = await window.booknestApiFetch('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password })
		});
		if (response.ok) {
			const data = await response.json();
			if (data.token) window.booknestAuth.setToken(data.token, data.expiresAt);
			state.user = data.user;
			applyAccountCustomerInfo(data.user);
			sessionStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(data.user));
			renderAccount();
			renderCart();
			void syncFavoritesFromServer().catch((error) =>
				showToast(error.message || 'Không thể đồng bộ sách yêu thích.', 'error')
			);
			setAccountView('login');
			accountDialog.close();
			form.reset();
			return;
		} else if (response.status === 401) {
			const errorData = await response.json().catch(() => ({}));
			showAccountError('#loginError', errorData.error || 'Email hoặc mật khẩu chưa đúng.');
			return;
		}
	} catch {
		// Server offline fallback
	}

	const user = readUsers().find((item) => item.email === email && item.password === password);
	if (!user) {
		showAccountError('#loginError', 'Email hoặc mật khẩu chưa đúng.');
		return;
	}
	state.user = user;
	applyAccountCustomerInfo(user);
	sessionStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user));
	renderAccount();
	renderCart();
	setAccountView('login');
	accountDialog.close();
	form.reset();
});
document.querySelector('#registerForm').addEventListener('submit', async (event) => {
	event.preventDefault();
	showAccountError('#registerError', '');
	const form = event.currentTarget;
	if (!form.reportValidity()) return;
	const data = new FormData(form);
	const email = String(data.get('email')).trim().toLowerCase();
	const user = {
		name: String(data.get('name')).trim(),
		email,
		password: data.get('password'),
		studentType: data.get('studentType'),
		studentId: String(data.get('studentId') || '').trim()
	};
	const submitButton = form.querySelector('[type="submit"]');
	submitButton.disabled = true;

	try {
		const response = await window.booknestApiFetch('/api/auth/register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(user)
		});
		if (response.ok) {
			const resData = await response.json();
			if (resData.token) window.booknestAuth.setToken(resData.token, resData.expiresAt);
			state.user = resData.user || user;
			applyAccountCustomerInfo(state.user);
			sessionStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(state.user));
			void syncFavoritesFromServer().catch((error) =>
				showToast(error.message || 'Không thể đồng bộ sách yêu thích.', 'error')
			);
			renderAccount();
			renderCart();
			setAccountView('login');
			accountDialog.close();
			form.reset();
			document.querySelector('.student-id-field').hidden = true;
			return;
		} else {
			const errorData = await response.json().catch(() => ({}));
			showAccountError(
				'#registerError',
				response.status === 409
					? errorData.error || 'Không thể hoàn tất đăng ký với thông tin đã cung cấp. Vui lòng kiểm tra và thử lại.'
					: errorData.error || `Máy chủ không thể tạo tài khoản (mã lỗi ${response.status}). Vui lòng thử lại sau.`
			);
			return;
		}
	} catch (error) {
		showAccountError(
			'#registerError',
			error instanceof Error
				? 'Không thể kết nối máy chủ để tạo tài khoản. Vui lòng kiểm tra kết nối rồi thử lại.'
				: 'Không thể tạo tài khoản lúc này. Vui lòng thử lại sau.'
		);
		return;
	} finally {
		submitButton.disabled = false;
	}
});
async function performAccountLogout(endpoint) {
	if (state.user?.firebaseUid && firebaseAuth) {
		try {
			await firebaseAuth.signOut();
		} catch (error) {
			showAccountError('#registerError', 'Không thể đăng xuất khỏi Firebase lúc này.');
			return;
		}
	}
	try {
		const token = window.booknestAuth.getToken();
		if (token) {
			await window.booknestApiFetch(endpoint, {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}` }
			});
		}
	} catch (error) {
		console.error('Không thể thu hồi phiên đăng nhập trên máy chủ:', error);
	}
	window.booknestAuth.clearToken();
	sessionStorage.removeItem(CURRENT_USER_STORAGE_KEY);
	sessionStorage.removeItem(CUSTOMER_INFO_STORAGE_KEY);
	state.user = null;
	state.favorites = loadFavorites();
	renderAccount();
	renderCart();
	setAccountView('login');
}
document.querySelector('#logoutButton').addEventListener('click', () => performAccountLogout('/api/auth/logout'));
document.querySelector('#logoutAllButton')?.addEventListener('click', () => performAccountLogout('/api/auth/logout-all'));
document.querySelector('#changePasswordNavButton')?.addEventListener('click', () => {
	showAccountError('#changePasswordError', '');
	setAccountView('change-password');
});
document.querySelector('#changePasswordForm')?.addEventListener('submit', async (event) => {
	event.preventDefault();
	showAccountError('#changePasswordError', '');
	const form = event.currentTarget;
	const currentPassword = String(form.elements.currentPassword?.value || '');
	const newPassword = String(form.elements.newPassword?.value || '');
	const confirmNewPassword = String(form.elements.confirmNewPassword?.value || '');
	if (newPassword !== confirmNewPassword) {
		showAccountError('#changePasswordError', 'Xác nhận mật khẩu mới chưa khớp.');
		return;
	}
	const token = window.booknestAuth.getToken();
	if (!token) {
		showAccountError('#changePasswordError', 'Vui lòng đăng nhập lại trước khi đổi mật khẩu.');
		return;
	}
	try {
		const res = await window.booknestApiFetch('/api/auth/change-password', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`
			},
			body: JSON.stringify({ currentPassword, newPassword })
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			showAccountError('#changePasswordError', data.error || 'Không thể đổi mật khẩu lúc này.');
			return;
		}
		if (data.token) window.booknestAuth.setToken(data.token);
		form.reset();
		setAccountView('login');
		if (typeof showToast === 'function') {
			showToast(data.message || 'Đã cập nhật mật khẩu thành công.', 'success');
		}
	} catch (error) {
		showAccountError('#changePasswordError', 'Lỗi kết nối máy chủ khi đổi mật khẩu.');
	}
});
function openOrderTracker(orderId = '') {
	const form = document.querySelector('#trackOrderForm');
	const orderIdInput = form?.elements?.orderId;
	let selectedOrderId = '';
	if (orderIdInput) {
		let savedOrderId = lastCreatedOrderId;
		try {
			savedOrderId = sessionStorage.getItem(LAST_ORDER_ID_STORAGE_KEY) || savedOrderId;
		} catch (storageError) {
		}
		selectedOrderId = orderId || orderIdInput.value || savedOrderId;
		orderIdInput.value = selectedOrderId;
	}
	const accessCodeInput = form?.elements?.accessCode;
	if (accessCodeInput) {
		accessCodeInput.value = selectedOrderId === lastCreatedOrderId
			? lastCreatedOrderAccessCode
			: '';
	}
	document.querySelector('#trackOrderError').hidden = true;
	document.querySelector('#orderResult').hidden = true;
	trackOrderDialog.showModal();
}
document.querySelector('#trackOrderButton')?.addEventListener('click', () => openOrderTracker());
document.querySelector('#closeTrackOrder')?.addEventListener('click', () => trackOrderDialog.close());
document.querySelector('#trackOrderForm')?.addEventListener('submit', async (event) => {
	event.preventDefault();
	const form = event.currentTarget;
	const error = document.querySelector('#trackOrderError');
	const result = document.querySelector('#orderResult');
	error.hidden = true;
	result.hidden = true;
	if (!form.reportValidity()) return;
	try {
		const formData = new FormData(form);
		const orderId = String(formData.get('orderId')).trim();
		const accessCode = String(formData.get('accessCode') || '').trim();
		const token = window.booknestAuth.getToken();
		const headers = token ? { Authorization: `Bearer ${token}` } : {};
		if (accessCode) headers['X-Order-Access-Code'] = accessCode;
		const response = await window.booknestApiFetch(
			`/api/orders/${encodeURIComponent(orderId)}`,
			{ headers }
		);
		const order = await response.json();
		if (!response.ok) throw new Error(order.error || 'Không tìm thấy đơn hàng.');
		if (order.paymentMethod === 'transfer') {
			const paymentConfirmed = order.paymentStatus === 'paid';
			window.booknestToast?.(
				paymentConfirmed
					? `Thanh toán đơn ${order.orderId} đã được xác nhận.`
					: `Đơn ${order.orderId} đang chờ thanh toán chuyển khoản.`,
				paymentConfirmed ? 'success' : 'info',
				{
					title: paymentConfirmed ? 'Đã xác nhận thanh toán thành công' : 'Đang chờ thanh toán',
					details: [
						{ label: 'Mã đơn', value: order.orderId },
						{ label: 'Tổng tiền', value: formatPrice(order.total) }
					]
				}
			);
		}
		result.innerHTML = `<h3>Đơn hàng ${escapeHtml(order.orderId)}</h3><p>Trạng thái: <strong>${escapeHtml(order.status)}</strong></p><p>Tổng tiền: <strong>${formatPrice(order.total)}</strong></p><ul>${order.items.map((item) => `<li>${escapeHtml(item.title)} × ${item.quantity}</li>`).join('')}</ul>`;
		result.hidden = false;
	} catch (trackError) {
		error.textContent = trackError instanceof Error ? trackError.message : 'Không thể tra cứu đơn hàng.';
		error.hidden = false;
	}
});
document.querySelector('#myOrdersButton')?.addEventListener('click', async () => {
	const error = document.querySelector('#trackOrderError');
	const result = document.querySelector('#orderResult');
	error.hidden = true;
	result.hidden = true;
	try {
		const token = window.booknestAuth.getToken();
		if (!token) throw new Error('Vui lòng đăng nhập để tra cứu đơn hàng.');
		const response = await window.booknestApiFetch('/api/orders', {
			headers: { Authorization: `Bearer ${token}` }
		});
		const orders = await response.json();
		if (!response.ok) throw new Error(orders.error || 'Không thể tải đơn hàng.');
		result.innerHTML = orders.length
			? `<h3>Đơn hàng của tôi</h3>${orders.map((order) => `<article><p>Mã đơn: <strong>${escapeHtml(order.orderId)}</strong></p><p>Trạng thái: <strong>${escapeHtml(order.status)}</strong></p><p>Tổng tiền: <strong>${formatPrice(order.total)}</strong></p></article>`).join('')}`
			: '<h3>Đơn hàng của tôi</h3><p>Bạn chưa có đơn hàng nào.</p>';
		result.hidden = false;
	} catch (historyError) {
		error.textContent = historyError instanceof Error ? historyError.message : 'Không thể tải đơn hàng.';
		error.hidden = false;
	}
});
const aiChat = document.querySelector('#aiChat');
const aiMessages = document.querySelector('#aiMessages');
const aiInput = document.querySelector('#aiInput');

function addAiMessage(message, sender) {
	const element = document.createElement('div');
	element.className = `ai-message ai-message-${sender}`;
	element.textContent = message;
	aiMessages.append(element);
	aiMessages.scrollTop = aiMessages.scrollHeight;
}

function askAi(question) {
	const cleanQuestion = question.trim();
	if (!cleanQuestion) return;
	addAiMessage(cleanQuestion, 'user');
	aiInput.value = '';
	window.setTimeout(() => addAiMessage(getAiAnswer(cleanQuestion), 'bot'), 250);
}

function initializeScrollCinema() {
	const hero = document.querySelector('[data-scroll-cinema]');
	const scene = hero?.querySelector('.hero-scene');
	const booksInScene = [...(hero?.querySelectorAll('.hero-book') || [])];
	const header = document.querySelector('.site-header');
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	if (!hero || !scene || !booksInScene.length || reducedMotion.matches) return;

	const bookMotion = [
		{ x: -1, y: -36, rotation: -7, scale: 0.04 },
		{ x: 0, y: -92, rotation: 0, scale: 0.08 },
		{ x: 1, y: -36, rotation: 8, scale: 0.04 }
	];
	const compactLayout = window.matchMedia('(max-width: 800px)');
	let frame = 0;

	function updateScene() {
		frame = 0;
		if (reducedMotion.matches) return;
		const headerHeight = header?.getBoundingClientRect().height || 0;
		document.documentElement.style.setProperty('--cinema-header-height', `${headerHeight}px`);
		const scrollRange = hero.offsetHeight - scene.offsetHeight;
		if (scrollRange <= 0) return;

		const progress = Math.max(0, Math.min(1, (headerHeight - hero.getBoundingClientRect().top) / scrollRange));
		const horizontalSpread = compactLayout.matches ? 16 : 40;
		scene.style.setProperty('--cinema-copy-y', `${-42 * progress}px`);
		scene.style.setProperty('--cinema-copy-opacity', `${1 - progress * 0.28}`);
		booksInScene.forEach((book, index) => {
			const motion = bookMotion[index];
			if (!motion) return;
			book.style.setProperty('--cinema-x', `${motion.x * horizontalSpread * progress}px`);
			book.style.setProperty('--cinema-y', `${motion.y * progress}px`);
			book.style.setProperty('--cinema-rotation', `${motion.rotation * progress}deg`);
			book.style.setProperty('--cinema-scale', `${1 + motion.scale * progress}`);
		});
	}

	function scheduleSceneUpdate() {
		if (!frame) frame = window.requestAnimationFrame(updateScene);
	}

	window.addEventListener('scroll', scheduleSceneUpdate, { passive: true });
	window.addEventListener('resize', scheduleSceneUpdate);
	reducedMotion.addEventListener('change', (event) => {
		if (event.matches) {
			window.removeEventListener('scroll', scheduleSceneUpdate);
			window.removeEventListener('resize', scheduleSceneUpdate);
			window.cancelAnimationFrame(frame);
			document.documentElement.classList.remove('has-scroll-cinema');
			document.documentElement.style.removeProperty('--cinema-header-height');
			scene.removeAttribute('style');
			booksInScene.forEach((book) => book.removeAttribute('style'));
			return;
		}
		document.documentElement.classList.add('has-scroll-cinema');
		scheduleSceneUpdate();
	});

	document.documentElement.classList.add('has-scroll-cinema');
	scheduleSceneUpdate();
}

document.querySelector('#aiLauncher').addEventListener('click', () => {
	const open = !aiChat.classList.contains('open');
	if (open) toggleCart(false);
	aiChat.classList.toggle('open', open);
	aiChat.setAttribute('aria-hidden', String(!open));
	if (open) aiInput.focus();
});
document.querySelector('#closeAi').addEventListener('click', () => {
	aiChat.classList.remove('open');
	aiChat.setAttribute('aria-hidden', 'true');
});
document.querySelector('#aiForm').addEventListener('submit', (event) => {
	event.preventDefault();
	askAi(aiInput.value);
});
document.querySelectorAll('[data-ai-question]').forEach((button) => button.addEventListener('click', () => askAi(button.dataset.aiQuestion)));
initializeScrollCinema();
renderAccount();
fillSavedCustomerInfo();
hydrateAuthenticatedUser();
renderCart();
hydrateCatalog();
if (hasCatalogShell) {
	renderCategories();
	renderBooks();
	if (new URLSearchParams(window.location.search).get('cart') === 'open') toggleCart(true);
}

