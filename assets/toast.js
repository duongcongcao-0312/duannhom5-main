(function (global) {
  const icons = {
    success: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 9"/></svg>',
    error: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg>',
    warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 4.9 2.8 18a1.5 1.5 0 0 0 1.3 2.2h15.8a1.5 1.5 0 0 0 1.3-2.2l-7.5-13.1a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 3h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></svg>',
  };
  const durations = { success: 5_600, error: 7_000, warning: 6_500, info: 5_600 };
  const activeToasts = new Set();
  const timerState = new WeakMap();
  const maxVisibleToasts = 4;

  function dismiss(toast) {
    if (!toast || toast.classList.contains('is-leaving')) return;
    const state = timerState.get(toast);
    if (state?.timer) clearTimeout(state.timer);
    activeToasts.delete(toast);
    toast.classList.add('is-leaving');
    setTimeout(() => {
      toast.remove();
    }, 240);
  }

  function startTimer(toast) {
    const state = timerState.get(toast);
    if (!state || state.timer) return;
    state.startedAt = Date.now();
    state.timer = setTimeout(() => dismiss(toast), state.remaining);
  }

  function pauseTimer(toast) {
    const state = timerState.get(toast);
    if (!state || !state.timer) return;
    clearTimeout(state.timer);
    state.timer = null;
    state.remaining = Math.max(0, state.remaining - (Date.now() - state.startedAt));
    toast.classList.add('is-paused');
  }

  function resumeTimer(toast) {
    if (toast.matches(':hover') || toast.contains(document.activeElement)) return;
    toast.classList.remove('is-paused');
    startTimer(toast);
  }

  function showToast(message, requestedType = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return null;
    const type = Object.prototype.hasOwnProperty.call(icons, requestedType) ? requestedType : 'info';
    if (activeToasts.size >= maxVisibleToasts) {
      dismiss(activeToasts.values().next().value);
    }

    const toast = document.createElement('article');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    toast.setAttribute('aria-atomic', 'true');
    toast.style.setProperty('--toast-duration', `${durations[type]}ms`);

    const icon = document.createElement('span');
    icon.className = 'toast__icon';
    icon.innerHTML = icons[type];

    const copy = document.createElement('p');
    copy.className = 'toast__message';
    copy.textContent = String(message ?? '');

    const close = document.createElement('button');
    close.className = 'toast__close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Đóng thông báo');
    close.textContent = '×';
    close.addEventListener('click', () => dismiss(toast));

    const progress = document.createElement('span');
    progress.className = 'toast__progress';
    progress.setAttribute('aria-hidden', 'true');

    toast.append(icon, copy, close, progress);
    container.appendChild(toast);
    activeToasts.add(toast);
    timerState.set(toast, { remaining: durations[type], startedAt: 0, timer: null });
    startTimer(toast);
    toast.addEventListener('pointerenter', () => pauseTimer(toast));
    toast.addEventListener('pointerleave', () => resumeTimer(toast));
    toast.addEventListener('focusin', () => pauseTimer(toast));
    toast.addEventListener('focusout', () => resumeTimer(toast));
    return toast;
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const focusedToast = document.activeElement?.closest?.('.toast');
    if (!focusedToast) return;
    event.preventDefault();
    dismiss(focusedToast);
  });

  global.booknestToast = showToast;
})(window);
