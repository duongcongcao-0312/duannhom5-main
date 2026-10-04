const books = globalThis.BOOKNEST_BOOKS;

const categories = [
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
const USERS_STORAGE_KEY = 'booknest-users';
const CURRENT_USER_STORAGE_KEY = 'booknest-current-user';
const SERVICE_REQUESTS_STORAGE_KEY = 'booknest-service-requests';
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
	try {
		const savedCart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
		if (!Array.isArray(savedCart)) return [];
		return savedCart.map((title) => books.find((book) => book.title === title)).filter(Boolean);
	} catch (error) {
		return [];
	}
}

function getBookStock(book) {
	return Number.isInteger(book.stock) && book.stock >= 0 ? book.stock : DEFAULT_BOOK_STOCK;
}

function loadCurrentUser() {
	try {
		return JSON.parse(localStorage.getItem(CURRENT_USER_STORAGE_KEY) || 'null');
	} catch (error) {
		return null;
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

const state = { cart: loadCart(), user: loadCurrentUser(), favorites: loadFavorites(), coupon: localStorage.getItem(COUPON_STORAGE_KEY) || '' };
const bookGrid = document.querySelector('#bookGrid');
const searchInput = document.querySelector('#searchInput');
const categoryFilter = document.querySelector('#categoryFilter');
<<<<<<< HEAD
const sortSelect = document.querySelector('#sortSelect');
=======
const sortFilter = document.querySelector('#sortFilter');
const favoritesFilter = document.querySelector('#favoritesFilter');
let showFavoritesOnly = false;
>>>>>>> 6df4a1f493f20bb3ecb37e1a43d62cbadf3065c3
const hasCatalogShell = Boolean(bookGrid && searchInput && categoryFilter);

function renderCategories() {
	if (!categoryFilter) return;
	categoryFilter.innerHTML = '<option value="all">Tất cả thể loại</option>' + categories.map((category) => `<option value="${category.value}">${category.label}</option>`).join('');
	const categoryList = document.querySelector('.category-list');
	if (categoryList) {
		categoryList.innerHTML = categories.map((category) => {
			const count = books.filter((book) => book.category === category.value).length;
			return `<button data-category="${category.value}" type="button"><span>${category.label}<small>${count} tựa sách</small></span><span>→</span></button>`;
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

function formatPrice(price) { return `${price.toLocaleString('vi-VN')} đ`; }

function getDiscountRate() {
	if (!state.user) return 0;
	return state.user.studentType === 'student' || state.user.studentType === 'university' ? 0.1 : 0.05;
}

function getDiscountLabel() {
	return state.user && getDiscountRate() === 0.1 ? 'Ưu đãi học sinh / sinh viên' : 'Ưu đãi thành viên';
}

function getCouponRate() {
	return state.coupon === 'BOOKNEST10' ? 0.1 : state.coupon === 'WELCOME5' ? 0.05 : 0;
}

function getAiAnswer(question) {
	const normalized = question.toLowerCase();
	if (/(thuê|muon|mượn)/.test(normalized)) return 'Bạn có thể thuê sách theo tuần hoặc tháng. Hãy mở mục “Dịch vụ” ở cuối trang và chọn “Đăng ký thuê” để gửi tên sách và thông tin liên hệ.';
	if (/(thu mua|bán sách|ban sach)/.test(normalized)) return 'BookNest nhận thu mua sách đã qua sử dụng. Chọn “Bán sách cho BookNest” trong mục “Dịch vụ”; đội ngũ sẽ xem tình trạng và phản hồi mức giá dự kiến.';
	if (/(trao đổi|trao doi|đổi sách|doi sach)/.test(normalized)) return 'Bạn có thể đăng sách muốn trao đổi tại mục “Trao đổi sách”. Hãy ghi tên sách và cuốn bạn đang tìm để BookNest hỗ trợ ghép cặp.';
	if (/(học sinh|sinh viên|sinh vien|ưu đãi|giam|giảm)/.test(normalized)) return 'Thành viên thông thường được giảm 5%. Học sinh và sinh viên được giảm 10% sau khi chọn đúng loại tài khoản và nhập mã học sinh/sinh viên.';
	if (/(hội viên|hoi vien|thẻ|the thanh vien|đăng ký|dang ky)/.test(normalized)) return 'Bạn mở nút “Đăng nhập” ở đầu trang, chọn “Đăng ký”. Sau khi tạo tài khoản, BookNest tự cấp thẻ hội viên điện tử và mã thành viên.';
	const category = categories.find((item) => normalized.includes(item.label.toLowerCase()) || normalized.includes(item.value));
	if (category) {
		const recommendations = books.filter((book) => book.category === category.value).slice(0, 3);
		return `Một vài gợi ý thuộc ${category.label}: ${recommendations.map((book) => `“${book.title}”`).join(', ')}. Bạn có thể xem thêm tại bộ sưu tập sách.`;
	}
	if (/(gợi ý|goi y|sách|sach|đọc gì|doc gi)/.test(normalized)) return 'Bạn có thể thử “Nhà giả kim”, “Mắt biếc” hoặc “Đi tìm lẽ sống”. Hãy cho mình biết thể loại bạn yêu thích để nhận gợi ý sát hơn nhé.';
	if (/(thanh toán|thanh toan|cod|chuyển khoản|chuyen khoan)/.test(normalized)) return 'BookNest hỗ trợ chuyển khoản qua mã QR và thanh toán khi nhận hàng (COD). Bạn chọn phương thức ở bước thanh toán trong giỏ hàng.';
	return 'Mình có thể hỗ trợ về gợi ý sách, thuê sách, thu mua, trao đổi, tài khoản hội viên và ưu đãi học sinh/sinh viên. Bạn thử hỏi cụ thể hơn nhé!';
}

function getBookImage(book) {
	return book.image || `https://covers.openlibrary.org/b/title/${encodeURIComponent(book.title)}-L.jpg?default=false`;
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

async function findBookCover(image) {
	try {
		const query = `https://openlibrary.org/search.json?title=${encodeURIComponent(image.dataset.bookTitle)}&author=${encodeURIComponent(image.dataset.bookAuthor)}&limit=1&fields=cover_i`;
		const response = await fetch(query);
		if (!response.ok) throw new Error('Không tìm thấy dữ liệu bìa sách.');
		const result = await response.json();
		const coverId = result.docs?.[0]?.cover_i;
		if (coverId) {
			image.src = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
			return;
		}
	} catch (error) {
	}
	image.src = createFallbackCover(image.dataset.bookTitle, image.dataset.bookAuthor);
}

function updatePaymentQr(total) {
	const paymentQr = document.querySelector('#paymentQr');
	const paymentInfo = encodeURIComponent(`BOOKNEST ${total}`);
	paymentQr.src = `https://img.vietqr.io/image/TCB-88803122007888-compact2.png?amount=${total}&addInfo=${paymentInfo}&accountName=BOOKNEST`;
}

function escapeHtml(value) {
	return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function showPaymentError(message) {
	const error = document.querySelector('#paymentError');
	error.textContent = message;
	error.hidden = !message;
}

function getSortedBooks(booksToSort) {
	if (!sortSelect) return booksToSort;
	const sortedBooks = [...booksToSort];
	if (sortSelect.value === 'price-asc') return sortedBooks.sort((left, right) => left.price - right.price);
	if (sortSelect.value === 'price-desc') return sortedBooks.sort((left, right) => right.price - left.price);
	return sortedBooks;
}

function renderBooks() {
	if (!bookGrid || !searchInput || !categoryFilter) return;
	const query = searchInput.value.trim().toLowerCase();
	const category = categoryFilter.value;
<<<<<<< HEAD
	const visibleBooks = getSortedBooks(books.filter((book) => {
		const matchesQuery = `${book.title} ${book.author}`.toLowerCase().includes(query);
		return matchesQuery && (category === 'all' || book.category === category);
	}));
=======
	let visibleBooks = books.filter((book) => {
		const matchesQuery = `${book.title} ${book.author}`.toLowerCase().includes(query);
		const matchesFavorite = !showFavoritesOnly || state.favorites.includes(book.title);
		return matchesQuery && matchesFavorite && (category === 'all' || book.category === category);
	});
	if (sortFilter?.value === 'price-asc') visibleBooks.sort((a, b) => a.price - b.price);
	if (sortFilter?.value === 'price-desc') visibleBooks.sort((a, b) => b.price - a.price);
	if (sortFilter?.value === 'title') visibleBooks.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
>>>>>>> 6df4a1f493f20bb3ecb37e1a43d62cbadf3065c3
	bookGrid.innerHTML = visibleBooks.map((book) => `
		<article class="book-card">
			<div class="cover ${escapeHtml(book.cover)} has-image"><img class="cover-image" data-book-title="${escapeHtml(book.title)}" data-book-author="${escapeHtml(book.author)}" src="${escapeHtml(getBookImage(book))}" alt="Bìa sách ${escapeHtml(book.title)} - ${escapeHtml(book.author)}" loading="lazy" decoding="async"><span class="cover-label">${escapeHtml(book.label).replace('\n', '<br>')}</span></div>
			<div class="book-info">
				<h3>${escapeHtml(book.title)}</h3><p class="author">${escapeHtml(book.author)}</p><p class="stock-status ${getBookStock(book) < 4 ? 'stock-low' : ''}">${getBookStock(book) ? `Còn ${getBookStock(book)} cuốn` : 'Tạm hết hàng'}</p>
				<div class="book-bottom"><span class="price">${formatPrice(book.price)}</span><a class="details-link" href="${getBookDetailsUrl(book)}">Chi tiết</a><button class="favorite-button ${state.favorites.includes(book.title) ? 'active' : ''}" data-favorite-title="${escapeHtml(book.title)}" type="button" aria-label="${state.favorites.includes(book.title) ? 'Bỏ yêu thích' : 'Thêm yêu thích'}">${state.favorites.includes(book.title) ? '♥' : '♡'}</button><button class="add-button" data-title="${escapeHtml(book.title)}" type="button" ${getBookStock(book) === 0 ? 'disabled' : ''}>${getBookStock(book) === 0 ? 'Hết hàng' : 'Thêm vào giỏ'}</button></div>
			</div>
		</article>`).join('');
	removeFailedImages(bookGrid);
	const emptyState = document.querySelector('#emptyState');
	const bookCount = document.querySelector('#bookCount');
	if (emptyState) emptyState.hidden = visibleBooks.length > 0;
	if (bookCount) bookCount.textContent = visibleBooks.length;
}

function toggleFavorite(title) {
	if (state.favorites.includes(title)) state.favorites = state.favorites.filter((item) => item !== title);
	else state.favorites.push(title);
	localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(state.favorites));
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
		if (!image.dataset.lookupAttempted) {
			image.dataset.lookupAttempted = 'true';
			findBookCover(image);
			return;
		}
		if (!image.dataset.fallback) {
			image.dataset.fallback = 'true';
			image.src = createFallbackCover(image.dataset.bookTitle, image.dataset.bookAuthor);
			return;
		}
		image.parentElement.classList.remove('has-image');
		image.remove();
	}));
}

function renderCart() {
	try {
		localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart.map((book) => book.title)));
	} catch (error) {
	}
	const cartCount = document.querySelector('#cartCount');
	const quickCartSummary = document.querySelector('#quickCartSummary');
	const cartItems = document.querySelector('#cartItems');
	if (!cartItems) return;
	const cartGroups = getCartGroups();
	if (cartCount) cartCount.textContent = state.cart.length;
	if (quickCartSummary) quickCartSummary.textContent = state.cart.length ? `${state.cart.length} cuốn sách trong giỏ hàng` : 'Chưa có sách được chọn';
	cartItems.innerHTML = cartGroups.length ? cartGroups.map(({ book, quantity }) => `<div class="cart-item"><div class="mini-cover ${escapeHtml(book.cover)}"><img data-book-title="${escapeHtml(book.title)}" data-book-author="${escapeHtml(book.author)}" src="${escapeHtml(getBookImage(book))}" alt="Bìa sách ${escapeHtml(book.title)} - ${escapeHtml(book.author)}" loading="lazy" decoding="async"></div><div class="cart-item-copy"><p>${escapeHtml(book.title)}</p><strong>${formatPrice(book.price * quantity)}</strong><div class="quantity-control" aria-label="Số lượng ${escapeHtml(book.title)}"><button class="quantity-button" data-cart-title="${escapeHtml(book.title)}" data-cart-change="-1" type="button" aria-label="Giảm số lượng ${escapeHtml(book.title)}">−</button><span>${quantity}</span><button class="quantity-button" data-cart-title="${escapeHtml(book.title)}" data-cart-change="1" type="button" aria-label="Tăng số lượng ${escapeHtml(book.title)}">+</button><button class="remove-button" data-cart-title="${escapeHtml(book.title)}" data-cart-change="-${quantity}" type="button" aria-label="Xóa ${escapeHtml(book.title)} khỏi giỏ hàng">Xóa</button></div></div></div>`).join('') : '<p class="cart-empty">Giỏ hàng đang trống.</p>';
	removeFailedImages(cartItems);
	const subtotal = state.cart.reduce((sum, book) => sum + book.price, 0);
	const discount = Math.round(subtotal * Math.min(getDiscountRate() + getCouponRate(), 0.3));
	const total = subtotal - discount;
	document.querySelector('#cartSubtotal').textContent = formatPrice(subtotal);
	document.querySelector('#cartDiscount').textContent = `-${formatPrice(discount)}`;
	const discountLine = document.querySelector('#discountLine');
	if (discountLine) discountLine.hidden = discount === 0;
	const discountLineLabel = document.querySelector('#discountLine span');
	if (discountLineLabel) discountLineLabel.textContent = getDiscountLabel();
	document.querySelector('#cartTotal').textContent = formatPrice(total);
	document.querySelector('#paymentTotal').textContent = formatPrice(total);
	updatePaymentQr(total);
	const checkoutButton = document.querySelector('#checkoutButton');
	if (checkoutButton) checkoutButton.disabled = state.cart.length === 0;
	const couponInput = document.querySelector('#couponInput');
	if (couponInput && state.coupon) couponInput.value = state.coupon;
}

function toggleCart(open) {
	const cartPanel = document.querySelector('#cartPanel');
	cartPanel.classList.toggle('open', open);
	cartPanel.setAttribute('aria-hidden', String(!open));
	document.querySelector('#overlay').classList.toggle('visible', open);
	if (open && typeof aiChat !== 'undefined' && aiChat.classList.contains('open')) {
		aiChat.classList.remove('open');
		aiChat.setAttribute('aria-hidden', 'true');
	}
}

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
if (searchInput) searchInput.addEventListener('input', renderBooks);
if (categoryFilter) categoryFilter.addEventListener('change', renderBooks);
<<<<<<< HEAD
if (sortSelect) sortSelect.addEventListener('change', renderBooks);
=======
if (sortFilter) sortFilter.addEventListener('change', renderBooks);
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
		const response = await fetch(`/api/coupons/${encodeURIComponent(code)}`);
		const result = await response.json();
		if (!response.ok) throw new Error(result.error || 'Mã ưu đãi không hợp lệ.');
		state.coupon = code;
		localStorage.setItem(COUPON_STORAGE_KEY, code);
		message.textContent = `${result.label}: giảm ${result.rate * 100}%.`;
		renderCart();
	} catch (error) {
		state.coupon = '';
		localStorage.removeItem(COUPON_STORAGE_KEY);
		message.textContent = error.message;
	}
});
>>>>>>> 6df4a1f493f20bb3ecb37e1a43d62cbadf3065c3
const cartButton = document.querySelector('#cartButton');
if (cartButton) cartButton.addEventListener('click', () => toggleCart(true));
document.querySelector('#quickCartButton')?.addEventListener('click', () => toggleCart(true));
document.querySelector('#closeCart')?.addEventListener('click', () => toggleCart(false));
document.querySelector('#overlay')?.addEventListener('click', () => toggleCart(false));
document.querySelector('#checkoutButton')?.addEventListener('click', () => document.querySelector('#paymentDialog')?.showModal());
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
		showPaymentError('');
		if (!form.reportValidity()) return;
		if (!state.cart.length) throw new Error('Giỏ hàng đang trống.');
		const customerName = form.elements.customerName.value.trim();
		const address = form.elements.address.value.trim();
		const phone = form.elements.phone.value.trim();
		if (customerName.length < 2 || address.length < 10 || !/^[0-9 +()-]{8,}$/.test(phone)) {
			throw new Error('Vui lòng kiểm tra họ tên, số điện thoại và địa chỉ nhận hàng.');
		}
		const method = form.elements.paymentMethod.value;
		const submitButton = form.querySelector('[type="submit"]');
		const originalButtonText = submitButton.textContent;
		submitButton.disabled = true;
		submitButton.textContent = 'Đang lưu đơn hàng...';
		const items = [...state.cart.reduce((quantities, book) => {
			quantities.set(book.title, (quantities.get(book.title) || 0) + 1);
			return quantities;
		}, new Map())].map(([title, quantity]) => ({ title, quantity }));
		let result;
		try {
			const response = await fetch('/api/orders', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					customerName,
					address,
					phone,
					paymentMethod: method,
					discountRate: getDiscountRate(),
					couponCode: state.coupon,
					items
				})
			});
			result = await response.json();
			if (!response.ok) throw new Error(result.error || 'Không thể lưu đơn hàng.');
			if (!result.orderId || !Number.isFinite(result.total)) {
				throw new Error('Máy chủ trả về xác nhận đơn hàng không hợp lệ.');
			}
		} catch (error) {
			throw new Error(error instanceof TypeError
				? 'Không thể kết nối máy chủ. Đơn hàng chưa được lưu; giỏ hàng vẫn được giữ lại.'
				: error.message);
		} finally {
			submitButton.disabled = false;
			submitButton.textContent = originalButtonText;
		}

		const message = method === 'cod'
			? `Đơn hàng COD đã được lưu thành công. Mã đơn hàng: ${result.orderId}. Tổng tiền ${formatPrice(result.total)} sẽ được giao đến địa chỉ bạn đã cung cấp.`
			: `Đơn hàng đã được lưu thành công. Mã đơn hàng: ${result.orderId}. Vui lòng hoàn tất chuyển khoản ${formatPrice(result.total)} để xử lý đơn hàng.`;
		alert(message);
		state.cart = [];
		form.reset();
		document.querySelector('#transferDetails').hidden = false;
		document.querySelector('#paymentDialog').close();
		toggleCart(false);
		renderCart();
	} catch (error) {
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
serviceForm.addEventListener('submit', (event) => {
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
		const savedRequests = JSON.parse(localStorage.getItem(SERVICE_REQUESTS_STORAGE_KEY) || '[]');
		if (!Array.isArray(savedRequests)) throw new Error('Không thể lưu yêu cầu lúc này.');
		savedRequests.push(request);
		localStorage.setItem(SERVICE_REQUESTS_STORAGE_KEY, JSON.stringify(savedRequests));
		alert(`Đã nhận yêu cầu ${serviceDetails[request.service].title.toLowerCase()} của ${request.name}. BookNest sẽ sớm liên hệ!`);
		serviceForm.reset();
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
	member: document.querySelector('#memberPanel')
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
	Object.entries(accountViews).forEach(([name, element]) => { element.hidden = name !== view; });
	document.querySelectorAll('.account-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.accountView === view));
}

function renderAccount() {
	if (state.user) {
		accountButton.textContent = state.user.name;
		document.querySelector('#memberName').textContent = state.user.name;
		document.querySelector('#memberNumber').textContent = `Mã hội viên: ${state.user.memberNumber}`;
		document.querySelector('#memberBenefit').textContent = getDiscountRate() === 0.1 ? 'Giảm 10% cho học sinh / sinh viên' : 'Giảm 5% cho thành viên';
		document.querySelector('#memberStatus').textContent = 'Thẻ hội viên điện tử đang hoạt động trên tài khoản này.';
		document.querySelector('#logoutButton').hidden = false;
	} else {
		accountButton.textContent = 'Đăng nhập';
		document.querySelector('#memberName').textContent = 'Bạn chưa đăng nhập';
		document.querySelector('#memberNumber').textContent = 'Đăng ký để nhận mã hội viên';
		document.querySelector('#memberBenefit').textContent = 'Giảm 5% cho thành viên';
		document.querySelector('#memberStatus').textContent = 'Đăng ký tài khoản để sở hữu thẻ hội viên điện tử.';
		document.querySelector('#logoutButton').hidden = true;
	}
}

function showAccountError(id, message) {
	const error = document.querySelector(id);
	error.textContent = message;
	error.hidden = !message;
}

accountButton.addEventListener('click', () => {
	renderAccount();
	setAccountView(state.user ? 'member' : 'login');
	accountDialog.showModal();
});
document.querySelector('#closeAccount').addEventListener('click', () => accountDialog.close());
document.querySelectorAll('.account-tab').forEach((tab) => tab.addEventListener('click', () => setAccountView(tab.dataset.accountView)));
document.querySelector('#registerForm select[name="studentType"]').addEventListener('change', (event) => {
	document.querySelector('.student-id-field').hidden = event.target.value === 'other';
});
document.querySelector('#loginForm').addEventListener('submit', (event) => {
	event.preventDefault();
	showAccountError('#loginError', '');
	if (!event.currentTarget.reportValidity()) return;
	const formData = new FormData(event.currentTarget);
	const user = readUsers().find((item) => item.email === formData.get('email') && item.password === formData.get('password'));
	if (!user) {
		showAccountError('#loginError', 'Email hoặc mật khẩu chưa đúng.');
		return;
	}
	state.user = user;
	localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user));
	renderAccount();
	renderCart();
	setAccountView('member');
	event.currentTarget.reset();
});
document.querySelector('#registerForm').addEventListener('submit', (event) => {
	event.preventDefault();
	showAccountError('#registerError', '');
	const form = event.currentTarget;
	if (!form.reportValidity()) return;
	const data = new FormData(form);
	const users = readUsers();
	const email = String(data.get('email')).trim().toLowerCase();
	if (users.some((item) => item.email === email)) {
		showAccountError('#registerError', 'Email này đã được đăng ký.');
		return;
	}
	const user = {
		name: String(data.get('name')).trim(),
		email,
		password: data.get('password'),
		studentType: data.get('studentType'),
		studentId: String(data.get('studentId') || '').trim(),
		memberNumber: `BN${Date.now().toString().slice(-8)}`
	};
	users.push(user);
	localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
	localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user));
	state.user = user;
	renderAccount();
	renderCart();
	setAccountView('member');
	form.reset();
	document.querySelector('.student-id-field').hidden = true;
});
document.querySelector('#logoutButton').addEventListener('click', () => {
	localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
	state.user = null;
	renderAccount();
	renderCart();
	setAccountView('login');
});
document.querySelector('#trackOrderButton')?.addEventListener('click', () => {
	document.querySelector('#trackOrderError').hidden = true;
	document.querySelector('#orderResult').hidden = true;
	trackOrderDialog.showModal();
});
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
		const orderId = String(new FormData(form).get('orderId')).trim();
		const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
		const order = await response.json();
		if (!response.ok) throw new Error(order.error || 'Không tìm thấy đơn hàng.');
		result.innerHTML = `<h3>Đơn hàng ${escapeHtml(order.orderId)}</h3><p>Trạng thái: <strong>${escapeHtml(order.status)}</strong></p><p>Tổng tiền: <strong>${formatPrice(order.total)}</strong></p><ul>${order.items.map((item) => `<li>${escapeHtml(item.title)} × ${item.quantity}</li>`).join('')}</ul>`;
		result.hidden = false;
	} catch (trackError) {
		error.textContent = trackError instanceof Error ? trackError.message : 'Không thể tra cứu đơn hàng.';
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
renderAccount();
if (hasCatalogShell) {
	renderCategories();
	renderBooks();
	if (new URLSearchParams(window.location.search).get('cart') === 'open') toggleCart(true);
}
