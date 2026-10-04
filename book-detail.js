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

const params = new URLSearchParams(window.location.search);
const title = params.get('title');
const author = params.get('author');
const category = params.get('category');
const price = Number(params.get('price'));
const image = params.get('image');
const detail = document.querySelector('#bookDetail');

if (!title || !author || !category || !Number.isFinite(price)) {
	detail.innerHTML = '<div class="detail-empty"><p class="eyebrow">Không tìm thấy sách</p><h1>Thông tin sách không hợp lệ.</h1><a class="primary-button" href="index.html#books">Về danh sách sách</a></div>';
} else {
	document.title = `${title} | BookNest`;
	detail.innerHTML = `
		<a class="detail-back" href="index.html#books">← Quay lại danh sách sách</a>
		<div class="book-detail-grid">
		<div class="detail-cover"><img src="${escapeHtml(image || '')}" alt="Bìa sách ${escapeHtml(title)} - ${escapeHtml(author)}" loading="lazy" decoding="async"></div>
			<div class="detail-copy">
				<p class="eyebrow">${escapeHtml(categoryLabels[category] || 'BookNest')}</p>
				<h1>${escapeHtml(title)}</h1>
				<p class="detail-author">Tác giả: <strong>${escapeHtml(author)}</strong></p>
				<p class="detail-price">${formatPrice(price)}</p>
				<p class="detail-description">${escapeHtml(categoryDescriptions[category] || 'Một lựa chọn đáng đọc trong bộ sưu tập BookNest.')}</p>
				<div class="detail-actions"><a class="primary-button" href="index.html#books">Chọn sách khác</a><a class="secondary-button" href="index.html#books">Mở giỏ hàng ở trang chính</a></div>
			</div>
		</div>`;
	const detailImage = detail.querySelector('.detail-cover img');
	detailImage.addEventListener('error', () => {
		detailImage.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><rect width="600" height="800" fill="#315c70"/><rect x="36" y="36" width="528" height="728" fill="none" stroke="#fffdf8" stroke-width="3"/><text x="70" y="300" fill="#fffdf8" font-family="Georgia,serif" font-size="42">${escapeHtml(title)}</text><text x="70" y="670" fill="#f7f3eb" font-family="Arial,sans-serif" font-size="22">${escapeHtml(author)}</text></svg>`)}`;
	}, { once: true });
}
