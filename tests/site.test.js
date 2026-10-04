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
