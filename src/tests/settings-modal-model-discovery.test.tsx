/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { SettingsModal } from '../components/SettingsModal';

// ── Mocks ────────────────────────────────────────────────────────

vi.mock('../components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const TabsContext = React.createContext<{
  value: string;
  onValueChange: (v: string) => void;
}>({ value: '', onValueChange: () => {} });

vi.mock('../components/ui/tabs', () => ({
  Tabs: ({ value, onValueChange, children, className }: any) => (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  ),
  TabsList: ({ children, className }: any) => <div className={className}>{children}</div>,
  TabsTrigger: ({ value, children, className }: any) => {
    const ctx = React.useContext(TabsContext);
    return (
      <button type="button" onClick={() => ctx.onValueChange(value)} className={className}>
        {children}
      </button>
    );
  },
  TabsContent: ({ value, children, className }: any) => {
    const ctx = React.useContext(TabsContext);
    if (ctx.value !== value) return null;
    return <div className={className}>{children}</div>;
  },
}));

vi.mock('../lib/download-client', () => ({ downloadDbBackup: vi.fn() }));

// ── Helpers ──────────────────────────────────────────────────────

// JSDOM does not implement scrollIntoView
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = vi.fn() as any;
}

function makeConfigResponse(overrides?: Record<string, unknown>) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      baseUrl: 'https://api.example.com/v1',
      model: '',
      hasApiKey: true,
      promptTemplates: {},
      ...overrides,
    }),
  } as Response);
}

function makeTestConnectionResponse(overrides?: Record<string, unknown>) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      models: ['gpt-4o', 'gpt-4o-mini', 'claude-3', 'gemini-2.5-pro'],
      modelDiscovery: 'available',
      selectedModelValid: true,
      modelTested: true,
      connectionOk: true,
      ok: true,
      message: 'OK',
      ...overrides,
    }),
  } as Response);
}

const DEFAULT_FETCH = window.fetch;

// ── Suite ────────────────────────────────────────────────────────

describe('SettingsModal Model Discovery', () => {

  beforeEach(() => {
    localStorage.clear();
    // Default: config fetch works, everything else falls through
    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') return makeConfigResponse();
      return DEFAULT_FETCH(url);
    });
  });

  afterEach(() => {
    window.fetch = DEFAULT_FETCH;
  });

  // ── T1: Cancel deadlock ──

  test('changing API Key while testing re-enables the button', async () => {
    // Make test-connection hang (never resolves)
    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') return makeConfigResponse();
      if (url === '/api/config/test-connection') return new Promise(() => {}); // never settles
      return DEFAULT_FETCH(url);
    });

    render(<SettingsModal isOpen={true} onClose={() => {}} theme="dark" onThemeChange={() => {}} />);

    // Wait for initial config fetch
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Click test connection
    const testBtn = screen.getByText('测试连接');
    fireEvent.click(testBtn);

    // Should show loading state
    expect(screen.getByText('测试中...')).toBeDefined();
    expect((testBtn as HTMLButtonElement).disabled).toBe(true);

    // Change API Key — this should cancel and re-enable
    const apiInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    expect(apiInput).not.toBeNull();
    fireEvent.change(apiInput, { target: { value: 'new-key' } });

    // Wait for React state to settle
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Button should be re-enabled
    expect(screen.queryByText('测试中...')).toBeNull();
    expect((screen.getByText('测试连接') as HTMLButtonElement).disabled).toBe(false);
  });

  test('changing Base URL while testing re-enables the button', async () => {
    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') return makeConfigResponse();
      if (url === '/api/config/test-connection') return new Promise(() => {});
      return DEFAULT_FETCH(url);
    });

    render(<SettingsModal isOpen={true} onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    const testBtn = screen.getByText('测试连接');
    fireEvent.click(testBtn);
    expect((testBtn as HTMLButtonElement).disabled).toBe(true);

    // Change Base URL
    const baseUrlInput = document.querySelector('input[placeholder*="api.deepseek"]') as HTMLInputElement;
    expect(baseUrlInput).not.toBeNull();
    fireEvent.change(baseUrlInput, { target: { value: 'https://new-api.example.com/v1' } });

    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(screen.queryByText('测试中...')).toBeNull();
    expect((screen.getByText('测试连接') as HTMLButtonElement).disabled).toBe(false);
  });

  test('close and reopen modal does not leave loading state', async () => {
    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') return makeConfigResponse();
      if (url === '/api/config/test-connection') return new Promise(() => {});
      return DEFAULT_FETCH(url);
    });

    const { rerender } = render(<SettingsModal isOpen={true} onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    const testBtn = screen.getByText('测试连接');
    fireEvent.click(testBtn);
    expect((testBtn as HTMLButtonElement).disabled).toBe(true);

    // Close modal
    rerender(<></>);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Re-open
    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') return makeConfigResponse();
      return DEFAULT_FETCH(url);
    });

    rerender(<SettingsModal isOpen={true} onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    // Button should not be in loading state
    expect(screen.queryByText('测试中...')).toBeNull();
    const reopenedBtn = screen.getByText('测试连接');
    expect((reopenedBtn as HTMLButtonElement).disabled).toBe(false);
  });

  // ── Stale response ──

  test('stale response from old config does not write back', async () => {
    let resolveTestConnection: ((r: Response) => void) | null = null;

    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') return makeConfigResponse();
      if (url === '/api/config/test-connection') {
        return new Promise<Response>(resolve => { resolveTestConnection = resolve; });
      }
      return DEFAULT_FETCH(url);
    });

    render(<SettingsModal isOpen={true} onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Start a test
    fireEvent.click(screen.getByText('测试连接'));
    expect(screen.getByText('测试中...')).toBeDefined();

    // While request is in-flight, change the model
    const modelInput = document.getElementById('model-input') as HTMLInputElement;
    expect(modelInput).not.toBeNull();
    fireEvent.change(modelInput, { target: { value: 'new-model' } });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Now resolve the OLD request
    await act(async () => {
      const oldResponse = await makeTestConnectionResponse({ models: ['old-model'] });
      resolveTestConnection?.(oldResponse);
      await new Promise(r => setTimeout(r, 50));
    });

    // The old response should NOT have set the discovered models
    // (because cancelPendingTest was called when model changed)
    const modelInfo = screen.queryByText(/已发现.*个模型/);
    expect(modelInfo).toBeNull();
  });

  // ── Model list display, filtering, no-match ──

  test('displays model list after successful test', async () => {
    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') return makeConfigResponse();
      if (url === '/api/config/test-connection') return makeTestConnectionResponse();
      return DEFAULT_FETCH(url);
    });

    const { container } = render(<SettingsModal isOpen={true} onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Click test
    fireEvent.click(screen.getByText('测试连接'));
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    // Should show model count in help text (below the input, not in result banner)
    const allPs = container.querySelectorAll('p');
    const helpP = Array.from(allPs).find(p => p.textContent?.includes('已发现'));
    expect(helpP).toBeDefined();
    expect(helpP!.textContent).toMatch(/4/);

    // Open dropdown
    const modelInput = document.getElementById('model-input') as HTMLInputElement;
    fireEvent.focus(modelInput);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Should see model list items
    const listbox = document.getElementById('model-listbox');
    expect(listbox).not.toBeNull();
    const options = listbox?.querySelectorAll('[role="option"]');
    expect(options?.length).toBe(4);
    expect(screen.getByText('gpt-4o')).toBeDefined();
  });

  test('filters model list as user types', async () => {
    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') return makeConfigResponse();
      if (url === '/api/config/test-connection') return makeTestConnectionResponse();
      return DEFAULT_FETCH(url);
    });

    render(<SettingsModal isOpen={true} onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    fireEvent.click(screen.getByText('测试连接'));
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    // Type to filter
    const modelInput = document.getElementById('model-input') as HTMLInputElement;
    fireEvent.focus(modelInput);
    fireEvent.change(modelInput, { target: { value: 'gpt' } });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Should show only GPT models
    const listbox = document.getElementById('model-listbox');
    const options = listbox?.querySelectorAll('[role="option"]');
    expect(options?.length).toBe(2);
    expect(screen.getByText('gpt-4o')).toBeDefined();
    expect(screen.getByText('gpt-4o-mini')).toBeDefined();
  });

  test('explicit dropdown button shows all models while typing still filters', async () => {
    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') return makeConfigResponse();
      if (url === '/api/config/test-connection') return makeTestConnectionResponse();
      return DEFAULT_FETCH(url);
    });

    render(<SettingsModal isOpen={true} onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    fireEvent.click(screen.getByText('测试连接'));
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    const modelInput = document.getElementById('model-input') as HTMLInputElement;
    fireEvent.change(modelInput, { target: { value: 'gpt' } });
    expect(document.querySelectorAll('#model-listbox [role="option"]')).toHaveLength(2);

    fireEvent.keyDown(modelInput, { key: 'Escape' });
    const dropdownButton = screen.getByRole('button', { name: '展开模型列表' });
    expect(dropdownButton.getAttribute('aria-controls')).toBe('model-listbox');
    fireEvent.click(dropdownButton);

    expect(dropdownButton.getAttribute('aria-expanded')).toBe('true');
    expect(modelInput.value).toBe('gpt');
    expect(document.querySelectorAll('#model-listbox [role="option"]')).toHaveLength(4);

    fireEvent.change(modelInput, { target: { value: 'gemini' } });
    const options = document.querySelectorAll('#model-listbox [role="option"]');
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain('gemini-2.5-pro');
  });

  test('no-match filter falls back to full model list', async () => {
    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') return makeConfigResponse();
      if (url === '/api/config/test-connection') return makeTestConnectionResponse();
      return DEFAULT_FETCH(url);
    });

    render(<SettingsModal isOpen={true} onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    fireEvent.click(screen.getByText('测试连接'));
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    // Type something that matches nothing
    const modelInput = document.getElementById('model-input') as HTMLInputElement;
    fireEvent.focus(modelInput);
    fireEvent.change(modelInput, { target: { value: 'zzzz-not-found' } });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Should show fallback message + full list
    expect(screen.getByText(/当前输入未匹配，展示全部模型/)).toBeDefined();
    const listbox = document.getElementById('model-listbox');
    const options = listbox?.querySelectorAll('[role="option"]');
    expect(options?.length).toBe(4);
  });

  // ── Keyboard and mouse selection ──

  test('clicking a model option selects it', async () => {
    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') return makeConfigResponse();
      if (url === '/api/config/test-connection') return makeTestConnectionResponse();
      return DEFAULT_FETCH(url);
    });

    render(<SettingsModal isOpen={true} onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    fireEvent.click(screen.getByText('测试连接'));
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    // Open dropdown and click a model
    const modelInput = document.getElementById('model-input') as HTMLInputElement;
    fireEvent.focus(modelInput);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    const option = screen.getByText('claude-3');
    fireEvent.mouseDown(option); // uses onMouseDown
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Input should now show the selected model
    expect(modelInput.value).toBe('claude-3');
  });

  test('keyboard arrow navigation selects model', async () => {
    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') return makeConfigResponse();
      if (url === '/api/config/test-connection') return makeTestConnectionResponse();
      return DEFAULT_FETCH(url);
    });

    render(<SettingsModal isOpen={true} onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    fireEvent.click(screen.getByText('测试连接'));
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    const modelInput = document.getElementById('model-input') as HTMLInputElement;
    // Focus and open dropdown
    fireEvent.focus(modelInput);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Arrow down to first item
    fireEvent.keyDown(modelInput, { key: 'ArrowDown' });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Enter to select
    fireEvent.keyDown(modelInput, { key: 'Enter' });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // First model should be selected
    expect(modelInput.value).toBe('gpt-4o');
  });

  // ── Escape on dropdown ──

  test('Escape on open dropdown closes dropdown but not modal', async () => {
    const mockClose = vi.fn();

    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') return makeConfigResponse();
      if (url === '/api/config/test-connection') return makeTestConnectionResponse();
      return DEFAULT_FETCH(url);
    });

    render(<SettingsModal isOpen={true} onClose={mockClose} theme="dark" onThemeChange={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    fireEvent.click(screen.getByText('测试连接'));
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    // Open dropdown
    const modelInput = document.getElementById('model-input') as HTMLInputElement;
    fireEvent.focus(modelInput);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Dropdown should be visible
    expect(document.getElementById('model-listbox')).not.toBeNull();

    // Press Escape on model input
    fireEvent.keyDown(modelInput, { key: 'Escape' });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Dropdown should close
    expect(document.getElementById('model-listbox')).toBeNull();

    // Modal should remain open
    expect(document.getElementById('settings-dialog-container')).not.toBeNull();
    expect(mockClose).not.toHaveBeenCalled();
  });

  // ── ARIA attributes ──

  test('model input has correct ARIA attributes', async () => {
    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') return makeConfigResponse();
      if (url === '/api/config/test-connection') return makeTestConnectionResponse();
      return DEFAULT_FETCH(url);
    });

    render(<SettingsModal isOpen={true} onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    const modelInput = document.getElementById('model-input') as HTMLInputElement;
    expect(modelInput).not.toBeNull();
    expect(modelInput.getAttribute('role')).toBe('combobox');
    expect(modelInput.getAttribute('aria-expanded')).toBe('false');
    expect(modelInput.getAttribute('aria-controls')).toBe('model-listbox');
    expect(modelInput.getAttribute('aria-haspopup')).toBe('listbox');
    expect(modelInput.getAttribute('aria-autocomplete')).toBe('list');

    // Label should have htmlFor pointing to model-input
    const labels = document.querySelectorAll('label');
    const modelLabel = Array.from(labels).find(l => l.textContent?.trim() === 'Model');
    expect(modelLabel).not.toBeNull();
    expect(modelLabel?.getAttribute('for')).toBe('model-input');

    // Open dropdown and check listbox ARIA
    fireEvent.focus(modelInput);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // The dropdown doesn't automatically open on focus for the first time if models are already discovered
    // It should open because discoveredModels.length > 0
    const listbox = document.getElementById('model-listbox');
    if (listbox) {
      expect(listbox.getAttribute('role')).toBe('listbox');
      expect(listbox.getAttribute('aria-label')).toBe('可用模型');
    }
  });

  test('status area has aria-live region', async () => {
    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') return makeConfigResponse();
      if (url === '/api/config/test-connection') return makeTestConnectionResponse();
      return DEFAULT_FETCH(url);
    });

    render(<SettingsModal isOpen={true} onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // The aria-live region should exist in the DOM
    const liveRegion = document.querySelector('[role="status"][aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
  });
});
