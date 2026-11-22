(function () {
  const POLICY_VERSION = '2026-01';
  const CONSENT_PURPOSES = new Set(['order', 'service', 'marketing']);
  const REQUEST_TYPES = new Set(['access', 'update', 'delete']);
  const REQUEST_STATUS_LABELS = {
    pending: 'Đang chờ xử lý',
    processing: 'Đang xử lý',
    completed: 'Đã hoàn tất',
    rejected: 'Đã từ chối'
  };

  function getToken() {
    return window.booknestAuth && window.booknestAuth.getToken();
  }

  function setStatus(id, message) {
    const element = document.getElementById(id);
    if (element) element.textContent = message;
  }

  async function request(url, options = {}) {
    const token = getToken();
    if (!token) throw new Error('Vui lòng đăng nhập để tiếp tục.');
    const headers = {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    };
    if (options.body) headers['Content-Type'] = 'application/json';
    const response = await window.booknestApiFetch(url, { ...options, headers });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Không thể cập nhật thông tin quyền riêng tư.');
    }
    return result;
  }

  async function loadConsents() {
    if (!getToken()) {
      setStatus('consentStatus', 'Đăng nhập để xem và quản lý consent.');
      return null;
    }
    const result = await request('/api/privacy/consents', { method: 'GET' });
    if (typeof document.querySelectorAll === 'function') {
      for (const control of document.querySelectorAll('[data-consent]')) {
        const record = result.current && result.current[control.dataset.consent];
        control.checked = Boolean(record && record.consent);
      }
    }
    setStatus('consentStatus', 'Đã tải trạng thái consent của tài khoản.');
    return result;
  }

  async function saveConsent(purpose, consent) {
    if (!CONSENT_PURPOSES.has(purpose) || typeof consent !== 'boolean') {
      throw new TypeError('Consent selection is invalid.');
    }
    const result = await request('/api/privacy/consents', {
      method: 'POST',
      body: JSON.stringify({
        purpose,
        policyVersion: POLICY_VERSION,
        dataSource: 'web',
        consent,
        retentionDays: 0
      })
    });
    setStatus('consentStatus', 'Đã lưu lựa chọn consent.');
    return result;
  }

  async function revokeConsent(purpose) {
    if (!CONSENT_PURPOSES.has(purpose)) {
      throw new TypeError('Consent purpose is invalid.');
    }
    const result = await request(
      `/api/privacy/consents/${purpose}?policyVersion=${POLICY_VERSION}`,
      { method: 'DELETE' }
    );
    const control = typeof document.querySelector === 'function'
      ? document.querySelector(`[data-consent="${purpose}"]`)
      : null;
    if (control) control.checked = false;
    setStatus('consentStatus', 'Đã ghi nhận yêu cầu rút lại consent.');
    return result;
  }

  async function loadDataRequests() {
    if (!getToken()) {
      setStatus('privacyDataRequestStatus', 'Đăng nhập để xem yêu cầu.');
      return null;
    }
    const result = await request('/api/privacy/data-requests', { method: 'GET' });
    const list = document.getElementById('privacyDataRequestList');
    if (list) {
      list.replaceChildren();
      for (const item of result.requests || []) {
        const entry = document.createElement('li');
        entry.textContent = `${item.type}: ${REQUEST_STATUS_LABELS[item.status] || item.status}`;
        list.appendChild(entry);
      }
    }
    setStatus(
      'privacyDataRequestStatus',
      result.requests && result.requests.length
        ? 'Trạng thái yêu cầu của bạn:'
        : 'Bạn chưa có yêu cầu dữ liệu nào.'
    );
    return result;
  }

  async function createDataRequest(type) {
    if (!REQUEST_TYPES.has(type)) {
      throw new TypeError('Data request type is invalid.');
    }
    const result = await request('/api/privacy/data-requests', {
      method: 'POST',
      body: JSON.stringify({ type })
    });
    setStatus('privacyDataRequestStatus', 'Đã gửi yêu cầu dữ liệu.');
    return result;
  }

  let latestExportDownload = null;

  async function loadExports() {
    if (!getToken()) {
      setStatus('privacyExportStatus', 'Đăng nhập để tạo và tải bản xuất dữ liệu.');
      return null;
    }
    const result = await request('/api/privacy/exports', { method: 'GET' });
    const list = document.getElementById('privacyExportList');
    if (list) {
      list.replaceChildren();
      for (const item of result.exports || []) {
        const entry = document.createElement('li');
        const statusText = item.expired ? 'Đã hết hạn' : `Còn hiệu lực đến ${item.expiresAt}`;
        entry.textContent = `${item.filename} (${item.format.toUpperCase()}) — ${statusText}`;
        list.appendChild(entry);
      }
    }
    if (!latestExportDownload) {
      setStatus(
        'privacyExportStatus',
        result.exports && result.exports.length
          ? 'Lịch sử bản xuất dữ liệu của bạn:'
          : 'Bạn chưa có bản xuất dữ liệu nào.'
      );
    }
    return result;
  }

  async function createDataExport(currentPassword = '') {
    const body = { format: 'json' };
    if (typeof currentPassword === 'string' && currentPassword) {
      body.currentPassword = currentPassword;
    }
    const result = await request('/api/privacy/exports', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    latestExportDownload = result.export || null;
    const downloadButton = document.getElementById('privacyExportDownloadButton');
    if (downloadButton && latestExportDownload && latestExportDownload.downloadToken) {
      downloadButton.hidden = false;
    }
    setStatus(
      'privacyExportStatus',
      `Đã tạo bản xuất ${result.export.filename}. Liên kết có hiệu lực đến ${result.export.expiresAt}.`
    );
    return result;
  }

  async function downloadDataExport(exportRecord = latestExportDownload) {
    const token = getToken();
    if (!token) throw new Error('Vui lòng đăng nhập để tiếp tục.');
    if (!exportRecord || !exportRecord.downloadUrl || !exportRecord.downloadToken) {
      throw new Error('Không có mã tải xuống hợp lệ. Vui lòng tạo bản xuất mới khi bản cũ hết hạn.');
    }
    const response = await window.booknestApiFetch(exportRecord.downloadUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Export-Token': exportRecord.downloadToken
      }
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || 'Không thể tải bản xuất dữ liệu.');
    }
    const blob = await response.blob();
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = exportRecord.filename || 'booknest-personal-data.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    }
    setStatus('privacyExportStatus', `Đã tải xuống ${exportRecord.filename}.`);
    return blob;
  }

  function bindControls() {
    if (typeof document.querySelectorAll === 'function') {
      for (const button of document.querySelectorAll('[data-consent-save]')) {
        button.addEventListener('click', () => {
          const purpose = button.dataset.consentSave;
          const control = document.querySelector(`[data-consent="${purpose}"]`);
          saveConsent(purpose, Boolean(control && control.checked))
            .catch((error) => setStatus('consentStatus', error.message));
        });
      }
      for (const button of document.querySelectorAll('[data-consent-revoke]')) {
        button.addEventListener('click', () => {
          revokeConsent(button.dataset.consentRevoke)
            .catch((error) => setStatus('consentStatus', error.message));
        });
      }
    }

    const form = document.getElementById('privacyDataRequestForm');
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const type = document.getElementById('privacyDataRequestType').value;
        createDataRequest(type)
          .then(() => loadDataRequests())
          .catch((error) => setStatus('privacyDataRequestStatus', error.message));
      });
    }

    const exportForm = document.getElementById('privacyExportForm');
    if (exportForm) {
      exportForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const passwordInput = document.getElementById('privacyExportPassword');
        const password = passwordInput ? passwordInput.value : '';
        createDataExport(password)
          .then(() => {
            if (passwordInput) passwordInput.value = '';
            return loadExports();
          })
          .catch((error) => setStatus('privacyExportStatus', error.message));
      });
    }

    const downloadButton = document.getElementById('privacyExportDownloadButton');
    if (downloadButton) {
      downloadButton.addEventListener('click', () => {
        downloadDataExport()
          .then(() => loadExports())
          .catch((error) => setStatus('privacyExportStatus', error.message));
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindControls();
    loadConsents().catch((error) => setStatus('consentStatus', error.message));
    loadDataRequests().catch((error) =>
      setStatus('privacyDataRequestStatus', error.message)
    );
    loadExports().catch((error) =>
      setStatus('privacyExportStatus', error.message)
    );
  });

  window.booknestPrivacy = {
    createDataExport,
    createDataRequest,
    downloadDataExport,
    loadConsents,
    loadDataRequests,
    loadExports,
    revokeConsent,
    saveConsent
  };
})();
