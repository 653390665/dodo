import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Automatically cleanup DOM elements after each test
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia for responsive styles or animations
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }),
});

// Mock ResizeObserver which is missing in jsdom
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserver;

// Mock standard fetch API if needed
window.fetch = window.fetch || (() => Promise.resolve(new Response()));

// toasts inject directly into document.body and survive afterEach cleanup,
// polluting role="alert" queries in later tests. Sweep them between tests.
afterEach(() => {
  document.querySelectorAll('[data-inkflow-toasts]').forEach((node) => node.remove());
});
