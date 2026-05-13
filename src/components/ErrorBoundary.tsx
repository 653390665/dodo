import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="h-full flex flex-col items-center justify-center p-12 text-gray-500 bg-theme-bg/30">
          <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mb-6 border border-red-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h2 className="text-xl font-serif font-bold text-theme-text mb-2">页面出现了意外错误</h2>
          <p className="text-sm text-theme-muted mb-2 max-w-md text-center">
            {this.state.error?.message || '未知渲染错误'}
          </p>
          <div className="flex gap-3 mt-4">
            <button onClick={this.handleRetry} className="px-6 py-2 bg-theme-accent text-white font-bold rounded-xl hover:bg-theme-accent/90 transition-colors">重试</button>
            <button onClick={() => window.location.reload()} className="px-6 py-2 border border-theme-border text-theme-text font-bold rounded-xl hover:bg-theme-sidebar/40 transition-colors">刷新页面</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
