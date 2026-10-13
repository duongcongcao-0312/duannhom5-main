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

function getBookNavigation(currentBook) {
	const currentIndex = catalog.findIndex((item) => item.title === currentBook.title);
	return {
		previous: currentIndex > 0 ? catalog[currentIndex - 1] : null,
		next: currentIndex >= 0 && currentIndex < catalog.length - 1 ? catalog[currentIndex + 1] : null
	};
}

function getBookDescription(book) {
	const categoryDescription = categoryDescriptions[book.category] || 'Một lựa chọn đáng đọc trong bộ sưu tập BookNest.';
	return `“${book.title}” của ${book.author} là một lựa chọn nổi bật trong nhóm ${categoryLabels[book.category] || 'sách chọn lọc'}. ${categoryDescription} Nội dung phù hợp để đọc chậm rãi, suy ngẫm và tìm thấy những ý tưởng có thể đồng hành cùng bạn trong đời sống hằng ngày.`;
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
		window.alert(message);
	}
}

const params = new URLSearchParams(window.location.search);
const requestedTitle = params.get('title');
const catalog = Array.isArray(globalThis.BOOKNEST_BOOKS) ? globalThis.BOOKNEST_BOOKS : [];
const book = catalog.find((item) => item.title === requestedTitle);
const detail = document.querySelector('#bookDetail');

if (!book) {
	detail.innerHTML = '<div class="detail-empty"><p class="eyebrow">Không tìm thấy sách</p><h1>Thông tin sách không hợp lệ.</h1><a class="primary-button" href="index.html#books">Về danh sách sách</a></div>';
} else {
	const relatedBooks = catalog.filter((item) => item.category === book.category && item.title !== book.title).slice(0, 4);
	const navigation = getBookNavigation(book);
	document.title = `${book.title} | BookNest`;
	detail.innerHTML = `
		<a class="detail-back" href="index.html#books">← Quay lại danh sách sách</a>
		<nav class="detail-navigation" aria-label="Chuyển đổi sách">
			${navigation.previous ? `<a href="${getBookDetailsUrl(navigation.previous)}">← <span>Sách trước</span><strong>${escapeHtml(navigation.previous.title)}</strong></a>` : '<span class="detail-navigation-placeholder"></span>'}
			${navigation.next ? `<a class="detail-navigation-next" href="${getBookDetailsUrl(navigation.next)}"><span>Sách tiếp theo</span> →<strong>${escapeHtml(navigation.next.title)}</strong></a>` : '<span class="detail-navigation-placeholder"></span>'}
		</nav>
		<div class="book-detail-grid">
		<div class="detail-cover"><img src="${escapeHtml(getBookImage(book))}" alt="Bìa sách ${escapeHtml(book.title)} - ${escapeHtml(book.author)}" loading="lazy" decoding="async"></div>
			<div class="detail-copy">
				<p class="eyebrow">${escapeHtml(categoryLabels[book.category] || 'BookNest')}</p>
				<h1>${escapeHtml(book.title)}</h1>
				<p class="detail-author">Tác giả: <strong>${escapeHtml(book.author)}</strong></p>
				<p class="detail-price">${formatPrice(book.price)}</p>
				<p class="detail-description">${escapeHtml(getBookDescription(book))}</p>
				<div class="detail-actions"><button class="primary-button" id="buyBook" type="button">Mua ngay</button><a class="secondary-button" href="index.html#books">Chọn sách khác</a></div>
			</div>
		</div>
		<section class="detail-extra" aria-labelledby="detailIntroTitle">
			<p class="eyebrow">Đọc và khám phá</p>
			<h2 id="detailIntroTitle">Vì sao nên chọn cuốn sách này?</h2>
			<p>${escapeHtml(categoryDescriptions[book.category] || 'Một lựa chọn đáng đọc trong bộ sưu tập BookNest.')} ${escapeHtml(`Bạn có thể bắt đầu từ những chương đầu và ghi lại các ý tưởng đáng nhớ của “${book.title}”.`)}</p>
		</section>
		<section class="related-books" aria-labelledby="relatedBooksTitle">
			<div class="section-heading"><div><p class="eyebrow">Có thể bạn sẽ thích</p><h2 id="relatedBooksTitle">Sách khác cùng thể loại</h2></div><a class="back-link" href="index.html#books">Xem toàn bộ sách →</a></div>
			<div class="related-book-grid">${relatedBooks.map((relatedBook) => `<a class="related-book-card" href="${getBookDetailsUrl(relatedBook)}"><div class="related-book-cover ${escapeHtml(relatedBook.cover)}"><span>${escapeHtml(relatedBook.label).replace(/\n/g, '<br>')}</span></div><strong>${escapeHtml(relatedBook.title)}</strong><small>${escapeHtml(relatedBook.author)}</small><b>${formatPrice(relatedBook.price)}</b></a>`).join('')}</div>
		</section>`;
	document.querySelector('#buyBook').addEventListener('click', () => addBookToCart(book));
	const detailImage = detail.querySelector('.detail-cover img');
	detailImage.addEventListener('error', () => {
		detailImage.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><rect width="600" height="800" fill="#315c70"/><rect x="36" y="36" width="528" height="728" fill="none" stroke="#fffdf8" stroke-width="3"/><text x="70" y="300" fill="#fffdf8" font-family="Georgia,serif" font-size="42">${escapeHtml(book.title)}</text><text x="70" y="670" fill="#f7f3eb" font-family="Arial,sans-serif" font-size="22">${escapeHtml(book.author)}</text></svg>`)}`;
	}, { once: true });
}
