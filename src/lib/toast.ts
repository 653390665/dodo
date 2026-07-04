/**
 * Minimal toast notification — replaces browser alert() dialogs.
 * No dependencies — uses DOM manipulation with Tailwind classes.
 */

type ToastType = 'info' | 'success' | 'error';

let toastContainer: HTMLDivElement | null = null;

function ensureContainer(): HTMLDivElement {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none';
    toastContainer.setAttribute('role', 'status');
    toastContainer.setAttribute('aria-live', 'polite');
    toastContainer.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

const TYPE_STYLES: Record<ToastType, string> = {
  info: 'bg-theme-text text-white',
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
};

export function toast(message: string, type: ToastType = 'info', durationMs = 3000): void {
  const container = ensureContainer();

  const el = document.createElement('div');
  el.className = `pointer-events-auto px-4 py-3 rounded-xl text-sm font-bold shadow-lg backdrop-blur-sm animate-in slide-in-from-right ${TYPE_STYLES[type]}`;
  el.textContent = message;
  el.style.opacity = '0';
  el.style.transform = 'translateX(20px)';
  el.style.transition = 'opacity 0.2s, transform 0.2s';

  container.appendChild(el);

  // Animate in
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(0)';
  });

  // Auto-dismiss
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 200);
  }, durationMs);
}
