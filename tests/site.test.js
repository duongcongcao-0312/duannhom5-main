const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServer } = require('../server');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('payment UI contains COD and delivery fields', () => {
	const html = read('index.html');
	assert.match(html, /value="cod"/);
	assert.match(html, /name="customerName"/);
	assert.match(html, /name="phone"/);
	assert.match(html, /name="address"/);
	assert.match(html, /id="paymentQr"/);
	assert.match(html, /TCB-88803122007888/);
});

test('images use lazy loading and async decoding', () => {
	const script = read('main.js');
	assert.ok((script.match(/loading="lazy"/g) || []).length >= 2);
	assert.ok((script.match(/decoding="async"/g) || []).length >= 2);
});

test('script validates and safely renders user-facing values', () => {
	const script = read('main.js');
	assert.match(script, /function escapeHtml/);
	assert.match(script, /reportValidity/);
	assert.match(script, /try \{/);
	assert.match(script, /catch \(error\)/);
});

test('cart persists safely between page loads', () => {
	const script = read('main.js');
	assert.match(script, /const CART_STORAGE_KEY = 'booknest-cart'/);
	assert.match(script, /JSON\.parse\(localStorage\.getItem\(CART_STORAGE_KEY/);
	assert.match(script, /localStorage\.setItem\(CART_STORAGE_KEY/);
	assert.match(script, /books\.find\(\(book\) => book\.title === title\)/);
});

test('cart groups duplicate books and provides quantity controls', () => {
	const script = read('main.js');
	const css = read('main.css');
	assert.match(script, /function getCartGroups/);
	assert.match(script, /function changeCartQuantity/);
	assert.match(script, /data-cart-change="-1"/);
	assert.match(script, /data-cart-change="1"/);
	assert.match(script, /data-cart-change="-\$\{quantity\}"/);
	assert.match(css, /\.quantity-control/);
});

test('cart opens as a floating window above the BookNest assistant', () => {
	const css = read('main.css');
	const script = read('main.js');
	assert.match(css, /\.cart-panel \{[^}]*position: fixed/);
	assert.match(css, /\.cart-panel \{[^}]*bottom: 84px/);
	assert.match(css, /\.cart-panel\.open \{[^}]*pointer-events: auto/);
	assert.match(script, /if \(open\) toggleCart\(false\)/);
});

test('responsive CSS includes tablet and mobile breakpoints', () => {
	const css = read('main.css');
	assert.match(css, /max-width: 1024px/);
	assert.match(css, /max-width: 800px/);
	assert.match(css, /max-width: 480px/);
	assert.match(css, /overflow-x: hidden/);
});

test('homepage presents the four-season bookstore layout', () => {
	const html = read('index.html');
	const css = read('main.css');
	['Xuân', 'Hạ', 'Thu', 'Đông'].forEach((season) => assert.match(html, new RegExp(season)));
	assert.match(html, /class="season-strip"/);
	assert.match(css, /\.spring/);
	assert.match(css, /\.summer/);
	assert.match(css, /\.autumn/);
	assert.match(css, /\.winter/);
});

test('SEO, legal and deployment assets exist', () => {
	assert.ok(fs.existsSync(path.join(root, 'sitemap.xml')));
	assert.ok(fs.existsSync(path.join(root, 'robots.txt')));
	assert.ok(fs.existsSync(path.join(root, 'manifest.json')));
	assert.ok(fs.existsSync(path.join(root, 'assets', 'favicon.svg')));
	assert.ok(fs.existsSync(path.join(root, 'privacy.html')));
	assert.ok(fs.existsSync(path.join(root, 'terms.html')));
	assert.ok(fs.existsSync(path.join(root, '.github', 'workflows', 'ci.yml')));
	assert.match(read('index.html'), /property="og:title"/);
	assert.match(read('index.html'), /class="skip-link"/);
});

test('each book category contains eight titles', () => {
	const script = read('books-data.js');
	const categoryValues = ['van-hoc', 'ky-nang', 'kinh-te', 'khoa-hoc', 'lich-su', 'thieu-nhi', 'trinh-tham', 'tam-ly', 'cong-nghe', 'ngoai-ngu'];
	categoryValues.forEach((category) => {
		const count = (script.match(new RegExp(`category: '${category}'`, 'g')) || []).length;
		assert.equal(count, 8, `${category} should contain 8 books`);
	});
});

test('book cards link to a detailed description page', () => {
	const script = read('main.js');
	assert.ok(fs.existsSync(path.join(root, 'book.html')));
	assert.ok(fs.existsSync(path.join(root, 'book-detail.js')));
	assert.match(script, /getBookDetailsUrl/);
	assert.match(script, /class="details-link"/);
	assert.match(read('book-detail.js'), /categoryDescriptions/);
});

test('book details support purchasing and related book discovery', () => {
	const html = read('book.html');
	const script = read('book-detail.js');
	const css = read('main.css');
	assert.match(html, /books-data\.js/);
	assert.match(script, /id="buyBook"/);
	assert.match(script, /localStorage\.setItem\('booknest-cart'/);
	assert.match(script, /relatedBooks/);
	assert.match(script, /Sách khác cùng thể loại/);
	assert.match(css, /\.related-book-grid/);
});

test('book details support previous and next book navigation', () => {
	const script = read('book-detail.js');
	const css = read('main.css');
	assert.match(script, /function getBookNavigation/);
	assert.match(script, /Sách trước/);
	assert.match(script, /Sách tiếp theo/);
	assert.match(css, /\.detail-navigation/);
});

test('account, membership discount and AI assistant are wired', () => {
	const html = read('index.html');
	const script = read('main.js');
	assert.match(html, /id="accountButton"/);
	assert.match(html, /id="registerForm"/);
	assert.match(html, /id="memberPanel"/);
	assert.match(html, /id="aiChat"/);
	assert.match(script, /getDiscountRate/);
	assert.match(script, /getAiAnswer/);
});

test('catalog supports sorting, favorites, coupons and order tracking', () => {
	const html = read('index.html');
	const script = read('main.js');
	const server = read('server.js');
	assert.match(html, /id="sortFilter"/);
	assert.match(html, /id="favoritesFilter"/);
	assert.match(html, /id="couponInput"/);
	assert.match(html, /id="trackOrderForm"/);
	assert.match(script, /FAVORITES_STORAGE_KEY/);
	assert.match(script, /api\/coupons/);
	assert.match(script, /trackOrderForm/);
	assert.match(server, /BOOKNEST10/);
	assert.match(server, /couponCode/);
});

test('book catalog supports price sorting with search and category filters', () => {
	const html = read('index.html');
	const script = read('main.js');
	assert.match(html, /<option value="featured">Sắp xếp nổi bật<\/option>/);
	assert.match(html, /<option value="price-asc">Giá thấp đến cao<\/option>/);
	assert.match(html, /<option value="price-desc">Giá cao đến thấp<\/option>/);
	assert.match(script, /const query = searchInput\.value\.trim\(\)\.toLowerCase\(\)/);
	assert.match(script, /category === 'all' \|\| book\.category === category/);
	assert.match(script, /visibleBooks\.sort\(\(a, b\) => a\.price - b\.price\)/);
	assert.match(script, /visibleBooks\.sort\(\(a, b\) => b\.price - a\.price\)/);
	assert.match(script, /sortFilter\) sortFilter\.addEventListener\('change', renderBooks\)/);
	assert.match(script, /data-title="\$\{escapeHtml\(book\.title\)\}"/);
});
test('storefront includes quick cart, stock visibility and refreshed branding', () => {
	const html = read('index.html');
	const script = read('main.js');
	const server = read('server.js');
	const css = read('main.css');
	assert.match(html, /id="quickCartButton"/);
	assert.match(html, /class="brand-mark"[^>]*>.*<span>B<\/span><i>N<\/i>/s);
	assert.match(script, /function getBookStock/);
	assert.match(script, /quickCartSummary/);
	assert.match(script, /quantityInCart >= getBookStock/);
	assert.match(server, /defaultBookStock/);
	assert.match(server, /vượt quá tồn kho/);
	assert.match(css, /\.quick-cart/);
	assert.match(css, /\.stock-status/);
});

test('quick cart is a compact fixed shortcut that follows the viewport', () => {
	const css = read('main.css');
	assert.match(css, /\.quick-cart \{[^}]*position: fixed/);
	assert.match(css, /\.quick-cart \{[^}]*right: 24px/);
	assert.match(css, /\.quick-cart \{[^}]*bottom: 142px/);
	assert.match(css, /\.quick-cart \{[^}]*z-index: 7/);
	assert.match(css, /@media \(max-width: 480px\) \{ \.quick-cart \{[^}]*bottom: 126px/);
});

test('category cards show data-driven book counts without inventory management', () => {
	const html = read('index.html');
	const script = read('main.js');
	const css = read('main.css');
	assert.match(html, /class="category-list"/);
	assert.match(script, /books\.filter\(\(book\) => book\.category === category\.value\)/);
	assert.doesNotMatch(html, /Quản lý kho|inventoryDialog/);
	assert.doesNotMatch(script, /INVENTORY_STORAGE_KEY|state\.inventory/);
	assert.doesNotMatch(css, /\.inventory-dialog/);
});

test('orders are saved before confirmation and can be looked up without exposing delivery details', async (t) => {
	const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'booknest-orders-'));
	const ordersPath = path.join(temporaryDirectory, 'orders.jsonl');
	const server = createServer({ ordersPath });
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve));
		await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	const baseUrl = `http://127.0.0.1:${address.port}`;
	const payload = {
		customerName: 'Nguyễn Văn A',
		address: '12 Đường Sách, Quận 1',
		phone: '0901234567',
		paymentMethod: 'cod',
		discountRate: 0.05,
		items: [{ title: 'Nhà giả kim', quantity: 2 }]
	};

	const response = await fetch(`${baseUrl}/api/orders`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	assert.equal(response.status, 201);
	const confirmation = await response.json();
	assert.match(confirmation.orderId, /^[0-9a-f-]{36}$/i);
	assert.equal(confirmation.total, 169100);
	assert.equal(confirmation.items[0].quantity, 2);
	assert.ok((await fsPromises.readFile(ordersPath, 'utf8')).includes(confirmation.orderId));

	const lookupResponse = await fetch(`${baseUrl}/api/orders/${confirmation.orderId}`);
	assert.equal(lookupResponse.status, 200);
	const order = await lookupResponse.json();
	assert.equal(order.orderId, confirmation.orderId);
	assert.equal(order.total, 169100);
	assert.equal(Object.hasOwn(order, 'phone'), false);
	assert.equal(Object.hasOwn(order, 'address'), false);

	const privateDataResponse = await fetch(`${baseUrl}/data/orders.jsonl`);
	assert.equal(privateDataResponse.status, 404);
	const serverSourceResponse = await fetch(`${baseUrl}/server.js`);
	assert.equal(serverSourceResponse.status, 404);
});

test('invalid books are rejected without saving an order', async (t) => {
	const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'booknest-invalid-order-'));
	const ordersPath = path.join(temporaryDirectory, 'orders.jsonl');
	const server = createServer({ ordersPath });
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve));
		await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});

	const response = await fetch(`http://127.0.0.1:${server.address().port}/api/orders`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			customerName: 'Nguyễn Văn A',
			address: '12 Đường Sách, Quận 1',
			phone: '0901234567',
			paymentMethod: 'cod',
			discountRate: 0,
			items: [{ title: 'Tựa sách không có', quantity: 1 }]
		})
	});
	assert.equal(response.status, 400);
	assert.equal(await fsPromises.stat(ordersPath).then(() => true, (error) => {
		if (error.code === 'ENOENT') return false;
		throw error;
	}), false);
});
