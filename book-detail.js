const categoryDescriptions = {
	'van-hoc': 'Những câu chuyện giàu cảm xúc, mở ra nhiều góc nhìn về con người, ký ức và cuộc sống.',
	'ky-nang': 'Các bài học thực tế giúp bạn xây dựng thói quen tốt, làm việc hiệu quả và sống chủ động hơn.',
	'kinh-te': 'Kiến thức về tiền bạc, kinh doanh và tư duy tài chính được trình bày gần gũi, dễ áp dụng.',
	'khoa-hoc': 'Những khám phá thú vị về tự nhiên, vũ trụ và cách thế giới vận hành.',
	'lich-su': 'Các lát cắt lịch sử giúp kết nối những sự kiện lớn với con người và xã hội hôm nay.',
	'thieu-nhi': 'Những chuyến phiêu lưu trong sáng, giàu trí tưởng tượng dành cho độc giả nhỏ tuổi.',
	'trinh-tham': 'Các vụ án và câu đố hấp dẫn dành cho bạn đọc yêu thích suy luận và những bất ngờ.',
	'tam-ly': 'Những góc nhìn sâu sắc về cảm xúc, hành vi và cách chúng ta kết nối với nhau.',
	'cong-nghe': 'Kiến thức nền tảng và tư duy thực hành cho người học lập trình, dữ liệu và công nghệ.',
	'ngoai-ngu': 'Tài liệu hỗ trợ học từ vựng, ngữ pháp và kỹ năng giao tiếp ngoại ngữ từng bước.'
};

const categoryLabels = {
	'van-hoc': 'Văn học',
	'ky-nang': 'Kỹ năng sống',
	'kinh-te': 'Kinh tế',
	'khoa-hoc': 'Khoa học',
	'lich-su': 'Lịch sử',
	'thieu-nhi': 'Thiếu nhi',
	'trinh-tham': 'Trinh thám',
	'tam-ly': 'Tâm lý',
	'cong-nghe': 'Công nghệ',
	'ngoai-ngu': 'Ngoại ngữ'
};

function escapeHtml(value) {
	return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatPrice(price) {
	return `${Number(price).toLocaleString('vi-VN')} đ`;
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

function getBookPictureSources(image) {
	const small = image?.variants?.small;
	const medium = image?.variants?.medium;
	if (small && medium) {
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
		publisher: book.publisher || '',
		publisherId: book.publisherId || '',
		image: getBookImage(book)
	});
	return `book.html?${params.toString()}`;
}

function getBookNavigation(currentBook) {
	const currentIndex = catalog.findIndex((item) => item.title === currentBook.title);
	return {
		previous: currentIndex > 0 ? catalog[currentIndex - 1] : null,
		next: currentIndex >= 0 && currentIndex < catalog.length - 1 ? catalog[currentIndex + 1] : null
	};
}

function getBookDescription(book) {
	return book.description || 'Chưa có mô tả cho cuốn sách này.';
}

function addBookToCart(book) {
	try {
		const savedCart = JSON.parse(localStorage.getItem('booknest-cart') || '[]');
		if (!Array.isArray(savedCart)) throw new Error('Dữ liệu giỏ hàng không hợp lệ.');
		savedCart.push(book.title);
		localStorage.setItem('booknest-cart', JSON.stringify(savedCart));
		window.location.href = 'index.html?cart=open#books';
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Không thể thêm sách vào giỏ hàng.';
		if (typeof window.booknestToast === 'function') window.booknestToast(message, 'error');
		else console.error('Không thể hiển thị thông báo BookNest:', message);
	}
}

const params = new URLSearchParams(window.location.search);
const requestedTitle = params.get('title');
const catalog = Array.isArray(globalThis.BOOKNEST_BOOKS) ? globalThis.BOOKNEST_BOOKS : [];
const book = catalog.find((item) => item.title === requestedTitle);
const detail = document.querySelector('#bookDetail');
const detailStatus = document.querySelector('#detailStatus');

function setDetailFeedback(container, stateName, message, retry) {
	if (!container) return;
	container.replaceChildren();
	container.dataset.state = stateName;
	container.setAttribute('role', stateName === 'error' ? 'alert' : 'status');
	container.setAttribute('aria-live', stateName === 'error' ? 'assertive' : 'polite');
	container.hidden = !message && !retry;
	if (message) {
		const text = document.createElement('span');
		text.textContent = message;
		container.appendChild(text);
	}
	if (retry) {
		const button = document.createElement('button');
		button.className = 'secondary-button';
		button.type = 'button';
		button.textContent = 'Thử lại';
		button.addEventListener('click', () => { void retry(); });
		container.appendChild(button);
	}
}

function renderDetail(content) {
	const status = detail.querySelector('#detailStatus');
	detail.innerHTML = content;
	if (status) detail.prepend(status);
}

function updateBookMetadata(remoteBook) {
	const copy = detail.querySelector('.detail-copy');
	if (!copy) return;
	const heading = copy.querySelector('h1');
	const author = copy.querySelector('.detail-author strong');
	const category = copy.querySelector('.eyebrow');
	const price = copy.querySelector('.detail-price');
	const description = copy.querySelector('.detail-description');
	if (heading) heading.textContent = remoteBook.title;
	if (author && remoteBook.author) author.textContent = remoteBook.author;
	if (category) category.textContent = categoryLabels[remoteBook.category] || 'BookNest';
	if (price && Number.isFinite(Number(remoteBook.price))) price.textContent = formatPrice(remoteBook.price);
	if (description) description.textContent = remoteBook.description || 'Chưa có mô tả cho cuốn sách này.';
	document.title = `${remoteBook.title} | BookNest`;

	if (remoteBook.publisher) {
		let publisher = copy.querySelector('.detail-publisher');
		if (!publisher) {
			publisher = document.createElement('p');
			publisher.className = 'detail-publisher';
			copy.querySelector('.detail-author')?.after(publisher);
		}
		publisher.innerHTML = `Nhà xuất bản: <strong>${escapeHtml(remoteBook.publisher)}</strong>`;
	}
	if (remoteBook.isbn && !copy.querySelector('.detail-isbn')) {
		const isbn = document.createElement('p');
		isbn.className = 'detail-isbn';
		isbn.textContent = `ISBN: ${remoteBook.isbn}`;
		copy.querySelector('.detail-price')?.after(isbn);
	}
	if (remoteBook.stock !== undefined && remoteBook.stock !== null && Number.isFinite(Number(remoteBook.stock))) {
		const stock = Number(remoteBook.stock);
		let stockStatus = copy.querySelector('.detail-stock');
		if (!stockStatus) {
			stockStatus = document.createElement('p');
			stockStatus.className = 'detail-stock';
			price?.after(stockStatus);
		}
		stockStatus.textContent = stock > 0 ? `Còn ${stock} cuốn` : 'Tạm hết hàng';
		const buyButton = detail.querySelector('#buyBook');
		if (buyButton) {
			buyButton.disabled = stock < 1;
			buyButton.textContent = stock < 1 ? 'Hết hàng' : 'Mua ngay';
		}
	}
}

function detailErrorMessage(error, section) {
	const status = Number(error?.status || error?.response?.status);
	const message = String(error?.message || '');
	if (error?.name === 'AbortError' || status === 408 || status === 504 || /timeout|quá thời gian|không phản hồi/i.test(message)) {
		return `Tải ${section} quá thời gian. Vui lòng thử lại.`;
	}
	if (status === 401 || status === 403) return `Bạn cần đăng nhập hoặc không có quyền xem ${section}.`;
	if (status >= 500) return `Máy chủ chưa thể tải ${section}. Vui lòng thử lại.`;
	if (error instanceof TypeError || /network|failed to fetch|kết nối/i.test(message)) {
		return `Không thể kết nối để tải ${section}. Kiểm tra mạng và thử lại.`;
	}
	return `Không thể tải ${section}. Vui lòng thử lại.`;
}

async function loadBookReviews(remoteBook, reviewsSection) {
	const summary = reviewsSection.querySelector('.review-summary');
	const list = reviewsSection.querySelector('.review-list');
	setDetailFeedback(summary, 'loading', 'Đang tải đánh giá...');
	try {
		const response = await window.booknestApiFetch(`/api/books/${encodeURIComponent(remoteBook.id)}/reviews`);
		if (!response.ok) {
			const error = new Error('Không thể tải đánh giá.');
			error.status = response.status;
			throw error;
		}
		const reviewData = await response.json();
		if (!Array.isArray(reviewData?.reviews)) throw new Error('Dữ liệu đánh giá không hợp lệ.');
		setDetailFeedback(summary, reviewData.reviews.length ? 'ready' : 'empty',
			`${reviewData.averageRating} / 5 · ${reviewData.reviewCount} đánh giá`);
		list.innerHTML = reviewData.reviews.length
			? reviewData.reviews.map((review) => `<article class="book-review"><strong>${escapeHtml(review.userName)}</strong><span>${escapeHtml(review.rating)} / 5</span><p>${escapeHtml(review.content)}</p><button type="button" data-report-review="${escapeHtml(review.id)}">Báo cáo</button></article>`).join('')
			: '<p>Chưa có đánh giá được duyệt.</p>';
	} catch (error) {
		setDetailFeedback(summary, 'error', detailErrorMessage(error, 'đánh giá'), () => loadBookReviews(remoteBook, reviewsSection));
	}
}

async function loadRelatedBooks(remoteBook, relatedSection) {
	const relatedGrid = relatedSection.querySelector('.related-book-grid');
	const status = relatedSection.querySelector('.related-status');
	setDetailFeedback(status, 'loading', 'Đang tải sách liên quan...');
	try {
		const response = await window.booknestApiFetch(`/api/books/${encodeURIComponent(remoteBook.id)}/related`);
		if (!response.ok) {
			const error = new Error('Không thể tải sách liên quan.');
			error.status = response.status;
			throw error;
		}
		const relatedBooks = await response.json();
		if (!Array.isArray(relatedBooks)) throw new Error('Dữ liệu sách liên quan không hợp lệ.');
		relatedGrid.innerHTML = relatedBooks.map((relatedBook) => `<a class="related-book-card" href="${getBookDetailsUrl(relatedBook)}"><img src="${escapeHtml(getBookImage(relatedBook))}" alt="" loading="lazy" decoding="async"><strong>${escapeHtml(relatedBook.title)}</strong><small>${escapeHtml(relatedBook.author)}</small><b>${formatPrice(relatedBook.price)}</b></a>`).join('') || '<p>Chưa có sách phù hợp để gợi ý.</p>';
		setDetailFeedback(status, relatedBooks.length ? 'ready' : 'empty', '');
	} catch (error) {
		setDetailFeedback(status, 'error', detailErrorMessage(error, 'sách liên quan'), () => loadRelatedBooks(remoteBook, relatedSection));
	}
}

if (!book) {
	renderDetail('<div class="detail-empty"><p class="eyebrow">Không tìm thấy sách</p><h1>Thông tin sách không hợp lệ.</h1><a class="primary-button" href="index.html#books">Về danh sách sách</a></div>');
} else {
	const relatedBooks = catalog.filter((item) => item.category === book.category && item.title !== book.title).slice(0, 4);
	const navigation = getBookNavigation(book);
	const pictureSources = getBookPictureSources(book.images?.[0]);
	document.title = `${book.title} | BookNest`;
	renderDetail(`
		<a class="detail-back" href="index.html#books">← Quay lại danh sách sách</a>
		<nav class="detail-navigation" aria-label="Chuyển đổi sách">
			${navigation.previous ? `<a href="${getBookDetailsUrl(navigation.previous)}">← <span>Sách trước</span><strong>${escapeHtml(navigation.previous.title)}</strong></a>` : '<span class="detail-navigation-placeholder"></span>'}
			${navigation.next ? `<a class="detail-navigation-next" href="${getBookDetailsUrl(navigation.next)}"><span>Sách tiếp theo</span> →<strong>${escapeHtml(navigation.next.title)}</strong></a>` : '<span class="detail-navigation-placeholder"></span>'}
		</nav>
		<div class="book-detail-grid">
		<div class="detail-cover">${pictureSources ? '<picture>' : ''}${pictureSources}<img width="400" height="600" src="${escapeHtml(getBookImage(book))}" alt="Bìa sách ${escapeHtml(book.title)} - ${escapeHtml(book.author)}" loading="eager" fetchpriority="high" decoding="async">${pictureSources ? '</picture>' : ''}</div>
			<div class="detail-copy">
				<p class="eyebrow">${escapeHtml(categoryLabels[book.category] || 'BookNest')}</p>
				<h1>${escapeHtml(book.title)}</h1>
				<p class="detail-author">Tác giả: <strong>${escapeHtml(book.author)}</strong></p>
				${book.publisher ? `<p class="detail-publisher">Nhà xuất bản: <strong>${escapeHtml(book.publisher)}</strong></p>` : ''}
				<p class="detail-price">${formatPrice(book.price)}</p>
				<p class="detail-description">${escapeHtml(getBookDescription(book))}</p>
				<div class="detail-actions"><button class="primary-button" id="buyBook" type="button">Mua ngay</button><a class="secondary-button" href="index.html#books">Chọn sách khác</a></div>
				<p class="payment-note" id="productReturnNotice">Hỗ trợ <a href="returns.html">đổi trả trong 7 ngày</a> (miễn phí vận chuyển nếu sách lỗi/giao sai) và <a href="refund.html">hoàn tiền minh bạch</a>.</p>
			</div>
		</div>
		<section class="detail-extra" aria-labelledby="detailIntroTitle">
			<p class="eyebrow">Đọc và khám phá</p>
			<h2 id="detailIntroTitle">Vì sao nên chọn cuốn sách này?</h2>
			<p>${escapeHtml(categoryDescriptions[book.category] || 'Một lựa chọn đáng đọc trong bộ sưu tập BookNest.')} ${escapeHtml(`Bạn có thể bắt đầu từ những chương đầu và ghi lại các ý tưởng đáng nhớ của “${book.title}”.`)}</p>
		</section>
		<section class="related-books" aria-labelledby="relatedBooksTitle">
			<div class="section-heading"><div><p class="eyebrow">Có thể bạn sẽ thích</p><h2 id="relatedBooksTitle">Sách khác cùng thể loại</h2></div><a class="back-link" href="index.html#books">Xem toàn bộ sách →</a></div>
			<div class="detail-feedback related-status" role="status" aria-live="polite" hidden></div>
			<div class="related-book-grid">${relatedBooks.map((relatedBook) => `<a class="related-book-card" href="${getBookDetailsUrl(relatedBook)}"><div class="related-book-cover ${getBookCoverStyle(relatedBook)}"><span>${escapeHtml(relatedBook.label || relatedBook.title).replace(/\n/g, '<br>')}</span></div><strong>${escapeHtml(relatedBook.title)}</strong><small>${escapeHtml(relatedBook.author)}</small><b>${formatPrice(relatedBook.price)}</b></a>`).join('')}</div>
		</section>`);
	document.querySelector('#buyBook').addEventListener('click', () => addBookToCart(book));
	const detailImage = detail.querySelector('.detail-cover img');
	detailImage.addEventListener('error', () => {
		 detailImage.closest('picture')?.querySelectorAll('source').forEach((source) => source.remove());
		detailImage.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><rect width="600" height="800" fill="#315c70"/><rect x="36" y="36" width="528" height="728" fill="none" stroke="#fffdf8" stroke-width="3"/><text x="70" y="300" fill="#fffdf8" font-family="Georgia,serif" font-size="42">${escapeHtml(book.title)}</text><text x="70" y="670" fill="#f7f3eb" font-family="Arial,sans-serif" font-size="22">${escapeHtml(book.author)}</text></svg>`)}`;
	}, { once: true });
}

async function hydrateBookDetails() {
	if (!window.BOOKNEST_API_BASE_URL || !requestedTitle) return;
	setDetailFeedback(detailStatus, 'loading', 'Đang tải thông tin sách...');
	try {
		if (typeof window.booknestApiFetch !== 'function') throw new Error('API client chưa được khởi tạo.');
		const catalogResponse = await window.booknestApiFetch(`/api/books?search=${encodeURIComponent(requestedTitle)}&limit=100`);
		if (!catalogResponse.ok) {
			const error = new Error('Không thể tải thông tin sách.');
			error.status = catalogResponse.status;
			throw error;
		}
		const remoteBooks = await catalogResponse.json();
		const remoteBook = Array.isArray(remoteBooks)
			? remoteBooks.find((item) => item.title === requestedTitle)
			: null;
		if (!remoteBook) {
			if (book) {
				renderDetail('<div class="detail-empty"><p class="eyebrow">Không tìm thấy sách</p><h1>Cuốn sách này không còn trong danh mục.</h1><a class="primary-button" href="index.html#books">Về danh sách sách</a></div>');
				document.title = 'Không tìm thấy sách | BookNest';
			}
			setDetailFeedback(detailStatus, 'empty', '');
			return;
		}
		if (!book) {
			renderDetail(`
				<a class="detail-back" href="index.html#books">← Quay lại danh sách sách</a>
				<div class="book-detail-grid">
					<div class="detail-cover">${getBookPictureSources(remoteBook.images?.[0]) ? `<picture>${getBookPictureSources(remoteBook.images?.[0])}` : ''}<img width="400" height="600" src="${escapeHtml(getBookImage(remoteBook))}" alt="Bìa sách ${escapeHtml(remoteBook.title)}" loading="eager" decoding="async">${getBookPictureSources(remoteBook.images?.[0]) ? '</picture>' : ''}</div>
					<div class="detail-copy">
						<p class="eyebrow">${escapeHtml(categoryLabels[remoteBook.category] || 'BookNest')}</p>
						<h1>${escapeHtml(remoteBook.title)}</h1>
						<p class="detail-author">Tác giả: <strong>${escapeHtml(remoteBook.author)}</strong></p>
						${remoteBook.publisher ? `<p class="detail-publisher">Nhà xuất bản: <strong>${escapeHtml(remoteBook.publisher)}</strong></p>` : ''}
						<p class="detail-price">${formatPrice(remoteBook.price)}</p>
						<p class="detail-description">${escapeHtml(remoteBook.description || 'Chưa có mô tả cho cuốn sách này.')}</p>
						<p class="detail-stock">${Number(remoteBook.stock) > 0 ? `Còn ${Number(remoteBook.stock)} cuốn` : 'Tạm hết hàng'}</p>
						${remoteBook.isbn ? `<p class="detail-isbn">ISBN: <strong>${escapeHtml(remoteBook.isbn)}</strong></p>` : ''}
						<div class="detail-actions"><button class="primary-button" id="buyBook" type="button" ${Number(remoteBook.stock) < 1 ? 'disabled' : ''}>${Number(remoteBook.stock) < 1 ? 'Hết hàng' : 'Thêm vào giỏ'}</button></div>
					</div>
				</div>
				<section class="related-books" aria-labelledby="relatedBooksTitle"><h2 id="relatedBooksTitle">Sách liên quan</h2><div class="detail-feedback related-status" role="status" aria-live="polite" hidden></div><div class="related-book-grid"></div></section>`);
			document.title = `${remoteBook.title} | BookNest`;
			detail.querySelector('.detail-cover img')?.addEventListener('error', (event) => {
				const image = event.currentTarget;
				image.closest('picture')?.querySelectorAll('source').forEach((source) => source.remove());
				image.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><rect width="600" height="800" fill="#315c70"/><text x="50" y="400" fill="white" font-size="32">Ảnh sách không khả dụng</text></svg>')}`;
			}, { once: true });
			if (Number(remoteBook.stock) > 0) {
				detail.querySelector('#buyBook').addEventListener('click', () => addBookToCart(remoteBook));
			}
		} else {
			updateBookMetadata(remoteBook);
		}
		setDetailFeedback(detailStatus, 'ready', '');

		const imageList = Array.isArray(remoteBook.images) && remoteBook.images.length
			? remoteBook.images
			: [{ url: getBookImage(remoteBook), alt: `Bìa sách ${remoteBook.title}` }];
		const cover = detail.querySelector('.detail-cover');
		if (cover && imageList.length > 1) {
			cover.innerHTML = `<picture>${getBookPictureSources(imageList[0])}<img class="detail-gallery-main" width="400" height="600" src="${escapeHtml(imageList[0].url || imageList[0].src)}" alt="${escapeHtml(imageList[0].alt || remoteBook.title)}" loading="eager" decoding="async"></picture><div class="detail-gallery-thumbnails" role="group" aria-label="Ảnh sách">${imageList.map((image, index) => `<button type="button" data-gallery-index="${index}" aria-label="Xem ảnh ${index + 1}" aria-pressed="${index === 0}"><img src="${escapeHtml(image.url || image.src)}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>`;
			cover.addEventListener('click', (event) => {
				const button = event.target.closest('[data-gallery-index]');
				if (!button) return;
				const selected = imageList[Number(button.dataset.galleryIndex)];
				const main = cover.querySelector('.detail-gallery-main');
				main.src = selected.url || selected.src;
				main.alt = selected.alt || `Ảnh sách ${remoteBook.title}`;
				const picture = main.closest('picture');
				picture.querySelectorAll('source').forEach((source) => source.remove());
				picture.insertAdjacentHTML('afterbegin', getBookPictureSources(selected));
				cover.querySelectorAll('[data-gallery-index]').forEach((item) =>
					item.setAttribute('aria-pressed', String(item === button))
				);
			});
			cover.querySelectorAll('.detail-gallery-thumbnails img').forEach((image) => {
				image.addEventListener('error', () => {
					image.closest('button').hidden = true;
				}, { once: true });
			});
			cover.querySelector('.detail-gallery-main')?.addEventListener('error', (event) => {
				const image = event.currentTarget;
				image.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><rect width="600" height="800" fill="#315c70"/><text x="50" y="400" fill="white" font-size="32">Ảnh sách không khả dụng</text></svg>')}`;
			}, { once: true });
		} else if (cover) {
			const image = cover.querySelector('img');
			if (image) {
				image.src = imageList[0].url || imageList[0].src;
				image.alt = imageList[0].alt || `Bìa sách ${remoteBook.title}`;
				const picture = image.closest('picture');
				if (picture) {
					picture.querySelectorAll('source').forEach((source) => source.remove());
					picture.insertAdjacentHTML('afterbegin', getBookPictureSources(imageList[0]));
				}
			}
		}

		const reviewsSection = document.createElement('section');
		reviewsSection.className = 'book-reviews';
		reviewsSection.setAttribute('aria-labelledby', 'bookReviewsTitle');
		reviewsSection.innerHTML = '<h2 id="bookReviewsTitle">Đánh giá của độc giả</h2><div class="review-summary detail-feedback" role="status" aria-live="polite"></div><div class="review-list"></div><form class="review-form"><label>Điểm đánh giá <select name="rating" required><option value="5">5 — Rất hay</option><option value="4">4 — Hay</option><option value="3">3 — Bình thường</option><option value="2">2 — Chưa phù hợp</option><option value="1">1 — Không hài lòng</option></select></label><label>Nhận xét <textarea name="content" maxlength="1000" required></textarea></label><button type="submit">Gửi đánh giá</button><p class="review-form-message" role="status"></p></form>';
		detail.querySelector('.related-books')?.before(reviewsSection);
		await loadBookReviews(remoteBook, reviewsSection);
		reviewsSection.querySelector('.review-list').addEventListener('click', async (event) => {
			const reportButton = event.target.closest('[data-report-review]');
			if (!reportButton) return;
			const token = window.booknestAuth?.getToken?.();
			if (!token) {
				reviewsSection.querySelector('.review-form-message').textContent = 'Vui lòng đăng nhập để báo cáo đánh giá.';
				return;
			}
			reportButton.disabled = true;
			try {
				const response = await window.booknestApiFetch(
					`/api/reviews/${encodeURIComponent(reportButton.dataset.reportReview)}/report`,
					{ method: 'POST', headers: { Authorization: `Bearer ${token}` } }
				);
				const result = await response.json();
				if (!response.ok) throw new Error(result.error || 'Không thể báo cáo đánh giá.');
				reportButton.textContent = 'Đã báo cáo';
			} catch (error) {
				reportButton.disabled = false;
				reviewsSection.querySelector('.review-form-message').textContent = error.message || 'Không thể báo cáo đánh giá.';
			}
		});
		reviewsSection.querySelector('.review-form').addEventListener('submit', async (event) => {
			event.preventDefault();
			const form = event.currentTarget;
			const message = form.querySelector('.review-form-message');
			const token = window.booknestAuth?.getToken?.();
			if (!token) {
				message.textContent = 'Vui lòng đăng nhập và hoàn tất mua cuốn sách này để gửi đánh giá.';
				return;
			}
			const submit = form.querySelector('button[type="submit"]');
			submit.disabled = true;
			try {
				const response = await window.booknestApiFetch(`/api/books/${encodeURIComponent(remoteBook.id)}/reviews`, {
					method: 'POST',
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({
						rating: Number(form.elements.rating.value),
						content: form.elements.content.value
					})
				});
				const result = await response.json();
				if (!response.ok) throw new Error(result.error || 'Không thể gửi đánh giá.');
				message.textContent = result.message;
				form.reset();
			} catch (error) {
				message.textContent = error.message || 'Không thể gửi đánh giá.';
			} finally {
				submit.disabled = false;
			}
		});

		const relatedSection = detail.querySelector('.related-books');
		if (relatedSection) await loadRelatedBooks(remoteBook, relatedSection);
	} catch (error) {
		setDetailFeedback(detailStatus, 'error', detailErrorMessage(error, 'thông tin sách'), () => hydrateBookDetails());
	}
}

void hydrateBookDetails();
