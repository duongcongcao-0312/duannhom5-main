(function attachBookNestVietQr(root, factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	if (root) root.BookNestVietQr = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBookNestVietQr() {
	const paymentCodePattern = /^BN[A-F0-9]{12}$/;

	function normalizePaymentConfig(config) {
		const bankCode = String(config?.bankCode || '').trim();
		const accountNumber = String(config?.accountNumber || '').trim();
		const accountName = String(config?.accountName || '').trim();

		if (!/^\d{6}$/.test(bankCode)) {
			throw new TypeError('Mã ngân hàng VietQR phải là BIN gồm 6 chữ số.');
		}
		if (!/^\d{6,19}$/.test(accountNumber)) {
			throw new TypeError('Số tài khoản nhận thanh toán không hợp lệ.');
		}
		if (!accountName) {
			throw new TypeError('Thiếu tên chủ tài khoản nhận thanh toán.');
		}

		return { bankCode, accountNumber, accountName };
	}

	function buildPaymentQrUrl(config, order) {
		const paymentConfig = normalizePaymentConfig(config);
		if (!order || typeof order !== 'object' || order.paymentMethod !== 'transfer' ||
			typeof order.orderId !== 'string' || !order.orderId.trim() ||
			typeof order.paymentCode !== 'string' || !paymentCodePattern.test(order.paymentCode) ||
			!Number.isSafeInteger(order.total) || order.total <= 0) {
			throw new TypeError('Đơn hàng chuyển khoản chưa hợp lệ để tạo mã QR.');
		}

		const imagePath = `${encodeURIComponent(paymentConfig.bankCode)}-${encodeURIComponent(paymentConfig.accountNumber)}-compact2.png`;
		const query = [
			`amount=${order.total}`,
			`addInfo=${encodeURIComponent(order.paymentCode)}`,
			`accountName=${encodeURIComponent(paymentConfig.accountName)}`
		].join('&');
		return `https://img.vietqr.io/image/${imagePath}?${query}`;
	}

	return Object.freeze({ buildPaymentQrUrl, normalizePaymentConfig });
});
