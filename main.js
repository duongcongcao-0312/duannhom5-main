const books = [
	{ title: 'Nhà giả kim', author: 'Paulo Coelho', price: 89000, category: 'van-hoc', cover: 'cover-1', label: 'THE\nALCHEMIST', image: 'https://covers.openlibrary.org/b/id/14846382-L.jpg?default=false' },
	{ title: 'Đi tìm lẽ sống', author: 'Viktor E. Frankl', price: 99000, category: 'ky-nang', cover: 'cover-2', label: 'MAN’S\nSEARCH' },
	{ title: 'Tư duy nhanh và chậm', author: 'Daniel Kahneman', price: 159000, category: 'kinh-te', cover: 'cover-3', label: 'THINKING\nFAST & SLOW', image: 'https://covers.openlibrary.org/b/id/13290711-L.jpg?default=false' },
	{ title: 'Tuổi trẻ đáng giá bao nhiêu?', author: 'Rosie Nguyễn', price: 89000, category: 'ky-nang', cover: 'cover-4', label: 'TUỔI TRẺ\nĐÁNG GIÁ?' },
	{ title: 'Mắt biếc', author: 'Nguyễn Nhật Ánh', price: 99000, category: 'van-hoc', cover: 'cover-5', label: 'MẮT\nBIẾC', image: 'https://covers.openlibrary.org/b/id/13258074-L.jpg?default=false' },
	{ title: 'Đắc nhân tâm', author: 'Dale Carnegie', price: 98000, category: 'ky-nang', cover: 'cover-2', label: 'ĐẮC NHÂN\nTÂM', image: 'https://covers.openlibrary.org/b/id/13314878-L.jpg?default=false' },
	{ title: 'Sapiens: Lược sử loài người', author: 'Yuval Noah Harari', price: 189000, category: 'kinh-te', cover: 'cover-3', label: 'SAPIENS', image: 'https://covers.openlibrary.org/b/id/8634250-L.jpg?default=false' },
	{ title: 'Dám bị ghét', author: 'Ichiro Kishimi, Fumitake Koga', price: 109000, category: 'ky-nang', cover: 'cover-4', label: 'DÁM BỊ GHÉT' },
	{ title: 'Người giàu có nhất thành Babylon', author: 'George S. Clason', price: 89000, category: 'kinh-te', cover: 'cover-1', label: 'NGƯỜI GIÀU\nBABYLON', image: 'https://covers.openlibrary.org/b/id/10491331-L.jpg?default=false' },
	{ title: 'Bố già', author: 'Mario Puzo', price: 159000, category: 'van-hoc', cover: 'cover-5', label: 'BỐ GIÀ', image: 'https://covers.openlibrary.org/b/id/6507069-L.jpg?default=false' },
	{ title: 'Cà phê cùng Tony', author: 'Tony Buổi Sáng', price: 90000, category: 'ky-nang', cover: 'cover-2', label: 'CÀ PHÊ\nCÙNG TONY', image: 'https://covers.openlibrary.org/b/id/9175811-L.jpg?default=false' },
	{ title: 'Nghĩ giàu và làm giàu', author: 'Napoleon Hill', price: 115000, category: 'kinh-te', cover: 'cover-3', label: 'NGHĨ GIÀU\nLÀM GIÀU', image: 'https://covers.openlibrary.org/b/id/14542536-L.jpg?default=false' },
	{ title: 'Hành trình về phương Đông', author: 'Baird T. Spalding', price: 99000, category: 'van-hoc', cover: 'cover-4', label: 'HÀNH TRÌNH\nPHƯƠNG ĐÔNG', image: 'https://covers.openlibrary.org/b/id/1626611-L.jpg?default=false' },
	{ title: 'Cho tôi xin một vé đi tuổi thơ', author: 'Nguyễn Nhật Ánh', price: 85000, category: 'van-hoc', cover: 'cover-5', label: 'VÉ ĐI\nTUỔI THƠ' },
	{ title: 'Không gia đình', author: 'Hector Malot', price: 145000, category: 'van-hoc', cover: 'cover-1', label: 'KHÔNG\nGIA ĐÌNH', image: 'https://covers.openlibrary.org/b/id/5754078-L.jpg?default=false' },
	{ title: 'Lược sử thời gian', author: 'Stephen Hawking', price: 165000, category: 'khoa-hoc', cover: 'cover-2', label: 'LƯỢC SỬ\nTHỜI GIAN' },
	{ title: 'Vũ trụ', author: 'Carl Sagan', price: 189000, category: 'khoa-hoc', cover: 'cover-3', label: 'VŨ TRỤ' },
	{ title: 'Súng, vi trùng và thép', author: 'Jared Diamond', price: 215000, category: 'lich-su', cover: 'cover-4', label: 'SÚNG, VI TRÙNG\nVÀ THÉP' },
	{ title: 'Việt Nam sử lược', author: 'Trần Trọng Kim', price: 175000, category: 'lich-su', cover: 'cover-5', label: 'VIỆT NAM\nSỬ LƯỢC' },
	{ title: 'Harry Potter và Hòn đá Phù thủy', author: 'J. K. Rowling', price: 120000, category: 'thieu-nhi', cover: 'cover-1', label: 'HARRY\nPOTTER' },
	{ title: 'Dế mèn phiêu lưu ký', author: 'Tô Hoài', price: 78000, category: 'thieu-nhi', cover: 'cover-2', label: 'DẾ MÈN\nPHIÊU LƯU KÝ' },
	{ title: 'Sherlock Holmes toàn tập', author: 'Arthur Conan Doyle', price: 249000, category: 'trinh-tham', cover: 'cover-3', label: 'SHERLOCK\nHOLMES' },
	{ title: 'Án mạng trên chuyến tàu tốc hành Phương Đông', author: 'Agatha Christie', price: 135000, category: 'trinh-tham', cover: 'cover-4', label: 'ÁN MẠNG\nPHƯƠNG ĐÔNG' },
	{ title: 'Tâm lý học đám đông', author: 'Gustave Le Bon', price: 99000, category: 'tam-ly', cover: 'cover-5', label: 'TÂM LÝ HỌC\nĐÁM ĐÔNG' },
	{ title: 'Bắt trẻ đồng xanh', author: 'J. D. Salinger', price: 118000, category: 'tam-ly', cover: 'cover-1', label: 'BẮT TRẺ\nĐỒNG XANH' },
	{ title: 'Clean Code', author: 'Robert C. Martin', price: 320000, category: 'cong-nghe', cover: 'cover-2', label: 'CLEAN\nCODE' },
	{ title: 'Design Patterns', author: 'Erich Gamma và cộng sự', price: 350000, category: 'cong-nghe', cover: 'cover-3', label: 'DESIGN\nPATTERNS' },
	{ title: 'English Grammar in Use', author: 'Raymond Murphy', price: 210000, category: 'ngoai-ngu', cover: 'cover-4', label: 'ENGLISH\nGRAMMAR' },
	{ title: 'Từ điển Anh - Việt', author: 'Nhiều tác giả', price: 145000, category: 'ngoai-ngu', cover: 'cover-5', label: 'ANH - VIỆT' },
	{ title: 'Những người khốn khổ', author: 'Victor Hugo', price: 198000, category: 'van-hoc', cover: 'cover-1', label: 'NHỮNG NGƯỜI\nKHỐN KHỔ' },
	{ title: 'Thằng gù Nhà thờ Đức Bà', author: 'Victor Hugo', price: 155000, category: 'van-hoc', cover: 'cover-2', label: 'NHÀ THỜ\nĐỨC BÀ' },
	{ title: '7 thói quen hiệu quả', author: 'Stephen R. Covey', price: 175000, category: 'ky-nang', cover: 'cover-3', label: '7 THÓI QUEN\nHIỆU QUẢ' },
	{ title: 'Atomic Habits', author: 'James Clear', price: 189000, category: 'ky-nang', cover: 'cover-4', label: 'ATOMIC\nHABITS' },
	{ title: 'Nghệ thuật tinh tế của việc đếch quan tâm', author: 'Mark Manson', price: 149000, category: 'ky-nang', cover: 'cover-5', label: 'NGHỆ THUẬT\nTINH TẾ' },
	{ title: 'Cha giàu cha nghèo', author: 'Robert Kiyosaki', price: 169000, category: 'kinh-te', cover: 'cover-1', label: 'CHA GIÀU\nCHA NGHÈO' },
	{ title: 'Nhà đầu tư thông minh', author: 'Benjamin Graham', price: 250000, category: 'kinh-te', cover: 'cover-2', label: 'NHÀ ĐẦU TƯ\nTHÔNG MINH' },
	{ title: 'Quốc gia khởi nghiệp', author: 'Dan Senor, Saul Singer', price: 135000, category: 'kinh-te', cover: 'cover-3', label: 'QUỐC GIA\nKHỞI NGHIỆP' },
	{ title: 'Kinh tế học hài hước', author: 'Steven D. Levitt', price: 125000, category: 'kinh-te', cover: 'cover-4', label: 'KINH TẾ HỌC\nHÀI HƯỚC' },
	{ title: 'Gen: Lịch sử tự nhiên của sự sống', author: 'Siddhartha Mukherjee', price: 245000, category: 'khoa-hoc', cover: 'cover-5', label: 'GEN\nSỰ SỐNG' },
	{ title: 'Lược sử vạn vật', author: 'Bill Bryson', price: 210000, category: 'khoa-hoc', cover: 'cover-1', label: 'LƯỢC SỬ\nVẠN VẬT' },
	{ title: 'Vật lý của những điều tưởng chừng không thể', author: 'Michio Kaku', price: 195000, category: 'khoa-hoc', cover: 'cover-2', label: 'VẬT LÝ\nKỲ DIỆU' },
	{ title: 'Toán học vui', author: 'Martin Gardner', price: 145000, category: 'khoa-hoc', cover: 'cover-3', label: 'TOÁN HỌC\nVUI' },
	{ title: 'Câu chuyện khoa học', author: 'Nhiều tác giả', price: 130000, category: 'khoa-hoc', cover: 'cover-4', label: 'CÂU CHUYỆN\nKHOA HỌC' },
	{ title: 'Homo Deus', author: 'Yuval Noah Harari', price: 225000, category: 'khoa-hoc', cover: 'cover-5', label: 'HOMO\nDEUS' },
	{ title: 'Đại Việt sử ký toàn thư', author: 'Nhiều tác giả', price: 280000, category: 'lich-su', cover: 'cover-1', label: 'ĐẠI VIỆT\nSỬ KÝ' },
	{ title: 'Lịch sử thế giới', author: 'E. H. Gombrich', price: 220000, category: 'lich-su', cover: 'cover-2', label: 'LỊCH SỬ\nTHẾ GIỚI' },
	{ title: 'Chiến tranh và hòa bình', author: 'Lev Tolstoy', price: 260000, category: 'lich-su', cover: 'cover-3', label: 'CHIẾN TRANH\nVÀ HÒA BÌNH' },
	{ title: 'Winston Churchill: Tiểu sử', author: 'Andrew Roberts', price: 245000, category: 'lich-su', cover: 'cover-4', label: 'WINSTON\nCHURCHILL' },
	{ title: 'Cổ sử Trung Hoa', author: 'Ngô Sĩ Liên', price: 180000, category: 'lich-su', cover: 'cover-5', label: 'CỔ SỬ\nTRUNG HOA' },
	{ title: 'Lịch sử Việt Nam bằng tranh', author: 'Nhiều tác giả', price: 115000, category: 'lich-su', cover: 'cover-1', label: 'LỊCH SỬ\nVIỆT NAM' },
	{ title: 'Hoàng tử bé', author: 'Antoine de Saint-Exupéry', price: 69000, category: 'thieu-nhi', cover: 'cover-2', label: 'HOÀNG\nTỬ BÉ' },
	{ title: 'Alice ở xứ sở diệu kỳ', author: 'Lewis Carroll', price: 85000, category: 'thieu-nhi', cover: 'cover-3', label: 'ALICE\nDIỆU KỲ' },
	{ title: 'Winnie-the-Pooh', author: 'A. A. Milne', price: 95000, category: 'thieu-nhi', cover: 'cover-4', label: 'WINNIE\nTHE POOH' },
	{ title: 'Nghìn lẻ một đêm', author: 'Nhiều tác giả', price: 125000, category: 'thieu-nhi', cover: 'cover-5', label: 'NGHÌN LẺ\nMỘT ĐÊM' },
	{ title: 'Kính vạn hoa', author: 'Nguyễn Nhật Ánh', price: 88000, category: 'thieu-nhi', cover: 'cover-1', label: 'KÍNH\nVẠN HOA' },
	{ title: 'Chuyện con mèo dạy hải âu bay', author: 'Luis Sepúlveda', price: 78000, category: 'thieu-nhi', cover: 'cover-2', label: 'MÈO DẠY\nHẢI ÂU' },
	{ title: 'Mật mã Da Vinci', author: 'Dan Brown', price: 159000, category: 'trinh-tham', cover: 'cover-3', label: 'MẬT MÃ\nDA VINCI' },
	{ title: 'Cô gái có hình xăm rồng', author: 'Stieg Larsson', price: 169000, category: 'trinh-tham', cover: 'cover-4', label: 'HÌNH XĂM\nRỒNG' },
	{ title: 'Mười người da đen', author: 'Agatha Christie', price: 119000, category: 'trinh-tham', cover: 'cover-5', label: 'MƯỜI NGƯỜI\nDA ĐEN' },
	{ title: 'Người gác đêm', author: 'Jeffery Deaver', price: 139000, category: 'trinh-tham', cover: 'cover-1', label: 'NGƯỜI\nGÁC ĐÊM' },
	{ title: 'Phía sau nghi can X', author: 'Higashino Keigo', price: 125000, category: 'trinh-tham', cover: 'cover-2', label: 'NGHI CAN X' },
	{ title: 'Sự im lặng của bầy cừu', author: 'Thomas Harris', price: 149000, category: 'trinh-tham', cover: 'cover-3', label: 'SỰ IM LẶNG\nBẦY CỪU' },
	{ title: 'Trí tuệ xúc cảm', author: 'Daniel Goleman', price: 185000, category: 'tam-ly', cover: 'cover-4', label: 'TRÍ TUỆ\nXÚC CẢM' },
	{ title: 'Im lặng: Sức mạnh của người hướng nội', author: 'Susan Cain', price: 155000, category: 'tam-ly', cover: 'cover-5', label: 'SỨC MẠNH\nHƯỚNG NỘI' },
	{ title: 'Tư duy tích cực', author: 'Norman Vincent Peale', price: 99000, category: 'tam-ly', cover: 'cover-1', label: 'TƯ DUY\nTÍCH CỰC' },
	{ title: 'Nghệ thuật yêu', author: 'Erich Fromm', price: 110000, category: 'tam-ly', cover: 'cover-2', label: 'NGHỆ THUẬT\nYÊU' },
	{ title: 'Cạm bẫy của tâm trí', author: 'Daniel Kahneman', price: 145000, category: 'tam-ly', cover: 'cover-3', label: 'CẠM BẪY\nTÂM TRÍ' },
	{ title: 'Tâm lý học tiền', author: 'Morgan Housel', price: 175000, category: 'tam-ly', cover: 'cover-4', label: 'TÂM LÝ\nTIỀN' },
	{ title: 'The Pragmatic Programmer', author: 'David Thomas, Andrew Hunt', price: 330000, category: 'cong-nghe', cover: 'cover-5', label: 'PRAGMATIC\nPROGRAMMER' },
	{ title: 'JavaScript hiện đại', author: 'Marijn Haverbeke', price: 290000, category: 'cong-nghe', cover: 'cover-1', label: 'JAVASCRIPT\nHIỆN ĐẠI' },
	{ title: 'Eloquent JavaScript', author: 'Marijn Haverbeke', price: 275000, category: 'cong-nghe', cover: 'cover-2', label: 'ELOQUENT\nJAVASCRIPT' },
	{ title: 'You Don\'t Know JS', author: 'Kyle Simpson', price: 285000, category: 'cong-nghe', cover: 'cover-3', label: 'YOU DON\'T\nKNOW JS' },
	{ title: 'AI 2041', author: 'Kai-Fu Lee, Chen Qiufan', price: 220000, category: 'cong-nghe', cover: 'cover-4', label: 'AI\n2041' },
	{ title: 'Học máy cơ bản', author: 'Nhiều tác giả', price: 245000, category: 'cong-nghe', cover: 'cover-5', label: 'HỌC MÁY\nCƠ BẢN' },
	{ title: 'Oxford Word Skills', author: 'Ruth Gairns, Stuart Redman', price: 185000, category: 'ngoai-ngu', cover: 'cover-1', label: 'OXFORD\nWORD SKILLS' },
	{ title: 'Tự học TOEIC', author: 'Nhiều tác giả', price: 145000, category: 'ngoai-ngu', cover: 'cover-2', label: 'TỰ HỌC\nTOEIC' },
	{ title: 'IELTS Practice Tests', author: 'Nhiều tác giả', price: 195000, category: 'ngoai-ngu', cover: 'cover-3', label: 'IELTS\nPRACTICE' },
	{ title: 'Tự học tiếng Nhật', author: 'Nhiều tác giả', price: 155000, category: 'ngoai-ngu', cover: 'cover-4', label: 'TIẾNG\nNHẬT' },
	{ title: 'Giáo trình tiếng Trung', author: 'Nhiều tác giả', price: 165000, category: 'ngoai-ngu', cover: 'cover-5', label: 'TIẾNG\nTRUNG' },
	{ title: 'Tiếng Hàn sơ cấp', author: 'Nhiều tác giả', price: 150000, category: 'ngoai-ngu', cover: 'cover-1', label: 'TIẾNG\nHÀN' }
];

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

function loadCurrentUser() {
	try {
		return JSON.parse(localStorage.getItem(CURRENT_USER_STORAGE_KEY) || 'null');
	} catch (error) {
		return null;
	}
}

const state = { cart: loadCart(), user: loadCurrentUser() };
const bookGrid = document.querySelector('#bookGrid');
const searchInput = document.querySelector('#searchInput');
const categoryFilter = document.querySelector('#categoryFilter');

function renderCategories() {
	categoryFilter.innerHTML = '<option value="all">Tất cả thể loại</option>' + categories.map((category) => `<option value="${category.value}">${category.label}</option>`).join('');
	document.querySelector('.category-list').innerHTML = categories.map((category) => {
		const count = books.filter((book) => book.category === category.value).length;
		return `<button data-category="${category.value}" type="button"><span>${category.label}<small>${count} tựa sách</small></span><span>→</span></button>`;
	}).join('');
	document.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => {
		categoryFilter.value = button.dataset.category;
		renderBooks();
		document.querySelector('#books').scrollIntoView({ behavior: 'smooth' });
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

function renderBooks() {
	const query = searchInput.value.trim().toLowerCase();
	const category = categoryFilter.value;
	const visibleBooks = books.filter((book) => {
		const matchesQuery = `${book.title} ${book.author}`.toLowerCase().includes(query);
		return matchesQuery && (category === 'all' || book.category === category);
	});
	bookGrid.innerHTML = visibleBooks.map((book) => `
		<article class="book-card">
			<div class="cover ${escapeHtml(book.cover)} has-image"><img class="cover-image" data-book-title="${escapeHtml(book.title)}" data-book-author="${escapeHtml(book.author)}" src="${escapeHtml(getBookImage(book))}" alt="Bìa sách ${escapeHtml(book.title)} - ${escapeHtml(book.author)}" loading="lazy" decoding="async"><span class="cover-label">${escapeHtml(book.label).replace('\n', '<br>')}</span></div>
			<div class="book-info">
				<h3>${escapeHtml(book.title)}</h3><p class="author">${escapeHtml(book.author)}</p>
				<div class="book-bottom"><span class="price">${formatPrice(book.price)}</span><a class="details-link" href="${getBookDetailsUrl(book)}">Chi tiết</a><button class="add-button" data-title="${escapeHtml(book.title)}" type="button">Thêm vào giỏ</button></div>
			</div>
		</article>`).join('');
	removeFailedImages(bookGrid);
	document.querySelector('#emptyState').hidden = visibleBooks.length > 0;
	document.querySelector('#bookCount').textContent = visibleBooks.length;
}

function addToCart(title) {
	const book = books.find((item) => item.title === title);
	if (!book) return;
	state.cart.push(book);
	renderCart();
}

function removeFromCart(index) {
	if (!Number.isInteger(index) || index < 0 || index >= state.cart.length) return;
	state.cart.splice(index, 1);
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
	document.querySelector('#cartCount').textContent = state.cart.length;
	const cartItems = document.querySelector('#cartItems');
	cartItems.innerHTML = state.cart.length ? state.cart.map((book, index) => `<div class="cart-item"><div class="mini-cover ${escapeHtml(book.cover)}"><img data-book-title="${escapeHtml(book.title)}" data-book-author="${escapeHtml(book.author)}" src="${escapeHtml(getBookImage(book))}" alt="Bìa sách ${escapeHtml(book.title)} - ${escapeHtml(book.author)}" loading="lazy" decoding="async"></div><p>${escapeHtml(book.title)}</p><strong>${formatPrice(book.price)}</strong><button class="remove-button" data-cart-index="${index}" type="button" aria-label="Xóa ${escapeHtml(book.title)} khỏi giỏ hàng">Xóa</button></div>`).join('') : '<p class="cart-empty">Giỏ hàng đang trống.</p>';
	removeFailedImages(cartItems);
	const subtotal = state.cart.reduce((sum, book) => sum + book.price, 0);
	const discount = Math.round(subtotal * getDiscountRate());
	const total = subtotal - discount;
	document.querySelector('#cartSubtotal').textContent = formatPrice(subtotal);
	document.querySelector('#cartDiscount').textContent = `-${formatPrice(discount)}`;
	document.querySelector('#discountLine').hidden = discount === 0;
	document.querySelector('#discountLine span').textContent = getDiscountLabel();
	document.querySelector('#cartTotal').textContent = formatPrice(total);
	document.querySelector('#paymentTotal').textContent = formatPrice(total);
	updatePaymentQr(total);
	document.querySelector('#checkoutButton').disabled = state.cart.length === 0;
}

function toggleCart(open) {
	const cartPanel = document.querySelector('#cartPanel');
	cartPanel.classList.toggle('open', open);
	cartPanel.setAttribute('aria-hidden', String(!open));
	document.querySelector('#overlay').classList.toggle('visible', open);
}

bookGrid.addEventListener('click', (event) => {
	const button = event.target.closest('.add-button');
	if (button) addToCart(button.dataset.title);
});
document.querySelector('#cartItems').addEventListener('click', (event) => {
	const button = event.target.closest('.remove-button');
	if (button) removeFromCart(Number(button.dataset.cartIndex));
});
searchInput.addEventListener('input', renderBooks);
categoryFilter.addEventListener('change', renderBooks);
document.querySelector('#cartButton').addEventListener('click', () => toggleCart(true));
document.querySelector('#closeCart').addEventListener('click', () => toggleCart(false));
document.querySelector('#overlay').addEventListener('click', () => toggleCart(false));
document.querySelector('#checkoutButton').addEventListener('click', () => document.querySelector('#paymentDialog').showModal());
document.querySelector('#closePayment').addEventListener('click', () => document.querySelector('#paymentDialog').close());
document.querySelectorAll('input[name="paymentMethod"]').forEach((input) => input.addEventListener('change', () => {
	const isTransfer = input.value === 'transfer' && input.checked;
	document.querySelector('#transferDetails').hidden = !isTransfer;
}));
document.querySelector('#paymentForm').addEventListener('submit', (event) => {
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
		const subtotal = state.cart.reduce((sum, book) => sum + book.price, 0);
		const total = subtotal - Math.round(subtotal * getDiscountRate());
		const message = method === 'cod'
			? `Đặt hàng COD thành công cho ${customerName}! Đơn hàng ${formatPrice(total)} sẽ được giao đến địa chỉ bạn đã cung cấp.`
			: `Đặt hàng thành công cho ${customerName}! Vui lòng hoàn tất chuyển khoản ${formatPrice(total)} để xử lý đơn hàng.`;
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
renderCategories();
renderBooks();
