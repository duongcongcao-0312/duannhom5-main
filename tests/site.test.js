const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createServer } = require('../server');
const { createServer: createAppServer } = require('../backend/app');
const { Database } = require('../backend/db');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('active server entrypoint uses the modular app composition root', () => {
	assert.equal(createServer, createAppServer);
	assert.match(read('server.js'), /function createServer/);
	assert.match(read('server.js'), /module\.exports/);
});

test('guest checkout creates access codes with Web Crypto and only sends them in the lookup header', () => {
	const script = read('main.js');
	assert.match(script, /crypto\.getRandomValues/);
	assert.match(script, /X-Order-Access-Code/);
	assert.match(script, /lastCreatedOrderAccessCode/);
	assert.doesNotMatch(script, /(?:sessionStorage|localStorage)\.setItem\([^,]*accessCode/i);
});

test('modular server preserves public, auth, admin, privacy, and payment route contracts', async (t) => {
	const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'booknest-route-contract-'));
	const server = createServer({
		ordersPath: path.join(temporaryDirectory, 'orders.jsonl'),
		usersPath: path.join(temporaryDirectory, 'users.json')
	});
	t.after(async () => {
		if (server.listening) await new Promise((resolve) => server.close(resolve));
		await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const cases = [
		['/health', 'GET', 200],
		['/api/auth/me', 'GET', 401],
		['/api/admin/books', 'GET', 401],
		['/api/privacy/data-requests', 'GET', 401],
		['/api/payments/webhook', 'POST', 503]
	];
	for (const [pathname, method, expectedStatus] of cases) {
		const response = await fetch(`${baseUrl}${pathname}`, {
			method,
			headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
			body: method === 'POST' ? '{}' : undefined
		});
		assert.equal(response.status, expectedStatus, `${method} ${pathname}`);
	}
});

test('admin auth check does not reopen the login overlay after login succeeds', () => {
	const script = read('admin.js');
	const authCheckStart = script.indexOf('async function checkAuth()');
	const loginHandlerStart = script.indexOf('adminLoginForm.addEventListener');
	const authCheck = script.slice(authCheckStart, loginHandlerStart);

	assert.match(authCheck, /if \(currentAdmin\) return;/);
	assert.ok(
		authCheck.indexOf('if (currentAdmin) return;') < authCheck.lastIndexOf('showLoginOverlay();'),
	);
});

function configureTestAdmin(t) {
	const previous = {
		ADMIN_EMAIL: process.env.ADMIN_EMAIL,
		ADMIN_PASSWORD: process.env.ADMIN_PASSWORD
	};
	process.env.ADMIN_EMAIL = 'admin@example.com';
	process.env.ADMIN_PASSWORD = 'local-test-admin-password-123';
	t.after(() => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
}

test('payment UI contains COD and loads bank details from the backend', () => {
	const html = read('index.html');
	const script = read('main.js');
	assert.match(html, /value="cod"/);
	assert.match(html, /name="customerName"/);
	assert.match(html, /name="phone"/);
	assert.match(html, /name="address"/);
	assert.match(html, /id="paymentQr"/);
	assert.doesNotMatch(html, /TCB-88803122007888/);
	assert.doesNotMatch(script, /TCB-88803122007888/);
	assert.match(script, /api\/payments\/config/);
	assert.match(script, /bankCode/);
	assert.match(html, /assets\/vietqr\.js[\s\S]*main\.js/);
	assert.match(script, /updatePaymentQr\(result\)/);
	assert.doesNotMatch(script, /updatePaymentQr\(quote\.total\)/);
	assert.match(script, /paymentCode/);
});

test('order toast separates COD success from pending and confirmed transfer payments', () => {
	const script = read('main.js');
	assert.match(script, /title: method === 'cod' \? 'Đặt hàng thành công!' : 'Đã tạo đơn, đang chờ thanh toán'/);
	assert.match(script, /\{ label: 'Mã đơn', value: result\.orderId \}/);
	assert.match(script, /sessionStorage\.setItem\(LAST_ORDER_ID_STORAGE_KEY, result\.orderId\)/);
	assert.match(script, /sessionStorage\.getItem\(LAST_ORDER_ID_STORAGE_KEY\)/);
	assert.match(script, /const paymentConfirmed = order\.paymentStatus === 'paid'/);
	assert.match(script, /paymentConfirmed \? 'Đã xác nhận thanh toán thành công' : 'Đang chờ thanh toán'/);
});

test('public quick-login profiles use synthetic demo identities', () => {
	const html = read('index.html');
	assert.doesNotMatch(html, /bit250048@|nguyenvanan|tranminhduc|lethao|Dương Công Cao|Nguyễn Văn An|Trần Minh Đức|Lê Phương Thảo/i);
	assert.match(html, /demo-user-01@example\.com/);
	assert.match(html, /dữ liệu giả lập/i);
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

test('customer contact information is session-scoped and cleared on logout', () => {
	const script = read('main.js');
	assert.match(script, /const CUSTOMER_INFO_STORAGE_KEY = 'booknest-customer-info'/);
	assert.match(script, /function loadCustomerInfo/);
	assert.match(script, /function saveCustomerInfo/);
	assert.match(script, /const customerInfo = \{ \.\.\.loadCustomerInfo\(\), customerName, address, phone \}/);
	assert.match(script, /const customerInfo = \{ \.\.\.loadCustomerInfo\(\), name: request\.name, phone: request\.phone \}/);
	assert.match(script, /function fillSavedCustomerInfo/);
	assert.match(script, /fillSavedCustomerInfo\(\);/);
	assert.match(script, /sessionStorage\.getItem\(CUSTOMER_INFO_STORAGE_KEY/);
	assert.match(script, /sessionStorage\.setItem\(CUSTOMER_INFO_STORAGE_KEY/);
	assert.match(script, /sessionStorage\.removeItem\(CUSTOMER_INFO_STORAGE_KEY\)/);
	assert.match(script, /saveCustomerInfoToAccount/);
	assert.match(script, /api\/auth\/customer-info/);
	assert.match(script, /hydrateAuthenticatedUser/);
	assert.match(script, /api\/auth\/me/);
});

test('privacy page exposes account consent controls and uses the authenticated consent API', async () => {
	const html = read('privacy.html');
	assert.match(html, /id="consentManagement"/);
	assert.match(html, /id="consentStatus"[^>]*aria-live="polite"/);
	assert.match(html, /id="privacyDataRequestForm"/);
	assert.match(html, /id="privacyDataRequestStatus"[^>]*aria-live="polite"/);

	const script = read('assets/privacy-consent.js');
	const calls = [];
	const context = {
		window: {
			booknestAuth: { getToken: () => 'privacy-test-token' },
			booknestApiFetch: async (url, options = {}) => {
				calls.push({ url, options });
				return {
					ok: true,
					status: 200,
					json: async () => url.includes('/data-requests')
						? { requests: [], request: { id: 'request-1', status: 'pending' } }
						: { records: [], current: {} }
				};
			}
		},
		document: {
			addEventListener() {},
			getElementById() { return null; }
		}
	};
	vm.runInNewContext(script, context);

	await context.window.booknestPrivacy.loadConsents();
	await context.window.booknestPrivacy.saveConsent('marketing', true);
	await context.window.booknestPrivacy.revokeConsent('marketing');
	await context.window.booknestPrivacy.loadDataRequests();
	await context.window.booknestPrivacy.createDataRequest('access');
	assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
		['/api/privacy/consents', 'GET'],
		['/api/privacy/consents', 'POST'],
		['/api/privacy/consents/marketing?policyVersion=2026-01', 'DELETE'],
		['/api/privacy/data-requests', 'GET'],
		['/api/privacy/data-requests', 'POST']
	]);
	assert.ok(calls.every(({ options }) => options.headers.Authorization === 'Bearer privacy-test-token'));
	assert.deepEqual(JSON.parse(calls.at(-1).options.body), { type: 'access' });
});

test('service requests wait for API confirmation and surface connection failures', () => {
	const script = read('main.js');
	assert.match(script, /const response = await window\.booknestApiFetch\('\/api\/services'/);
	assert.match(script, /if \(!response\.ok\) throw new Error\(result\.error \|\| 'Không thể gửi yêu cầu đến máy chủ/);
	assert.match(script, /showServiceError\(error instanceof Error \? error\.message/);
});

test('account login provides password-reset request and confirmation forms', () => {
	const html = read('index.html');
	const script = read('main.js');
	assert.match(html, /id="forgotPasswordButton"/);
	assert.match(html, /id="passwordResetRequestForm"/);
	assert.match(html, /id="passwordResetConfirmForm"/);
	assert.match(script, /api\/auth\/password-reset/);
	assert.match(script, /api\/auth\/password-reset\/confirm/);
	assert.match(script, /window\.location\.hash/);
});

test('admin API authentication uses bearer tokens without cross-origin cookies', () => {
	const script = read('admin.js');
	assert.match(script, /headers\[AUTH_HEADER_KEY\]/);
	assert.doesNotMatch(script, /credentials:\s*['"]include['"]/);
});

test('admin dashboard exposes live API, database, payment and backup health', () => {
	const html = read('admin.html');
	const script = read('admin.js');
	assert.match(html, /aria-labelledby="monitoringTitle"/);
	assert.match(html, /id="monitoringApiStatus"/);
	assert.match(html, /id="monitoringDatabaseStatus"/);
	assert.match(html, /id="monitoringPaymentStatus"/);
	assert.match(html, /id="monitoringBackupStatus"/);
	assert.match(script, /api\/admin\/monitoring/);
});

test('authentication tokens use tab-scoped storage and expire consistently', async () => {
	const apiClient = read('assets/api-client.js');
	const main = read('main.js');
	const admin = read('admin.js');
	assert.match(apiClient, /sessionStorage\.setItem\(AUTH_TOKEN_KEY, token\)/);
	assert.match(apiClient, /localStorage\.removeItem\(AUTH_TOKEN_KEY\)/);
	assert.doesNotMatch(main, /localStorage\.(?:getItem|setItem|removeItem)\(['"]booknest-(?:admin-)?auth-token/);
	assert.doesNotMatch(admin, /localStorage\.(?:getItem|setItem|removeItem)\(['"]booknest-(?:admin-)?auth-token/);

	const createStorage = () => {
		const values = new Map();
		return {
			getItem: (key) => values.get(key) || null,
			setItem: (key, value) => values.set(key, String(value)),
			removeItem: (key) => values.delete(key)
		};
	};
	const localStorage = createStorage();
	const sessionStorage = createStorage();
	const events = [];
	const context = {
		window: { dispatchEvent: (event) => events.push(event.type) },
		localStorage,
		sessionStorage,
		Event: class TestEvent { constructor(type) { this.type = type; } },
		AbortController,
		Headers,
		setTimeout,
		clearTimeout,
		fetch: async () => ({ status: 401 }),
		document: { body: null }
	};
	vm.runInNewContext(apiClient, context);

	context.window.booknestAuth.setToken('temporary-token', Date.now() + 60_000);
	assert.equal(sessionStorage.getItem('booknest-auth-token'), 'temporary-token');
	assert.equal(localStorage.getItem('booknest-auth-token'), null);
	await context.window.booknestApiFetch('/api/auth/me', {
		headers: { Authorization: 'Bearer temporary-token' }
	});
	assert.equal(sessionStorage.getItem('booknest-auth-token'), null);
	assert.deepEqual(events, ['booknest:auth-expired']);

	localStorage.setItem('booknest-admin-token', 'legacy-token');
	assert.equal(context.window.booknestAuth.getToken(), 'legacy-token');
	assert.equal(localStorage.getItem('booknest-admin-token'), null);
	assert.equal(sessionStorage.getItem('booknest-auth-token'), 'legacy-token');

	context.window.booknestAuth.setToken('expired-token', Date.now() - 1);
	assert.equal(context.window.booknestAuth.getToken(), null);
	assert.deepEqual(events, ['booknest:auth-expired', 'booknest:auth-expired']);
});

test('account registration only reports duplicates for an explicit conflict response', () => {
	const script = read('main.js');
	assert.match(script, /response\.status === 409/);
	assert.match(script, /Không thể kết nối máy chủ để tạo tài khoản/);
	assert.match(script, /Không thể tạo tài khoản lúc này/);
	assert.match(script, /submitButton\.disabled = true/);
	assert.match(script, /submitButton\.disabled = false/);
	assert.doesNotMatch(script, /const users = readUsers\(\);[\s\S]{0,300}showAccountError\('#registerError', 'Email này đã được đăng ký\.'\)/);
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
	assert.match(css, /overflow-x: (?:hidden|clip)/);
});

test('mobile checkout keeps delivery fields accessible before transfer details', () => {
	const html = read('index.html');
	const css = read('main.css');
	assert.match(html, /name="customerName"[^>]*autocomplete="name"/);
	assert.match(html, /name="phone"[^>]*inputmode="tel"/);
	assert.match(html, /name="address"[^>]*autocomplete="street-address"/);
	assert.match(css, /\.payment-dialog \.shipping-fields \{ order: 2; \}/);
	assert.match(css, /\.payment-dialog #transferDetails \{ order: 3; \}/);
	assert.match(css, /\.shipping-fields input,\s*\.shipping-fields textarea \{\s*font-size: 16px;/);
	assert.match(css, /\.site-header > \.cart-button,\s*\.site-header > \.account-button \{\s*flex: 1 1 0;/);
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

test('homepage hero is a scroll-scrubbed scene with reduced-motion support', () => {
	const html = read('index.html');
	const css = read('main.css');
	const script = read('main.js');
	assert.match(html, /<section class="hero" data-scroll-cinema>/);
	assert.match(html, /<div class="hero-scene">/);
	assert.match(css, /\.has-scroll-cinema \.hero-scene\s*\{[^}]*position: sticky/s);
	assert.match(css, /prefers-reduced-motion: reduce/);
	assert.match(script, /function initializeScrollCinema\(\)/);
	assert.match(script, /requestAnimationFrame\(updateScene\)/);
	assert.match(script, /initializeScrollCinema\(\);/);
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

test('toast notifications share an accessible frontend renderer on store and admin pages', () => {
	const html = read('index.html');
	const adminHtml = read('admin.html');
	const script = read('assets/toast.js');
	const styles = read('assets/toast.css');
	assert.match(html, /assets\/toast\.css/);
	assert.match(html, /assets\/toast\.js[\s\S]*main\.js/);
	assert.match(adminHtml, /assets\/toast\.css/);
	assert.match(adminHtml, /assets\/toast\.js[\s\S]*admin\.js/);
	assert.match(script, /aria-live/);
	assert.match(script, /aria-label/);
	assert.match(script, /copy\.textContent = messageText/);
	assert.match(script, /maxVisibleToasts = 3/);
	assert.match(script, /duration: 5000/);
	assert.match(script, /duration: 6000/);
	assert.match(script, /event\.key !== 'Escape'/);
	assert.match(styles, /prefers-reduced-motion: reduce/);
	assert.match(styles, /@media \(max-width: 600px\)/);
	assert.doesNotMatch(read('main.js'), /\balert\s*\(/);
	assert.match(read('admin.js'), /window\.booknestToast/);
	assert.doesNotMatch(read('book-detail.js'), /window\.alert\s*\(/);
	assert.match(read('scripts/build-pages.js'), /'toast\.css'.*'toast\.js'/);
});

test('CI scans full Git history for committed secrets', () => {
	const workflow = read('.github/workflows/ci.yml');
	assert.match(workflow, /^  push:\r?\n    branches:\r?\n      - ['"]?\*\*['"]?\r?\n    tags:\r?\n      - ['"]?\*\*['"]?$/m);
	assert.match(workflow, /fetch-depth:\s*0/);
	assert.match(workflow, /uses:\s*gitleaks\/gitleaks-action@v/);
	assert.match(workflow, /GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
});

test('SePay production settings are declared as environment variables without real values', () => {
	const envExample = read('.env.example');
	const renderConfig = read('render.yaml');
	const keys = [
		'SEPAY_API_KEY',
		'SEPAY_BANK_CODE',
		'SEPAY_BANK_NAME',
		'SEPAY_ACCOUNT_NUMBER',
		'SEPAY_ACCOUNT_NAME'
	];
	keys.forEach((key) => {
		assert.match(envExample, new RegExp(`^${key}=$`, 'm'));
		assert.match(renderConfig, new RegExp(`key: ${key}[\\s\\S]*?sync: false`));
	});
	[
		'ADMIN_EMAIL',
		'ADMIN_PASSWORD',
		'DATABASE_URL',
		'FIREBASE_API_KEY',
		'SMTP_PASSWORD',
		'RESEND_API_KEY'
	].forEach((key) => assert.match(envExample, new RegExp(`^${key}=$`, 'm')));
});

test('frontend API client targets the configured backend origin', () => {
	const context = { window: { BOOKNEST_API_BASE_URL: 'https://api.example.com/' } };
	vm.runInNewContext(read('assets/api-client.js'), context);
	assert.equal(context.window.booknestApiUrl('/api/books'), 'https://api.example.com/api/books');
	assert.equal(typeof context.window.booknestApiFetch, 'function');
	const pagesConfig = { window: { location: { hostname: 'duongcongcao-0312.github.io' } } };
	vm.runInNewContext(read('assets/api-config.js'), pagesConfig);
	assert.equal(pagesConfig.window.BOOKNEST_API_BASE_URL, 'https://duannhom5-main.onrender.com');
	const localConfig = { window: { location: { hostname: '127.0.0.1', port: '8000' } } };
	vm.runInNewContext(read('assets/api-config.js'), localConfig);
	assert.equal(localConfig.window.BOOKNEST_API_BASE_URL, '');
	const fileConfig = { window: { location: { hostname: '', port: '', protocol: 'file:' } } };
	vm.runInNewContext(read('assets/api-config.js'), fileConfig);
	assert.equal(fileConfig.window.BOOKNEST_API_BASE_URL, 'http://127.0.0.1:8000');
	const liveServerConfig = { window: { location: { hostname: 'localhost', port: '5500' } } };
	vm.runInNewContext(read('assets/api-config.js'), liveServerConfig);
	assert.equal(liveServerConfig.window.BOOKNEST_API_BASE_URL, 'http://localhost:8000');
	const viteConfig = { window: { location: { hostname: '127.0.0.1', port: '5173' } } };
	vm.runInNewContext(read('assets/api-config.js'), viteConfig);
	assert.equal(viteConfig.window.BOOKNEST_API_BASE_URL, 'http://127.0.0.1:8000');
	const customBackendPortConfig = { window: { location: { hostname: 'localhost', port: '8001' } } };
	vm.runInNewContext(read('assets/api-config.js'), customBackendPortConfig);
	assert.equal(customBackendPortConfig.window.BOOKNEST_API_BASE_URL, '');
	assert.match(read('index.html'), /assets\/api-config\.js[\s\S]*assets\/api-client\.js[\s\S]*main\.js/);
	assert.match(read('admin.html'), /assets\/api-config\.js[\s\S]*assets\/api-client\.js[\s\S]*admin\.js/);
});

test('API client reports timeouts and unavailable server responses with actionable notices', async () => {
	let notice;
	const createElement = () => ({
		children: [],
		setAttribute() {},
		addEventListener() {},
		append(...children) { this.children.push(...children); },
		appendChild(child) { this.children.push(child); },
		querySelector(selector) {
			return this.children.find((child) => child.className === selector.slice(1));
		},
		remove() {}
	});

	test('API client retries safe cold-start requests without replaying writes', async () => {
		let attempts = 0;
		const context = {
			window: { BOOKNEST_API_BASE_URL: 'https://api.example.com' },
			document: { body: null },
			AbortController,
			fetch: async (_url, options) => {
				attempts += 1;
				assert.ok(options.signal);
				if (attempts < 3) return { status: 503 };
				return { status: 200 };
			},
			setTimeout(callback) { callback(); return 1; },
			clearTimeout() {}
		};
		vm.runInNewContext(read('assets/api-client.js'), context);

		await context.window.booknestApiFetch('/health');
		assert.equal(attempts, 3);

		attempts = 0;
		await context.window.booknestApiFetch('/api/orders', { method: 'POST', body: '{}' });
		assert.equal(attempts, 1);
	});
	const document = {
		body: { appendChild(element) { notice = element; } },
		getElementById(id) { return id === 'apiConnectionNotice' ? notice : null; },
		createElement
	};
	const context = {
		window: { BOOKNEST_API_BASE_URL: 'https://api.example.com' },
		document,
		AbortController,
		fetch: async (_url, { signal }) => {
			assert.equal(signal.aborted, true);
			throw Object.assign(new Error('aborted'), { name: 'AbortError' });
		},
		setTimeout(callback) {
			callback();
			return 1;
		},
		clearTimeout() {}
	};
	vm.runInNewContext(read('assets/api-client.js'), context);

	await assert.rejects(
		context.window.booknestApiFetch('/api/orders'),
		/Máy chủ BookNest không phản hồi sau 15 giây/,
	);
	assert.match(
		notice.querySelector('.api-connection-notice-message').textContent,
		/kiểm tra kết nối mạng và thử lại thao tác/i,
	);

	context.fetch = async () => ({ status: 503 });
	await context.window.booknestApiFetch('/api/orders');
	assert.match(
		notice.querySelector('.api-connection-notice-message').textContent,
		/không khả dụng \(HTTP 503\)/i,
	);
});

test('each book category contains eight titles', () => {
	const script = read('books-data.js');
	const categoryValues = ['van-hoc', 'ky-nang', 'kinh-te', 'khoa-hoc', 'lich-su', 'thieu-nhi', 'trinh-tham', 'tam-ly', 'cong-nghe', 'ngoai-ngu'];
	categoryValues.forEach((category) => {
		const count = (script.match(new RegExp(`category: '${category}'`, 'g')) || []).length;
		assert.equal(count, 8, `${category} should contain 8 books`);
	});
});

test('book catalog exposes itself in browser globals', () => {

	const context = { globalThis: {} };
	vm.runInNewContext(read('books-data.js'), context, { filename: path.join(root, 'books-data.js') });
	assert.equal(context.globalThis.BOOKNEST_BOOKS.length, 80);
	assert.ok(context.globalThis.BOOKNEST_BOOKS.every((book) => book.tag));
});

test('book cards link to a detailed description page', () => {
	const script = read('main.js');
	assert.ok(fs.existsSync(path.join(root, 'book.html')));
	assert.ok(fs.existsSync(path.join(root, 'book-detail.js')));
	assert.match(script, /getBookDetailsUrl/);
	assert.match(script, /class="details-link"/);
	assert.match(read('book-detail.js'), /categoryDescriptions/);
});

test('custom product cover URLs are used on the catalog and detail pages', () => {
	for (const file of ['main.js', 'book-detail.js']) {
		const script = read(file);
		const match = script.match(/function getBookImage\(book\) \{[\s\S]*?\n\}/);
		assert.ok(match, `${file} should define getBookImage`);
		const getBookImage = vm.runInNewContext(`${match[0]}; getBookImage`);
		assert.equal(getBookImage({ cover: 'https://example.com/custom-cover.jpg' }), 'https://example.com/custom-cover.jpg');
		assert.equal(getBookImage({ cover: 'cover-3', title: 'A Book' }), 'https://covers.openlibrary.org/b/title/A%20Book-L.jpg?default=false');
		assert.equal(getBookImage({ image: 'https://example.com/catalog-cover.jpg', cover: 'cover-2', title: 'A Book' }), 'https://example.com/catalog-cover.jpg');
	}
	const script = read('main.js');
	assert.match(script, /image\.src = createFallbackCover\(image\.dataset\.bookTitle, image\.dataset\.bookAuthor\)/);
	assert.doesNotMatch(script, /findBookCover/);
});

test('book covers use smaller responsive sources on mobile and prioritize the detail cover', () => {
	for (const file of ['main.js', 'book-detail.js']) {
		const script = read(file);
		const helper = script.match(/function getResponsiveBookImage\(book, size\) \{[\s\S]*?\n\}/);
		assert.ok(helper, `${file} should define responsive cover sizing`);
		const getBookImage = vm.runInNewContext(
			`${script.match(/function getBookImage\(book\) \{[\s\S]*?\n\}/)[0]}; getBookImage`,
		);
		const getResponsiveBookImage = vm.runInNewContext(`${helper[0]}; getResponsiveBookImage`, { getBookImage });
		assert.equal(getResponsiveBookImage({ title: 'A Book' }, 'M'), 'https://covers.openlibrary.org/b/title/A%20Book-M.jpg?default=false');
		assert.equal(getResponsiveBookImage({ image: 'https://covers.openlibrary.org/b/id/123-L.jpg' }, 'M'), 'https://covers.openlibrary.org/b/id/123-M.jpg');
		assert.equal(getResponsiveBookImage({ cover: 'https://example.com/cover.jpg' }, 'M'), '');
		assert.equal(getResponsiveBookImage({
			images: [{
				url: '/api/uploads/book-covers/12345678-1234-4234-8234-123456789abc.webp',
				variants: {
					small: '/api/uploads/book-covers/12345678-1234-4234-8234-123456789abc-320.webp',
					medium: '/api/uploads/book-covers/12345678-1234-4234-8234-123456789abc-640.webp',
				},
			}],
		}, 'M'), '/api/uploads/book-covers/12345678-1234-4234-8234-123456789abc-640.webp');
		assert.match(script, /<source media="\(max-width: 800px\)"/);
	}
	const detail = read('book-detail.js');
	assert.match(detail, /loading="eager" fetchpriority="high" decoding="async"/);
	assert.match(detail, /alt="B/);
	assert.match(read('main.js'), /loading="lazy" decoding="async"/);
	assert.match(read('server.js'), /public, max-age=86400, stale-while-revalidate=604800/);
});

test('book details support purchasing and related book discovery', () => {
	const html = read('book.html');
	const script = read('book-detail.js');
	const css = read('main.css');
	assert.match(html, /assets\/api-config\.js/);
	assert.match(html, /assets\/api-client\.js/);
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

test('account discounts and AI assistant are wired without membership cards', () => {
	const html = read('index.html');
	const script = read('main.js');
	const css = read('main.css');
	const firebaseConfig = read('assets/firebase-config.js');
	assert.match(html, /id="accountButton"/);
	assert.match(html, /id="registerForm"/);
	assert.doesNotMatch(html, /id="memberPanel"/);
	assert.doesNotMatch(html, /data-account-view="member"/);
	assert.match(html, /data-social-provider="google"/);
	assert.match(html, /data-social-provider="facebook"/);
	assert.match(css, /\.account-form\[hidden\]\s*\{\s*display:\s*none;/);
	assert.match(html, /id="aiChat"/);
	assert.match(script, /signInWithPopup\(providerObject\)/);
	assert.match(firebaseConfig, /BOOKNEST_FIREBASE_CONFIG/);
	assert.match(script, /api\/orders\/quote/);
	assert.match(script, /getAiAnswer/);
	assert.doesNotMatch(script, /memberNumber/);
});

test('catalog supports sorting, favorites, coupons and order tracking', () => {
	const html = read('index.html');
	const script = read('main.js');
	const server = read('server.js');
	const coupons = read('backend/coupons.js');
	assert.match(html, /id="sortFilter"/);
	assert.match(html, /id="favoritesFilter"/);
	assert.match(html, /id="couponInput"/);
	assert.match(html, /id="trackOrderForm"/);
	assert.match(html, /id="myOrdersButton"/);
	assert.match(script, /FAVORITES_STORAGE_KEY/);
	assert.match(script, /api\/coupons/);
	assert.match(script, /trackOrderForm/);
	assert.match(script, /booknestApiFetch\('\/api\/orders'/);
	assert.match(script, /booknestApiFetch\('\/api\/orders\/quote'/);
	assert.match(script, /Authorization: `Bearer \$\{token\}`/);
	assert.match(coupons, /BOOKNEST10/);
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
	assert.match(script, /sortFilter\) sortFilter\.addEventListener\('change', \(\) => \{ currentCatalogPage = 1; renderBooks\(\); \}\)/);
	assert.match(script, /data-title="\$\{escapeHtml\(book\.title\)\}"/);
});

test('issue #39 - search, category filter, price filter, tag filter and sorting work accurately across storefront and admin', () => {
	const html = read('index.html');
	const script = read('main.js');
	const adminHtml = read('admin.html');
	const adminScript = read('admin.js');

	// Storefront filters in HTML
	assert.match(html, /id="priceFilter"/);
	assert.match(html, /id="tagFilter"/);
	assert.match(html, /<option value="under-100k">/);
	assert.match(html, /<option value="100k-200k">/);
	assert.match(html, /<option value="above-200k">/);
	assert.match(html, /<option value="bestseller">/);
	assert.match(html, /<option value="title-desc">Tên Z-A<\/option>/);
	assert.match(html, /id="resetFiltersBtn"/);

	// Storefront script filter & sort logic
	assert.match(script, /removeVietnameseAccents/);
	assert.match(script, /priceFilter/);
	assert.match(script, /tagFilter/);
	assert.match(script, /priceRange === 'under-100k'/);
	assert.match(script, /priceRange === '100k-200k'/);
	assert.match(script, /priceRange === 'above-200k'/);
	assert.match(script, /function roundMoney/);
	assert.doesNotMatch(script, /discountRate:\s*getDiscountRate\(\)/);
	assert.match(script, /visibleBooks\.sort\(\(a, b\) => b\.title\.localeCompare\(a\.title, 'vi'\)\)/);
	assert.match(script, /resetFiltersBtn/);

	// Admin search, category filter and sorting
	assert.match(adminHtml, /id="bookSortFilter"/);
	assert.match(adminScript, /bookSortFilter/);
});

test('issue #25 - main.js syntax is valid without duplicate closing braces in account handlers', () => {
	const script = read('main.js');
	assert.doesNotMatch(script, /accountDialog\.close\(\);\s*\}\s*\}\s*\}/);
	assert.doesNotMatch(script, /\}\s*\r?\n\}\s*\r?\n\}\s*\r?\n\s*function getSocialAuthError/);
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
	const server = createServer({ ordersPath, usersPath: path.join(temporaryDirectory, 'users.json') });
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
		accessCode: 'a1'.repeat(32),
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
	assert.equal(confirmation.total, 178000);
	assert.equal(confirmation.subtotal, 178000);
	assert.equal(confirmation.discount, 0);
	assert.equal(confirmation.items[0].quantity, 2);
	assert.ok((await fsPromises.readFile(ordersPath, 'utf8')).includes(confirmation.orderId));

	const lookupResponse = await fetch(`${baseUrl}/api/orders/${confirmation.orderId}`, {
		headers: { 'X-Order-Access-Code': payload.accessCode }
	});
	assert.equal(lookupResponse.status, 200);
	const order = await lookupResponse.json();
	assert.equal(order.orderId, confirmation.orderId);
	assert.equal(order.total, 178000);
	assert.equal(order.subtotal, 178000);
	assert.equal(order.discount, 0);
	assert.equal(Object.hasOwn(order, 'phone'), false);
	assert.equal(Object.hasOwn(order, 'address'), false);
	assert.equal(Object.hasOwn(order, 'accessCodeHash'), false);

	const privateDataResponse = await fetch(`${baseUrl}/data/orders.jsonl`);
	assert.equal(privateDataResponse.status, 404);
	const serverSourceResponse = await fetch(`${baseUrl}/server.js`);
	assert.equal(serverSourceResponse.status, 404);
});

test('guest order lookups require the access code and never expose its verifier', async (t) => {
	const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'booknest-guest-order-code-'));
	const ordersPath = path.join(temporaryDirectory, 'orders.jsonl');
	const usersPath = path.join(temporaryDirectory, 'users.json');
	const database = new Database({ ordersPath, usersPath });
	const adminPassword = 'guest-order-admin-test-password';
	const admin = await database.createUser({
		name: 'Guest Order Admin',
		email: 'guest-order-admin@example.com',
		password: adminPassword,
		role: 'admin'
	});
	const visitorPassword = 'guest-order-visitor-test-password';
	const visitor = await database.createUser({
		name: 'Guest Order Visitor',
		email: 'guest-order-visitor@example.com',
		password: visitorPassword,
		role: 'user'
	});
	const server = createServer({
		ordersPath,
		usersPath,
		database
	});
	const originalConsole = Object.fromEntries(
		['log', 'warn', 'error'].map((method) => [method, console[method]])
	);
	const loggedMessages = [];
	for (const method of Object.keys(originalConsole)) {
		console[method] = (...args) => loggedMessages.push(args.join(' '));
	}
	t.after(async () => {
		for (const [method, original] of Object.entries(originalConsole)) {
			console[method] = original;
		}
		if (server.listening) await new Promise((resolve) => server.close(resolve));
		await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const accessCode = 'b2'.repeat(32);
	const payload = {
		customerName: 'Guest Order Customer',
		address: '12 Guest Order Street, District 1',
		phone: '0901234567',
		paymentMethod: 'cod',
		accessCode,
		items: [{ title: 'Nhà giả kim', quantity: 1 }]
	};
	const missingCodeCreation = await fetch(`${baseUrl}/api/orders`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...payload, accessCode: undefined })
	});
	assert.equal(missingCodeCreation.status, 400);
	const creationResponse = await fetch(`${baseUrl}/api/orders`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Idempotency-Key': 'guest-access-code-001'
		},
		body: JSON.stringify(payload)
	});
	assert.equal(creationResponse.status, 201);
	assert.equal(creationResponse.headers.get('cache-control'), 'no-store');
	const creationBody = await creationResponse.json();
	assert.equal(Object.hasOwn(creationBody, 'accessCode'), false);
	assert.equal(Object.hasOwn(creationBody, 'accessCodeHash'), false);
	const storedOrder = JSON.parse((await fsPromises.readFile(ordersPath, 'utf8')).trim());
	const accessCodeHash = crypto.createHash('sha256').update(accessCode).digest('hex');
	assert.equal(storedOrder.accessCodeHash, accessCodeHash);
	assert.equal(Object.hasOwn(storedOrder, 'accessCode'), false);

	const missingOrder = await fetch(`${baseUrl}/api/orders/11111111-1111-4111-8111-111111111111`);
	const missingCode = await fetch(`${baseUrl}/api/orders/${creationBody.orderId}`);
	const wrongCode = await fetch(`${baseUrl}/api/orders/${creationBody.orderId}`, {
		headers: { 'X-Order-Access-Code': 'c3'.repeat(32) }
	});
	assert.equal(missingOrder.status, 404);
	assert.equal(missingCode.status, 404);
	assert.equal(wrongCode.status, 404);
	const missingOrderBody = await missingOrder.json();
	const missingCodeBody = await missingCode.json();
	const wrongCodeBody = await wrongCode.json();
	for (const body of [missingOrderBody, missingCodeBody, wrongCodeBody]) {
		assert.equal(body.error, 'Không tìm thấy đơn hàng.');
		assert.equal(body.code, 'NOT_FOUND');
		assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
	}
	assert.equal(new Set([
		missingOrderBody.requestId,
		missingCodeBody.requestId,
		wrongCodeBody.requestId
	]).size, 3);

	const detailResponse = await fetch(`${baseUrl}/api/orders/${creationBody.orderId}`, {
		headers: { 'X-Order-Access-Code': accessCode }
	});
	assert.equal(detailResponse.status, 200);
	assert.equal(detailResponse.headers.get('cache-control'), 'no-store');
	const detail = await detailResponse.json();
	assert.equal(Object.hasOwn(detail, 'accessCodeHash'), false);
	assert.equal(Object.hasOwn(detail, 'accessCode'), false);

	const statusWithoutCode = await fetch(`${baseUrl}/api/orders/${creationBody.orderId}/status`);
	const statusWithCode = await fetch(`${baseUrl}/api/orders/${creationBody.orderId}/status`, {
		headers: { 'X-Order-Access-Code': accessCode }
	});
	assert.equal(statusWithoutCode.status, 404);
	assert.equal(statusWithCode.status, 200);
	assert.deepEqual(await statusWithCode.json(), {
		paymentStatus: 'cod_pending',
		orderStatus: 'received'
	});
	const visitorLogin = await fetch(`${baseUrl}/api/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: visitor.email, password: visitorPassword })
	});
	assert.equal(visitorLogin.status, 200);
	const visitorToken = (await visitorLogin.json()).token;
	const authenticatedWithoutCode = await fetch(`${baseUrl}/api/orders/${creationBody.orderId}`, {
		headers: { Authorization: `Bearer ${visitorToken}` }
	});
	const authenticatedWithCode = await fetch(`${baseUrl}/api/orders/${creationBody.orderId}`, {
		headers: {
			Authorization: `Bearer ${visitorToken}`,
			'X-Order-Access-Code': accessCode
		}
	});
	assert.equal(authenticatedWithoutCode.status, 404);
	assert.equal(authenticatedWithCode.status, 200);

	const legacyOrderId = '44444444-4444-4444-8444-444444444444';
	await fsPromises.appendFile(ordersPath, `${JSON.stringify({
		orderId: legacyOrderId,
		status: 'received',
		paymentStatus: 'cod_pending',
		items: []
	})}\n`);
	const legacyLookup = await fetch(`${baseUrl}/api/orders/${legacyOrderId}`);
	assert.equal(legacyLookup.status, 404);

	const invalidUuid = await fetch(`${baseUrl}/api/orders/not-a-uuid`);
	assert.equal(invalidUuid.status, 404);
	const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: admin.email, password: adminPassword })
	});
	assert.equal(adminLogin.status, 200);
	const adminToken = (await adminLogin.json()).token;
	const adminHeaders = { Authorization: `Bearer ${adminToken}` };
	const adminOrdersResponse = await fetch(`${baseUrl}/api/admin/orders`, {
		headers: adminHeaders
	});
	assert.equal(adminOrdersResponse.status, 200);
	const adminOrders = await adminOrdersResponse.json();
	assert.equal(Object.hasOwn(adminOrders.find((entry) => entry.orderId === creationBody.orderId), 'accessCodeHash'), false);
	const adminStatsResponse = await fetch(`${baseUrl}/api/admin/stats`, {
		headers: adminHeaders
	});
	assert.equal(adminStatsResponse.status, 200);
	const adminStats = await adminStatsResponse.json();
	assert.equal(Object.hasOwn(adminStats.recentOrders.find((entry) => entry.orderId === creationBody.orderId), 'accessCodeHash'), false);
	const adminUpdateResponse = await fetch(`${baseUrl}/api/admin/orders/${creationBody.orderId}`, {
		method: 'PATCH',
		headers: { ...adminHeaders, 'Content-Type': 'application/json' },
		body: JSON.stringify({ status: 'processing' })
	});
	assert.equal(adminUpdateResponse.status, 200);
	assert.equal(Object.hasOwn(await adminUpdateResponse.json(), 'accessCodeHash'), false);
	assert.doesNotMatch(loggedMessages.join('\n'), new RegExp(accessCode));
	assert.doesNotMatch(loggedMessages.join('\n'), new RegExp(accessCodeHash));
});

test('retries with the same idempotency key return one saved order and reject changed payloads', async (t) => {
	const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'booknest-idempotency-'));
	const ordersPath = path.join(temporaryDirectory, 'orders.jsonl');
	const server = createServer({ ordersPath, usersPath: path.join(temporaryDirectory, 'users.json') });
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve));
		await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const payload = {
		customerName: 'Nguyễn Văn B',
		address: '20 Đường Sách, Quận 1',
		phone: '0901234567',
		paymentMethod: 'cod',
		accessCode: 'd4'.repeat(32),
		discountRate: 0,
		items: [{ title: 'Nhà giả kim', quantity: 1 }],
	};
	const headers = {
		'Content-Type': 'application/json',
		'Idempotency-Key': 'checkout-retry-123',
	};
	const request = () => fetch(`http://127.0.0.1:${server.address().port}/api/orders`, {
		method: 'POST',
		headers,
		body: JSON.stringify(payload),
	});
	const first = await request();
	const firstBody = await first.json();
	const retry = await request();
	const retryBody = await retry.json();
	assert.equal(first.status, 201);
	assert.equal(retry.status, 200);
	assert.equal(retryBody.orderId, firstBody.orderId);
	assert.equal(retryBody.total, firstBody.total);
	const mismatched = await fetch(`http://127.0.0.1:${server.address().port}/api/orders`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ ...payload, accessCode: 'e5'.repeat(32) }),
	});
	assert.equal(mismatched.status, 409);
	assert.match((await mismatched.json()).error, /Idempotency-Key.*nội dung đơn hàng khác/i);
	const saved = (await fsPromises.readFile(ordersPath, 'utf8')).trim().split(/\r?\n/);
	assert.equal(saved.length, 1);
});

test('invalid idempotency keys are rejected before creating an order', async (t) => {
	const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'booknest-idempotency-invalid-'));
	const ordersPath = path.join(temporaryDirectory, 'orders.jsonl');
	const server = createServer({ ordersPath, usersPath: path.join(temporaryDirectory, 'users.json') });
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
		headers: {
			'Content-Type': 'application/json',
			'Idempotency-Key': 'bad key',
		},
		body: '{}',
	});
	assert.equal(response.status, 400);
	await assert.rejects(fsPromises.access(ordersPath));
});

test('coupon and account discounts use one rounded integer-money calculation', async (t) => {
	const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'booknest-money-rounding-'));
	const ordersPath = path.join(temporaryDirectory, 'orders.jsonl');
	const usersPath = path.join(temporaryDirectory, 'users.json');
	const server = createServer({ ordersPath, usersPath });
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve));
		await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const student = await fetch(`${baseUrl}/api/auth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			name: 'Nguyễn Văn B',
			email: 'money-rounding@example.com',
			password: 'password12345',
			studentType: 'student',
		}),
	});
	assert.equal(student.status, 201);
	const studentToken = (await student.json()).token;

	const response = await fetch(`${baseUrl}/api/orders`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${studentToken}`,
		},
		body: JSON.stringify({
			customerName: 'Nguyễn Văn B',
			address: '12 Đường Sách, Quận 1',
			phone: '0901234567',
			paymentMethod: 'cod',
			discountRate: 0.1,
			couponCode: 'BOOKNEST10',
			items: [{ title: 'Nhà giả kim', quantity: 1 }],
		}),
	});
	assert.equal(response.status, 201);
	const order = await response.json();
	assert.deepEqual(
		{ subtotal: order.subtotal, discount: order.discount, total: order.total },
		{ subtotal: 89000, discount: 13350, total: 75650 },
	);
});

test('customer PostgreSQL migration defines CRM tables, constraints and indexes', () => {
	const schemaPath = path.join(root, 'data', 'customer-schema.sql');
	assert.ok(fs.existsSync(schemaPath));
	const schema = fs.readFileSync(schemaPath, 'utf8');
	const initialMigration = read('data/migrations/001_customer_crm.sql');
	const alignmentMigration = read('data/migrations/002_align_customer_crm_schema.sql');
	const interactionMigration = read('data/migrations/007_customer_interaction_audit.sql');
	const migrationRunner = read('scripts/migrate.js');
	assert.match(schema, /CREATE TABLE IF NOT EXISTS customers/);
	assert.match(schema, /CREATE TABLE IF NOT EXISTS customer_interactions/);
	assert.match(schema, /updated_by VARCHAR\(100\) NOT NULL DEFAULT 'system'/);
	assert.match(interactionMigration, /ALTER TABLE customer_interactions/);
	assert.match(interactionMigration, /SET updated_by = COALESCE\(updated_by, created_by\)/);
	assert.match(schema, /CREATE TABLE IF NOT EXISTS customer_orders/);
	assert.match(schema, /CREATE TABLE IF NOT EXISTS consent_records/);
	assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone/);
	assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email/);
	assert.match(schema, /WHERE is_active/);
	assert.match(schema, /CHECK \(status IN \('new', 'lead', 'customer'\)\)/);
	assert.match(schema, /FOREIGN KEY \(customer_id\) REFERENCES customers/);
	assert.match(initialMigration, /CREATE TABLE IF NOT EXISTS customers/);
	assert.match(alignmentMigration, /ALTER TABLE customers/);
	assert.match(alignmentMigration, /UPDATE customer_orders/);
	assert.match(alignmentMigration, /CREATE TABLE IF NOT EXISTS consent_records/);
	assert.match(migrationRunner, /schema_migrations/);
	assert.match(migrationRunner, /pg_advisory_lock/);
	assert.match(read('data/migrations/003_shared_order_idempotency.sql'), /PRIMARY KEY/);
	assert.match(read('data/migrations/003_shared_order_idempotency.sql'), /ON CONFLICT \(idempotency_key\) DO NOTHING/);
	assert.match(read('data/migrations/004_transactional_book_inventory.sql'), /reserved <= stock/);
});

test('OpenAPI documents the current core API routes and CRM statuses', () => {
	const spec = JSON.parse(read('docs/openapi.json'));
	assert.ok(spec.paths['/api/customers/{id}/interactions']);
	assert.ok(spec.paths['/api/customers/{id}/interactions/{interactionId}']);
	assert.deepEqual(
		spec.components.schemas.CustomerInteractionInput.properties.type.enum,
		['call', 'chat', 'email', 'order', 'review', 'support', 'feedback'],
	);
	assert.equal(spec.openapi, '3.1.0');
	assert.ok(spec.paths['/api/auth/register']);
	assert.ok(spec.paths['/api/auth/social']);
	assert.ok(spec.paths['/api/auth/social/link'].post.security);
	assert.ok(spec.paths['/api/auth/social/unlink'].post.security);
	assert.ok(spec.paths['/api/auth/password-reset']);
	assert.ok(spec.paths['/api/orders'].get.security);
	assert.ok(spec.paths['/api/auth/password-reset/confirm']);
	assert.ok(spec.paths['/api/orders']);
	assert.ok(spec.paths['/api/orders/{id}'].patch.security);
	assert.equal(
		spec.paths['/api/orders/{id}'].patch.requestBody.content['application/json'].schema.$ref,
		'#/components/schemas/OrderUpdateRequest'
	);
	assert.equal(
		spec.components.schemas.OrderUpdateRequest.properties.items.items.additionalProperties,
		false
	);
	assert.ok(spec.paths['/api/customers/{id}']);
	assert.ok(spec.paths['/api/admin/customers']);
	assert.ok(spec.paths['/api/admin/customers/{id}']);
	assert.deepEqual(
		spec.paths['/api/customers/{id}'].patch.requestBody.content['application/json'].schema.properties.status.enum,
		['new', 'lead', 'customer']
	);
});

test('Render deployment provisions storefront URL and SMTP reset-email settings', () => {
	const renderConfig = read('render.yaml');
	assert.match(renderConfig, /key: PUBLIC_APP_URL[\s\S]*value: https:\/\/duongcongcao-0312\.github\.io\/duannhom5-main\//);
	['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASSWORD']
		.forEach((key) => assert.match(renderConfig, new RegExp(`key: ${key}`)));
	['RESEND_API_KEY', 'RESEND_FROM']
		.forEach((key) => assert.match(renderConfig, new RegExp(`key: ${key}`)));
});

test('customer seed is repeatable and includes 10 to 20 synthetic customers', () => {
	const seedPath = path.join(root, 'data', 'customer-seed.sql');
	assert.ok(fs.existsSync(seedPath));
	const seed = fs.readFileSync(seedPath, 'utf8');
	const demoEmails = seed.match(/'crm-demo-\d{2}@example\.com'/g) || [];
	assert.ok(demoEmails.length >= 10 && demoEmails.length <= 20);
	assert.match(seed, /ON CONFLICT DO NOTHING/);
	assert.match(seed, /INSERT INTO customer_interactions/);
});

test('invalid books are rejected without saving an order', async (t) => {
	const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'booknest-invalid-order-'));
	const ordersPath = path.join(temporaryDirectory, 'orders.jsonl');
	const server = createServer({ ordersPath, usersPath: path.join(temporaryDirectory, 'users.json') });
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
			accessCode: 'a1'.repeat(32),
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

test('orders exceeding stock are rejected without changing existing orders', async (t) => {
	const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'booknest-stock-order-'));
	const ordersPath = path.join(temporaryDirectory, 'orders.jsonl');
	const existingOrder = JSON.stringify({ orderId: 'existing-order', status: 'received' }) + '\n';
	await fsPromises.writeFile(ordersPath, existingOrder);
	const server = createServer({ ordersPath, usersPath: path.join(temporaryDirectory, 'users.json') });
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve));
		await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});

	const request = (items) => fetch(`http://127.0.0.1:${server.address().port}/api/orders`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			customerName: 'Nguyễn Văn A',
			address: '12 Đường Sách, Quận 1',
			phone: '0901234567',
			paymentMethod: 'cod',
			accessCode: 'a1'.repeat(32),
			discountRate: 0,
			items,
		}),
	});

	const directOverflow = await request([{ title: 'Nhà giả kim', quantity: 13 }]);
	assert.equal(directOverflow.status, 400);
	assert.match((await directOverflow.json()).error, /vượt quá tồn kho/i);

	const duplicateOverflow = await request([
		{ title: 'Nhà giả kim', quantity: 7 },
		{ title: 'Nhà giả kim', quantity: 6 },
	]);
	assert.equal(duplicateOverflow.status, 400);
	assert.match((await duplicateOverflow.json()).error, /vượt quá tồn kho/i);
	assert.equal(await fsPromises.readFile(ordersPath, 'utf8'), existingOrder);
});

test('zero and negative quantities are rejected on create and update without persistence', async (t) => {
	configureTestAdmin(t);
	const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'booknest-invalid-quantity-'));
	const ordersPath = path.join(temporaryDirectory, 'orders.jsonl');
	const server = createServer({ ordersPath, usersPath: path.join(temporaryDirectory, 'users.json') });
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve));
		await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const request = (quantity) => fetch(`${baseUrl}/api/orders`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			customerName: 'Nguyễn Văn A',
			address: '12 Đường Sách, Quận 1',
			phone: '0901234567',
			paymentMethod: 'cod',
			accessCode: 'a1'.repeat(32),
			discountRate: 0,
			items: [{ title: 'Nhà giả kim', quantity }],
		}),
	});

	for (const quantity of [0, -1]) {
		const response = await request(quantity);
		assert.equal(response.status, 400);
		assert.match((await response.json()).error, /lớn hơn 0/i);
	}
	assert.equal(await fsPromises.stat(ordersPath).then(() => true, (error) => {
		if (error.code === 'ENOENT') return false;
		throw error;
	}), false);

	const validResponse = await request(1);
	assert.equal(validResponse.status, 201);
	const order = await validResponse.json();
	const beforeUpdate = await fsPromises.readFile(ordersPath, 'utf8');
	const updateResponse = await fetch(`${baseUrl}/api/orders/${order.orderId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ items: [{ title: 'Nhà giả kim', quantity: 0 }] }),
	});
	assert.equal(updateResponse.status, 401);

	const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: 'admin@example.com', password: 'local-test-admin-password-123' }),
	});
	const token = (await loginResponse.json()).token;
	const authenticatedUpdate = await fetch(`${baseUrl}/api/orders/${order.orderId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify({ items: [{ title: 'Nhà giả kim', quantity: -2 }] }),
	});
	assert.equal(authenticatedUpdate.status, 400);
	assert.match((await authenticatedUpdate.json()).error, /lớn hơn 0/i);
	assert.equal(await fsPromises.readFile(ordersPath, 'utf8'), beforeUpdate);
});

test('order product updates recalculate totals and preserve order and stock on failures', async (t) => {
	configureTestAdmin(t);
	const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'booknest-order-update-'));
	const ordersPath = path.join(temporaryDirectory, 'orders.jsonl');
	const usersPath = path.join(temporaryDirectory, 'users.json');
	const database = new Database({ ordersPath, usersPath });
	const server = createServer({ database, ordersPath, usersPath });
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve));
		await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const orderRequest = (quantity) => fetch(`${baseUrl}/api/orders`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			customerName: 'Order Update User',
			address: '1 Đường Sách',
			phone: '0901234567',
			paymentMethod: 'cod',
			accessCode: 'a1'.repeat(32),
			discountRate: 0,
			items: [{ title: 'Nhà giả kim', quantity }],
		}),
	});
	const createdResponse = await orderRequest(1);
	assert.equal(createdResponse.status, 201);
	const createdOrder = await createdResponse.json();
	const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: 'admin@example.com', password: 'local-test-admin-password-123' }),
	});
	const token = (await loginResponse.json()).token;
	const update = (orderId, items) => fetch(`${baseUrl}/api/orders/${orderId}`, {
		method: 'PATCH',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ items }),
	});

	const successfulUpdate = await update(createdOrder.orderId, [
		{ title: 'Nhà giả kim', quantity: 2 },
	]);
	assert.equal(successfulUpdate.status, 200);
	const updatedOrder = await successfulUpdate.json();
	assert.equal(updatedOrder.items[0].quantity, 2);
	assert.equal(updatedOrder.subtotal, createdOrder.subtotal * 2);
	assert.equal(updatedOrder.total, updatedOrder.subtotal - updatedOrder.discount);

	assert.equal((await orderRequest(10)).status, 201);
	const beforeRejectedUpdate = await fsPromises.readFile(ordersPath, 'utf8');
	const stockRejected = await update(createdOrder.orderId, [
		{ title: 'Nhà giả kim', quantity: 3 },
	]);
	assert.equal(stockRejected.status, 400);
	assert.match((await stockRejected.json()).error, /vượt quá tồn kho/i);
	assert.equal(await fsPromises.readFile(ordersPath, 'utf8'), beforeRejectedUpdate);

	const unknownProduct = await update(createdOrder.orderId, [
		{ title: 'Sách không tồn tại', quantity: 1 },
	]);
	assert.equal(unknownProduct.status, 400);
	assert.match((await unknownProduct.json()).error, /không hợp lệ/i);
	assert.equal(await fsPromises.readFile(ordersPath, 'utf8'), beforeRejectedUpdate);

	const unsupportedItemField = await fetch(`${baseUrl}/api/orders/${createdOrder.orderId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify({
			items: [{ title: 'Nhà giả kim', quantity: 1, unitPrice: 1 }],
		}),
	});
	assert.equal(unsupportedItemField.status, 400);
	assert.equal(await fsPromises.readFile(ordersPath, 'utf8'), beforeRejectedUpdate);
});

test('order update database failures return a sanitized error and do not alter saved order data', async (t) => {
	configureTestAdmin(t);
	const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'booknest-order-update-failure-'));
	const ordersPath = path.join(temporaryDirectory, 'orders.jsonl');
	const usersPath = path.join(temporaryDirectory, 'users.json');
	const database = new Database({ ordersPath, usersPath });
	const server = createServer({ database, ordersPath, usersPath });
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve));
		await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const createdResponse = await fetch(`${baseUrl}/api/orders`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			customerName: 'Order Update Failure User',
			address: '1 Đường Sách',
			phone: '0901234567',
			paymentMethod: 'cod',
			accessCode: 'a1'.repeat(32),
			discountRate: 0,
			items: [{ title: 'Nhà giả kim', quantity: 1 }],
		}),
	});
	const createdOrder = await createdResponse.json();
	const beforeUpdate = await fsPromises.readFile(ordersPath, 'utf8');
	const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: 'admin@example.com', password: 'local-test-admin-password-123' }),
	});
	const token = (await loginResponse.json()).token;
	database.updateOrderStatus = async () => {
		throw new Error('injected database credentials failure');
	};

	const response = await fetch(`${baseUrl}/api/orders/${createdOrder.orderId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify({ items: [{ title: 'Nhà giả kim', quantity: 2 }] }),
	});
	assert.equal(response.status, 500);
	assert.match((await response.json()).error, /Máy chủ gặp lỗi/i);
	assert.equal(await fsPromises.readFile(ordersPath, 'utf8'), beforeUpdate);
});

test('concurrent orders are serialized and cannot reserve the same stock twice', async (t) => {
	const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'booknest-order-race-'));
	const ordersPath = path.join(temporaryDirectory, 'orders.jsonl');
	const server = createServer({ ordersPath, usersPath: path.join(temporaryDirectory, 'users.json') });
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve));
		await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const request = () => fetch(`${baseUrl}/api/orders`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			customerName: 'Nguyễn Văn C',
			address: '12 Đường Sách, Quận 1',
			phone: '0901234567',
			paymentMethod: 'cod',
			accessCode: 'a1'.repeat(32),
			discountRate: 0,
			items: [{ title: 'Nhà giả kim', quantity: 8 }],
		}),
	});

	const responses = await Promise.all([request(), request()]);
	assert.deepEqual(responses.map((response) => response.status).sort(), [201, 400]);
	const failedResponse = responses.find((response) => response.status === 400);
	assert.match((await failedResponse.json()).error, /vượt quá tồn kho/i);
	const savedOrders = (await fsPromises.readFile(ordersPath, 'utf8'))
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	assert.equal(savedOrders.length, 1);
	assert.equal(savedOrders[0].items[0].quantity, 8);
});
