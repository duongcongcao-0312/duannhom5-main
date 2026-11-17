(function (global, doc) {
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const typeConfig = {
    success: { title: 'Thành công', duration: 5000, icon: [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'm8 12 2.5 2.5L16.5 9' }]] },
    error: { title: 'Có lỗi xảy ra', duration: 0, icon: [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'm9 9 6 6m0-6-6 6' }]] },
    warning: { title: 'Cần lưu ý', duration: 9000, icon: [['path', { d: 'M10.3 4.9 2.8 18a1.5 1.5 0 0 0 1.3 2.2h15.8a1.5 1.5 0 0 0 1.3-2.2L13.7 4.9a2 2 0 0 0-3.4 0Z' }], ['path', { d: 'M12 9v4m0 3h.01' }]] },
    info: { title: 'Thông tin', duration: 6000, icon: [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'M12 11v5m0-8h.01' }]] },
  };
  const maxVisibleToasts = 3;
  const activeToasts = new Set();
  const dedupeIndex = new Map();
  const timerState = new WeakMap();

  function makeIcon(type) {
    const svg = doc.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const [tagName, attributes] of typeConfig[type].icon) {
      const shape = doc.createElementNS(svgNamespace, tagName);
      for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
      svg.appendChild(shape);
    }
    return svg;
  }

  function dismiss(toast, immediate = false) {
    if (!toast || toast.classList.contains('is-leaving')) return;
    const state = timerState.get(toast);
    if (state?.timer !== null && state?.timer !== undefined) clearTimeout(state.timer);
    if (state) state.timer = null;
    activeToasts.delete(toast);
    if (state && dedupeIndex.get(state.key)?.toast === toast) dedupeIndex.delete(state.key);
    if (immediate) {
      toast.remove();
      return;
    }
    toast.classList.add('is-leaving');
    toast.setAttribute('aria-hidden', 'true');
    setTimeout(() => toast.remove(), 250);
  }

  function startTimer(toast) {
    const state = timerState.get(toast);
    if (!state || state.duration <= 0 || state.timer !== null) return;
    state.startedAt = Date.now();
    state.timer = setTimeout(() => dismiss(toast), state.remaining);
  }

  function pauseTimer(toast) {
    const state = timerState.get(toast);
    if (!state || state.timer === null) return;
    clearTimeout(state.timer);
    state.timer = null;
    state.remaining = Math.max(0, state.remaining - (Date.now() - state.startedAt));
    toast.classList.add('is-paused');
  }

  function resumeTimer(toast) {
    if (toast.matches(':hover') || toast.contains(doc.activeElement)) return;
    toast.classList.remove('is-paused');
    startTimer(toast);
  }

  function normalizedText(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
  }

  function showToast(message, requestedType = 'success', options = {}) {
    const container = doc.getElementById('toastContainer');
    if (!container) return null;

    const type = Object.hasOwn(typeConfig, requestedType) ? requestedType : 'info';
    const messageText = String(message ?? '');
    const titleText = normalizedText(options.title) || typeConfig[type].title;
    const details = Array.isArray(options.details)
      ? options.details.slice(0, 3).map((detail) => ({
        label: String(detail?.label ?? ''),
        value: String(detail?.value ?? ''),
      }))
      : [];
    const detailKey = details.map(({ label, value }) => `${label}:${value}`).join('|');
    const actionLabel = String(options.action?.label ?? '');
    const key = `${type}|${titleText}|${normalizedText(messageText)}|${detailKey}|${actionLabel}`;
    const duplicate = dedupeIndex.get(key);
    if (duplicate && activeToasts.has(duplicate.toast)) return duplicate.toast;

    while (container.children.length >= maxVisibleToasts) {
      const oldest = container.children[0];
      if (oldest.classList.contains('is-leaving')) oldest.remove();
      else dismiss(oldest, true);
    }

    const requestedDuration = Number(options.duration);
    const duration = Number.isFinite(requestedDuration) && requestedDuration >= 0
      ? requestedDuration
      : typeConfig[type].duration;
    const toast = doc.createElement('article');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    toast.setAttribute('aria-atomic', 'true');
    toast.style.setProperty('--toast-duration', `${duration}ms`);

    const icon = doc.createElement('span');
    icon.className = 'toast__icon';
    icon.appendChild(makeIcon(type));

    const content = doc.createElement('div');
    content.className = 'toast__content';
    const title = doc.createElement('strong');
    title.className = 'toast__title';
    title.textContent = titleText;
    content.appendChild(title);

    if (messageText) {
      const copy = doc.createElement('p');
      copy.className = 'toast__message';
      copy.textContent = messageText;
      content.appendChild(copy);
    }

    if (details.length) {
      const detailList = doc.createElement('dl');
      detailList.className = 'toast__details';
      for (const detail of details) {
        const row = doc.createElement('div');
        row.className = 'toast__detail';
        const label = doc.createElement('dt');
        label.textContent = detail.label;
        const value = doc.createElement('dd');
        value.textContent = detail.value;
        row.append(label, value);
        detailList.appendChild(row);
      }
      content.appendChild(detailList);
    }

    const close = doc.createElement('button');
    close.className = 'toast__close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Đóng thông báo');
    close.textContent = '×';
    close.addEventListener('click', () => dismiss(toast));

    const children = [icon, content, close];
    if (duration > 0) {
      const progress = doc.createElement('span');
      progress.className = 'toast__progress';
      progress.setAttribute('aria-hidden', 'true');
      children.push(progress);
    } else {
      toast.classList.add('toast--manual-close');
    }

    if (options.action && typeof options.action.onClick === 'function' && options.action.label) {
      const action = doc.createElement('button');
      action.className = 'toast__action';
      action.type = 'button';
      action.textContent = String(options.action.label);
      action.addEventListener('click', () => {
        dismiss(toast);
        options.action.onClick();
      });
      content.appendChild(action);
    }

    toast.append(...children);
    container.appendChild(toast);
    activeToasts.add(toast);
    timerState.set(toast, { key, duration, remaining: duration, startedAt: 0, timer: null });
    dedupeIndex.set(key, { toast });
    startTimer(toast);
    toast.addEventListener('pointerenter', () => pauseTimer(toast));
    toast.addEventListener('pointerleave', () => resumeTimer(toast));
    toast.addEventListener('focusin', () => pauseTimer(toast));
    toast.addEventListener('focusout', () => resumeTimer(toast));
    return toast;
  }

  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const focusedToast = doc.activeElement?.closest?.('.toast');
    if (!focusedToast) return;
    event.preventDefault();
    dismiss(focusedToast);
  });

  global.booknestToast = showToast;
})(window, document);
