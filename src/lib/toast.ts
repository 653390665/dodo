/**
 * Minimal toast notification — replaces browser alert() dialogs.
 * No dependencies — uses DOM manipulation with Tailwind classes.
 */

type ToastType = 'info' | 'success' | 'error';

let toastContainer: HTMLDivElement | null = null;

function ensureContainer(): HTMLDivElement {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = document.createElement('div');
    // data marker lets test teardown sweep toasts injected into document.body.
    toastContainer.setAttribute('data-inkflow-toasts', '');
    toastContainer.className = 'fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none';
    toastContainer.setAttribute('role', 'status');
    toastContainer.setAttribute('aria-live', 'polite');
    toastContainer.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

const TYPE_STYLES: Record<ToastType, string> = {
  info: 'bg-theme-text text-theme-bg',
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
};

export function toast(
  message: string,
  type: ToastType = 'info',
  durationMs?: number,
  action?: { label: string; onClick: () => void },
): void {
  const container = ensureContainer();

  // Errors stay on screen longer — a 3s error is easy to miss entirely.
  const effectiveDuration = durationMs ?? (type === 'error' ? 6500 : 3000);
  const el = document.createElement('div');
  el.className = `pointer-events-auto px-4 py-3 rounded-xl text-sm font-bold shadow-lg backdrop-blur-sm animate-in slide-in-from-right ${TYPE_STYLES[type]} ${action ? 'flex items-center gap-3' : ''}`;
  // Errors are assertive so screen readers announce them immediately.
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.className = 'shrink-0 rounded-lg border border-current/40 px-2 py-1 text-xs font-bold underline underline-offset-2';
    btn.addEventListener('click', () => {
      clearTimeout(dismissTimer);
      el.remove();
      action.onClick();
    });
    el.appendChild(btn);
  }
  el.style.opacity = '0';
  el.style.transform = 'translateX(20px)';
  el.style.transition = 'opacity 0.2s, transform 0.2s';

  container.appendChild(el);

  let dismissTimer: number | undefined;
  // Animate in
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(0)';
  });

  // Auto-dismiss
  dismissTimer = window.setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 200);
  }, effectiveDuration);
}
