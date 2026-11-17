const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

class FakeClassList {
	constructor(owner) {
		this.owner = owner;
	this.values = new Set();
	}
	add(value) { this.values.add(value); }
	remove(value) { this.values.delete(value); }
	contains(value) { return this.values.has(value); }
}

class FakeElement {
	constructor(tagName) {
		this.tagName = tagName;
		this.children = [];
		this.attributes = new Map();
		this.listeners = new Map();
		this.parentNode = null;
		this.classList = new FakeClassList(this);
		this.style = { properties: new Map(), setProperty: (name, value) => this.style.properties.set(name, value) };
		this.textContent = '';
		this.type = '';
		this._className = '';
	}
	set className(value) {
		this._className = value;
		this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean));
	}
	get className() { return this._className; }
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	appendChild(child) {
		this.children.push(child);
		child.parentNode = this;
		return child;
	}
	append(...children) { children.forEach((child) => this.appendChild(child)); }
	addEventListener(type, callback) {
		const listeners = this.listeners.get(type) || [];
		listeners.push(callback);
		this.listeners.set(type, listeners);
	}
	dispatch(type, event = {}) {
		for (const callback of this.listeners.get(type) || []) callback({ preventDefault() {}, ...event });
	}
	remove() {
		if (!this.parentNode) return;
		this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
		this.parentNode = null;
	}
	contains(node) {
		return this === node || this.children.some((child) => child.contains(node));
	}
	closest(selector) {
		let current = this;
		while (current) {
			if (selector === '.toast' && current.classList.contains('toast')) return current;
			current = current.parentNode;
		}
		return null;
	}
	matches(selector) { return selector === ':hover' ? false : false; }
}

function createToastContext() {
	const container = new FakeElement('div');
	const documentListeners = new Map();
	const timers = new Map();
	let timerId = 0;
	const document = {
		activeElement: null,
		getElementById: (id) => id === 'toastContainer' ? container : null,
		createElement: (tagName) => new FakeElement(tagName),
		createElementNS: (_namespace, tagName) => new FakeElement(tagName),
		addEventListener(type, callback) {
			const listeners = documentListeners.get(type) || [];
			listeners.push(callback);
			documentListeners.set(type, listeners);
		},
		dispatch(type, event) {
			for (const callback of documentListeners.get(type) || []) callback(event);
		},
	};
	const window = {};
	const context = {
		window,
		document,
		Date,
		setTimeout(callback, delay) {
			const id = ++timerId;
			timers.set(id, { callback, delay });
			return id;
		},
		clearTimeout(id) { timers.delete(id); },
	};
	vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/toast.js'), 'utf8'), context);
	return { container, document, timers, window };
}

function findByClass(element, className) {
	if (element.classList.contains(className)) return element;
	for (const child of element.children) {
		const found = findByClass(child, className);
		if (found) return found;
	}
	return null;
}

test('toast statuses have accessible roles, icons and the requested display durations', () => {
	const { container, window, timers } = createToastContext();
	const success = window.booknestToast('Đã lưu.', 'success');
	assert.ok([...timers.values()].some(({ delay }) => delay === 5000));
	const info = window.booknestToast('Đang chờ.', 'info');
	const warning = window.booknestToast('Kiểm tra lại.', 'warning');
	const error = window.booknestToast('Không thể lưu.', 'error');

	assert.equal(container.children.length, 3);
	assert.equal(success.attributes.get('role'), 'status');
	assert.equal(info.attributes.get('aria-live'), 'polite');
	assert.equal(warning.attributes.get('aria-atomic'), 'true');
	assert.equal(error.attributes.get('role'), 'alert');
	assert.equal(error.attributes.get('aria-live'), 'assertive');
	assert.ok(findByClass(success, 'toast__icon').children[0].tagName === 'svg');
	assert.ok([...timers.values()].some(({ delay }) => delay === 6000));
	assert.ok([...timers.values()].some(({ delay }) => delay === 9000));
	assert.equal([...timers.values()].filter(({ delay }) => delay === 0).length, 0);
	assert.equal(findByClass(error, 'toast__progress'), null);
});

test('toast stack is capped at three and repeated content is deduplicated', () => {
	const { container, window } = createToastContext();
	const first = window.booknestToast('Trùng lặp', 'info');
	assert.equal(window.booknestToast('Trùng lặp', 'info'), first);
	assert.equal(container.children.length, 1);
	window.booknestToast('Toast thứ hai', 'success');
	window.booknestToast('Toast thứ ba', 'warning');
	window.booknestToast('Toast thứ tư', 'error');
	assert.equal(container.children.length, 3);
	assert.equal(container.children.some((toast) => toast === first), false);
});

test('long Vietnamese text, order details and actions use text nodes without dynamic HTML', () => {
	const { window } = createToastContext();
	const longText = 'Đơn hàng ' + 'ABCD1234'.repeat(18) + ' — nội dung <script>alert(1)</script> được giữ nguyên dưới dạng chữ.';
	let actionCalled = false;
	const toast = window.booknestToast(longText, 'success', {
		title: 'Đặt hàng thành công!',
		details: [
			{ label: 'Mã đơn', value: 'ABCD1234-VERY-LONG-ORDER-IDENTIFIER' },
			{ label: 'Tổng tiền', value: '245.000 ₫' },
		],
		action: { label: 'Tra cứu đơn', onClick: () => { actionCalled = true; } },
	});

	assert.equal(findByClass(toast, 'toast__title').textContent, 'Đặt hàng thành công!');
	assert.equal(findByClass(toast, 'toast__message').textContent, longText);
	assert.equal(findByClass(toast, 'toast__details').children.length, 2);
	assert.equal(findByClass(toast, 'toast__action').textContent, 'Tra cứu đơn');
	assert.equal(Object.hasOwn(findByClass(toast, 'toast__message'), 'innerHTML'), false);
	findByClass(toast, 'toast__action').dispatch('click');
	assert.equal(actionCalled, true);
});

test('close button, Escape and hover/focus timers remain keyboard-accessible', () => {
	const { document, window } = createToastContext();
	const toast = window.booknestToast('Có thể đóng bằng bàn phím.', 'warning');
	const close = findByClass(toast, 'toast__close');
	assert.equal(close.attributes.get('aria-label'), 'Đóng thông báo');
	toast.dispatch('pointerenter');
	assert.equal(toast.classList.contains('is-paused'), true);
	toast.dispatch('pointerleave');

	let prevented = false;
	document.activeElement = close;
	document.dispatch('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
	assert.equal(prevented, true);
	assert.equal(toast.classList.contains('is-leaving'), true);
});

test('premium dark toast styles cover desktop, mobile and reduced motion', () => {
	const css = fs.readFileSync(path.join(root, 'assets/toast.css'), 'utf8');
	assert.match(css, /background:\s*#151c1a/i);
	assert.match(css, /border-radius:\s*16px/i);
	assert.match(css, /@media\s*\(max-width:\s*600px\)/);
	assert.match(css, /align-items:\s*center/);
	assert.match(css, /prefers-reduced-motion:\s*reduce/);
	assert.match(css, /toast-enter\s+250ms/);
});
