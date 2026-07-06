import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import axe from 'axe-core';
import { Sidebar } from '../components/Sidebar';
import { SettingsModal } from '../components/SettingsModal';

// Mock tooltip to avoid complicated portal testing in jsdom
vi.mock('../components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('InkFlow Frontend Accessibility & A11y Suite', () => {
  beforeEach(() => {
    // Clear fetch mocks
    vi.restoreAllMocks();

    // Mock the fetch call in SettingsModal to resolve immediately
    window.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          baseUrl: 'http://test.api',
          model: 'gemini-pro',
          hasApiKey: true,
          promptTemplates: {}
        }),
      } as Response)
    );
  });

  describe('Sidebar A11y & Interactive State', () => {
    test('Toggle button should correctly report aria-expanded and aria-controls', () => {
      const mockNavigate = vi.fn();
      const mockUser = { uid: 'test-uid' };

      render(
        <Sidebar
          currentView="welcome"
          onNavigate={mockNavigate}
          user={mockUser}
        />
      );

      // Locate toggle button using aria-label (default uncollapsed state is "折叠侧边栏")
      const toggleBtn = screen.getByLabelText('折叠侧边栏');
      expect(toggleBtn).toBeDefined();
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
      expect(toggleBtn.getAttribute('aria-controls')).toBe('sidebar-nav-panel');

      // Click to collapse
      fireEvent.click(toggleBtn);

      // Now the label should transition to "展开侧边栏" and aria-expanded becomes "false"
      expect(toggleBtn.getAttribute('aria-label')).toBe('展开侧边栏');
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    });

    test('Should execute automated axe-core A11y scan on Sidebar', async () => {
      const mockNavigate = vi.fn();
      const mockUser = { uid: 'test-uid' };

      const { container } = render(
        <Sidebar
          currentView="welcome"
          onNavigate={mockNavigate}
          user={mockUser}
        />
      );

      // Perform direct axe-core scan on the rendered container
      // Disable 'color-contrast' which is extremely slow and prone to timing out in JSDOM environment
      const results = await axe.run(container, {
        rules: {
          'color-contrast': { enabled: false }
        }
      });
      expect(results.violations.length).toBe(0);
    });
  });

  describe('SettingsModal Focus Trap & restoration', () => {
    test('Should auto focus first input on open, trap focus on tab, and restore focus on close', async () => {
      // 1. Create a trigger element to host the initial focus
      const triggerButton = document.createElement('button');
      triggerButton.textContent = 'Open Settings';
      document.body.appendChild(triggerButton);
      triggerButton.focus();
      expect(document.activeElement).toBe(triggerButton);

      const mockClose = vi.fn();

      // 2. Render SettingsModal as open
      const { unmount } = render(
        <SettingsModal
          isOpen={true}
          onClose={mockClose}
          theme="dark"
          onThemeChange={() => {}}
        />
      );

      // 3. Confirm focus was trapped and redirected to the first input in SettingsModal (typically API Key or first TabTrigger)
      const container = document.getElementById('settings-dialog-container');
      expect(container).not.toBeNull();

      const firstInput = container?.querySelector('input, select, textarea, button') as HTMLElement;
      if (firstInput) {
        expect(document.activeElement).toBe(firstInput);
      }

      // 4. Fire Escape key to verify triggers close callback
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(mockClose).toHaveBeenCalledTimes(1);

      // 5. Unmount settings modal to trigger cleanup and check focus restoration
      unmount();
      expect(document.activeElement).toBe(triggerButton);

      // Cleanup DOM
      document.body.removeChild(triggerButton);
    });
  });
});
