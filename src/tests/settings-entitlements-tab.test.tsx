import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '../components/SettingsModal';

vi.mock('../components/ui/tabs', () => {
  const Context = React.createContext({ value: '', onValueChange: (_value: string) => {} });
  return {
    Tabs: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) => (
      <Context.Provider value={{ value, onValueChange }}>{children}</Context.Provider>
    ),
    TabsList: ({ children, className }: { children: React.ReactNode; className?: string }) => <div role="tablist" className={className}>{children}</div>,
    TabsTrigger: ({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) => {
      const context = React.useContext(Context);
      return <button type="button" role="tab" className={className} onClick={() => context.onValueChange(value)}>{children}</button>;
    },
    TabsContent: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const context = React.useContext(Context);
      return context.value === value ? <div>{children}</div> : null;
    },
  };
});

describe('settings entitlement status', () => {
  it('opens Beta status without access-code controls by default', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })));
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '权益状态' }));
    expect(await screen.findByText(/Beta 默认开放/)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/访问码/)).toBeNull();
    expect(screen.queryByRole('button', { name: /立即激活/ })).toBeNull();
    expect(screen.getByRole('tablist').className).toContain('grid-cols-2');
    expect(screen.getByRole('tablist').className).toContain('sm:grid-cols-4');
    expect(screen.getByRole('tab', { name: '权益状态' }).className).toContain('whitespace-normal');
    expect(screen.getByRole('tab', { name: '权益状态' }).className).toContain('min-h-10');
  });
});
