/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog';

interface AppDialogRequest {
  kind: 'confirm' | 'prompt';
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  defaultValue?: string;
  placeholder?: string;
  resolve: (value: boolean | string | null) => void;
}

const listeners = new Set<(request: AppDialogRequest | null) => void>();

function emit(request: AppDialogRequest | null): void {
  listeners.forEach((listener) => listener(request));
}

/**
 * Promise-based in-app confirmation. Replaces window.confirm, which embedded
 * browsers and some Electron shells suppress or auto-dismiss.
 */
export function appConfirm(
  title: string,
  description?: string,
  options?: { confirmLabel?: string; cancelLabel?: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    emit({ kind: 'confirm', title, description, ...options, resolve: (value) => resolve(value === true) });
  });
}

/**
 * Promise-based in-app text input. Replaces window.prompt, which shares the
 * same suppression problems as window.confirm in embedded browsers.
 * Resolves the entered string, or null when cancelled.
 */
export function appPrompt(
  title: string,
  options?: { description?: string; defaultValue?: string; placeholder?: string; confirmLabel?: string },
): Promise<string | null> {
  return new Promise((resolve) => {
    emit({ kind: 'prompt', title, ...options, resolve: (value) => resolve(typeof value === 'string' ? value : null) });
  });
}

/** Mount once near the app root to render appConfirm()/appPrompt() requests. */
export function AppDialogHost() {
  const [request, setRequest] = React.useState<AppDialogRequest | null>(null);
  const [inputValue, setInputValue] = React.useState('');
  const settledRef = React.useRef(false);
  React.useEffect(() => {
    const listener = (next: AppDialogRequest | null) => {
      settledRef.current = false;
      setRequest(next);
      setInputValue(next?.defaultValue ?? '');
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const settle = (value: boolean | string | null) => {
    if (settledRef.current) return;
    settledRef.current = true;
    request?.resolve(value);
    setRequest(null);
  };
  if (!request) return null;
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) settle(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request.title}</AlertDialogTitle>
          {request.description ? (
            <AlertDialogDescription>{request.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        {request.kind === 'prompt' ? (
          <input
            autoFocus
            type="text"
            value={inputValue}
            placeholder={request.placeholder}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                settle(request.kind === 'prompt' ? inputValue : true);
              }
            }}
            className="w-full rounded-xl border border-theme-border bg-theme-bg px-3 py-2 text-sm text-theme-text outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/30"
          />
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(null)}>{request.cancelLabel ?? '取消'}</AlertDialogCancel>
          <AlertDialogAction onClick={() => settle(request.kind === 'prompt' ? inputValue : true)}>
            {request.confirmLabel ?? '确定'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
